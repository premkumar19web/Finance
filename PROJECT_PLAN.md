# Lion Finance — Project Plan & Status

Finance collection management platform: branches, staff, customers, loans, repayment
schedules, field collections, payments, expenses, reports and audit trail.

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite, `react-router` 7, plain CSS design tokens |
| Backend | Node 24 + Express 5 + TypeScript (run with `tsx`), `zod` validation, `pg` |
| Database | PostgreSQL 18, plain SQL migrations tracked in `schema_migrations` |
| Auth | Argon2id (Node built-in `crypto.argon2`), DB-backed sessions in an HttpOnly cookie |
| Tests | Node built-in test runner (`node --test`) against a separate `lion_finance_test` database |

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Inspect repository, connect PostgreSQL, health endpoints | ✅ Done |
| 2 | Schema: 13 core tables + permissions, role_permissions, user_sessions; constraints, triggers, sequences | ✅ Done |
| 3 | Finance core: decimal-safe money, flat-interest schedules, oldest-first allocation | ✅ Done |
| 4 | Backend API: auth, RBAC, branch scoping, all modules, audit, rate limiting, CSRF | ✅ Done |
| 5 | Idempotent development seed + verification script | ✅ Done |
| 6 | Frontend: layout, API client, auth, 20 screens | ✅ Done |
| 7 | Tests: unit (finance), API (auth, RBAC, CRUD, payments, validation) | ✅ Done |
| 8 | Documentation | ✅ Done |
| 9 | Business-rule confirmation (see `OPEN_QUESTIONS.md`) | ⏳ Waiting on product owner |

Vertical slice built first: login → customers → loans → collections → payments.

## Verification (27 Oct 2026)

| Check | Result |
|---|---|
| Backend `npm run typecheck` | ✅ |
| Backend `npm test` (52 unit + API tests, `lion_finance_test`) | ✅ 52/52 |
| `npm run db:verify` on `lion_finance` | ✅ all 15 invariants |
| Frontend `npm run lint` / `npm run build` | ✅ / ✅ |
| Browser walk-through (headless Edge): login, dashboard, customers, loan detail, daily/weekly collections, payment entry → receipt, history, all admin screens, CSV export, agent restrictions, 390 px mobile layout | ✅ 29/29 after fixing mobile overflow |

Not yet covered by automated tests: frontend unit tests (no test runner installed) and
committed end-to-end tests (the browser run used a throwaway script).

## Repository layout

```
backend/
  src/
    app.ts                 Express app (used by server and tests)
    server.ts              Starts the HTTP server
    config.ts              Validated environment configuration
    db.ts                  Shared PostgreSQL pool
    db/                    migrations, migrate, seed, verify, helpers
    finance/               money, schedule and allocation logic (pure, unit tested)
    auth/                  password hashing, sessions, permission middleware
    http/                  errors, validation, pagination, security middleware
    modules/<feature>/     routes (+ service) per feature
    test/                  test environment and API helpers
frontend/
  src/
    api/                   typed API client and DTO types
    auth/                  session context and route guards
    components/            layout and reusable UI
    pages/                 one file per screen
    lib/                   formatting helpers
```

See `README.md` for commands, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`,
`SEED_DATA.md`, `SECURITY.md` and `OPEN_QUESTIONS.md` for details.
