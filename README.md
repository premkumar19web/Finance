# Lion Finance

Loan collection management for a multi-branch microfinance business: customers,
loan applications and approvals, repayment schedules, daily/weekly field collections,
payments with printable receipts, expenses, reports and a full audit trail.

| | |
|---|---|
| Frontend | React 19 + TypeScript + Vite (`frontend/`, port 5173) |
| Backend | Node.js 24 + Express 5 + TypeScript (`backend/`, port 3001) |
| Database | PostgreSQL 18 (`lion_finance`) |

More detail: [PROJECT_PLAN.md](PROJECT_PLAN.md) · [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) ·
[API_DOCUMENTATION.md](API_DOCUMENTATION.md) · [SEED_DATA.md](SEED_DATA.md) ·
[SECURITY.md](SECURITY.md) · [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) ·
[backend/docs/loan-calculations.md](backend/docs/loan-calculations.md)

---

## Requirements

- **Node.js 24.7 or newer** (password hashing uses Node's built-in Argon2id). Check: `node --version`
- **PostgreSQL 18** running locally
- Windows PowerShell (commands below), or any shell

## 1. Install dependencies

```powershell
cd C:\LionFinance\backend
npm install
cd C:\LionFinance\frontend
npm install
```

## 2. Configure environment variables

```powershell
cd C:\LionFinance\backend
Copy-Item .env.example .env
notepad .env
```

Set `DATABASE_URL` to your PostgreSQL password. URL-encode special characters
(`@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `%` → `%25`). `.env` is git-ignored.

The frontend reads `VITE_API_BASE_URL` (default `/api`). In development, Vite forwards
`/api` to the backend on port 3001 (see `frontend/vite.config.ts`), so the browser only
ever talks to `http://localhost:5173` — no CORS or cookie problems:

```powershell
cd C:\LionFinance\frontend
Copy-Item .env.example .env
```

## 3. Create the database

Skip this if `lion_finance` already exists. The command only creates — it never drops.

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h localhost lion_finance
```

Check the connection:

```powershell
cd C:\LionFinance\backend
npm run db:test
```

## 4. Run migrations

```powershell
npm run db:migrate
```

Applies every pending file in `backend/src/db/migrations/` in order, each inside its own
transaction, and records it in `schema_migrations`. Safe to run repeatedly.

## 5. Load development seed data

```powershell
npm run db:seed
```

Development only (refuses when `NODE_ENV=production`). Runs once — later runs print
"already applied" and change nothing. See [SEED_DATA.md](SEED_DATA.md) for demo logins.

## 6. Verify seed counts and integrity

```powershell
npm run db:verify
```

Prints a row count for every table and checks 15 financial/relationship invariants
(allocations equal payments, balances equal unpaid installments, and so on).

## 7. Start the backend

```powershell
cd C:\LionFinance\backend
npm run dev
```

Health checks: <http://localhost:3001/api/health> and <http://localhost:3001/api/health/db>.

## 8. Start the frontend

In a second terminal:

```powershell
cd C:\LionFinance\frontend
npm run dev
```

Open <http://localhost:5173> and sign in, e.g. `admin@lionfinance.test` / `LionDev@2026`.

**"Cannot reach the server" on the sign-in page?** The backend isn't running (start it,
step 7), or `frontend/.env` still points at `http://localhost:3001/api` — set it to `/api`
and restart `npm run dev`. **"Too many sign-in attempts"** clears after 15 minutes or when
the backend restarts.

## 9. Run tests and checks

```powershell
cd C:\LionFinance\backend
npm run typecheck      # TypeScript
npm test               # creates/updates lion_finance_test, then runs all tests
npm run test:unit      # finance unit tests only (no database needed)

cd C:\LionFinance\frontend
npm run lint
npm run build          # type-check + production build
```

`npm test` never touches `lion_finance`: it uses `lion_finance_test` (created if missing).

## 10. Build for production

```powershell
cd C:\LionFinance\frontend
npm run build          # static files in frontend\dist — serve them from any web server
```

The backend runs TypeScript directly with `tsx` (`npm start`). On a server set
`NODE_ENV=production`, use HTTPS, set `FRONTEND_URL` to the real site origin, and never run
`db:seed`. See [SECURITY.md](SECURITY.md) for the production checklist.

## 11. Connect with DataGrip

1. **New → Data Source → PostgreSQL.**
2. Host `localhost`, port `5432`, user `postgres`, your password, database `lion_finance`.
3. **Test Connection**, then **OK**.
4. Expand **lion_finance → public → tables**. If tables are missing after a migration,
   select the connection and press **Ctrl+F5** (DataGrip caches the structure).

Useful views: `v_collection_schedules` adds the live `effective_status` (OVERDUE) and
`days_past_due` to each installment.

---

## Project layout

```
backend/src/
  app.ts, server.ts, config.ts, db.ts, audit.ts
  auth/        password hashing, sessions, permission middleware
  http/        errors, validation, SQL filter helper, CSRF + rate limiting
  finance/     money, schedule and allocation logic (+ unit tests)
  modules/     one folder per feature (routes + services)
  db/          migrations, migrate, seed, verify, integrity checks
  test/        API tests and helpers
frontend/src/
  api/         API client and response types
  auth/        session context and route guards
  components/  layout, tables, forms, pickers, charts
  pages/       one screen per file
  lib/         formatting, money, data-loading hooks
```
