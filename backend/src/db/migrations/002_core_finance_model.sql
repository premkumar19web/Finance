-- 002_core_finance_model.sql
-- Extends the 001 schema with what the application needs for authentication,
-- permissions, approvals, financial tracking and integrity.
--
-- Written when every table was empty. New NOT NULL columns without defaults would
-- fail (and the whole migration roll back) if data already existed — nothing is lost.
-- Applied inside one transaction by src/db/migrate.ts. Do not add BEGIN/COMMIT here.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Human-readable codes are generated from these sequences by the backend.
CREATE SEQUENCE customer_code_seq;
CREATE SEQUENCE loan_code_seq;
CREATE SEQUENCE receipt_number_seq;

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------
ALTER TABLE branches
  ADD COLUMN city       VARCHAR(80),
  ADD COLUMN email      VARCHAR(255),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE branches
  ADD CONSTRAINT branches_branch_code_format_chk CHECK (branch_code ~ '^[A-Z0-9-]{2,30}$'),
  ADD CONSTRAINT branches_branch_name_chk CHECK (length(btrim(branch_name)) > 0);

CREATE TRIGGER branches_set_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- roles, permissions, role_permissions
-- Role and permission codes are referenced by backend code; see 003 for the data.
-- ---------------------------------------------------------------------------
ALTER TABLE roles
  ADD COLUMN display_name VARCHAR(80);

ALTER TABLE roles
  ADD CONSTRAINT roles_role_name_format_chk CHECK (role_name ~ '^[A-Z_]{2,40}$');

CREATE TABLE permissions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  permission_code VARCHAR(60) NOT NULL UNIQUE CHECK (permission_code ~ '^[a-z_]+\.[a-z_]+$'),
  description     TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id       BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN phone                 VARCHAR(20),
  ADD COLUMN last_login_at         TIMESTAMPTZ,
  ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  ADD COLUMN locked_until          TIMESTAMPTZ,
  ADD COLUMN password_changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE users
  ADD CONSTRAINT users_name_chk CHECK (length(btrim(name)) > 0),
  ADD CONSTRAINT users_email_format_chk CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Replace the case-sensitive unique constraint with a case-insensitive one.
ALTER TABLE users DROP CONSTRAINT users_email_key;
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE INDEX idx_users_branch ON users(branch_id);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE user_roles
  ADD COLUMN assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- ---------------------------------------------------------------------------
-- user_sessions: server-side login sessions. Only a SHA-256 hash of the session
-- token is stored; the raw token lives in the user's HttpOnly cookie.
-- ---------------------------------------------------------------------------
CREATE TABLE user_sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64)    NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  ip_address   VARCHAR(64),
  user_agent   VARCHAR(255),
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

-- ---------------------------------------------------------------------------
-- customers. Identity documents: only the type and last 4 characters are kept.
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN email             VARCHAR(255),
  ADD COLUMN occupation        VARCHAR(100),
  ADD COLUMN id_document_type  VARCHAR(20),
  ADD COLUMN id_document_last4 VARCHAR(4),
  ADD COLUMN created_by        BIGINT REFERENCES users(id);

ALTER TABLE customers ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE customers
  ADD CONSTRAINT customers_full_name_chk CHECK (length(btrim(full_name)) > 0),
  ADD CONSTRAINT customers_id_document_type_chk
    CHECK (id_document_type IN ('AADHAAR', 'PAN', 'VOTER_ID', 'PASSPORT', 'DRIVING_LICENSE')),
  ADD CONSTRAINT customers_id_document_last4_chk CHECK (id_document_last4 ~ '^[0-9A-Z]{4}$'),
  ADD CONSTRAINT customers_id_document_pair_chk
    CHECK ((id_document_type IS NULL) = (id_document_last4 IS NULL));

CREATE INDEX idx_customers_branch ON customers(branch_id);
CREATE INDEX idx_customers_email ON customers(lower(email));

CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- loans
-- Lifecycle: PENDING -> APPROVED -> ACTIVE (disbursed) -> CLOSED
--            PENDING -> REJECTED;  ACTIVE -> DEFAULTED
-- outstanding_balance = amount still receivable (principal + interest) and is
-- maintained by the backend in the same transaction as every payment/reversal.
-- ---------------------------------------------------------------------------
ALTER TABLE loans
  ADD COLUMN interest_method     VARCHAR(20)    NOT NULL DEFAULT 'FLAT',
  ADD COLUMN total_interest      NUMERIC(14,2)  NOT NULL DEFAULT 0 CHECK (total_interest >= 0),
  ADD COLUMN total_payable       NUMERIC(14,2)  GENERATED ALWAYS AS (principal_amount + total_interest) STORED,
  ADD COLUMN outstanding_balance NUMERIC(14,2)  NOT NULL DEFAULT 0 CHECK (outstanding_balance >= 0),
  ADD COLUMN maturity_date       DATE           NOT NULL,
  ADD COLUMN purpose             VARCHAR(200),
  ADD COLUMN created_by          BIGINT REFERENCES users(id),
  ADD COLUMN approved_by         BIGINT REFERENCES users(id),
  ADD COLUMN approved_at         TIMESTAMPTZ,
  ADD COLUMN rejected_by         BIGINT REFERENCES users(id),
  ADD COLUMN rejected_at         TIMESTAMPTZ,
  ADD COLUMN rejection_reason    VARCHAR(255),
  ADD COLUMN disbursed_by        BIGINT REFERENCES users(id),
  ADD COLUMN disbursed_at        TIMESTAMPTZ,
  ADD COLUMN closed_at           TIMESTAMPTZ;

