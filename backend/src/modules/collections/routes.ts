import { Router, type Request } from 'express';
import { z } from 'zod';
import { effectiveBranch, getAuth, isAgentOnly, requirePermission } from '../../auth/middleware.js';
import { pool } from '../../db.js';
import { badRequest, forbidden } from '../../http/errors.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import { isoDate, orderBy, pageQuery, queryBool, searchText } from '../../http/validation.js';
import { businessToday } from '../loans/service.js';

export const collectionsRouter = Router();

const dueQuery = pageQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Also list unpaid installments that fell due before `from` (arrears). */
  includeArrears: queryBool.optional(),
  branchId: z.coerce.number().int().positive().optional(),
  agentId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED']).optional(),
  loanStatus: z.enum(['ACTIVE', 'DEFAULTED', 'CLOSED']).optional(),
  search: searchText,
  sort: z.string().optional(),
});

const SORTS = {
  dueDate: 's.due_date',
  customer: 'c.full_name',
  loan: 'l.loan_code',
  outstanding: 's.outstanding_amount',
  agent: 'ag.name',
};

const DUE_FROM = `v_collection_schedules s
  JOIN loans l ON l.id = s.loan_id
  JOIN customers c ON c.id = l.customer_id
  JOIN branches b ON b.id = c.branch_id
  LEFT JOIN collection_assignments ca ON ca.loan_id = l.id AND ca.unassigned_at IS NULL
  LEFT JOIN users ag ON ag.id = ca.agent_user_id`;

/**
 * Installments due in a date range — the daily and weekly collection lists.
 * Collection agents only ever see loans currently assigned to them.
 */
collectionsRouter.get('/due', requirePermission('collections.view'), async (req, res) => {
  const q = dueQuery.parse(req.query);
  const today = await businessToday(pool);
  const from = q.from ?? today;
  const to = q.to ?? from;
  if (to < from) throw badRequest('"to" must be on or after "from".');

  const f = new Filters();
  f.addIf(effectiveBranch(req, q.branchId), 'c.branch_id = ?');
  const agentId = agentFilter(req, q.agentId);
  f.addIf(agentId, 'ca.agent_user_id = ?');
  if (q.includeArrears) {
    f.add(`(s.due_date BETWEEN ? AND ? OR (s.due_date < ? AND s.effective_status = 'OVERDUE'))`, from, to, from);
  } else {
    f.add('s.due_date BETWEEN ? AND ?', from, to);
  }
  f.addIf(q.status, 's.effective_status = ?');
  if (q.loanStatus) f.add('l.status = ?', q.loanStatus);
  else f.add(`l.status IN ('ACTIVE', 'DEFAULTED', 'CLOSED')`);
  if (q.search) {
    f.add('(c.full_name ILIKE ? OR l.loan_code ILIKE ? OR c.phone ILIKE ?)', ...Array(3).fill(likePattern(q.search)));
  }

  const page = await paginate(pool, {
    select: `s.id, s.loan_id AS "loanId", l.loan_code AS "loanCode", l.status AS "loanStatus",
             l.collection_frequency AS "collectionFrequency", c.id AS "customerId", c.full_name AS "customerName",
             c.phone AS "customerPhone", c.address AS "customerAddress", b.branch_name AS "branchName",
             s.installment_number AS "installmentNumber", s.due_date AS "dueDate", s.due_amount AS "dueAmount",
             s.paid_amount AS "paidAmount", s.outstanding_amount AS "outstandingAmount",
             s.effective_status AS "status", s.days_past_due AS "daysPastDue",
             ag.id AS "agentId", ag.name AS "agentName"`,
    from: DUE_FROM,
    filters: f,
    orderBy: orderBy(q.sort, SORTS, 's.due_date, c.full_name, s.id'),
    page: q.page,
    pageSize: q.pageSize,
  });

  const summary = await pool.query(
    `SELECT count(*) AS "installments",
            COALESCE(SUM(s.due_amount), 0) AS "dueAmount",
            COALESCE(SUM(s.paid_amount), 0) AS "paidAmount",
            COALESCE(SUM(s.outstanding_amount) FILTER (WHERE s.status <> 'WAIVED'), 0) AS "outstandingAmount",
            count(*) FILTER (WHERE s.effective_status = 'PAID') AS "paidCount",
            count(*) FILTER (WHERE s.effective_status = 'PARTIAL') AS "partialCount",
            count(*) FILTER (WHERE s.effective_status = 'PENDING') AS "pendingCount",
            count(*) FILTER (WHERE s.effective_status = 'OVERDUE') AS "overdueCount"
     FROM ${DUE_FROM} ${f.where}`,
    f.params,
  );
  res.json({ ...page, summary: { ...summary.rows[0], from, to } });
});

