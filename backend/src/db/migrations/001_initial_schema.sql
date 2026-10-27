-- 001_initial_schema.sql
-- Initial Lion Finance schema.
--
-- Applied by src/db/migrate.ts inside a single transaction and recorded in
-- schema_migrations, so it runs exactly once. Do not add BEGIN/COMMIT here.

-- 1. Branches
CREATE TABLE IF NOT EXISTS branches (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_name VARCHAR(120) NOT NULL,
    branch_code VARCHAR(30) UNIQUE NOT NULL,
    address TEXT,
    phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Roles
CREATE TABLE IF NOT EXISTS roles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name VARCHAR(40) UNIQUE NOT NULL,
    description TEXT
);

-- 3. Users
CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id BIGINT REFERENCES branches(id),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. User roles
CREATE TABLE IF NOT EXISTS user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id),
    role_id BIGINT NOT NULL REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);

-- 5. Customers
CREATE TABLE IF NOT EXISTS customers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id BIGINT REFERENCES branches(id),
    customer_code VARCHAR(40) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Loans
CREATE TABLE IF NOT EXISTS loans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_code VARCHAR(40) UNIQUE NOT NULL,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    principal_amount NUMERIC(14,2) NOT NULL
        CHECK (principal_amount > 0),
    annual_interest_rate NUMERIC(7,4) NOT NULL DEFAULT 0
        CHECK (annual_interest_rate >= 0),
    loan_start_date DATE NOT NULL,
    loan_term INTEGER NOT NULL CHECK (loan_term > 0),
    collection_frequency VARCHAR(10) NOT NULL
        CHECK (collection_frequency IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN (
            'PENDING', 'APPROVED', 'ACTIVE',
            'CLOSED', 'REJECTED', 'DEFAULTED'
        )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Collection assignments
CREATE TABLE IF NOT EXISTS collection_assignments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_id BIGINT NOT NULL REFERENCES loans(id),
    agent_user_id BIGINT NOT NULL REFERENCES users(id),
    assigned_by BIGINT REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unassigned_at TIMESTAMPTZ,
    CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);

-- 8. Collection schedules
CREATE TABLE IF NOT EXISTS collection_schedules (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_id BIGINT NOT NULL REFERENCES loans(id),
    installment_number INTEGER NOT NULL CHECK (installment_number > 0),
    due_date DATE NOT NULL,
    due_amount NUMERIC(14,2) NOT NULL CHECK (due_amount > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN (
            'PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED'
        )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (loan_id, installment_number)
);

-- 9. Payments
CREATE TABLE IF NOT EXISTS payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_id BIGINT NOT NULL REFERENCES loans(id),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_method VARCHAR(20) NOT NULL
        CHECK (payment_method IN (
            'CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'
        )),
    reference_number VARCHAR(100),
    recorded_by BIGINT NOT NULL REFERENCES users(id),
    status VARCHAR(15) NOT NULL DEFAULT 'RECORDED'
        CHECK (status IN ('RECORDED', 'REVERSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Payment allocations
-- Allows one payment to cover one or more installments.
CREATE TABLE IF NOT EXISTS payment_allocations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    schedule_id BIGINT NOT NULL REFERENCES collection_schedules(id),
    allocated_amount NUMERIC(14,2) NOT NULL
        CHECK (allocated_amount > 0),
    UNIQUE (payment_id, schedule_id)
);

-- 11. Business expenses
CREATE TABLE IF NOT EXISTS expenses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id BIGINT REFERENCES branches(id),
    recorded_by BIGINT NOT NULL REFERENCES users(id),
    category VARCHAR(80) NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NOT NULL,
    entity_id BIGINT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Application settings
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_customers_name
    ON customers(full_name);

CREATE INDEX IF NOT EXISTS idx_customers_phone
    ON customers(phone);

CREATE INDEX IF NOT EXISTS idx_loans_customer
    ON loans(customer_id);

CREATE INDEX IF NOT EXISTS idx_schedules_due_date_status
    ON collection_schedules(due_date, status);

CREATE INDEX IF NOT EXISTS idx_payments_loan_date
    ON payments(loan_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_assignments_agent
    ON collection_assignments(agent_user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs(created_at);
