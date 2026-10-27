import { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { assertBranchAccess, effectiveBranch, getAuth, requirePermission } from '../../auth/middleware.js';
import { pool, withTransaction } from '../../db.js';
import { fromPaise, toPaise, toRateUnits } from '../../finance/money.js';
import { buildSchedule, COLLECTION_FREQUENCIES, type CollectionFrequency } from '../../finance/schedule.js';
import { badRequest, businessRule, notFound } from '../../http/errors.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import {
  idParam,
  isoDate,
  moneyString,
  optionalText,
  orderBy,
  pageQuery,
  rateString,
  requiredText,
  searchText,
} from '../../http/validation.js';
import { getSettings } from '../settings/service.js';
import {
  assignAgent,
  businessToday,
  insertSchedule,
  scheduleToJson,
  validateAndBuildSchedule,
} from './service.js';

export const loansRouter = Router();

export const LOAN_STATUSES = ['PENDING', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'DEFAULTED'] as const;

const listQuery = pageQuery.extend({
  search: searchText,
  status: z.enum(LOAN_STATUSES).optional(),
  frequency: z.enum(COLLECTION_FREQUENCIES).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  agentId: z.coerce.number().int().positive().optional(),
  sort: z.string().optional(),
});

const SORTS = {
  code: 'l.loan_code',
  customer: 'c.full_name',
  principal: 'l.principal_amount',
  outstanding: 'l.outstanding_balance',
  startDate: 'l.loan_start_date',
  maturityDate: 'l.maturity_date',
  status: 'l.status',
  createdAt: 'l.created_at',
};

const LOAN_COLUMNS = `
  l.id, l.loan_code AS "loanCode", l.customer_id AS "customerId", c.customer_code AS "customerCode",
  c.full_name AS "customerName", c.phone AS "customerPhone", c.branch_id AS "branchId", b.branch_name AS "branchName",
  l.principal_amount AS "principalAmount", l.annual_interest_rate AS "annualInterestRate",
  l.interest_method AS "interestMethod", l.total_interest AS "totalInterest", l.total_payable AS "totalPayable",
  l.outstanding_balance AS "outstandingBalance", l.loan_term AS "loanTerm",
  l.collection_frequency AS "collectionFrequency", l.loan_start_date AS "loanStartDate",
  l.maturity_date AS "maturityDate", l.status, l.purpose, l.created_at AS "createdAt",
  l.approved_at AS "approvedAt", l.disbursed_at AS "disbursedAt", l.closed_at AS "closedAt",
  l.rejected_at AS "rejectedAt", l.rejection_reason AS "rejectionReason",
  (SELECT json_build_object('id', u.id, 'name', u.name) FROM collection_assignments ca
     JOIN users u ON u.id = ca.agent_user_id
     WHERE ca.loan_id = l.id AND ca.unassigned_at IS NULL) AS agent`;

const LOAN_FROM = 'loans l JOIN customers c ON c.id = l.customer_id JOIN branches b ON b.id = c.branch_id';

loansRouter.get('/', requirePermission('loans.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = new Filters();
  f.addIf(effectiveBranch(req, q.branchId), 'c.branch_id = ?');
  f.addIf(q.status, 'l.status = ?');
  f.addIf(q.frequency, 'l.collection_frequency = ?');
  f.addIf(q.customerId, 'l.customer_id = ?');
  f.addIf(
    q.agentId,
    'EXISTS (SELECT 1 FROM collection_assignments ca WHERE ca.loan_id = l.id AND ca.unassigned_at IS NULL AND ca.agent_user_id = ?)',
  );
  if (q.search) {
    f.add('(l.loan_code ILIKE ? OR c.full_name ILIKE ? OR c.customer_code ILIKE ? OR c.phone ILIKE ?)',
      ...Array(4).fill(likePattern(q.search)));
  }
  res.json(
    await paginate(pool, {
      select: LOAN_COLUMNS,
      from: LOAN_FROM,
      filters: f,
      orderBy: orderBy(q.sort, SORTS, 'l.created_at DESC, l.id DESC'),
      page: q.page,
      pageSize: q.pageSize,
    }),
  );
});

async function loadLoanForAccess(req: Request, id: number) {
  const { rows } = await pool.query(
    `SELECT ${LOAN_COLUMNS},
            cb.name AS "createdByName", ab.name AS "approvedByName", db.name AS "disbursedByName",
            rb.name AS "rejectedByName", l.created_by AS "createdBy"
     FROM ${LOAN_FROM}
     LEFT JOIN users cb ON cb.id = l.created_by
     LEFT JOIN users ab ON ab.id = l.approved_by
     LEFT JOIN users db ON db.id = l.disbursed_by
     LEFT JOIN users rb ON rb.id = l.rejected_by
     WHERE l.id = $1`,
    [id],
  );
  const loan = rows[0];
  if (!loan) throw notFound('Loan');
  assertBranchAccess(req, loan.branchId);
  return loan;
}

