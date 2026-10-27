import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { assertBranchAccess, effectiveBranch, getAuth, requirePermission } from '../../auth/middleware.js';
import { pool, withTransaction } from '../../db.js';
import { businessRule, notFound } from '../../http/errors.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import { idParam, optionalText, orderBy, pageQuery, queryBool, searchText } from '../../http/validation.js';
import { assignAgent } from '../loans/service.js';

export const assignmentsRouter = Router();

const listQuery = pageQuery.extend({
  search: searchText,
  loanId: z.coerce.number().int().positive().optional(),
  agentId: z.coerce.number().int().positive().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  active: queryBool.optional(),
  sort: z.string().optional(),
});

const SORTS = { assignedAt: 'ca.assigned_at', agent: 'ag.name', loan: 'l.loan_code', customer: 'c.full_name' };

assignmentsRouter.get('/', requirePermission('assignments.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = new Filters();
  f.addIf(effectiveBranch(req, q.branchId), 'c.branch_id = ?');
  f.addIf(q.loanId, 'ca.loan_id = ?');
  f.addIf(q.agentId, 'ca.agent_user_id = ?');
  if (q.active !== undefined) f.add(q.active ? 'ca.unassigned_at IS NULL' : 'ca.unassigned_at IS NOT NULL');
  if (q.search) {
    f.add('(l.loan_code ILIKE ? OR c.full_name ILIKE ? OR ag.name ILIKE ?)', ...Array(3).fill(likePattern(q.search)));
  }
  res.json(
    await paginate(pool, {
      select: `ca.id, ca.loan_id AS "loanId", l.loan_code AS "loanCode", l.status AS "loanStatus",
               l.outstanding_balance AS "outstandingBalance", c.full_name AS "customerName",
               c.branch_id AS "branchId", b.branch_name AS "branchName",
               ca.agent_user_id AS "agentId", ag.name AS "agentName", ca.assigned_at AS "assignedAt",
               ab.name AS "assignedByName", ca.unassigned_at AS "unassignedAt", ca.notes,
               CASE WHEN ca.unassigned_at IS NULL THEN 'ACTIVE' ELSE 'ENDED' END AS status`,
      from: `collection_assignments ca
             JOIN loans l ON l.id = ca.loan_id
             JOIN customers c ON c.id = l.customer_id
             JOIN branches b ON b.id = c.branch_id
             JOIN users ag ON ag.id = ca.agent_user_id
             LEFT JOIN users ab ON ab.id = ca.assigned_by`,
      filters: f,
      orderBy: orderBy(q.sort, SORTS, 'ca.assigned_at DESC, ca.id DESC'),
      page: q.page,
      pageSize: q.pageSize,
    }),
  );
});

const createBody = z.object({
  loanId: z.number().int().positive(),
  agentId: z.number().int().positive(),
  notes: optionalText(255),
});

assignmentsRouter.post('/', requirePermission('assignments.manage'), async (req, res) => {
  const body = createBody.parse(req.body);
  const auth = getAuth(req);
  const id = await withTransaction(async (db) => {
    const loan = await db.query(
      'SELECT c.branch_id, l.loan_code FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1 FOR UPDATE OF l',
      [body.loanId],
    );
    if (!loan.rows[0]) throw notFound('Loan');
    assertBranchAccess(req, loan.rows[0].branch_id);
    const newId = await assignAgent(db, body.loanId, body.agentId, auth.userId, body.notes);
    await audit(db, req, {
      action: 'AGENT_ASSIGNED',
      entityType: 'loan',
      entityId: body.loanId,
      details: { loanCode: loan.rows[0].loan_code, agentId: body.agentId, assignmentId: newId },
    });
    return newId;
  });
  res.status(201).json({ data: { id } });
});

assignmentsRouter.post('/:id/end', requirePermission('assignments.manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const auth = getAuth(req);
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT ca.loan_id, ca.unassigned_at, c.branch_id FROM collection_assignments ca
       JOIN loans l ON l.id = ca.loan_id JOIN customers c ON c.id = l.customer_id
       WHERE ca.id = $1 FOR UPDATE OF ca`,
      [id],
    );
    const a = rows[0];
    if (!a) throw notFound('Assignment');
    assertBranchAccess(req, a.branch_id);
    if (a.unassigned_at) throw businessRule('ALREADY_ENDED', 'This assignment has already ended.');
    await db.query('UPDATE collection_assignments SET unassigned_at = NOW(), unassigned_by = $2 WHERE id = $1', [
      id,
      auth.userId,
    ]);
    await audit(db, req, { action: 'AGENT_UNASSIGNED', entityType: 'loan', entityId: a.loan_id, details: { assignmentId: id } });
  });
  res.status(204).end();
});

/** Agents that can be assigned to a branch's loans (for dropdowns). */
assignmentsRouter.get('/agents', requirePermission('assignments.view', 'collections.view'), async (req, res) => {
  const q = z.object({ branchId: z.coerce.number().int().positive().optional() }).parse(req.query);
  const branch = effectiveBranch(req, q.branchId);
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.branch_id AS "branchId", b.branch_name AS "branchName",
            (SELECT count(*) FROM collection_assignments ca JOIN loans l ON l.id = ca.loan_id
             WHERE ca.agent_user_id = u.id AND ca.unassigned_at IS NULL AND l.status IN ('ACTIVE','DEFAULTED')) AS "activeLoans"
     FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     LEFT JOIN branches b ON b.id = u.branch_id
     WHERE r.role_name = 'COLLECTION_AGENT' AND u.is_active AND ($1::bigint IS NULL OR u.branch_id = $1)
     ORDER BY b.branch_name, u.name`,
    [branch],
  );
  res.json({ data: rows });
});
