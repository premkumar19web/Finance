// Recording and reversing payments. Every balance change happens inside one
// database transaction with the loan and its installments locked (SELECT ... FOR
// UPDATE), so two collectors paying the same loan at once cannot double-apply.

import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { audit } from '../../audit.js';
import { assertBranchAccess, isAgentOnly } from '../../auth/middleware.js';
import { withTransaction } from '../../db.js';
import { allocatePayment, installmentStatus, OverpaymentError } from '../../finance/allocation.js';
import { fromPaise, toPaise } from '../../finance/money.js';
import { AppError, businessRule, conflict, forbidden, notFound } from '../../http/errors.js';
import { getSettings, type PaymentMethod } from '../settings/service.js';

export interface NewPayment {
  loanId: number;
  amount: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
  /** ISO timestamp; defaults to now. */
  paymentDate: string | null;
  collectedBy: number | null;
  idempotencyKey: string;
}

export interface PaymentResult {
  id: number;
  receiptNumber: string;
  /** true when this request repeated an earlier submission with the same idempotency key. */
  replayed: boolean;
}

export async function recordPayment(req: Request, userId: number, input: NewPayment): Promise<PaymentResult> {
  try {
    return await withTransaction((db) => recordPaymentTx(db, req, userId, input));
  } catch (err) {
    // Two identical submissions raced: the loser hits the unique idempotency key.
    if ((err as { code?: string; constraint?: string }).constraint === 'payments_idempotency_key_key') {
      return withTransaction((db) => findReplay(db, input));
    }
    throw err;
  }
}

async function findReplay(db: PoolClient, input: NewPayment): Promise<PaymentResult> {
  const { rows } = await db.query<{ id: number; receipt_number: string; loan_id: number; amount: string }>(
    'SELECT id, receipt_number, loan_id, amount FROM payments WHERE idempotency_key = $1',
    [input.idempotencyKey],
  );
  const existing = rows[0];
  if (!existing) throw new AppError(500, 'INTERNAL_ERROR', 'Could not confirm the payment. Please check payment history.');
  if (existing.loan_id !== input.loanId || toPaise(existing.amount) !== toPaise(input.amount)) {
    throw conflict('This submission key was already used for a different payment.', 'IDEMPOTENCY_KEY_REUSED');
  }
  return { id: existing.id, receiptNumber: existing.receipt_number, replayed: true };
}

