import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { authenticate, getAuth } from '../../auth/middleware.js';
import { getDummyHash, hashPassword, passwordPolicy, verifyPassword } from '../../auth/password.js';
import {
  clearSessionCookie,
  clientIp,
  createSession,
  revokeSession,
  revokeUserSessions,
  setSessionCookie,
} from '../../auth/session.js';
import { config } from '../../config.js';
import { pool, withTransaction } from '../../db.js';
import { AppError, badRequest, unauthorized } from '../../http/errors.js';
import { rateLimit } from '../../http/security.js';
import { phoneString } from '../../http/validation.js';
import { getSettings } from '../settings/service.js';

export const authRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Development seed accounts use the reserved .test domain and can never sign in to production.
const DEV_ONLY_EMAIL = /@[^@]+\.test$/i;

const loginBody = z.object({
  email: z.string().trim().toLowerCase().max(255),
  password: z.string().min(1).max(128),
});

const loginLimiterByIp = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  key: (req) => `login-ip:${clientIp(req)}`,
  message: 'Too many sign-in attempts from this network. Please wait 15 minutes.',
});
const loginLimiterByEmail = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  key: (req) => `login-email:${String(req.body?.email ?? '').toLowerCase()}`,
  message: 'Too many sign-in attempts for this account. Please wait 15 minutes.',
});

authRouter.post('/login', loginLimiterByIp, loginLimiterByEmail, async (req, res) => {
  const { email, password } = loginBody.parse(req.body);
  const invalid = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

  const { rows } = await pool.query<{
    id: number;
    password_hash: string;
    is_active: boolean;
    locked: boolean;
    failed_login_attempts: number;
  }>(
    `SELECT id, password_hash, is_active, failed_login_attempts,
            COALESCE(locked_until > NOW(), false) AS locked
     FROM users WHERE lower(email) = $1`,
    [email],
  );
  const user = rows[0];

  if (!user || (config.isProduction && DEV_ONLY_EMAIL.test(email))) {
    await verifyPassword(password, await getDummyHash()); // equalise timing
    throw invalid();
  }
  if (user.locked) {
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk || !user.is_active) {
    await withTransaction(async (db) => {
      if (!passwordOk) {
        await db.query(
          `UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE WHEN failed_login_attempts + 1 >= $2
                                 THEN NOW() + make_interval(mins => $3) ELSE locked_until END
           WHERE id = $1`,
          [user.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
        );
      }
      await audit(db, req, {
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        details: { reason: passwordOk ? 'inactive' : 'wrong_password' },
      }, user.id);
    });
    throw invalid();
  }

  const token = await withTransaction(async (db) => {
    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
      [user.id],
    );
    const t = await createSession(db, user.id, req);
    await audit(db, req, { action: 'LOGIN', entityType: 'user', entityId: user.id }, user.id);
    return t;
  });

  setSessionCookie(res, token);
  res.json({ data: await loadProfile(user.id) });
});

authRouter.post('/logout', async (req, res) => {
  // Logging out must work even with an expired session, so authenticate is optional here.
  try {
    await authenticate(req, res, () => {});
  } catch {
    // no valid session — just clear the cookie
  }
  if (req.auth) {
    await withTransaction(async (db) => {
      await revokeSession(db, req.auth!.sessionId);
      await audit(db, req, { action: 'LOGOUT', entityType: 'user', entityId: req.auth!.userId });
    });
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ data: await loadProfile(getAuth(req).userId) });
});

const profileBody = z.object({
  name: z.string().trim().min(1).max(150),
  phone: phoneString.optional().nullable().or(z.literal('')).transform((v) => v || null),
});

authRouter.patch('/me', authenticate, async (req, res) => {
  const body = profileBody.parse(req.body);
  const auth = getAuth(req);
  await withTransaction(async (db) => {
    await db.query('UPDATE users SET name = $2, phone = $3 WHERE id = $1', [auth.userId, body.name, body.phone]);
    await audit(db, req, { action: 'PROFILE_UPDATED', entityType: 'user', entityId: auth.userId });
  });
  res.json({ data: await loadProfile(auth.userId) });
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordPolicy,
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  key: (req) => `password:${req.auth?.userId ?? clientIp(req)}`,
});

authRouter.post('/change-password', authenticate, passwordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
  const auth = getAuth(req);
  if (currentPassword === newPassword) throw badRequest('The new password must be different from the current one.');

  const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
    auth.userId,
  ]);
  if (!rows[0] || !(await verifyPassword(currentPassword, rows[0].password_hash))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'Current password is incorrect.');
  }

  const newHash = await hashPassword(newPassword);
  await withTransaction(async (db) => {
    await db.query('UPDATE users SET password_hash = $2, password_changed_at = NOW() WHERE id = $1', [
      auth.userId,
      newHash,
    ]);
    // Sign out every other device that used the old password.
    await revokeUserSessions(db, auth.userId, auth.sessionId);
    await audit(db, req, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: auth.userId });
  });
  res.status(204).end();
});

export async function loadProfile(userId: number) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.last_login_at AS "lastLoginAt",
            u.password_changed_at AS "passwordChangedAt",
            CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('id', b.id, 'name', b.branch_name, 'code', b.branch_code) END AS branch,
            COALESCE(ARRAY(SELECT r.role_name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                           WHERE ur.user_id = u.id ORDER BY r.role_name), '{}') AS roles,
            COALESCE(ARRAY(SELECT DISTINCT p.permission_code FROM user_roles ur
                           JOIN role_permissions rp ON rp.role_id = ur.role_id
                           JOIN permissions p ON p.id = rp.permission_id
                           WHERE ur.user_id = u.id ORDER BY p.permission_code), '{}') AS permissions
     FROM users u LEFT JOIN branches b ON b.id = u.branch_id
     WHERE u.id = $1`,
    [userId],
  );
  if (!rows[0]) throw unauthorized();
  const settings = await getSettings(pool);
  return {
    ...rows[0],
    config: {
      companyName: settings['company.name'],
      currency: settings['company.currency'],
      paymentMethods: settings['payments.enabled_methods'],
      weekStartsOn: settings['collections.week_starts_on'],
    },
  };
}
