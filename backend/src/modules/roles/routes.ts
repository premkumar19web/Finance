import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { requirePermission } from '../../auth/middleware.js';
import { pool, withTransaction } from '../../db.js';
import { badRequest, businessRule, notFound } from '../../http/errors.js';
import { idParam } from '../../http/validation.js';

export const rolesRouter = Router();

rolesRouter.get('/', requirePermission('roles.view', 'users.view', 'users.manage'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.role_name AS "roleName", r.display_name AS "displayName", r.description,
            (SELECT count(*) FROM user_roles ur JOIN users u ON u.id = ur.user_id
             WHERE ur.role_id = r.id AND u.is_active) AS "activeUsers",
            COALESCE(ARRAY(SELECT p.permission_code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                           WHERE rp.role_id = r.id ORDER BY p.permission_code), '{}') AS permissions
     FROM roles r ORDER BY r.id`,
  );
  res.json({ data: rows });
});

rolesRouter.get('/permissions', requirePermission('roles.view'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, permission_code AS "permissionCode", description FROM permissions ORDER BY permission_code`,
  );
  res.json({ data: rows });
});

const updateBody = z.object({ permissionCodes: z.array(z.string().max(60)).max(100) });

rolesRouter.put('/:id/permissions', requirePermission('roles.manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { permissionCodes } = updateBody.parse(req.body);

  await withTransaction(async (db) => {
    const role = await db.query<{ role_name: string }>('SELECT role_name FROM roles WHERE id = $1 FOR UPDATE', [id]);
    if (!role.rows[0]) throw notFound('Role');
    // Protects against locking everyone out of user and role management.
    if (role.rows[0].role_name === 'ADMIN') {
      throw businessRule('ADMIN_ROLE_LOCKED', 'The Administrator role always has every permission.');
    }
    const perms = await db.query<{ id: number; permission_code: string }>(
      'SELECT id, permission_code FROM permissions WHERE permission_code = ANY($1)',
      [permissionCodes],
    );
    if (perms.rowCount !== new Set(permissionCodes).size) throw badRequest('One or more permission codes are unknown.');

    const before = await db.query<{ permission_code: string }>(
      `SELECT p.permission_code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
      [id],
    );
    await db.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    await db.query('INSERT INTO role_permissions (role_id, permission_id) SELECT $1, unnest($2::bigint[])', [
      id,
      perms.rows.map((p) => p.id),
    ]);

    const old = new Set(before.rows.map((r) => r.permission_code));
    const next = new Set(permissionCodes);
    await audit(db, req, {
      action: 'ROLE_PERMISSIONS_CHANGED',
      entityType: 'role',
      entityId: id,
      details: {
        role: role.rows[0].role_name,
        added: [...next].filter((p) => !old.has(p)),
        removed: [...old].filter((p) => !next.has(p)),
      },
    });
  });
  res.status(204).end();
});
