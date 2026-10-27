import { ApiError } from '../api/client';

/** Turns any thrown value into a human-readable message for forms. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = Object.values(err.fieldErrors);
    return fields.length ? `${err.message} ${fields.join(' ')}` : err.message;
  }
  return 'Something went wrong. Please try again.';
}

/** Field-level messages from a validation error, keyed by field name. */
export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fieldErrors : {};
}