ALTER TABLE loans
  ADD CONSTRAINT loans_interest_method_chk CHECK (interest_method IN ('FLAT')),
  ADD CONSTRAINT loans_annual_interest_rate_max_chk CHECK (annual_interest_rate <= 100),
  ADD CONSTRAINT loans_maturity_after_start_chk CHECK (maturity_date > loan_start_date),
  ADD CONSTRAINT loans_outstanding_le_payable_chk
    CHECK (outstanding_balance <= principal_amount + total_interest),
  ADD CONSTRAINT loans_approval_recorded_chk
    CHECK (status IN ('PENDING', 'REJECTED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  ADD CONSTRAINT loans_rejection_recorded_chk
    CHECK (status <> 'REJECTED' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL)),
  ADD CONSTRAINT loans_disbursement_recorded_chk
    CHECK (status NOT IN ('ACTIVE', 'CLOSED', 'DEFAULTED') OR disbursed_at IS NOT NULL),
  ADD CONSTRAINT loans_closed_chk
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  ADD CONSTRAINT loans_closed_zero_balance_chk
    CHECK (status <> 'CLOSED' OR outstanding_balance = 0);

CREATE INDEX idx_loans_status ON loans(status);
CREATE INDEX idx_loans_start_date ON loans(loan_start_date);

CREATE TRIGGER loans_set_updated_at BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- collection_assignments: history of which agent collects a loan.
-- An assignment is active while unassigned_at IS NULL; one active per loan.
-- ---------------------------------------------------------------------------
ALTER TABLE collection_assignments
  ADD COLUMN unassigned_by BIGINT REFERENCES users(id),
  ADD COLUMN notes         VARCHAR(255);

CREATE UNIQUE INDEX collection_assignments_one_active_per_loan
  ON collection_assignments(loan_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_assignments_loan ON collection_assignments(loan_id);

-- ---------------------------------------------------------------------------
-- collection_schedules: one row per installment. due_amount = total due.
-- Stored status tracks payment progress (PENDING / PARTIAL / PAID / WAIVED).
-- "Overdue" depends on today's date, so it is derived in v_collection_schedules
-- instead of being stored (a stored flag would go stale overnight).
-- ---------------------------------------------------------------------------
ALTER TABLE collection_schedules
  ADD COLUMN principal_due      NUMERIC(14,2) NOT NULL CHECK (principal_due >= 0),
  ADD COLUMN interest_due       NUMERIC(14,2) NOT NULL CHECK (interest_due >= 0),
  ADD COLUMN paid_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  ADD COLUMN outstanding_amount NUMERIC(14,2) GENERATED ALWAYS AS (due_amount - paid_amount) STORED,
  ADD COLUMN updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW();

ALTER TABLE collection_schedules
  ADD CONSTRAINT collection_schedules_total_chk CHECK (due_amount = principal_due + interest_due),
  ADD CONSTRAINT collection_schedules_paid_le_due_chk CHECK (paid_amount <= due_amount),
  ADD CONSTRAINT collection_schedules_status_paid_chk CHECK (
    (status = 'PAID'    AND paid_amount = due_amount) OR
    (status = 'PARTIAL' AND paid_amount > 0 AND paid_amount < due_amount) OR
    (status IN ('PENDING', 'OVERDUE') AND paid_amount = 0) OR
    (status = 'WAIVED')
  ),
  ADD CONSTRAINT collection_schedules_loan_due_date_key UNIQUE (loan_id, due_date),
  -- Target of the composite foreign key from payment_allocations.
  ADD CONSTRAINT collection_schedules_id_loan_key UNIQUE (id, loan_id);

CREATE TRIGGER collection_schedules_set_updated_at BEFORE UPDATE ON collection_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE VIEW v_collection_schedules AS
SELECT
  cs.*,
  CASE
    WHEN cs.status IN ('PENDING', 'PARTIAL', 'OVERDUE') AND cs.due_date < CURRENT_DATE THEN 'OVERDUE'
    WHEN cs.status = 'OVERDUE' THEN 'PENDING'
    ELSE cs.status
  END AS effective_status,
  GREATEST(CURRENT_DATE - cs.due_date, 0) AS days_past_due
FROM collection_schedules cs;

-- ---------------------------------------------------------------------------
-- payments
-- * receipt_number: generated by the backend from receipt_number_seq.
-- * idempotency_key: generated by the client per submission; a retried request
--   with the same key returns the original payment instead of charging twice.
-- * Payments are immutable except for reversal (enforced by trigger below).
-- ---------------------------------------------------------------------------
ALTER TABLE payments
  ADD COLUMN receipt_number  VARCHAR(40) NOT NULL UNIQUE,
  ADD COLUMN idempotency_key UUID        NOT NULL UNIQUE,
  ADD COLUMN collected_by    BIGINT REFERENCES users(id),
  ADD COLUMN notes           VARCHAR(255),
  ADD COLUMN reversed_at     TIMESTAMPTZ,
  ADD COLUMN reversed_by     BIGINT REFERENCES users(id),
  ADD COLUMN reversal_reason VARCHAR(255);

ALTER TABLE payments
  ADD CONSTRAINT payments_reversal_recorded_chk CHECK (
    (status = 'REVERSED') = (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL)
  ),
  ADD CONSTRAINT payments_reference_required_chk CHECK (
    payment_method NOT IN ('UPI', 'BANK_TRANSFER', 'CHEQUE')
    OR length(btrim(coalesce(reference_number, ''))) > 0
  ),
  -- Target of the composite foreign key from payment_allocations.
  ADD CONSTRAINT payments_id_loan_key UNIQUE (id, loan_id);

CREATE INDEX idx_payments_payment_date ON payments(payment_date);
CREATE INDEX idx_payments_collected_by ON payments(collected_by);

CREATE OR REPLACE FUNCTION payments_prevent_edit() RETURNS trigger AS $$
BEGIN
  IF NEW.loan_id         IS DISTINCT FROM OLD.loan_id
  OR NEW.amount          IS DISTINCT FROM OLD.amount
  OR NEW.payment_date    IS DISTINCT FROM OLD.payment_date
  OR NEW.payment_method  IS DISTINCT FROM OLD.payment_method
  OR NEW.receipt_number  IS DISTINCT FROM OLD.receipt_number
  OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  OR NEW.recorded_by     IS DISTINCT FROM OLD.recorded_by
  OR NEW.collected_by    IS DISTINCT FROM OLD.collected_by
  OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Payments are immutable; reverse the payment instead of editing it'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'A reversed payment cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_prevent_edit BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_prevent_edit();

CREATE OR REPLACE FUNCTION payments_prevent_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Payments cannot be deleted; reverse the payment instead' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_prevent_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_prevent_delete();

-- ---------------------------------------------------------------------------
-- payment_allocations: which installments a payment paid.
-- The composite foreign keys guarantee the payment and the installment belong
-- to the same loan. The deferred trigger guarantees that, at commit time, every
-- payment is allocated in full — never more, never less.
-- ---------------------------------------------------------------------------
ALTER TABLE payment_allocations
  ADD COLUMN loan_id    BIGINT      NOT NULL,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_payment_same_loan_fkey
    FOREIGN KEY (payment_id, loan_id) REFERENCES payments(id, loan_id),
  ADD CONSTRAINT payment_allocations_schedule_same_loan_fkey
    FOREIGN KEY (schedule_id, loan_id) REFERENCES collection_schedules(id, loan_id);

CREATE INDEX idx_payment_allocations_schedule ON payment_allocations(schedule_id);
CREATE INDEX idx_payment_allocations_loan ON payment_allocations(loan_id);

CREATE OR REPLACE FUNCTION check_payment_fully_allocated() RETURNS trigger AS $$
DECLARE
  target_payment BIGINT;
  payment_amount NUMERIC;
  allocated      NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    target_payment := NEW.id;
  ELSE
    target_payment := COALESCE(NEW.payment_id, OLD.payment_id);
  END IF;

  SELECT amount INTO payment_amount FROM payments WHERE id = target_payment;
  IF payment_amount IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO allocated
    FROM payment_allocations WHERE payment_id = target_payment;

  IF allocated <> payment_amount THEN
    RAISE EXCEPTION 'Payment % is allocated % but its amount is %', target_payment, allocated, payment_amount
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER payments_fully_allocated
  AFTER INSERT ON payments DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payment_fully_allocated();

CREATE CONSTRAINT TRIGGER payment_allocations_fully_allocated
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payment_fully_allocated();

-- ---------------------------------------------------------------------------
-- expenses: submitted, then approved or rejected by a reviewer.
-- ---------------------------------------------------------------------------
ALTER TABLE expenses
  ADD COLUMN status      VARCHAR(15) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN reviewed_by BIGINT REFERENCES users(id),
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_note VARCHAR(255),
  ADD COLUMN updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE expenses
  ADD CONSTRAINT expenses_status_chk CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD CONSTRAINT expenses_category_chk CHECK (category IN (
    'RENT', 'UTILITIES', 'SALARIES', 'TRAVEL', 'OFFICE_SUPPLIES',
    'MARKETING', 'MAINTENANCE', 'COMMUNICATION', 'OTHER'
  )),
  ADD CONSTRAINT expenses_review_recorded_chk
    CHECK ((status = 'PENDING') = (reviewed_by IS NULL AND reviewed_at IS NULL));

CREATE INDEX idx_expenses_branch_date ON expenses(branch_id, expense_date);
CREATE INDEX idx_expenses_status ON expenses(status);

CREATE TRIGGER expenses_set_updated_at BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs
  ADD COLUMN ip_address VARCHAR(64);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
ALTER TABLE app_settings
  ADD COLUMN description TEXT,
  ADD COLUMN updated_by  BIGINT REFERENCES users(id);

CREATE TRIGGER app_settings_set_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
