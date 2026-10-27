import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { getAuth, requirePermission } from '../../auth/middleware.js';
import { pool, withTransaction } from '../../db.js';
import { notFound } from '../../http/errors.js';
import { isSettingKey, SETTING_SCHEMAS } from './service.js';

export const settingsRouter = Router();

settingsRouter.get('/', requirePermission('settings.view'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.setting_key AS key, s.setting_value AS value, s.description, s.updated_at AS "updatedAt",
            u.name AS "updatedByName"
     FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by
     WHERE s.setting_key NOT LIKE 'dev.%'
     ORDER BY s.setting_key`,
  );
  res.json({ data: rows.filter((r) => isSettingKey(r.key)) });
});

settingsRouter.put('/:key', requirePermission('settings.manage'), async (req, res) => {
  const key = String(req.params.key);
  if (!isSettingKey(key)) throw notFound('Setting');
  const { value } = z.object({ value: z.unknown() }).parse(req.body);
  const parsed = SETTING_SCHEMAS[key].parse(value);

  await withTransaction(async (db) => {
    const before = await db.query('SELECT setting_value FROM app_settings WHERE setting_key = $1 FOR UPDATE', [key]);
    await db.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(parsed), getAuth(req).userId],
    );
    await audit(db, req, {
      action: 'SETTING_CHANGED',
      entityType: 'setting',
      details: { key, from: before.rows[0]?.setting_value ?? null, to: parsed },
    });
  });
  res.status(204).end();
});