loansRouter.get('/:id', requirePermission('loans.view'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const loan = await loadLoanForAccess(req, id);

  const [schedule, payments, assignments, summary] = await Promise.all([
    pool.query(
      `SELECT id, installment_number AS "installmentNumber", due_date AS "dueDate",
              principal_due AS "principalDue", interest_due AS "interestDue", due_amount AS "totalDue",
              paid_amount AS "paidAmount", outstanding_amount AS "outstandingAmount",
              status, effective_status AS "effectiveStatus", days_past_due AS "daysPastDue"
       FROM v_collection_schedules WHERE loan_id = $1 ORDER BY installment_number`,
      [id],
    ),
    pool.query(
      `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount, p.payment_date AS "paymentDate",
              p.payment_method AS "paymentMethod", p.status, u.name AS "collectedByName"
       FROM payments p LEFT JOIN users u ON u.id = COALESCE(p.collected_by, p.recorded_by)
       WHERE p.loan_id = $1 ORDER BY p.payment_date DESC, p.id DESC`,
      [id],
    ),
    pool.query(
      `SELECT ca.id, ca.agent_user_id AS "agentId", ag.name AS "agentName", ca.assigned_at AS "assignedAt",
              ca.unassigned_at AS "unassignedAt", ab.name AS "assignedByName", ca.notes
       FROM collection_assignments ca JOIN users ag ON ag.id = ca.agent_user_id
       LEFT JOIN users ab ON ab.id = ca.assigned_by
       WHERE ca.loan_id = $1 ORDER BY ca.assigned_at DESC`,
      [id],
    ),
    pool.query(
      `SELECT COALESCE(SUM(paid_amount), 0) AS "paidAmount",
              COALESCE(SUM(outstanding_amount) FILTER (WHERE effective_status = 'OVERDUE'), 0) AS "overdueAmount",
              count(*) FILTER (WHERE effective_status = 'OVERDUE') AS "overdueInstallments",
              count(*) FILTER (WHERE status = 'PAID') AS "paidInstallments",
              MIN(due_date) FILTER (WHERE status IN ('PENDING','PARTIAL')) AS "nextDueDate"
       FROM v_collection_schedules WHERE loan_id = $1`,
      [id],
    ),
  ]);

  res.json({
    data: {
      ...loan,
      summary: summary.rows[0],
      schedule: schedule.rows,
      payments: payments.rows,
      assignments: assignments.rows,
    },
  });
});

const termsSchema = z.object({
  principalAmount: moneyString,
  annualInterestRate: rateString,
  loanTerm: z.coerce.number().int().positive().max(10_000),
  collectionFrequency: z.enum(COLLECTION_FREQUENCIES),
  loanStartDate: isoDate,
});

loansRouter.post('/preview', requirePermission('loans.create', 'loans.view'), async (req, res) => {
  const terms = termsSchema.parse(req.body);
  const settings = await getSettings(pool);
  const schedule = validateAndBuildSchedule(terms, settings, await businessToday(pool));
  res.json({ data: scheduleToJson(schedule) });
});

const createBody = termsSchema.extend({
  customerId: z.number().int().positive(),
  purpose: optionalText(200),
});

loansRouter.post('/', requirePermission('loans.create'), async (req, res) => {
  const body = createBody.parse(req.body);
  const auth = getAuth(req);

  const loan = await withTransaction(async (db) => {
    const customer = await db.query<{ branch_id: number; is_active: boolean }>(
      'SELECT branch_id, is_active FROM customers WHERE id = $1',
      [body.customerId],
    );
    const c = customer.rows[0];
    if (!c) throw badRequest('Customer does not exist.');
    assertBranchAccess(req, c.branch_id);
    if (!c.is_active) throw businessRule('CUSTOMER_INACTIVE', 'Loans cannot be created for an inactive customer.');

    const settings = await getSettings(db);
    const schedule = validateAndBuildSchedule(body, settings, await businessToday(db));

    const { rows } = await db.query<{ id: number; loanCode: string }>(
      `INSERT INTO loans (loan_code, customer_id, principal_amount, annual_interest_rate, loan_term,
                          collection_frequency, loan_start_date, maturity_date, total_interest, purpose, created_by)
       VALUES ('LN-' || lpad(nextval('loan_code_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, loan_code AS "loanCode"`,
      [
        body.customerId,
        body.principalAmount,
        body.annualInterestRate,
        body.loanTerm,
        body.collectionFrequency,
        body.loanStartDate,
        schedule.maturityDate,
        fromPaise(schedule.totalInterest),
        body.purpose,
        auth.userId,
      ],
    );
    const created = rows[0]!;
    await audit(db, req, {
      action: 'LOAN_CREATED',
      entityType: 'loan',
      entityId: created.id,
      details: {
        loanCode: created.loanCode,
        principalAmount: body.principalAmount,
        annualInterestRate: body.annualInterestRate,
        loanTerm: body.loanTerm,
        collectionFrequency: body.collectionFrequency,
      },
    });
    return created;
  });
  res.status(201).json({ data: loan });
});