async function recordPaymentTx(db: PoolClient, req: Request, userId: number, input: NewPayment): Promise<PaymentResult> {
  const replay = await db.query('SELECT 1 FROM payments WHERE idempotency_key = $1', [input.idempotencyKey]);
  if (replay.rowCount) return findReplay(db, input);

  const settings = await getSettings(db);
  if (!settings['payments.enabled_methods'].includes(input.paymentMethod)) {
    throw businessRule('METHOD_DISABLED', 'This payment method is not enabled.');
  }

  const loanResult = await db.query<{
    id: number;
    loan_code: string;
    status: string;
    branch_id: number;
    outstanding_balance: string;
    disbursed_at: Date;
  }>(
    `SELECT l.id, l.loan_code, l.status, c.branch_id, l.outstanding_balance, l.disbursed_at
     FROM loans l JOIN customers c ON c.id = l.customer_id
     WHERE l.id = $1 FOR UPDATE OF l`,
    [input.loanId],
  );
  const loan = loanResult.rows[0];
  if (!loan) throw notFound('Loan');
  assertBranchAccess(req, loan.branch_id);
  if (isAgentOnly(req)) {
    const assigned = await db.query(
      'SELECT 1 FROM collection_assignments WHERE loan_id = $1 AND agent_user_id = $2 AND unassigned_at IS NULL',
      [input.loanId, userId],
    );
    if (!assigned.rowCount) throw forbidden('This loan is not assigned to you.');
  }
  if (loan.status !== 'ACTIVE' && loan.status !== 'DEFAULTED') {
    throw businessRule('LOAN_NOT_ACTIVE', `Payments cannot be recorded while the loan is ${loan.status}.`);
  }

  if (input.paymentDate) {
    const when = new Date(input.paymentDate);
    if (when.getTime() > Date.now() + 60_000) throw businessRule('PAYMENT_IN_FUTURE', 'Payment date cannot be in the future.');
    if (when < loan.disbursed_at) {
      throw businessRule('PAYMENT_BEFORE_DISBURSAL', 'Payment date cannot be before the loan was disbursed.');
    }
  }

  const collectorId = input.collectedBy ?? userId;
  if (input.collectedBy) {
    const collector = await db.query('SELECT branch_id, is_active FROM users WHERE id = $1', [input.collectedBy]);
    const c = collector.rows[0];
    if (!c || !c.is_active || c.branch_id !== loan.branch_id) {
      throw businessRule('INVALID_COLLECTOR', 'The collector must be an active user of the loan’s branch.');
    }
  }

  const schedule = await db.query<{ id: number; installment_number: number; due_amount: string; paid_amount: string }>(
    `SELECT id, installment_number, due_amount, paid_amount FROM collection_schedules
     WHERE loan_id = $1 AND status IN ('PENDING', 'PARTIAL', 'OVERDUE')
     ORDER BY installment_number FOR UPDATE`,
    [input.loanId],
  );
  const amount = toPaise(input.amount);
  if (amount <= 0n) throw businessRule('INVALID_AMOUNT', 'Payment amount must be greater than zero.');

  let allocations;
  try {
    allocations = allocatePayment(
      amount,
      schedule.rows.map((s) => ({
        scheduleId: s.id,
        installmentNumber: s.installment_number,
        outstanding: toPaise(s.due_amount) - toPaise(s.paid_amount),
      })),
    );
  } catch (err) {
    if (err instanceof OverpaymentError) {
      throw businessRule('OVERPAYMENT', `Payment exceeds the outstanding balance of ₹${fromPaise(err.outstanding)}.`, {
        outstanding: fromPaise(err.outstanding),
      });
    }
    throw err;
  }

  const receipt = await db.query<{ receipt_number: string }>(
    `SELECT $1 || '-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || lpad(nextval('receipt_number_seq')::text, 6, '0')
       AS receipt_number`,
    [settings['receipts.prefix']],
  );
  const receiptNumber = receipt.rows[0]!.receipt_number;

  const inserted = await db.query<{ id: number }>(
    `INSERT INTO payments (loan_id, amount, payment_date, payment_method, reference_number, recorded_by,
                           collected_by, notes, receipt_number, idempotency_key)
     VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      input.loanId,
      fromPaise(amount),
      input.paymentDate,
      input.paymentMethod,
      input.referenceNumber,
      userId,
      collectorId,
      input.notes,
      receiptNumber,
      input.idempotencyKey,
    ],
  );
  const paymentId = inserted.rows[0]!.id;

  const byId = new Map(schedule.rows.map((s) => [s.id, s]));
  for (const a of allocations) {
    const s = byId.get(a.scheduleId)!;
    const newPaid = toPaise(s.paid_amount) + a.amount;
    await db.query(
      'INSERT INTO payment_allocations (payment_id, schedule_id, loan_id, allocated_amount) VALUES ($1, $2, $3, $4)',
      [paymentId, a.scheduleId, input.loanId, fromPaise(a.amount)],
    );
    await db.query('UPDATE collection_schedules SET paid_amount = $2, status = $3 WHERE id = $1', [
      a.scheduleId,
      fromPaise(newPaid),
      installmentStatus(newPaid, toPaise(s.due_amount)),
    ]);
  }

  const newOutstanding = toPaise(loan.outstanding_balance) - amount;
  await db.query(
    `UPDATE loans SET outstanding_balance = $2,
            status = CASE WHEN $2::numeric = 0 THEN 'CLOSED' ELSE status END,
            closed_at = CASE WHEN $2::numeric = 0 THEN NOW() ELSE closed_at END
     WHERE id = $1`,
    [input.loanId, fromPaise(newOutstanding)],
  );

  await audit(db, req, {
    action: 'PAYMENT_RECORDED',
    entityType: 'payment',
    entityId: paymentId,
    details: {
      receiptNumber,
      loanCode: loan.loan_code,
      amount: fromPaise(amount),
      method: input.paymentMethod,
      installments: allocations.length,
      loanClosed: newOutstanding === 0n,
    },
  });
  if (newOutstanding === 0n) {
    await audit(db, req, { action: 'LOAN_CLOSED', entityType: 'loan', entityId: input.loanId, details: { loanCode: loan.loan_code } });
  }
  return { id: paymentId, receiptNumber, replayed: false };
}

/**
 * Reverses a payment: its allocations stop counting, installment and loan balances
 * are restored, and a closed loan re-opens. The payment row and its allocations are
 * kept for the audit trail (balances only count RECORDED payments).
 */
export async function reversePayment(req: Request, userId: number, paymentId: number, reason: string): Promise<void> {
  await withTransaction(async (db) => {
    const p = await db.query<{
      id: number;
      loan_id: number;
      amount: string;
      status: string;
      receipt_number: string;
      within_window: boolean;
    }>(
      `SELECT p.id, p.loan_id, p.amount, p.status, p.receipt_number,
              p.payment_date >= NOW() - make_interval(days => $2) AS within_window
       FROM payments p WHERE p.id = $1 FOR UPDATE`,
      [paymentId, (await getSettings(db))['payments.reversal_window_days']],
    );
    const payment = p.rows[0];
    if (!payment) throw notFound('Payment');
    if (payment.status !== 'RECORDED') throw businessRule('ALREADY_REVERSED', 'This payment has already been reversed.');
    if (!payment.within_window) {
      throw businessRule('REVERSAL_WINDOW_PASSED', 'This payment is older than the reversal window and cannot be reversed.');
    }

    const loanResult = await db.query<{ loan_code: string; status: string; branch_id: number; outstanding_balance: string }>(
      `SELECT l.loan_code, l.status, c.branch_id, l.outstanding_balance
       FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1 FOR UPDATE OF l`,
      [payment.loan_id],
    );
    const loan = loanResult.rows[0]!;
    assertBranchAccess(req, loan.branch_id);

    const allocations = await db.query<{ schedule_id: number; allocated_amount: string; due_amount: string; paid_amount: string }>(
      `SELECT pa.schedule_id, pa.allocated_amount, cs.due_amount, cs.paid_amount
       FROM payment_allocations pa JOIN collection_schedules cs ON cs.id = pa.schedule_id
       WHERE pa.payment_id = $1 FOR UPDATE OF cs`,
      [paymentId],
    );
    for (const a of allocations.rows) {
      const newPaid = toPaise(a.paid_amount) - toPaise(a.allocated_amount);
      await db.query('UPDATE collection_schedules SET paid_amount = $2, status = $3 WHERE id = $1', [
        a.schedule_id,
        fromPaise(newPaid),
        installmentStatus(newPaid, toPaise(a.due_amount)),
      ]);
    }

    const restored = toPaise(loan.outstanding_balance) + toPaise(payment.amount);
    await db.query(
      `UPDATE loans SET outstanding_balance = $2,
              status = CASE WHEN status = 'CLOSED' THEN 'ACTIVE' ELSE status END,
              closed_at = NULL
       WHERE id = $1`,
      [payment.loan_id, fromPaise(restored)],
    );
    await db.query(
      `UPDATE payments SET status = 'REVERSED', reversed_at = NOW(), reversed_by = $2, reversal_reason = $3 WHERE id = $1`,
      [paymentId, userId, reason],
    );
    await audit(db, req, {
      action: 'PAYMENT_REVERSED',
      entityType: 'payment',
      entityId: paymentId,
      details: { receiptNumber: payment.receipt_number, loanCode: loan.loan_code, amount: payment.amount, reason },
    });
  });
}