/** Per-day expected vs collected amounts — feeds the weekly collections view. */
collectionsRouter.get('/daily-totals', requirePermission('collections.view'), async (req, res) => {
  const q = z
    .object({
      from: isoDate,
      to: isoDate,
      branchId: z.coerce.number().int().positive().optional(),
      agentId: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  if (q.to < q.from) throw badRequest('"to" must be on or after "from".');
  const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
  if (days > 92) throw badRequest('Choose a range of at most 92 days.');

  const branch = effectiveBranch(req, q.branchId);
  const agentId = agentFilter(req, q.agentId);
  const { rows } = await pool.query(
    `WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, '1 day') d)
     SELECT days.day,
       COALESCE((SELECT SUM(s.due_amount) FROM collection_schedules s
                 JOIN loans l ON l.id = s.loan_id JOIN customers c ON c.id = l.customer_id
                 LEFT JOIN collection_assignments ca ON ca.loan_id = l.id AND ca.unassigned_at IS NULL
                 WHERE s.due_date = days.day AND l.status IN ('ACTIVE','DEFAULTED','CLOSED')
                   AND ($3::bigint IS NULL OR c.branch_id = $3)
                   AND ($4::bigint IS NULL OR ca.agent_user_id = $4)), 0) AS "dueAmount",
       COALESCE((SELECT SUM(p.amount) FROM payments p
                 JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
                 WHERE p.status = 'RECORDED' AND p.payment_date >= days.day AND p.payment_date < days.day + 1
                   AND ($3::bigint IS NULL OR c.branch_id = $3)
                   AND ($4::bigint IS NULL OR COALESCE(p.collected_by, p.recorded_by) = $4)), 0) AS "collectedAmount",
       (SELECT count(*) FROM payments p
                 JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
                 WHERE p.status = 'RECORDED' AND p.payment_date >= days.day AND p.payment_date < days.day + 1
                   AND ($3::bigint IS NULL OR c.branch_id = $3)
                   AND ($4::bigint IS NULL OR COALESCE(p.collected_by, p.recorded_by) = $4)) AS "paymentCount"
     FROM days ORDER BY days.day`,
    [q.from, q.to, branch, agentId ?? null],
  );
  res.json({ data: rows });
});

/** Collection agent dashboard: their own figures (or a chosen agent's, for supervisors). */
collectionsRouter.get('/agent-summary', requirePermission('collections.view'), async (req, res) => {
  const q = z.object({ agentId: z.coerce.number().int().positive().optional() }).parse(req.query);
  const auth = getAuth(req);
  const agentId = agentFilter(req, q.agentId) ?? auth.userId;

  const agent = await pool.query(
    `SELECT u.id, u.name, u.branch_id AS "branchId", b.branch_name AS "branchName"
     FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = $1`,
    [agentId],
  );
  if (!agent.rows[0]) throw badRequest('Agent not found.');
  const scope = effectiveBranch(req, undefined);
  if (scope !== null && agent.rows[0].branchId !== scope) throw forbidden('This agent belongs to another branch.');

  const { rows } = await pool.query(
    `WITH my_loans AS (
       SELECT l.id FROM collection_assignments ca JOIN loans l ON l.id = ca.loan_id
       WHERE ca.agent_user_id = $1 AND ca.unassigned_at IS NULL AND l.status IN ('ACTIVE','DEFAULTED')
     )
     SELECT
       (SELECT count(*) FROM my_loans) AS "assignedLoans",
       (SELECT COALESCE(SUM(l.outstanding_balance), 0) FROM loans l WHERE l.id IN (SELECT id FROM my_loans)) AS "portfolioOutstanding",
       (SELECT count(*) FROM collection_schedules s WHERE s.loan_id IN (SELECT id FROM my_loans) AND s.due_date = CURRENT_DATE) AS "dueTodayCount",
       (SELECT COALESCE(SUM(s.due_amount), 0) FROM collection_schedules s WHERE s.loan_id IN (SELECT id FROM my_loans) AND s.due_date = CURRENT_DATE) AS "dueTodayAmount",
       (SELECT COALESCE(SUM(s.outstanding_amount), 0) FROM collection_schedules s WHERE s.loan_id IN (SELECT id FROM my_loans) AND s.due_date = CURRENT_DATE AND s.status <> 'WAIVED') AS "dueTodayRemaining",
       (SELECT count(*) FROM v_collection_schedules s WHERE s.loan_id IN (SELECT id FROM my_loans) AND s.effective_status = 'OVERDUE') AS "overdueCount",
       (SELECT COALESCE(SUM(s.outstanding_amount), 0) FROM v_collection_schedules s WHERE s.loan_id IN (SELECT id FROM my_loans) AND s.effective_status = 'OVERDUE') AS "overdueAmount",
       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE COALESCE(p.collected_by, p.recorded_by) = $1 AND p.status = 'RECORDED' AND p.payment_date >= CURRENT_DATE) AS "collectedToday",
       (SELECT count(*) FROM payments p WHERE COALESCE(p.collected_by, p.recorded_by) = $1 AND p.status = 'RECORDED' AND p.payment_date >= CURRENT_DATE) AS "paymentsToday",
       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE COALESCE(p.collected_by, p.recorded_by) = $1 AND p.status = 'RECORDED' AND p.payment_date >= date_trunc('month', CURRENT_DATE)) AS "collectedThisMonth"`,
    [agentId],
  );
  const recent = await pool.query(
    `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount, p.payment_date AS "paymentDate",
            p.payment_method AS "paymentMethod", p.status, l.loan_code AS "loanCode", c.full_name AS "customerName"
     FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
     WHERE COALESCE(p.collected_by, p.recorded_by) = $1
     ORDER BY p.payment_date DESC LIMIT 10`,
    [agentId],
  );
  res.json({ data: { agent: agent.rows[0], ...rows[0], recentPayments: recent.rows } });
});

/**
 * Collection agents are limited to their own work; supervisors may pick any agent
 * (branch limits are still applied by the caller).
 */
function agentFilter(req: Request, requested: number | undefined): number | undefined {
  const auth = getAuth(req);
  if (isAgentOnly(req)) {
    if (requested !== undefined && requested !== auth.userId) throw forbidden('You can only view your own collections.');
    return auth.userId;
  }
  return requested;
}
