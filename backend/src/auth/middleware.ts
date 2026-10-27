import type { Request, RequestHandler } from 'express';
import { forbidden, unauthorized } from '../http/errors.js';
import { loadSession, readSessionCookie, type AuthContext } from './session.js';

/** Rejects the request with 401 unless it carries a valid session cookie. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readSessionCookie(req);
  const auth = token ? await loadSession(token) : null;
  if (!auth) throw unauthorized('Your session has expired. Please sign in again.');
  req.auth = auth;
  next();
};

/** Allows the request if the user has at least one of the given permissions. */
export function requirePermission(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    const auth = getAuth(req);
    if (!codes.some((c) => auth.permissions.has(c))) throw forbidden();
    next();
  };
}

export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function hasPermission(req: Request, code: string): boolean {
  return getAuth(req).permissions.has(code);
}

/**
 * Branch the user is limited to, or null when they may see every branch.
 * A user without `scope.all_branches` and without a branch sees nothing (-1).
 */
export function branchScope(req: Request): number | null {
  const auth = getAuth(req);
  if (auth.permissions.has('scope.all_branches')) return null;
  return auth.branchId ?? -1;
}

/**
 * Resolves the branch filter for a query: the requested branch if allowed,
 * otherwise the user's own branch. Throws if a limited user asks for another branch.
 */
export function effectiveBranch(req: Request, requested: number | undefined): number | null {
  const scope = branchScope(req);
  if (scope === null) return requested ?? null;
  if (requested !== undefined && requested !== scope) throw forbidden('You can only access your own branch.');
  return scope;
}

/**
 * True for field collection agents (no supervisory permissions). They only work on
 * loans currently assigned to them.
 */
export function isAgentOnly(req: Request): boolean {
  const auth = getAuth(req);
  return (
    auth.roles.includes('COLLECTION_AGENT') &&
    !auth.permissions.has('assignments.manage') &&
    !auth.permissions.has('scope.all_branches')
  );
}

export function assertBranchAccess(req: Request, branchId: number): void {
  const scope = branchScope(req);
  if (scope !== null && scope !== branchId) throw forbidden('This record belongs to another branch.');
}
