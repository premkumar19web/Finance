import type { Request, RequestHandler } from 'express';
import { config } from '../config.js';
import { AppError } from './errors.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'LionFinance';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Browser origins allowed to call the API: the FRONTEND_URL list, plus — outside
 * production only — any loopback address on any port, so opening the dev site as
 * 127.0.0.1, [::1] or on another Vite port still works.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (config.corsOrigins.includes(origin)) return true;
  if (config.isProduction) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * CSRF defence for cookie sessions (in addition to SameSite=Strict cookies):
 * state-changing requests must carry a custom header — browsers only send custom
 * headers cross-origin after a CORS preflight, which our allowlist refuses — and,
 * when the browser sends an Origin header, it must be an allowed origin.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    throw new AppError(403, 'CSRF_CHECK_FAILED', 'Request blocked by CSRF protection.');
  }
  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin)) {
    throw new AppError(403, 'CSRF_CHECK_FAILED', 'Request blocked: origin not allowed.');
  }
  next();
};

/** API responses contain personal and financial data: never cache them. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/** One line per request. Logs the path only (query strings may contain names or phone numbers). */
export const requestLogger: RequestHandler = (req, res, next) => {
  if (config.NODE_ENV === 'test') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const user = req.auth ? ` user=${req.auth.userId}` : '';
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms${user}`);
  });
  next();
};

interface RateLimitOptions {
  windowMs: number;
  max: number;
  key: (req: Request) => string;
  message?: string;
}

/**
 * Small fixed-window, in-memory rate limiter (enough for a single server process).
 * For several server instances, move the counters to a shared store such as Redis.
 */
export function rateLimit({ windowMs, max, key, message }: RateLimitOptions): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  sweeper.unref();

  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new AppError(429, 'RATE_LIMITED', message ?? 'Too many requests. Please slow down and try again.');
    }
    next();
  };
}
