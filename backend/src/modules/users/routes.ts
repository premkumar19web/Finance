import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { effectiveBranch, getAuth, requirePermission } from '../../auth/middleware.js';
import { hashPassword, passwordPolicy } from '../../auth/password.js';
import { revokeUserSessions } from '../../auth/session.js';
import { pool, withTransaction } from '../../db.js';
import { badRequest, businessRule, notFound } from '../../http/errors.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import { idParam, orderBy, pageQuery, phoneString, queryBool, requiredText, searchText } from '../../http/validation.js';

export const usersRouter = Router();

const listQuery = pageQuery.extend({
  search: searchText,
  branchId: z.coerce.number().int().positive().optional(),
  role: z.string().regex(/^[A-Z_]+$/).optional(),
  isActive: queryBool.optional(),
  sort: z.string().optional(),
});

const SORTS = { name: 'u.name', email: 'u.email', branch: 'b.branch_name', lastLogin: 'u.last_login_at', createdAt: 'u.created_at' };

const USER_COLUMNS = `u.id, u.name, u.email, u.phone, u.is_active AS "isActive", u.branch_id AS "branchId",
  b.branch_name AS "branchName", u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
  (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS "isLocked",
  COALESCE(ARRAY(SELECT r.role_name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id ORDER BY r.role_name), '{}') AS roles`;

usersRouter.get('/', requirePermission('users.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = new Filters();
  f.addIf(effectiveBranch(req, q.branchId), 'u.branch_id = ?');
  f.addIf(q.isActive, 'u.is_active = ?');
  f.addIf(q.role, 'EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.role_name = ?)');
  if (q.search) f.add('(u.name ILIKE ? OR u.email ILIKE ? OR u.phone ILIKE ?)', ...Array(3).fill(likePattern(q.search)));
  res.json(
    await paginate(pool, {
      select: USER_COLUMNS,
      from: 'users u LEFT JOIN branches b ON b.id = u.branch_id',
      filters: f,
      orderBy: orderBy(q.sort, SORTS, 'u.name'),
      page: q.page,
      pageSize: q.pageSize,
    }),
  );
});

usersRouter.get('/:id', requirePermission('users.view'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = $1`,
    [id],
  );
  const user = rows[0];
  if (!user) throw notFound('User');
  if (effectiveBranch(req, undefined) !== null && user.branchId !== effectiveBranch(req, undefined)) throw notFound('User');
  res.json({ data: user });
});

const roleList = z.array(z.string().regex(/^[A-Z_]+$/)).min(1, 'Choose at least one role').max(6);

const createBody = z.object({
  name: requiredText(150),
  email: z.email('Enter a valid email').max(255).transform((v) => v.toLowerCase()),
  phone: phoneString.optional().nullable().or(z.literal('')).transform((v) => v || null),
  branchId: z.number().int().positive().nullable().optional(),
  roles: roleList,
  password: passwordPolicy,
});

async function resolveRoleIds(db: import('pg').PoolClient, roles: string[]): Promise<number[]> {
  const { rows } = await db.query<{ id: number; role_name: string }>(
    'SELECT id, role_name FROM roles WHERE role_name = ANY($1)',
    [roles],
  );
  const unknown = roles.filter((r) => !rows.some((row) => row.role_name === r));
  if (unknown.length) throw badRequest(`Unknown role: ${unknown.join(', ')}`);
  return rows.map((r) => r.id);
}

function requireBranchForBranchRoles(roles: string[], branchId: number | null | undefined) {
  const branchRoles = ['BRANCH_MANAGER', 'COLLECTION_AGENT'];
  if (roles.some((r) => branchRoles.includes(r)) && !branchId) {
    throw badRequest('Branch managers and collection agents must belong to a branch.');
  }
}

usersRouter.post('/', requirePermission('users.manage'), async (req, res) => {
  const body = createBody.parse(req.body);
  requireBranchForBranchRoles(body.roles, body.branchId);
  const passwordHash = await hashPassword(body.password);

  const user = await withTransaction(async (db) => {
    const roleIds = await resolveRoleIds(db, body.roles);
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO users (name, email, phone, branch_id, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [body.name, body.email, body.phone, body.branchId ?? null, passwordHash],
    );
    const id = rows[0]!.id;
    await db.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::bigint[])', [id, roleIds]);
    await audit(db, req, { action: 'USER_CREATED', entityType: 'user', entityId: id, details: { email: body.email, roles: body.roles } });
    return { id };
  });
  res.status(201).json({ data: user });
});

const updateBody = z.object({
  name: requiredText(150).optional(),
  phone: phoneString.optional().nullable().or(z.literal('')).transform((v) => v || null),
  branchId: z.number().int().positive().nullable().optional(),
  roles: roleList.optional(),
  isActive: z.boolean().optional(),
});

usersRouter.patch('/:id', requirePermission('users.manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateBody.parse(req.body);
  const auth = getAuth(req);

  await withTransaction(async (db) => {
    const existing = await db.query(
      `SELECT u.branch_id, COALESCE(ARRAY(SELECT r.role_name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                                          WHERE ur.user_id = u.id), '{}') AS roles
       FROM users u WHERE u.id = $1 FOR UPDATE`,
      [id],
    );
    const current = existing.rows[0];
    if (!current) throw notFound('User');
    if (id === auth.userId) {
      if (body.isActive === false) throw businessRule('SELF_DEACTIVATION', 'You cannot deactivate your own account.');
      if (body.roles && current.roles.includes('ADMIN') && !body.roles.includes('ADMIN')) {
        throw businessRule('SELF_DEMOTION', 'You cannot remove your own administrator role.');
      }
    }
    const roles: string[] = body.roles ?? current.roles;
    const branchId = body.branchId !== undefined ? body.branchId : current.branch_id;
    requireBranchForBranchRoles(roles, branchId);

    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (body.name !== undefined) set('name', body.name);
    if (body.phone !== undefined) set('phone', body.phone);
    if (body.branchId !== undefined) set('branch_id', body.branchId);
    if (body.isActive !== undefined) set('is_active', body.isActive);
    if (sets.length) await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);

    if (body.roles) {
      const roleIds = await resolveRoleIds(db, body.roles);
      await db.query('DELETE FROM user_roles WHERE user_id = $1 AND NOT (role_id = ANY($2::bigint[]))', [id, roleIds]);
      await db.query(
        'INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING',
        [id, roleIds],
      );
    }
    // A deactivated user is signed out everywhere immediately.
    if (body.isActive === false) await revokeUserSessions(db, id);

    await audit(db, req, {
      action: body.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      entityType: 'user',
      entityId: id,
      details: { fields: Object.keys(body), roles: body.roles },
    });
  });
  res.status(204).end();
});

const resetBody = z.object({ newPassword: passwordPolicy });

usersRouter.post('/:id/reset-password', requirePermission('users.manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { newPassword } = resetBody.parse(req.body);
  const hash = await hashPassword(newPassword);
  await withTransaction(async (db) => {
    const result = await db.query(
      `UPDATE users SET password_hash = $2, password_changed_at = NOW(), failed_login_attempts = 0, locked_until = NULL
       WHERE id = $1`,
      [id, hash],
    );
    if (!result.rowCount) throw notFound('User');
    await revokeUserSessions(db, id);
    await audit(db, req, { action: 'PASSWORD_RESET', entityType: 'user', entityId: id });
  });
  res.status(204).end();
});