/** Locks the loan row and checks branch access and the expected current status. */
async function lockLoan(db: import('pg').PoolClient, req: Request, id: number, expected: string[]) {
  const { rows } = await db.query(
    `SELECT l.*, c.branch_id FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1 FOR UPDATE OF l`,
    [id],
  );
  const loan = rows[0];
  if (!loan) throw notFound('Loan');
  assertBranchAccess(req, loan.branch_id);
  if (!expected.includes(loan.status)) {
    throw businessRule('INVALID_LOAN_STATUS', `This action is not allowed while the loan is ${loan.status}.`);
  }
  return loan;
}

loansRouter.post('/:id/approve', requirePermission('loans.approve'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const auth = getAuth(req);
  await withTransaction(async (db) => {
    const loan = await lockLoan(db, req, id, ['PENDING']);
    const settings = await getSettings(db);
    if (settings['loans.require_different_approver'] && loan.created_by === auth.userId) {
      throw businessRule('MAKER_CHECKER', 'A loan must be approved by someone other than the person who created it.');
    }
    await db.query(
      `UPDATE loans SET status = 'APPROVED', approved_by = $2, approved_at = NOW() WHERE id = $1`,
      [id, auth.userId],
    );
    await audit(db, req, { action: 'LOAN_APPROVED', entityType: 'loan', entityId: id, details: { loanCode: loan.loan_code } });
  });
  res.status(204).end();
});

const reasonBody = z.object({ reason: requiredText(255) });

loansRouter.post('/:id/reject', requirePermission('loans.approve'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = reasonBody.parse(req.body);
  const auth = getAuth(req);
  await withTransaction(async (db) => {
    const loan = await lockLoan(db, req, id, ['PENDING']);
    await db.query(
      `UPDATE loans SET status = 'REJECTED', rejected_by = $2, rejected_at = NOW(), rejection_reason = $3 WHERE id = $1`,
      [id, auth.userId, reason],
    );
    await audit(db, req, { action: 'LOAN_REJECTED', entityType: 'loan', entityId: id, details: { loanCode: loan.loan_code, reason } });
  });
  res.status(204).end();
});

const disburseBody = z.object({
  agentId: z.number().int().positive().optional(),
});

loansRouter.post('/:id/disburse', requirePermission('loans.disburse'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { agentId } = disburseBody.parse(req.body ?? {});
  const auth = getAuth(req);

  await withTransaction(async (db) => {
    const loan = await lockLoan(db, req, id, ['APPROVED']);
    // The schedule is generated from the stored loan terms at disbursement.
    const schedule = buildSchedule({
      principal: toPaise(loan.principal_amount),
      annualRateUnits: toRateUnits(loan.annual_interest_rate),
      term: loan.loan_term,
      frequency: loan.collection_frequency as CollectionFrequency,
      startDate: loan.loan_start_date,
    });
    await insertSchedule(db, id, schedule);
    await db.query(
      `UPDATE loans SET status = 'ACTIVE', disbursed_by = $2, disbursed_at = NOW(),
              total_interest = $3, maturity_date = $4, outstanding_balance = $5
       WHERE id = $1`,
      [id, auth.userId, fromPaise(schedule.totalInterest), schedule.maturityDate, fromPaise(schedule.totalPayable)],
    );
    if (agentId) await assignAgent(db, id, agentId, auth.userId, null);
    await audit(db, req, {
      action: 'LOAN_DISBURSED',
      entityType: 'loan',
      entityId: id,
      details: {
        loanCode: loan.loan_code,
        principalAmount: loan.principal_amount,
        totalPayable: fromPaise(schedule.totalPayable),
        installments: schedule.installments.length,
        agentId: agentId ?? null,
      },
    });
  });
  res.status(204).end();
});

loansRouter.post('/:id/default', requirePermission('loans.approve'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { reason } = reasonBody.parse(req.body);
  await withTransaction(async (db) => {
    const loan = await lockLoan(db, req, id, ['ACTIVE']);
    await db.query(`UPDATE loans SET status = 'DEFAULTED' WHERE id = $1`, [id]);
    await audit(db, req, { action: 'LOAN_DEFAULTED', entityType: 'loan', entityId: id, details: { loanCode: loan.loan_code, reason } });
  });
  res.status(204).end();
});
