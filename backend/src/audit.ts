import type { Request } from 'express';
import { clientIp } from './auth/session.js';
import type { Queryable } from './db.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: number | null;
  /** Safe, non-secret context only — never passwords, tokens or full documents. */
  details?: Record<string, unknown>;
}

/** Records who did what. Call with the transaction client so it commits atomically. */
export async function audit(db: Queryable, req: Request, entry: AuditEntry, userId?: number | null): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId !== undefined ? userId : (req.auth?.userId ?? null),
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      clientIp(req),
    ],
  );
}
