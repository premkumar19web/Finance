# API documentation

Base URL: `http://localhost:3001/api`. The frontend uses `VITE_API_BASE_URL` (default
`/api`, proxied to the backend by Vite in development).

## Conventions

- **Authentication:** `POST /auth/login` sets an HttpOnly `lf_session` cookie. Browsers must
  send requests with `credentials: 'include'`.
- **CSRF:** every non-GET request must include the header `X-Requested-With: LionFinance`.
  Requests from origins not in `FRONTEND_URL` are rejected.
- **Bodies:** JSON. Money is a **string** with up to 2 decimals (`"1500.50"`); rates up to 4.
  Dates are `YYYY-MM-DD`.
- **Success:** `{ "data": … }`; lists add `"meta": { page, pageSize, total, totalPages }`
  and sometimes `"summary"`. Actions without content return `204`.
- **Errors:** `{ "error": { "code", "message", "details"? } }`.

| Status | Meaning |
|---|---|
| 400 | `VALIDATION_ERROR` (with `details: [{ field, message }]`), malformed input |
| 401 | Not signed in / session expired |
| 403 | Missing permission, other branch, or CSRF check failed |
| 404 | Not found |
| 409 | Duplicate unique value, idempotency key reused with different data |
| 422 | Business rule broken (code explains: `OVERPAYMENT`, `MAKER_CHECKER`, `INVALID_LOAN_STATUS`, …) |
| 429 | Rate limited or account temporarily locked |
| 503 | Database unavailable (health check) |

**Lists** accept `page` (default 1), `pageSize` (≤ 100), `search`, `sort` (`field` or
`-field`, whitelisted) and the filters listed below.
**Branch scope:** users without `scope.all_branches` only ever see their own branch.

## Endpoints

| Method & path | Permission | Notes |
|---|---|---|
| `GET /health` · `GET /health/db` | public | Liveness / database check |
| `POST /auth/login` | public | `{ email, password }` → profile; rate limited, 5 failures lock 15 min |
| `POST /auth/logout` | session | Revokes the session server-side |
| `GET /auth/me` · `PATCH /auth/me` | session | Profile (roles, permissions, config) / update name & phone |
| `POST /auth/change-password` | session | `{ currentPassword, newPassword }`; signs out other devices |
| `GET /dashboard/summary` | dashboard.view | `?branchId`; all dashboard figures |
| `GET /branches` · `GET /branches/:id` | branches.view | `?search&isActive&sort` |
| `POST /branches` · `PATCH /branches/:id` | branches.manage | Deactivation blocked while open loans exist |
| `GET /users` · `GET /users/:id` | users.view | `?search&role&branchId&isActive` |
| `POST /users` · `PATCH /users/:id` | users.manage | Roles array; cannot deactivate/demote yourself |
| `POST /users/:id/reset-password` | users.manage | Clears lockout, signs the user out |
| `GET /roles` · `GET /roles/permissions` | roles.view | |
| `PUT /roles/:id/permissions` | roles.manage | `{ permissionCodes: [] }`; ADMIN is locked |
| `GET /customers` · `GET /customers/:id` | customers.view | Detail includes loans and totals |
| `POST /customers` · `PATCH /customers/:id` | customers.manage | Code generated; deactivation blocked with open loans |
| `GET /loans` · `GET /loans/:id` | loans.view | `?status&frequency&branchId&customerId&agentId`; detail has schedule, payments, agents |
| `POST /loans/preview` | loans.create / loans.view | Schedule without saving |
| `POST /loans` | loans.create | Creates PENDING loan; validated against settings |
| `POST /loans/:id/approve` | loans.approve | Maker-checker: not the creator |
| `POST /loans/:id/reject` | loans.approve | `{ reason }` |
| `POST /loans/:id/disburse` | loans.disburse | `{ agentId? }`; creates the schedule, loan becomes ACTIVE |
| `POST /loans/:id/default` | loans.approve | `{ reason }` |
| `GET /assignments` | assignments.view | `?loanId&agentId&branchId&active` |
| `GET /assignments/agents` | assignments.view / collections.view | Active agents for dropdowns |
| `POST /assignments` · `POST /assignments/:id/end` | assignments.manage | Reassigning ends the previous assignment |
| `GET /collections/due` | collections.view | `?from&to&includeArrears&status&branchId&agentId`; agents see only their loans |
| `GET /collections/daily-totals` | collections.view | `?from&to` (≤ 92 days): due vs collected per day |
| `GET /collections/agent-summary` | collections.view | `?agentId` (supervisors) |
| `GET /payments` · `GET /payments/:id` | payments.view | Filters `from,to,loanId,customerId,agentId,method,status`; detail = receipt + allocations |
| `POST /payments` | payments.create | See below |
| `POST /payments/:id/reverse` | payments.reverse | `{ reason }`; within the reversal window |
| `GET /expenses` | expenses.view | `?from&to&status&category&branchId` |
| `POST /expenses` | expenses.create | |
| `POST /expenses/:id/approve` · `/reject` | expenses.approve | `{ note }` (required to reject); not your own |
| `GET /reports` · `GET /reports/:type` | reports.view | Types: `collections`, `payments`, `outstanding-loans`, `overdue-installments`, `branch-performance`, `agent-performance`, `expenses`. `?from&to&branchId&groupBy` |
| `GET /reports/:type?format=csv` | reports.export | CSV download (formula-injection safe); export is audited |
| `GET /audit-logs` · `GET /audit-logs/actions` | audit.view | `?from&to&userId&action&entityType&entityId` |
| `GET /settings` · `PUT /settings/:key` | settings.view / settings.manage | `{ value }` validated per key |

## Recording a payment

```http
POST /api/payments
X-Requested-With: LionFinance
Content-Type: application/json

{
  "loanId": 154,
  "amount": "1500.00",
  "paymentMethod": "UPI",
  "referenceNumber": "UPI123456789012",
  "notes": null,
  "idempotencyKey": "7d0f4c8e-3b1a-4a52-9c1e-2f6f0b9e8a11"
}
```

- `201 { data: { id, receiptNumber, replayed: false } }` — recorded.
- `200 { …, replayed: true }` — the same `idempotencyKey` was already recorded; nothing new happened.
- `409 IDEMPOTENCY_KEY_REUSED` — key reused for a different loan/amount.
- `422 OVERPAYMENT` (with `details.outstanding`), `LOAN_NOT_ACTIVE`, `METHOD_DISABLED`, …
- `403` — collection agents may only collect on loans assigned to them.

The client generates one UUID per reviewed submission and reuses it on retry, so a network
failure can never cause a double charge. Everything (payment, allocations, installment
statuses, loan balance, loan closing, audit entries) commits in one transaction with the
loan row locked.
