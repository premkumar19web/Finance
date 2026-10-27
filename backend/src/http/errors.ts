import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

/** An error whose status, code and message are safe to show to the client. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this.') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (entity = 'Record') => new AppError(404, 'NOT_FOUND', `${entity} not found.`);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const businessRule = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);

// Friendly messages for unique constraints the user can trigger.
const UNIQUE_MESSAGES: Record<string, string> = {
  users_email_lower_key: 'A user with this email already exists.',
  branches_branch_code_key: 'A branch with this code already exists.',
  roles_role_name_key: 'A role with this name already exists.',
  collection_assignments_one_active_per_loan: 'This loan already has an active collection agent.',
  payments_idempotency_key_key: 'This payment was already submitted.',
};

interface PgError {
  code: string;
  constraint?: string;
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && typeof (err as PgError).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((err as PgError).code);
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'API endpoint not found.'));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid.',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  // body-parser errors
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    return;
  }
  if (isPgError(err)) {
    const mapped = mapPgError(err);
    if (mapped) {
      res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
      return;
    }
  }

  // Unknown error: log details server-side only; the client gets a generic message.
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
};

function mapPgError(err: PgError): AppError | null {
  switch (err.code) {
    case '23505':
      return conflict(UNIQUE_MESSAGES[err.constraint ?? ''] ?? 'A record with the same unique value already exists.');
    case '23503':
      return conflict('A referenced record does not exist, or this record is still in use.');
    case '23514':
      return businessRule('CONSTRAINT_VIOLATION', 'The change breaks a data integrity rule.');
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return badRequest('A value has an invalid format or is out of range.');
    case '40001':
    case '40P01':
      return conflict('The record was changed by someone else at the same time. Please retry.', 'RETRY');
    default:
      return null;
  }
}
