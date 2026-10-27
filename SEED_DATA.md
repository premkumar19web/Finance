# Development seed data

```powershell
cd C:\LionFinance\backend
npm run db:seed     # load (once)
npm run db:verify   # counts + integrity checks
```

**Development only.** The seed refuses to run when `NODE_ENV=production`. All data is
synthetic: invented names, phone numbers in the non-dialable `+91 00000 xxxxx` block,
customer emails at `example.com`, staff emails at the reserved `.test` domain, and only the
last 4 characters of made-up ID documents.

## Demo logins

Password for every seeded account: **`LionDev@2026`** (override with `SEED_USER_PASSWORD`
in `backend/.env` *before* seeding).

| Email | Role | Sees |
|---|---|---|
| `admin@lionfinance.test` | Administrator | Everything, incl. users, roles, settings |
| `manager@lionfinance.test` | Manager | All branches; approves loans |
| `accountant@lionfinance.test` | Accountant | Disburses loans, reverses payments, approves expenses |
| `auditor@lionfinance.test` | Auditor | Read-only, incl. the audit log |
| `branchmanager@lionfinance.test` | Branch manager | Chennai Branch only |
| `agent@lionfinance.test` | Collection agent | Own assigned loans in Chennai Branch |

Try maker-checker: create a loan as `branchmanager@`, approve it as `manager@`, disburse it
as `accountant@`, collect as `agent@` (after assigning).

**Why these can't become production credentials:** the API rejects sign-in for any
`@….test` email when `NODE_ENV=production`, and the seed itself refuses to run in production.

## Safety and re-runs

- Everything is inserted in **one transaction** — all or nothing.
- A marker setting (`app_settings.dev.seed_version`) is written in the same transaction;
  later runs print "already applied" and change nothing. Nothing is ever deleted.
- Data is generated from a fixed random seed, with dates relative to the day you run it
  (so "today", "overdue" and "this week" are meaningful). Codes come from the same
  sequences the app uses, so new records never collide with seeded ones.
- The loan history is **simulated with the same schedule and allocation code the API uses**,
  so balances, allocations and statuses reconcile exactly (`npm run db:verify`).

## Actual counts (run on 26 Oct 2026)

| Table | Rows | ≥ 50 |
|---|---:|---|
| branches | 50 | ✅ |
| users | 92 | ✅ (6 demo + 86 generated; 4 inactive former agents) |
| user_roles | 92 | ✅ |
| customers | 150 | ✅ (7 inactive) |
| loans | 170 | ✅ ACTIVE 110 · CLOSED 30 · PENDING 10 · REJECTED 8 · APPROVED 6 · DEFAULTED 6 |
| collection_assignments | 167 | ✅ incl. reassignment history |
| collection_schedules | 5,116 | ✅ PAID 2,877 · PENDING 2,080 · OVERDUE 138 · PARTIAL 18 · WAIVED 3 |
| payments | 2,639 | ✅ incl. 15 reversed duplicates |
| payment_allocations | 3,279 | ✅ |
| expenses | 80 | ✅ approved / pending / rejected |
| audit_logs | 3,703 | ✅ |
| role_permissions | 110 | ✅ |
| roles | 6 | Exception — fixed list the backend understands |
| permissions | 28 | Exception — one row per permission code the backend checks |
| app_settings | 13 | Exception — one row per real setting (+ seed marker) |
| user_sessions | 0 | Exception — created only when someone signs in |

Inventing extra roles, permissions or settings just to reach 50 would make the data model
wrong, so those reference tables are documented exceptions.

## Starting over

The seed never deletes. To reload from scratch on a development machine, drop and recreate
the **development** database yourself, then migrate and seed:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\dropdb.exe" -U postgres -h localhost lion_finance    # destroys all data!
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h localhost lion_finance
npm run db:migrate
npm run db:seed
```
