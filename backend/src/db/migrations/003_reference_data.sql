-- 003_reference_data.sql
-- Reference data required in every environment (including production):
-- standard roles, the permission codes checked by the backend, the default
-- role -> permission mapping, and default application settings.
-- No users and no demo data are created here (see src/db/seed.ts for dev data).

INSERT INTO roles (role_name, display_name, description) VALUES
  ('ADMIN',            'Administrator',    'Full access, including users, roles and settings'),
  ('MANAGER',          'Manager',          'Runs operations across all branches'),
  ('BRANCH_MANAGER',   'Branch Manager',   'Manages customers, loans and collections for one branch'),
  ('COLLECTION_AGENT', 'Collection Agent', 'Collects installments for assigned loans in one branch'),
  ('ACCOUNTANT',       'Accountant',       'Disburses loans, reverses payments, approves expenses, runs reports'),
  ('AUDITOR',          'Auditor',          'Read-only access to all records, reports and the audit log')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO permissions (permission_code, description) VALUES
  ('dashboard.view',     'View the dashboard'),
  ('branches.view',      'View branches'),
  ('branches.manage',    'Create and edit branches'),
  ('users.view',         'View users'),
  ('users.manage',       'Create, edit, deactivate users and reset passwords'),
  ('roles.view',         'View roles and permissions'),
  ('roles.manage',       'Change the permissions of a role'),
  ('customers.view',     'View customers'),
  ('customers.manage',   'Create, edit and deactivate customers'),
  ('loans.view',         'View loans and repayment schedules'),
  ('loans.create',       'Create loan applications'),
  ('loans.approve',      'Approve, reject or mark loans as defaulted'),
  ('loans.disburse',     'Disburse approved loans (creates the repayment schedule)'),
  ('assignments.view',   'View collection assignments'),
  ('assignments.manage', 'Assign and unassign collection agents'),
  ('collections.view',   'View daily and weekly collection lists'),
  ('payments.view',      'View payments and receipts'),
  ('payments.create',    'Record payments'),
  ('payments.reverse',   'Reverse recorded payments'),
  ('expenses.view',      'View expenses'),
  ('expenses.create',    'Submit expenses'),
  ('expenses.approve',   'Approve or reject expenses'),
  ('reports.view',       'View reports'),
  ('reports.export',     'Export reports as CSV'),
  ('audit.view',         'View the audit log'),
  ('settings.view',      'View application settings'),
  ('settings.manage',    'Change application settings'),
  ('scope.all_branches', 'Access data of every branch (otherwise limited to own branch)')
ON CONFLICT (permission_code) DO NOTHING;

-- Default role -> permission mapping (editable later on the Roles screen).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('ADMIN', ARRAY[
    'dashboard.view','branches.view','branches.manage','users.view','users.manage','roles.view',
    'roles.manage','customers.view','customers.manage','loans.view','loans.create','loans.approve',
    'loans.disburse','assignments.view','assignments.manage','collections.view','payments.view',
    'payments.create','payments.reverse','expenses.view','expenses.create','expenses.approve',
    'reports.view','reports.export','audit.view','settings.view','settings.manage','scope.all_branches']),
  ('MANAGER', ARRAY[
    'dashboard.view','branches.view','branches.manage','users.view','roles.view','customers.view',
    'customers.manage','loans.view','loans.create','loans.approve','loans.disburse','assignments.view',
    'assignments.manage','collections.view','payments.view','payments.create','payments.reverse',
    'expenses.view','expenses.create','expenses.approve','reports.view','reports.export','audit.view',
    'settings.view','scope.all_branches']),
  ('BRANCH_MANAGER', ARRAY[
    'dashboard.view','branches.view','users.view','customers.view','customers.manage','loans.view',
    'loans.create','loans.approve','assignments.view','assignments.manage','collections.view',
    'payments.view','payments.create','expenses.view','expenses.create','expenses.approve',
    'reports.view','reports.export']),
  ('COLLECTION_AGENT', ARRAY[
    'dashboard.view','customers.view','loans.view','assignments.view','collections.view',
    'payments.view','payments.create','expenses.view','expenses.create']),
  ('ACCOUNTANT', ARRAY[
    'dashboard.view','branches.view','customers.view','loans.view','loans.disburse','assignments.view',
    'collections.view','payments.view','payments.reverse','expenses.view','expenses.create',
    'expenses.approve','reports.view','reports.export','scope.all_branches']),
  ('AUDITOR', ARRAY[
    'dashboard.view','branches.view','users.view','roles.view','customers.view','loans.view',
    'assignments.view','collections.view','payments.view','expenses.view','reports.view',
    'reports.export','audit.view','settings.view','scope.all_branches'])
) AS mapping(role_name, codes)
JOIN roles r ON r.role_name = mapping.role_name
JOIN permissions p ON p.permission_code = ANY (mapping.codes)
ON CONFLICT DO NOTHING;

-- Default settings. Values are JSON; the backend validates each key's shape.
-- Business-policy values are documented assumptions — see OPEN_QUESTIONS.md.
INSERT INTO app_settings (setting_key, setting_value, description) VALUES
  ('company.name',                    '"Lion Finance"',  'Name printed on receipts and reports'),
  ('company.currency',                '"INR"',           'Currency code for all amounts'),
  ('receipts.prefix',                 '"LF"',            'Prefix for generated receipt numbers'),
  ('loans.min_principal',             '"1000.00"',       'Smallest principal accepted for a new loan'),
  ('loans.max_principal',             '"1000000.00"',    'Largest principal accepted for a new loan'),
  ('loans.max_annual_interest_rate',  '"36.0000"',       'Highest annual flat interest rate (%) accepted'),
  ('loans.max_term',                  '{"DAILY": 365, "WEEKLY": 104, "MONTHLY": 60}', 'Maximum number of installments per collection frequency'),
  ('loans.max_start_days_ahead',      '90',              'How many days in the future a loan start date may be'),
  ('loans.require_different_approver','true',            'Maker-checker: the approver must differ from the creator'),
  ('payments.enabled_methods',        '["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"]', 'Payment methods offered on payment entry'),
  ('payments.reversal_window_days',   '30',              'Payments older than this many days cannot be reversed'),
  ('collections.week_starts_on',      '"MONDAY"',        'First day of the week for weekly collection views')
ON CONFLICT (setting_key) DO NOTHING;
