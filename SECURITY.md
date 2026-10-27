# Security

## What is implemented

| Area | Implementation |
|---|---|
| Passwords | Argon2id (Node built-in, OWASP parameters m=19 MiB, t=2, p=1), PHC string format; policy ≥ 10 chars with a letter and a digit. Plaintext is never stored or logged. |
| Login protection | Generic "invalid email or password" for unknown users and wrong passwords (with equalised timing); 5 failures lock the account for 15 min; rate limits per IP (30/15 min) and per email (10/15 min). |
| Sessions | Random 256-bit token in an **HttpOnly, SameSite=Strict** cookie (`Secure` in production), scoped to `/api`. Only its SHA-256 hash is stored. 12 h absolute lifetime, 60 min idle timeout, server-side revocation on logout, password change, reset and deactivation. |
| CSRF | SameSite=Strict cookie **plus** a required custom header (`X-Requested-With`) on every state-changing request **plus** an `Origin` allowlist check. |
| CORS | Origins in `FRONTEND_URL`; outside production also any loopback origin (`localhost`, `127.0.0.1`, `[::1]`, any port) for local development. Credentials allowed only for these. In development the frontend calls the API same-origin through the Vite proxy. |
| Authorization | Role → permission table enforced by middleware on **every** API route. Branch scoping on every query and record lookup for users without `scope.all_branches`. Collection agents are further limited to their assigned loans. The UI hiding menus is cosmetic only. |
| Maker-checker | Loan approver must differ from the creator (setting); expenses cannot be approved by the submitter; the Administrator role cannot be stripped of permissions; users cannot deactivate or demote themselves. |
| Input validation | `zod` schemas on every body and query; whitelisted sort columns; strict money/rate/date formats. |
| SQL injection | Parameterised queries only (`pg` placeholders); dynamic filters are built from fixed clauses. |
| Financial integrity | Transactions with row locks for payments/reversals/disbursement; idempotency keys; immutable, undeletable payments (DB triggers); deferred check that allocations equal payment amounts; composite FKs prevent cross-loan allocations. |
| Error handling | Clients get safe codes and messages; stack traces and SQL details stay in server logs. |
| Logging | One line per request with method, **path only** (no query strings, which may contain names or phones), status, duration and user id. No bodies, passwords or tokens. |
| Audit trail | `audit_logs` records sign-ins, failures, every create/approve/reject/disburse, payment and reversal, setting and permission change, CSV export — with actor, time, IP and non-secret details. |
| Headers | `helmet` defaults (CSP, HSTS, no-sniff, frame denial, …); `Cache-Control: no-store` on API responses; `x-powered-by` removed. |
| Rate limiting | Global 600 req/min per IP; payments 30/min per user. In-memory — use a shared store (e.g. Redis) when running several server instances. |
| Exports | CSV cells starting with `= + - @` are neutralised against spreadsheet formula injection. |
| Secrets | Only in `backend/.env` (git-ignored). Config is validated at start-up; errors list variable names, never values. |
| Personal data | Identity documents: type + last 4 characters only. No card numbers, CVVs or bank credentials are stored. |
| Dev accounts | Seeded accounts use `@….test` emails; login for them is refused when `NODE_ENV=production`; the seed refuses to run in production. |

## Production checklist

1. `NODE_ENV=production`, HTTPS only (Secure cookies require it), real `FRONTEND_URL`.
2. A dedicated PostgreSQL role with least privilege (not `postgres`); strong password; TLS to the DB if remote.
3. **Change the `postgres` password used during development** — it was shared in a chat session.
4. Never run `npm run db:seed` against production. Create the first administrator deliberately
   (e.g. a one-off script using `hashPassword`), then manage users in the app.
5. Put the API behind a reverse proxy; if you enable `trust proxy`, make sure `X-Forwarded-For`
   cannot be spoofed, otherwise IP rate limits can be bypassed.
6. Back up the database and test restores. Monitor logs for `LOGIN_FAILED` bursts.
7. Run `npm audit` in both packages regularly.

## Reporting a vulnerability

Contact the repository owner privately; do not open a public issue.
