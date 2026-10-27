// The only place the frontend talks to the backend. Adds the session cookie
// (credentials: 'include'), the CSRF header, timeouts and consistent errors.

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 15_000;

/** Fired when the server says the session is gone; the auth provider signs the user out. */
export const SESSION_EXPIRED_EVENT = 'lf:session-expired';

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field-level validation messages keyed by field name. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as FieldError[]).map((d) => [d.field, d.message]));
  }
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ''}`;
}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function send(method: string, pathWithQuery: string, opts: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => controller.abort(opts.signal?.reason));

  const headers: Record<string, string> = { 'X-Requested-With': 'LionFinance' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    return await fetch(`${BASE_URL}${pathWithQuery}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err; // caller cancelled — not an error to show
    if (controller.signal.aborted) {
      throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.');
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and that the API is running.');
  } finally {
    clearTimeout(timer);
  }
}

async function handle<T>(res: Response, pathWithQuery: string): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && !pathWithQuery.startsWith('/auth/login') && !pathWithQuery.startsWith('/auth/me')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status}).`, err?.details);
  }
  return body as T;
}

export async function request<T>(method: string, pathWithQuery: string, opts?: RequestOptions): Promise<T> {
  return handle<T>(await send(method, pathWithQuery, opts), pathWithQuery);
}

export const http = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', buildUrl(path, query), signal ? { signal } : {}),
  post: <T = void>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  patch: <T = void>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  put: <T = void>(path: string, body: unknown) => request<T>('PUT', path, { body }),
};

/** Downloads a CSV export through the authenticated session. */
export async function downloadFile(path: string, query: Query, fallbackName: string): Promise<void> {
  const url = buildUrl(path, query);
  const res = await send('GET', url, { timeoutMs: 60_000 });
  if (!res.ok) await handle(res, url);
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
