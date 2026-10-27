// Relationship and financial invariants that must always hold.
// Used by `npm run db:verify` and by the automated tests.

export const MIN_ROWS = 50;

/** Tables that intentionally hold fewer than 50 rows, and why. */
export const ROW_COUNT_EXCEPTIONS: Record<string, string> = {
  roles: 'Fixed reference list: the 6 standard roles the backend understands',
  permissions: 'Fixed reference list: one row per permission code checked by the backend',
  app_settings: 'One row per real setting; inventing more would be meaningless',
  user_sessions: 'Runtime table: rows appear only when someone signs in',
  schema_migrations: 'One row per applied migration file',
};

/** Each query returns the number of violating rows (0 = pass). */
export const INTEGRITY_CHECKS: [label: string, sql: string][] = [
  ['Every installment\'s paid amount equals its allocations from recorded payments', `
    SELECT count(*) FROM collection_schedules s
    WHERE s.paid_amount <> COALESCE((SELECT SUM(pa.allocated_amount) FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id WHERE pa.schedule_id = s.id AND p.status = 'RECORDED'), 0)`],
  ['Every payment is allocated in full', `
    SELECT count(*) FROM payments p
    WHERE p.amount <> COALESCE((SELECT SUM(allocated_amount) FROM payment_allocations WHERE payment_id = p.id), 0)`],
  ['Allocations only touch installments of the payment\'s own loan', `
    SELECT count(*) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
    JOIN collection_schedules s ON s.id = pa.schedule_id WHERE p.loan_id <> s.loan_id OR pa.loan_id <> p.loan_id`],
  ['Loan outstanding balance equals the unpaid installment total', `
    SELECT count(*) FROM loans l WHERE l.disbursed_at IS NOT NULL AND l.outstanding_balance <>
      (SELECT COALESCE(SUM(due_amount - paid_amount), 0) FROM collection_schedules WHERE loan_id = l.id AND status <> 'WAIVED')`],
  ['Recorded payments per loan equal amounts paid on its installments', `
    SELECT count(*) FROM loans l WHERE
      COALESCE((SELECT SUM(amount) FROM payments WHERE loan_id = l.id AND status = 'RECORDED'), 0) <>
      COALESCE((SELECT SUM(paid_amount) FROM collection_schedules WHERE loan_id = l.id), 0)`],
  ['Schedules sum exactly to principal and to total payable', `
    SELECT count(*) FROM loans l WHERE l.disbursed_at IS NOT NULL AND (
      l.principal_amount <> (SELECT SUM(principal_due) FROM collection_schedules WHERE loan_id = l.id) OR
      l.total_payable <> (SELECT SUM(due_amount) FROM collection_schedules WHERE loan_id = l.id) OR
      l.loan_term <> (SELECT count(*) FROM collection_schedules WHERE loan_id = l.id))`],
  ['Loans not yet disbursed have no schedule and no balance', `
    SELECT count(*) FROM loans l WHERE l.disbursed_at IS NULL AND (l.outstanding_balance <> 0 OR
      EXISTS (SELECT 1 FROM collection_schedules WHERE loan_id = l.id))`],
  ['Closed loans owe nothing; active and defaulted loans still owe', `
    SELECT count(*) FROM loans WHERE (status = 'CLOSED' AND outstanding_balance <> 0)
      OR (status IN ('ACTIVE','DEFAULTED') AND outstanding_balance = 0)`],
  ['Payments only on disbursed loans, never before disbursal or in the future', `
    SELECT count(*) FROM payments p JOIN loans l ON l.id = p.loan_id
    WHERE l.disbursed_at IS NULL OR p.payment_date < l.disbursed_at OR p.payment_date > NOW()`],
  ['Collectors belong to the loan\'s branch (or are all-branch staff)', `
    SELECT count(*) FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
    JOIN users u ON u.id = COALESCE(p.collected_by, p.recorded_by) WHERE u.branch_id IS DISTINCT FROM c.branch_id
      AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                      JOIN permissions pm ON pm.id = rp.permission_id
                      WHERE ur.user_id = u.id AND pm.permission_code = 'scope.all_branches')`],
  ['No loan has more than one active collection agent', `
    SELECT count(*) FROM loans l WHERE l.status IN ('ACTIVE','DEFAULTED') AND
      (SELECT count(*) FROM collection_assignments WHERE loan_id = l.id AND unassigned_at IS NULL) > 1`],
  ['Assigned agents hold the COLLECTION_AGENT role and work in the loan\'s branch', `
    SELECT count(*) FROM collection_assignments ca JOIN loans l ON l.id = ca.loan_id
    JOIN customers c ON c.id = l.customer_id JOIN users u ON u.id = ca.agent_user_id
    WHERE u.branch_id IS DISTINCT FROM c.branch_id OR NOT EXISTS (
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.role_name = 'COLLECTION_AGENT')`],
  ['Inactive customers have no open loans', `
    SELECT count(*) FROM loans l JOIN customers c ON c.id = l.customer_id
    WHERE NOT c.is_active AND l.status IN ('PENDING','APPROVED','ACTIVE','DEFAULTED')`],
  ['Loan lifecycle timestamps are in order', `
    SELECT count(*) FROM loans WHERE approved_at < created_at OR disbursed_at < approved_at OR closed_at < disbursed_at`],
  ['Receipt numbers and idempotency keys are unique', `
    SELECT (SELECT count(*) - count(DISTINCT receipt_number) FROM payments) + (SELECT count(*) - count(DISTINCT idempotency_key) FROM payments)`],
];
