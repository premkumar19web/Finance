import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { INTEGRITY_CHECKS } from '../db/integrity.js';
import { pool } from '../db.js';
import { fromPaise, toPaise } from '../finance/money.js';
import { ApiClient, createDisbursedLoan, startServer } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
let admin: ApiClient;
let manager: ApiClient;
let accountant: ApiClient;
let agent: ApiClient;

before(async () => {
  server = await startServer();
  admin = new ApiClient(server.baseUrl);
  manager = new ApiClient(server.baseUrl);
  accountant = new ApiClient(server.baseUrl);
  agent = new ApiClient(server.baseUrl);
  await admin.login('admin@lionfinance.test');
  await manager.login('manager@lionfinance.test');
  await accountant.login('accountant@lionfinance.test');
  await agent.login('agent@lionfinance.test');
});
after(async () => {
  await server.close();
  await pool.end();
});

const loanSetup = () => createDisbursedLoan({ admin, manager, accountant });
const pay = (client: ApiClient, loanId: number, amount: string, extra: Record<string, unknown> = {}) =>
  client.post('/payments', { loanId, amount, paymentMethod: 'CASH', idempotencyKey: randomUUID(), ...extra });

describe('recording payments', () => {
  it('records a payment, issues a receipt and updates balances exactly', async () => {
    const { loanId } = await loanSetup();
    const before = (await admin.get(`/loans/${loanId}`)).body.data;
    const firstDue = before.schedule[0].totalDue as string;

    const res = await pay(agent, loanId, '1500.00');
    assert.equal(res.status, 201);
    assert.match(res.body.data.receiptNumber, /^LF-\d{8}-\d{6}$/);

    const after = (await admin.get(`/loans/${loanId}`)).body.data;
    assert.equal(after.outstandingBalance, fromPaise(toPaise(before.outstandingBalance) - toPaise('1500.00')));
    assert.equal(after.schedule[0].status, 'PAID');
    assert.equal(after.schedule[1].paidAmount, fromPaise(toPaise('1500.00') - toPaise(firstDue)));
    assert.equal(after.schedule[1].status, 'PARTIAL');

    const receipt = (await admin.get(`/payments/${res.body.data.id}`)).body.data;
    assert.equal(receipt.allocations.length, 2);
    assert.equal(receipt.collectedByName, 'Ganesh Agent');
  });

  it('returns the original payment when the same submission is retried', async () => {
    const { loanId } = await loanSetup();
    const key = randomUUID();
    const first = await pay(agent, loanId, '500', { idempotencyKey: key });
    const retry = await pay(agent, loanId, '500', { idempotencyKey: key });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.id, first.body.data.id);
    assert.equal(retry.body.data.replayed, true);
    const list = await admin.get(`/payments?loanId=${loanId}`);
    assert.equal(list.body.meta.total, 1);

    const misuse = await pay(agent, loanId, '600', { idempotencyKey: key });
    assert.equal(misuse.status, 409);
    assert.equal(misuse.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('records only one payment when the same submission arrives twice at once', async () => {
    const { loanId } = await loanSetup();
    const key = randomUUID();
    const [a, b] = await Promise.all([pay(agent, loanId, '700', { idempotencyKey: key }), pay(agent, loanId, '700', { idempotencyKey: key })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    assert.equal(a.body.data.id, b.body.data.id);
    assert.equal((await admin.get(`/payments?loanId=${loanId}`)).body.meta.total, 1);
  });

  it('never lets concurrent payments exceed the outstanding balance', async () => {
    const { loanId } = await loanSetup();
    const outstanding = (await admin.get(`/loans/${loanId}`)).body.data.outstandingBalance as string;
    const results = await Promise.all([pay(agent, loanId, outstanding), pay(agent, loanId, outstanding)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 422]);
    const loan = (await admin.get(`/loans/${loanId}`)).body.data;
    assert.equal(loan.outstandingBalance, '0.00');
    assert.equal(loan.status, 'CLOSED');
  });

  it('rejects overpayments, zero and negative amounts, and bad formats', async () => {
    const { loanId } = await loanSetup();
    const outstanding = (await admin.get(`/loans/${loanId}`)).body.data.outstandingBalance as string;
    const over = await pay(agent, loanId, fromPaise(toPaise(outstanding) + 1n));
    assert.equal(over.status, 422);
    assert.equal(over.body.error.code, 'OVERPAYMENT');
    assert.equal((await pay(agent, loanId, '0')).status, 422);
    assert.equal((await pay(agent, loanId, '-10')).status, 400);
    assert.equal((await pay(agent, loanId, '10.999')).status, 400);
    assert.equal((await admin.get(`/payments?loanId=${loanId}`)).body.meta.total, 0);
  });

  it('requires a reference number for UPI, bank transfer and cheque', async () => {
    const { loanId } = await loanSetup();
    const res = await pay(agent, loanId, '100', { paymentMethod: 'UPI' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'referenceNumber');
    assert.equal((await pay(agent, loanId, '100', { paymentMethod: 'UPI', referenceNumber: 'UPI123456789012' })).status, 201);
  });

  it('agents can only collect on loans assigned to them', async () => {
    const { loanId } = await loanSetup();
    const assignments = (await admin.get(`/assignments?loanId=${loanId}&active=true`)).body.data;
    assert.equal((await admin.post(`/assignments/${assignments[0].id}/end`)).status, 204);
    const res = await pay(agent, loanId, '100');
    assert.equal(res.status, 403);
  });

  it('refuses payments on loans that are not active', async () => {
    const { loanId } = await loanSetup();
    const loan = (await admin.get(`/loans/${loanId}`)).body.data;
    await pay(agent, loanId, loan.outstandingBalance);
    const res = await pay(agent, loanId, '1');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'LOAN_NOT_ACTIVE');
  });
});

describe('reversing payments', () => {
  it('restores installment and loan balances and re-opens a closed loan', async () => {
    const { loanId } = await loanSetup();
    const before = (await admin.get(`/loans/${loanId}`)).body.data;
    const paid = await pay(agent, loanId, before.outstandingBalance);
    assert.equal((await admin.get(`/loans/${loanId}`)).body.data.status, 'CLOSED');

    assert.equal((await agent.post(`/payments/${paid.body.data.id}/reverse`, { reason: 'test' })).status, 403);
    assert.equal((await accountant.post(`/payments/${paid.body.data.id}/reverse`, {})).status, 400);
    assert.equal((await accountant.post(`/payments/${paid.body.data.id}/reverse`, { reason: 'Entered twice' })).status, 204);

    const after = (await admin.get(`/loans/${loanId}`)).body.data;
    assert.equal(after.status, 'ACTIVE');
    assert.equal(after.outstandingBalance, before.outstandingBalance);
    assert.ok(after.schedule.every((s: { paidAmount: string }) => s.paidAmount === '0.00'));
    const payment = (await admin.get(`/payments/${paid.body.data.id}`)).body.data;
    assert.equal(payment.status, 'REVERSED');
    assert.equal(payment.reversalReason, 'Entered twice');

    const again = await accountant.post(`/payments/${paid.body.data.id}/reverse`, { reason: 'again' });
    assert.equal(again.status, 422);
    assert.equal(again.body.error.code, 'ALREADY_REVERSED');
  });

  it('writes an audit entry for each payment and reversal', async () => {
    const { loanId } = await loanSetup();
    const p = await pay(agent, loanId, '250');
    await accountant.post(`/payments/${p.body.data.id}/reverse`, { reason: 'Audit check' });
    const logs = (await admin.get(`/audit-logs?entityType=payment&entityId=${p.body.data.id}`)).body.data;
    assert.deepEqual(logs.map((l: { action: string }) => l.action).sort(), ['PAYMENT_RECORDED', 'PAYMENT_REVERSED']);
    assert.ok(!JSON.stringify(logs).includes('password'));
  });
});

describe('database integrity', () => {
  it('payments cannot be edited or deleted directly in the database', async () => {
    const { rows } = await pool.query('SELECT id FROM payments LIMIT 1');
    await assert.rejects(pool.query('UPDATE payments SET amount = amount + 1 WHERE id = $1', [rows[0].id]), /immutable/);
    await assert.rejects(pool.query('DELETE FROM payments WHERE id = $1', [rows[0].id]), /cannot be deleted/);
  });

  it('all invariants hold across seeded and test-created data', async () => {
    for (const [label, sql] of INTEGRITY_CHECKS) {
      const { rows } = await pool.query(sql);
      assert.equal(Number(Object.values(rows[0])[0]), 0, label);
    }
  });
});
