import { Router } from 'express';
import { z } from 'zod';
import { assertBranchAccess, effectiveBranch, getAuth, requirePermission } from '../../auth/middleware.js';
import { pool } from '../../db.js';
import { notFound } from '../../http/errors.js';
import { rateLimit } from '../../http/security.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import {
  idParam,
  isoDate,
  moneyString,
  optionalText,
  orderBy,
  pageQuery,
  requiredText,
  searchText,
} from '../../http/validation.js';
import { getSettings, PAYMENT_METHODS } from '../settings/service.js';
import { recordPayment, reversePayment } from './service.js';

export const paymentsRouter = Router();

const listQuery = pageQuery.extend({
  search: searchText,
  from: isoDate.optional(),
  to: isoDate.optional(),
  branchId: z.coerce.number().int().positive().optional(),
  loanId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  agentId: z.coerce.number().int().positive().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(['RECORDED', 'REVERSED']).optional(),
  sort: z.string().optional(),
});

const SORTS = {
  receipt: 'p.receipt_number',
  date: 'p.payment_date',
  amount: 'p.amount',
  customer: 'c.full_name',
};

export const PAYMENT_COLUMNS = `
  p.id, p.receipt_number AS "receiptNumber", p.amount, p.payment_date AS "paymentDate",
  p.payment_method AS "paymentMethod", p.reference_number AS "referenceNumber", p.status, p.notes,
  p.loan_id AS "loanId", l.loan_code AS "loanCode", c.id AS "customerId", c.customer_code AS "customerCode",
  c.full_name AS "customerName", c.phone AS "customerPhone", c.branch_id AS "branchId", b.branch_name AS "branchName",
  COALESCE(p.collected_by, p.recorded_by) AS "collectedById", col.name AS "collectedByName",
  rec.name AS "recordedByName", p.created_at AS "createdAt",
  p.reversed_at AS "reversedAt", rev.name AS "reversedByName", p.reversal_reason AS "reversalReason"`;

export const PAYMENT_FROM = `payments p
  JOIN loans l ON l.id = p.loan_id
  JOIN customers c ON c.id = l.customer_id
  JOIN branches b ON b.id = c.branch_id
  LEFT JOIN users col ON col.id = COALESCE(p.collected_by, p.recorded_by)
  LEFT JOIN users rec ON rec.id = p.recorded_by
  LEFT JOIN users rev ON rev.id = p.reversed_by`;

/** Filters shared by the payment list and the payment-history report. */
export function paymentFilters(req: Parameters<typeof effectiveBranch>[0], q: z.infer<typeof listQuery>): Filters {
  const f = new Filters();
  f.addIf(effectiveBranch(req, q.branchId), 'c.branch_id = ?');
  f.addIf(q.from, 'p.payment_date >= ?::date');
  f.addIf(q.to, `p.payment_date < ?::date + 1`);
  f.addIf(q.loanId, 'p.loan_id = ?');
  f.addIf(q.customerId, 'c.id = ?');
  f.addIf(q.agentId, 'COALESCE(p.collected_by, p.recorded_by) = ?');
  f.addIf(q.method, 'p.payment_method = ?');
  f.addIf(q.status, 'p.status = ?');
  if (q.search) {
    f.add('(p.receipt_number ILIKE ? OR l.loan_code ILIKE ? OR c.full_name ILIKE ? OR p.reference_number ILIKE ?)',
      ...Array(4).fill(likePattern(q.search)));
  }
  return f;
}

export const paymentListQuery = listQuery;

paymentsRouter.get('/', requirePermission('payments.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = paymentFilters(req, q);
  const result = await paginate(pool, {
    select: PAYMENT_COLUMNS,
    from: PAYMENT_FROM,
    filters: f,
    orderBy: orderBy(q.sort, SORTS, 'p.payment_date DESC, p.id DESC'),
    page: q.page,
    pageSize: q.pageSize,
  });
  const totals = await pool.query(
    `SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'RECORDED'), 0) AS "recordedAmount",
            count(*) FILTER (WHERE p.status = 'RECORDED') AS "recordedCount",
            COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'REVERSED'), 0) AS "reversedAmount",
            count(*) FILTER (WHERE p.status = 'REVERSED') AS "reversedCount"
     FROM ${PAYMENT_FROM} ${f.where}`,
    f.params,
  );
  res.json({ ...result, summary: totals.rows[0] });
});

paymentsRouter.get('/:id', requirePermission('payments.view'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `SELECT ${PAYMENT_COLUMNS}, l.outstanding_balance AS "loanOutstanding", l.total_payable AS "loanTotalPayable",
            l.status AS "loanStatus", b.address AS "branchAddress", b.phone AS "branchPhone"
     FROM ${PAYMENT_FROM} WHERE p.id = $1`,
    [id],
  );
  const payment = rows[0];
  if (!payment) throw notFound('Payment');
  assertBranchAccess(req, payment.branchId);

  const allocations = await pool.query(
    `SELECT pa.schedule_id AS "scheduleId", cs.installment_number AS "installmentNumber",
            cs.due_date AS "dueDate", cs.due_amount AS "dueAmount", pa.allocated_amount AS "allocatedAmount"
     FROM payment_allocations pa JOIN collection_schedules cs ON cs.id = pa.schedule_id
     WHERE pa.payment_id = $1 ORDER BY cs.installment_number`,
    [id],
  );
  const settings = await getSettings(pool);
  res.json({
    data: {
      ...payment,
      allocations: allocations.rows,
      companyName: settings['company.name'],
      currency: settings['company.currency'],
    },
  });
});

const createBody = z.object({
  loanId: z.number().int().positive(),
  amount: moneyString,
  paymentMethod: z.enum(PAYMENT_METHODS),
  referenceNumber: optionalText(100),
  notes: optionalText(255),
  paymentDate: z.iso.datetime({ offset: true }).optional().nullable(),
  collectedBy: z.number().int().positive().optional().nullable(),
  idempotencyKey: z.uuid('A unique submission key is required'),
}).refine((b) => !['UPI', 'BANK_TRANSFER', 'CHEQUE'].includes(b.paymentMethod) || b.referenceNumber, {
  path: ['referenceNumber'],
  message: 'A reference number is required for UPI, bank transfer and cheque payments',
});

const paymentLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  key: (req) => `payments:${req.auth?.userId}`,
  message: 'Too many payments submitted in a minute. Please wait a moment.',
});

paymentsRouter.post('/', requirePermission('payments.create'), paymentLimiter, async (req, res) => {
  const body = createBody.parse(req.body);
  const result = await recordPayment(req, getAuth(req).userId, {
    ...body,
    paymentDate: body.paymentDate ?? null,
    collectedBy: body.collectedBy ?? null,
  });
  res.status(result.replayed ? 200 : 201).json({ data: result });
});

const reverseBody = z.object({ reason: requiredText(255) });

paymentsRouter.post('/:id/reverse', requirePermission('payments.reverse'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = reverseBody.parse(req.body);
  await reversePayment(req, getAuth(req).userId, id, reason);
  res.status(204).end();
});
