# Open questions — business rules to confirm

The application works today using the **documented assumptions** below. None of them is a
regulatory or accounting rule; each needs confirmation by the business owner (and, where
relevant, a compliance advisor) before real money is managed. Where a value is configurable
it lives in **Settings** (`app_settings`) and can be changed without code.

| # | Topic | Current assumption | Where |
|---|---|---|---|
| 1 | Interest method | **Flat** interest on the original principal for the whole term. Reducing-balance (EMI) is not implemented. | `backend/src/finance/schedule.ts` |
| 2 | Annual → period conversion | Term in years = installments ÷ 365 (daily), ÷ 52 (weekly), ÷ 12 (monthly). | same |
| 3 | Rounding | Total interest rounded half-up to the paisa once; principal and interest each split evenly, rounded down; the **last installment absorbs the remainder**. | same |
| 4 | First due date | One period after the loan start date. No Sunday/holiday skipping (no holiday calendar exists). | same |
| 5 | Monthly dates | Keep the start day; clamp to the month's last day (31 Jan → 28/29 Feb). | same |
| 6 | Payment allocation | Oldest unpaid installment first; no separate interest-first/penalty-first split within an installment. | `finance/allocation.ts` |
| 7 | Overpayment | Rejected: a payment may not exceed the loan's outstanding balance. Advance payments within the balance are applied to future installments. | `payments/service.ts` |
| 8 | Overdue | An unpaid or partly paid installment is overdue from the day after its due date. No grace period. | view `v_collection_schedules` |
| 9 | Penalties / late fees | **None.** Not implemented. | — |
| 10 | Processing fees | None; full principal is disbursed. | — |
| 11 | Prepayment / foreclosure | Paying the full outstanding closes the loan; flat interest is **not** recalculated (no rebate). | — |
| 12 | Defaulted loans | Manual action by a user with `loans.approve`; payments are still accepted; no automatic rule (e.g. 90 days past due). | loans routes |
| 13 | Waivers | Seed data contains 3 waived installments, but there is **no waiver screen/API** yet; who may waive and how it is approved must be defined. | — |
| 14 | Refunds | Not implemented. A wrong payment is **reversed** (balances restored, receipt kept and marked reversed). Cash refunds of genuine overpayments need a policy. | — |
| 15 | Reversal window | 30 days (setting `payments.reversal_window_days`). | Settings |
| 16 | Backdated payments | The API accepts an optional `paymentDate` (not before disbursement, not in the future); the UI always records "now". Should agents be allowed to backdate? | payments routes |
| 17 | Loan start date | Must be today or up to 90 days ahead (setting). Backdated loans are not allowed. | Settings |
| 18 | Limits | Principal ₹1,000–₹10,00,000; max rate 36 % p.a.; max installments 365 daily / 104 weekly / 60 monthly. | Settings |
| 19 | Maker-checker | Loan approver must differ from creator (setting `loans.require_different_approver`); expense reviewer must differ from submitter (always). | Settings / expenses |
| 20 | Agent scope | Agents see and collect only loans **assigned** to them; a loan can be disbursed without an agent. Should assignment be mandatory at disbursement? | collections / payments |
| 21 | Collection achievement | Month-to-date: amount paid against installments due from the 1st to today ÷ amount due in that period. | dashboard |
| 22 | Business time zone | `Asia/Kolkata` (`APP_TIMEZONE`) decides "today". | `.env` |
| 23 | Receipt numbering | `LF-YYYYMMDD-NNNNNN`, one global sequence (not per branch, not reset yearly). | Settings `receipts.prefix` |
| 24 | KYC | Only document type + last 4 characters are stored. Is full KYC (documents, verification status, photos) required, and where should documents be stored? | customers |
| 25 | Data retention | How long to keep closed loans, audit logs and sessions; customer data deletion requests. | — |
| 26 | Regulatory reporting | Any statutory reports, interest-rate disclosures or receipts wording required for your licence. | — |
