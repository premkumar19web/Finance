import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { branchScope, requirePermission } from '../../auth/middleware.js';
import { pool, withTransaction } from '../../db.js';
import { badRequest, businessRule, notFound } from '../../http/errors.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import {
  idParam,
  optionalText,
  orderBy,
  pageQuery,
  phoneString,
  queryBool,
  requiredText,
  searchText,
} from '../../http/validation.js';

export const branchesRouter = Router();

const listQuery = pageQuery.extend({
  search: searchText,
  isActive: queryBool.optional(),
  sort: z.string().optional(),
});

const SORTS = { code: 'b.branch_code', name: 'b.branch_name', city: 'b.city', createdAt: 'b.created_at' };

const BRANCH_COLUMNS = `b.id, b.branch_code AS "branchCode", b.branch_name AS "branchName", b.city, b.address,
  b.phone, b.email, b.is_active AS "isActive", b.created_at AS "createdAt", b.updated_at AS "updatedAt"`;

branchesRouter.get('/', requirePermission('branches.view', 'customers.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = new Filters();
  const scope = branchScope(req);
  f.addIf(scope, 'b.id = ?');
  f.addIf(q.isActive, 'b.is_active = ?');
  if (q.search) {
    f.add('(b.branch_name ILIKE ? OR b.branch_code ILIKE ? OR b.city ILIKE ?)', ...Array(3).fill(likePattern(q.search)));
  }
  res.json(
    await paginate(pool, {
      select: `${BRANCH_COLUMNS},
        (SELECT count(*) FROM customers c WHERE c.branch_id = b.id) AS "customerCount",
        (SELECT count(*) FROM users u WHERE u.branch_id = b.id AND u.is_active) AS "staffCount",
        (SELECT count(*) FROM loans l JOIN customers c ON c.id = l.customer_id
           WHERE c.branch_id = b.id AND l.status IN ('ACTIVE','DEFAULTED')) AS "openLoans"`,
      from: 'branches b',
      filters: f,
      orderBy: orderBy(q.sort, SORTS, 'b.branch_code'),
      page: q.page,
      pageSize: q.pageSize,
    }),
  );
});

branchesRouter.get('/:id', requirePermission('branches.view'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const scope = branchScope(req);
  if (scope !== null && scope !== id) throw notFound('Branch');
  const { rows } = await pool.query(`SELECT ${BRANCH_COLUMNS} FROM branches b WHERE b.id = $1`, [id]);
  if (!rows[0]) throw notFound('Branch');
  res.json({ data: rows[0] });
});

const branchBody = z.object({
  branchCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,30}$/, 'Use 2-30 capital letters, digits or dashes'),
  branchName: requiredText(120),
  city: optionalText(80),
  address: optionalText(500),
  phone: phoneString.optional().nullable().or(z.literal('')).transform((v) => v || null),
  email: z.email('Enter a valid email').max(255).optional().nullable().or(z.literal('')).transform((v) => v || null),
});

branchesRouter.post('/', requirePermission('branches.manage'), async (req, res) => {
  const body = branchBody.parse(req.body);
  const branch = await withTransaction(async (db) => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO branches (branch_code, branch_name, city, address, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [body.branchCode, body.branchName, body.city, body.address, body.phone, body.email],
    );
    await audit(db, req, { action: 'BRANCH_CREATED', entityType: 'branch', entityId: rows[0]!.id, details: { branchCode: body.branchCode } });
    return rows[0]!;
  });
  res.status(201).json({ data: branch });
});

const updateBody = branchBody.partial().extend({ isActive: z.boolean().optional() });
const COLUMNS: Record<string, string> = {
  branchCode: 'branch_code',
  branchName: 'branch_name',
  city: 'city',
  address: 'address',
  phone: 'phone',
  email: 'email',
  isActive: 'is_active',
};

branchesRouter.patch('/:id', requirePermission('branches.manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateBody.parse(req.body);
  await withTransaction(async (db) => {
    const existing = await db.query('SELECT is_active FROM branches WHERE id = $1 FOR UPDATE', [id]);
    if (!existing.rows[0]) throw notFound('Branch');
    if (body.isActive === false && existing.rows[0].is_active) {
      const open = await db.query(
        `SELECT 1 FROM loans l JOIN customers c ON c.id = l.customer_id
         WHERE c.branch_id = $1 AND l.status IN ('PENDING','APPROVED','ACTIVE','DEFAULTED') LIMIT 1`,
        [id],
      );
      if (open.rowCount) throw businessRule('BRANCH_HAS_OPEN_LOANS', 'This branch still has open loans.');
    }
    const f = new Filters();
    const sets = Object.entries(COLUMNS)
      .filter(([key]) => (body as Record<string, unknown>)[key] !== undefined)
      .map(([key, column]) => `${column} = ${f.param((body as Record<string, unknown>)[key])}`);
    if (!sets.length) throw badRequest('Nothing to update.');
    await db.query(`UPDATE branches SET ${sets.join(', ')} WHERE id = ${f.param(id)}`, f.params);
    await audit(db, req, {
      action: body.isActive === false ? 'BRANCH_DEACTIVATED' : 'BRANCH_UPDATED',
      entityType: 'branch',
      entityId: id,
      details: { fields: Object.keys(body) },
    });
  });
  res.status(204).end();
});
