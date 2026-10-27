import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../auth/middleware.js';
import { pool } from '../../db.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import { isoDate, pageQuery, searchText } from '../../http/validation.js';

export const auditRouter = Router();

const listQuery = pageQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: z.string().regex(/^[A-Z_]+$/).optional(),
  entityType: z.string().regex(/^[a-z_]+$/).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  search: searchText,
});

auditRouter.get('/', requirePermission('audit.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = new Filters();
  f.addIf(q.from, 'a.created_at >= ?::date');
  f.addIf(q.to, 'a.created_at < ?::date + 1');
  f.addIf(q.userId, 'a.user_id = ?');
  f.addIf(q.action, 'a.action = ?');
  f.addIf(q.entityType, 'a.entity_type = ?');
  f.addIf(q.entityId, 'a.entity_id = ?');
  if (q.search) f.add('(u.name ILIKE ? OR a.action ILIKE ? OR a.details::text ILIKE ?)', ...Array(3).fill(likePattern(q.search)));
  res.json(
    await paginate(pool, {
      select: `a.id, a.created_at AS "createdAt", a.user_id AS "userId", u.name AS "userName", a.action,
               a.entity_type AS "entityType", a.entity_id AS "entityId", a.details, a.ip_address AS "ipAddress"`,
      from: 'audit_logs a LEFT JOIN users u ON u.id = a.user_id',
      filters: f,
      orderBy: 'ORDER BY a.created_at DESC, a.id DESC',
      page: q.page,
      pageSize: q.pageSize,
    }),
  );
});

auditRouter.get('/actions', requirePermission('audit.view'), async (_req, res) => {
  const { rows } = await pool.query<{ action: string }>('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  res.json({ data: rows.map((r) => r.action) });
});
