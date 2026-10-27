import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { pool, type Queryable } from '../db.js';

export const SESSION_COOKIE = 'lf_session';

export interface AuthContext {
  userId: number;
  sessionId: number;
  name: string;
  email: string;
  branchId: number | null;
  roles: string[];
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Queryable, userId: number, req: Request): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, NOW() + make_interval(hours => $3), $4, $5)`,
    [userId, hashToken(token), config.SESSION_TTL_HOURS, clientIp(req), (req.get('user-agent') ?? '').slice(0, 255)],
  );
  return token;
}

/** Returns the signed-in user for a session token, or null if invalid/expired. */
export async function loadSession(token: string): Promise<AuthContext | null> {
  const { rows } = await pool.query<{
    session_id: number;
    user_id: number;
    name: string;
    email: string;
    branch_id: number | null;
    roles: string[];
    permissions: string[];
    stale: boolean;
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.name, u.email, u.branch_id,
            COALESCE(ARRAY(SELECT r.role_name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                           WHERE ur.user_id = u.id ORDER BY r.role_name), '{}') AS roles,
            COALESCE(ARRAY(SELECT DISTINCT p.permission_code FROM user_roles ur
                           JOIN role_permissions rp ON rp.role_id = ur.role_id
                           JOIN permissions p ON p.id = rp.permission_id
                           WHERE ur.user_id = u.id), '{}') AS permissions,
            s.last_seen_at < NOW() - INTERVAL '1 minute' AS stale
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND s.last_seen_at > NOW() - make_interval(mins => $2)
       AND u.is_active`,
    [hashToken(token), config.SESSION_IDLE_MINUTES],
  );
  const row = rows[0];
  if (!row) return null;

  // Sliding idle timeout; written at most once a minute to keep reads cheap.
  if (row.stale) {
    await pool.query('UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1', [row.session_id]);
  }

  return {
    userId: row.user_id,
    sessionId: row.session_id,
    name: row.name,
    email: row.email,
    branchId: row.branch_id,
    roles: row.roles,
    permissions: new Set(row.permissions),
  };
}

export async function revokeSession(db: Queryable, sessionId: number): Promise<void> {
  await db.query('UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

export async function revokeUserSessions(db: Queryable, userId: number, exceptSessionId?: number): Promise<void> {
  await db.query(
    'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2',
    [userId, exceptSessionId ?? 0],
  );
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable by JavaScript, so XSS cannot steal it
    sameSite: 'strict', // not sent on cross-site requests (CSRF defence)
    secure: config.isProduction, // HTTPS only in production
    path: '/api',
    maxAge: config.SESSION_TTL_HOURS * 3_600_000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.isProduction, path: '/api' });
}

export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? '').slice(0, 64);
}
