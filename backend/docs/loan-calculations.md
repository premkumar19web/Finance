# Loan calculations — implemented policy

This is what the code does today (`backend/src/finance/`). Every rule here is an
**assumption to confirm** — see [OPEN_QUESTIONS.md](../../OPEN_QUESTIONS.md).

## Exact arithmetic

All money is calculated as whole **paise** using JavaScript `BigInt` (no floating point),
and stored as PostgreSQL `NUMERIC(14,2)`. The API sends money as strings (`"1500.50"`).
Interest rates are handled in units of 0.0001 %.

## Flat interest

```
total interest = principal × (annual rate ÷ 100) × (installments ÷ periods per year)
periods per year: DAILY 365, WEEKLY 52, MONTHLY 12
```

Rounded **half-up to the paisa**, once, on the total.

## Splitting into installments

- Principal per installment = principal ÷ n, rounded **down** to the paisa.
- Interest per installment = total interest ÷ n, rounded **down**.
- The **last installment** gets whatever is left, so the schedule always sums exactly to
  `principal + total interest`.

## Due dates

- First installment: one period after the start date.
- Daily: +1 day each; weekly: +7 days each; monthly: same day of month, clamped to the
  month's last day (start 31 Jan → 28/29 Feb, 31 Mar, …).
- No weekends or holidays are skipped.

## Worked examples (output of `buildSchedule`, start date 31 Jan 2026)

| Loan | Total interest | Installments | Total payable |
|---|---|---|---|
| ₹10,000 at 24 % for 3 monthly | 10,000 × 0.24 × 3/12 = **₹600.00** | 2 × ₹3,533.33, last ₹3,533.34 (due 28 Feb, 31 Mar, 30 Apr) | ₹10,600.00 |
| ₹10,000 at 24 % for 10 weekly | 10,000 × 0.24 × 10/52 = 461.538… → **₹461.54** | 9 × ₹1,046.15, last ₹1,046.19 | ₹10,461.54 |
| ₹50,000 at 18 % for 12 monthly | **₹9,000.00** | 11 × ₹4,916.66, last ₹4,916.74 | ₹59,000.00 |
| ₹20,000 at 30 % for 100 daily | 20,000 × 0.30 × 100/365 = 1,643.835… → **₹1,643.84** | 99 × ₹216.43, last ₹217.27 | ₹21,643.84 |

## Payments

1. The loan row and its open installments are locked (`SELECT … FOR UPDATE`).
2. The amount is applied to the **oldest unpaid installment first**, then the next.
3. A payment larger than the outstanding balance is rejected (`OVERPAYMENT`).
4. Installments become `PARTIAL` or `PAID`; the loan balance falls by the amount; at zero
   the loan becomes `CLOSED`.
5. Payment, allocations, balances and audit entries commit together, or not at all.

## Reversals

The payment is marked `REVERSED` (never deleted). Each installment it paid is reduced by
the allocated amount and its status recalculated; the loan balance is restored and a closed
loan re-opens. Balances only ever count `RECORDED` payments.

## Interest vs principal outstanding

`outstanding_balance` is the total still receivable (principal **and** interest). The split
of each payment between principal and interest is not tracked separately because flat
interest is spread evenly; it can be derived per installment from `principal_due` /
`interest_due` if accounting needs it.
