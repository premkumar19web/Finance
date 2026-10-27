import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pool } from '../db.js';
import { ApiClient, createDisbursedLoan, startServer, todayFromApi, unique } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
let admin: ApiClient;
let manager: ApiClient;
let accountant: ApiClient;
let branchId: number;

before(async () => {
  server = await startServer();
  admin = new ApiClient(server.baseUrl);
  manager = new ApiClient(server.baseUrl);
  accountant = new ApiClient(server.baseUrl);
  await admin.login('admin@lionfinance.test');
  await manager.login('manager@lionfinance.test');
  await accountant.login('accountant@lionfinance.test');
  branchId = (await admin.get('/branches?search=BR001')).body.data[0].id;
});
after(async () => {
  await server.close();
  await pool.end();
});

describe('branches', () => {
  it('creates, updates and rejects duplicate codes', async () => {
    const code = `T-${unique()}`.slice(0, 30);
    const created = await admin.post('/branches', { branchCode: code, branchName: 'Test Branch', city: 'Testville' });
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal((await admin.patch(`/branches/${id}`, { branchName: 'Renamed Branch' })).status, 204);
    assert.equal((await admin.get(`/branches/${id}`)).body.data.branchName, 'Renamed Branch');
    const dup = await admin.post('/branches', { branchCode: code, branchName: 'Again' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.message, 'A branch with this code already exists.');
  });

  it('validates branch codes', async () => {
    const res = await admin.post('/branches', { branchCode: 'bad code!', branchName: 'X' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'branchCode');
  });
});

describe('customers', () => {
  it('creates a customer with a generated code, then finds and edits it', async () => {
    const name = `Kumar Test ${unique()}`;
    const created = await admin.post('/customers', {
      branchId, fullName: name, phone: '+91 00000 12345', email: 'kumar.test@example.com',
      idDocumentType: 'AADHAAR', idDocumentLast4: '1234',
    });
    assert.equal(created.status, 201);
    assert.match(created.body.data.customerCode, /^CUST-\d{6}$/);
    const id = created.body.data.id;

    const search = await admin.get(`/customers?search=${encodeURIComponent(name)}`);
    assert.equal(search.body.meta.total, 1);
    assert.equal((await admin.patch(`/customers/${id}`, { occupation: 'Tailor' })).status, 204);
    const detail = await admin.get(`/customers/${id}`);
    assert.equal(detail.body.data.occupation, 'Tailor');
    assert.deepEqual(detail.body.data.loans, []);
  });

  it('returns field-level validation errors', async () => {
    const res = await admin.post('/customers', { branchId, fullName: '', phone: 'abc' });
    assert.equal(res.status, 400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    assert.deepEqual(fields, ['fullName', 'phone']);
  });

  it('requires the document type and last 4 together', async () => {
    const res = await admin.post('/customers', { branchId, fullName: 'Doc Test', phone: '+91 00000 12345', idDocumentType: 'PAN' });
    assert.equal(res.status, 400);
  });

  it('treats search text literally (no SQL wildcards or injection)', async () => {
    const res = await admin.get(`/customers?search=${encodeURIComponent("%' OR 1=1 --")}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.total, 0);
  });

  it('cannot deactivate a customer with an open loan', async () => {
    const { customerId } = await createDisbursedLoan({ admin, manager, accountant });
    const res = await admin.patch(`/customers/${customerId}`, { isActive: false });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'CUSTOMER_HAS_OPEN_LOANS');
  });
});

describe('loans', () => {
  let customerId: number;
  before(async () => {
    customerId = (await admin.post('/customers', { branchId, fullName: `Loan Test ${unique()}`, phone: '+91 00000 22222' })).body.data.id;
  });

  it('previews a schedule that matches the documented flat-interest policy', async () => {
    const today = await todayFromApi(admin);
    const res = await admin.post('/loans/preview', {
      principalAmount: '50000', annualInterestRate: '18', loanTerm: 12, collectionFrequency: 'MONTHLY', loanStartDate: today,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.totalInterest, '9000.00');
    assert.equal(res.body.data.totalPayable, '59000.00');
    assert.equal(res.body.data.installments.length, 12);
  });

  it('rejects out-of-policy amounts and dates', async () => {
    const today = await todayFromApi(admin);
    const base = { customerId, annualInterestRate: '24', loanTerm: 10, collectionFrequency: 'WEEKLY', loanStartDate: today };
    const small = await admin.post('/loans', { ...base, principalAmount: '10' });
    assert.equal(small.status, 422);
    assert.equal(small.body.error.code, 'PRINCIPAL_OUT_OF_RANGE');
    const rate = await admin.post('/loans', { ...base, principalAmount: '10000', annualInterestRate: '99' });
    assert.equal(rate.body.error.code, 'RATE_TOO_HIGH');
    const past = await admin.post('/loans', { ...base, principalAmount: '10000', loanStartDate: '2020-01-01' });
    assert.equal(past.body.error.code, 'START_DATE_IN_PAST');
    const badDate = await admin.post('/loans', { ...base, principalAmount: '10000', loanStartDate: '2026-02-30' });
    assert.equal(badDate.status, 400);
    const negative = await admin.post('/loans', { ...base, principalAmount: '-5000' });
    assert.equal(negative.status, 400);
  });

  it('enforces maker-checker approval and the lifecycle order', async () => {
    const today = await todayFromApi(admin);
    const created = await admin.post('/loans', {
      customerId, principalAmount: '20000', annualInterestRate: '20', loanTerm: 20, collectionFrequency: 'WEEKLY', loanStartDate: today,
    });
    assert.equal(created.status, 201);
    assert.match(created.body.data.loanCode, /^LN-\d{6}$/);
    const id = created.body.data.id;

    assert.equal((await accountant.post(`/loans/${id}/disburse`)).status, 422); // not approved yet
    const self = await admin.post(`/loans/${id}/approve`);
    assert.equal(self.status, 422);
    assert.equal(self.body.error.code, 'MAKER_CHECKER');
    assert.equal((await manager.post(`/loans/${id}/approve`)).status, 204);
    assert.equal((await manager.post(`/loans/${id}/approve`)).status, 422); // already approved
    assert.equal((await accountant.post(`/loans/${id}/disburse`)).status, 204);

    const loan = (await admin.get(`/loans/${id}`)).body.data;
    assert.equal(loan.status, 'ACTIVE');
    assert.equal(loan.schedule.length, 20);
    assert.equal(loan.outstandingBalance, loan.totalPayable);
  });

  it('rejects a loan with a reason', async () => {
    const today = await todayFromApi(admin);
    const id = (await admin.post('/loans', {
      customerId, principalAmount: '15000', annualInterestRate: '20', loanTerm: 6, collectionFrequency: 'MONTHLY', loanStartDate: today,
    })).body.data.id;
    assert.equal((await manager.post(`/loans/${id}/reject`, {})).status, 400);
    assert.equal((await manager.post(`/loans/${id}/reject`, { reason: 'Insufficient income' })).status, 204);
    const loan = (await admin.get(`/loans/${id}`)).body.data;
    assert.equal(loan.status, 'REJECTED');
    assert.equal(loan.rejectionReason, 'Insufficient income');
  });
});
