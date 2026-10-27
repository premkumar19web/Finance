import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { assertBranchAccess, effectiveBranch, getAuth, requirePermission } from '../../auth/middleware.js';
import { pool, withTransaction } from '../../db.js';
import { badRequest, businessRule, notFound } from '../../http/errors.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import {
  idParam,
  isoDate,
  moneyString,
  optionalText,
  orderBy,
  pageQuery,
  searchText,
} from '../../http/validation.js';
import { businessToday } from '../loans/service.js';

export const expensesRouter = Router();

export const EXPENSE_CATEGORIES = [
  'RENT', 'UTILITIES', 'SALARIES', 'TRAVEL', 'OFFICE_SUPPLIES', 'MARKETING', 'MAINTENANCE', 'COMMUNICATION', 'OTHER',
] as const;

const listQuery = pageQuery.extend({
  search: searchText,
  from: isoDate.optional(),
  to: isoDate.optional(),
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  sort: z.string().optional(),
});

const SORTS = { date: 'e.expense_date', amount: 'e.amount', category: 'e.category', branch: 'b.branch_name', status: 'e.status' };

const EXPENSE_FROM = `expenses e
  LEFT JOIN branches b ON b.id = e.branch_id
  JOIN users s ON s.id = e.recorded_by
  LEFT JOIN users r ON r.id = e.reviewed_by`;

expensesRouter.get('/', requirePermission('expenses.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = new Filters();
  f.addIf(effectiveBranch(req, q.branchId), 'e.branch_id = ?');
  f.addIf(q.from, 'e.expense_date >= ?');
  f.addIf(q.to, 'e.expense_date <= ?');
  f.addIf(q.status, 'e.status = ?');
  f.addIf(q.category, 'e.category = ?');
  if (q.search) f.add('(e.description ILIKE ? OR s.name ILIKE ?)', ...Array(2).fill(likePattern(q.search)));

  const page = await paginate(pool, {
    select: `e.id, e.category, e.amount, e.expense_date AS "expenseDate", e.description, e.status,
             e.branch_id AS "branchId", b.branch_name AS "branchName", e.recorded_by AS "submittedBy",
             s.name AS "submittedByName", r.name AS "reviewedByName", e.reviewed_at AS "reviewedAt",
             e.review_note AS "reviewNote", e.created_at AS "createdAt"`,
    from: EXPENSE_FROM,
    filters: f,
    orderBy: orderBy(q.sort, SORTS, 'e.expense_date DESC, e.id DESC'),
    page: q.page,
    pageSize: q.pageSize,
  });
  const totals = await pool.query(
    `SELECT COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'APPROVED'), 0) AS "approvedAmount",
            COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'PENDING'), 0) AS "pendingAmount",
            count(*) FILTER (WHERE e.status = 'PENDING') AS "pendingCount"
     FROM ${EXPENSE_FROM} ${f.where}`,
    f.params,
  );
  res.json({ ...page, summary: totals.rows[0] });
});

const createBody = z.object({
  branchId: z.number().int().positive().optional(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: moneyString,
  expenseDate: isoDate,
  description: optionalText(500),
});

expensesRouter.post('/', requirePermission('expenses.create'), async (req, res) => {
  const body = createBody.parse(req.body);
  const branchId = effectiveBranch(req, body.branchId) ?? body.branchId;
  if (!branchId) throw badRequest('Choose the branch this expense belongs to.');
  if (body.amount === '0' || /^0+(\.0+)?$/.test(body.amount)) throw badRequest('Amount must be greater than zero.');

  const expense = await withTransaction(async (db) => {
    if (body.expenseDate > (await businessToday(db))) throw businessRule('FUTURE_EXPENSE', 'Expense date cannot be in the future.');
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO expenses (branch_id, recorded_by, category, amount, expense_date, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [branchId, getAuth(req).userId, body.category, body.amount, body.expenseDate, body.description],
    );
    await audit(db, req, {
      action: 'EXPENSE_SUBMITTED',
      entityType: 'expense',
      entityId: rows[0]!.id,
      details: { category: body.category, amount: body.amount, branchId },
    });
    return rows[0]!;
  });
  res.status(201).json({ data: expense });
});

const reviewBody = z.object({ note: optionalText(255) });

for (const decision of ['approve', 'reject'] as const) {
  expensesRouter.post(`/:id/${decision}`, requirePermission('expenses.approve'), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { note } = reviewBody.parse(req.body ?? {});
    const auth = getAuth(req);
    if (decision === 'reject' && !note) throw badRequest('Give a reason for rejecting the expense.');

    await withTransaction(async (db) => {
      const { rows } = await db.query('SELECT branch_id, status, recorded_by, amount, category FROM expenses WHERE id = $1 FOR UPDATE', [id]);
      const e = rows[0];
      if (!e) throw notFound('Expense');
      if (e.branch_id) assertBranchAccess(req, e.branch_id);
      if (e.status !== 'PENDING') throw businessRule('ALREADY_REVIEWED', 'This expense has already been reviewed.');
      if (e.recorded_by === auth.userId) throw businessRule('SELF_REVIEW', 'You cannot review an expense you submitted.');
      await db.query(
        'UPDATE expenses SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_note = $4 WHERE id = $1',
        [id, decision === 'approve' ? 'APPROVED' : 'REJECTED', auth.userId, note],
      );
      await audit(db, req, {
        action: decision === 'approve' ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
        entityType: 'expense',
        entityId: id,
        details: { amount: e.amount, category: e.category, note },
      });
    });
    res.status(204).end();
  });
}
