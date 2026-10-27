import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { effectiveBranch, hasPermission, requirePermission } from '../../auth/middleware.js';
import { pool } from '../../db.js';
import { badRequest, forbidden, notFound } from '../../http/errors.js';
import { isoDate } from '../../http/validation.js';
import { businessToday } from '../loans/service.js';

export const reportsRouter = Router();

const MAX_ROWS = 5000;

type ColumnType = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent';
interface Column {
  key: string;
  label: string;
  type: ColumnType;
}
interface ReportParams {
  from: string;
  to: string;
  branch: number | null;
  groupBy: 'day' | 'week' | 'month';
}
interface ReportDef {
  title: string;
  columns: Column[];
  /** Columns to sum in the totals row. */
  totals?: string[];
  sql: (p: ReportParams) => { text: string; values: unknown[] };
}

const branchClause = '($3::bigint IS NULL OR c.branch_id = $3)';

const REPORTS: Record<string, ReportDef> = {
  collections: {
    title: 'Collections',
    columns: [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'payments', label: 'Payments', type: 'number' },
      { key: 'collected', label: 'Collected', type: 'money' },
      { key: 'reversed', label: 'Reversed', type: 'money' },
    ],
    totals: ['payments', 'collected', 'reversed'],
    sql: (p) => ({
      text: `SELECT date_trunc('${p.groupBy}', p.payment_date)::date AS period,
                    count(*) FILTER (WHERE p.status = 'RECORDED') AS payments,
                    COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'RECORDED'), 0) AS collected,
                    COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'REVERSED'), 0) AS reversed
             FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
             WHERE p.payment_date >= $1::date AND p.payment_date < $2::date + 1 AND ${branchClause}
             GROUP BY 1 ORDER BY 1`,
      values: [p.from, p.to, p.branch],
    }),
  },
  'outstanding-loans': {
    title: 'Outstanding loans',
    columns: [
      { key: 'loanCode', label: 'Loan', type: 'text' },
      { key: 'customerName', label: 'Customer', type: 'text' },
      { key: 'branchName', label: 'Branch', type: 'text' },
      { key: 'agentName', label: 'Agent', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'totalPayable', label: 'Total payable', type: 'money' },
      { key: 'outstanding', label: 'Outstanding', type: 'money' },
      { key: 'overdueAmount', label: 'Overdue', type: 'money' },
      { key: 'maturityDate', label: 'Maturity', type: 'date' },
    ],
    totals: ['totalPayable', 'outstanding', 'overdueAmount'],
    sql: (p) => ({
      text: `SELECT l.loan_code AS "loanCode", c.full_name AS "customerName", b.branch_name AS "branchName",
                    ag.name AS "agentName", l.status, l.total_payable AS "totalPayable",
                    l.outstanding_balance AS outstanding,
                    COALESCE((SELECT SUM(s.outstanding_amount) FROM v_collection_schedules s
                              WHERE s.loan_id = l.id AND s.effective_status = 'OVERDUE'), 0) AS "overdueAmount",
                    l.maturity_date AS "maturityDate"
             FROM loans l JOIN customers c ON c.id = l.customer_id JOIN branches b ON b.id = c.branch_id
             LEFT JOIN collection_assignments ca ON ca.loan_id = l.id AND ca.unassigned_at IS NULL
             LEFT JOIN users ag ON ag.id = ca.agent_user_id
             -- A balance snapshot as of today; "from" is unused but every report shares the same parameters.
             WHERE l.status IN ('ACTIVE','DEFAULTED') AND l.loan_start_date <= $2::date
               AND ($1::date IS NOT NULL) AND ${branchClause}
             ORDER BY l.outstanding_balance DESC`,
      values: [p.from, p.to, p.branch],
    }),
  },
  'overdue-installments': {
    title: 'Overdue installments',
    columns: [
      { key: 'loanCode', label: 'Loan', type: 'text' },
      { key: 'customerName', label: 'Customer', type: 'text' },
      { key: 'customerPhone', label: 'Phone', type: 'text' },
      { key: 'branchName', label: 'Branch', type: 'text' },
      { key: 'agentName', label: 'Agent', type: 'text' },
      { key: 'installmentNumber', label: 'Installment', type: 'number' },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'daysPastDue', label: 'Days late', type: 'number' },
      { key: 'outstanding', label: 'Outstanding', type: 'money' },
    ],
    totals: ['outstanding'],
    sql: (p) => ({
      text: `SELECT l.loan_code AS "loanCode", c.full_name AS "customerName", c.phone AS "customerPhone",
                    b.branch_name AS "branchName", ag.name AS "agentName", s.installment_number AS "installmentNumber",
                    s.due_date AS "dueDate", s.days_past_due AS "daysPastDue", s.outstanding_amount AS outstanding
             FROM v_collection_schedules s JOIN loans l ON l.id = s.loan_id
             JOIN customers c ON c.id = l.customer_id JOIN branches b ON b.id = c.branch_id
             LEFT JOIN collection_assignments ca ON ca.loan_id = l.id AND ca.unassigned_at IS NULL
             LEFT JOIN users ag ON ag.id = ca.agent_user_id
             WHERE s.effective_status = 'OVERDUE' AND l.status IN ('ACTIVE','DEFAULTED')
               AND s.due_date BETWEEN $1::date AND $2::date AND ${branchClause}
             ORDER BY s.days_past_due DESC, s.outstanding_amount DESC`,
      values: [p.from, p.to, p.branch],
    }),
  },
  'branch-performance': {
    title: 'Branch performance',
    columns: [
      { key: 'branchName', label: 'Branch', type: 'text' },
      { key: 'loansDisbursed', label: 'Loans disbursed', type: 'number' },
      { key: 'amountDisbursed', label: 'Amount disbursed', type: 'money' },
      { key: 'dueInPeriod', label: 'Due in period', type: 'money' },
      { key: 'collected', label: 'Collected', type: 'money' },
      { key: 'achievement', label: 'Achievement %', type: 'percent' },
      { key: 'outstanding', label: 'Outstanding', type: 'money' },
      { key: 'expenses', label: 'Approved expenses', type: 'money' },
    ],
    totals: ['loansDisbursed', 'amountDisbursed', 'dueInPeriod', 'collected', 'outstanding', 'expenses'],
    sql: (p) => ({
      text: `SELECT b.branch_name AS "branchName", x.*,
                    CASE WHEN x."dueInPeriod" > 0 THEN round(x."paidTowardsDue" / x."dueInPeriod" * 100, 1) END AS achievement
             FROM branches b CROSS JOIN LATERAL (SELECT
               (SELECT count(*) FROM loans l JOIN customers c ON c.id = l.customer_id
                 WHERE c.branch_id = b.id AND l.disbursed_at >= $1::date AND l.disbursed_at < $2::date + 1) AS "loansDisbursed",
               (SELECT COALESCE(SUM(l.principal_amount), 0) FROM loans l JOIN customers c ON c.id = l.customer_id
                 WHERE c.branch_id = b.id AND l.disbursed_at >= $1::date AND l.disbursed_at < $2::date + 1) AS "amountDisbursed",
               (SELECT COALESCE(SUM(s.due_amount), 0) FROM collection_schedules s JOIN loans l ON l.id = s.loan_id
                 JOIN customers c ON c.id = l.customer_id
                 WHERE c.branch_id = b.id AND s.due_date BETWEEN $1::date AND $2::date AND s.status <> 'WAIVED') AS "dueInPeriod",
               (SELECT COALESCE(SUM(s.paid_amount), 0) FROM collection_schedules s JOIN loans l ON l.id = s.loan_id
                 JOIN customers c ON c.id = l.customer_id
                 WHERE c.branch_id = b.id AND s.due_date BETWEEN $1::date AND $2::date AND s.status <> 'WAIVED') AS "paidTowardsDue",
               (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
                 WHERE c.branch_id = b.id AND p.status = 'RECORDED' AND p.payment_date >= $1::date AND p.payment_date < $2::date + 1) AS collected,
               (SELECT COALESCE(SUM(l.outstanding_balance), 0) FROM loans l JOIN customers c ON c.id = l.customer_id
                 WHERE c.branch_id = b.id AND l.status IN ('ACTIVE','DEFAULTED')) AS outstanding,
               (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
                 WHERE e.branch_id = b.id AND e.status = 'APPROVED' AND e.expense_date BETWEEN $1::date AND $2::date) AS expenses
             ) x
             WHERE ($3::bigint IS NULL OR b.id = $3)
             ORDER BY x.collected DESC`,
      values: [p.from, p.to, p.branch],
    }),
  },
  'agent-performance': {
    title: 'Agent performance',
    columns: [
      { key: 'agentName', label: 'Agent', type: 'text' },
      { key: 'branchName', label: 'Branch', type: 'text' },
      { key: 'activeLoans', label: 'Active loans', type: 'number' },
      { key: 'payments', label: 'Payments', type: 'number' },
      { key: 'collected', label: 'Collected', type: 'money' },
      { key: 'dueInPeriod', label: 'Due on their loans', type: 'money' },
      { key: 'achievement', label: 'Achievement %', type: 'percent' },
      { key: 'overdueAmount', label: 'Overdue now', type: 'money' },
    ],
    totals: ['activeLoans', 'payments', 'collected', 'dueInPeriod', 'overdueAmount'],
    sql: (p) => ({
      text: `WITH agents AS (
               SELECT u.id, u.name, u.branch_id FROM users u
               JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
               WHERE r.role_name = 'COLLECTION_AGENT' AND ($3::bigint IS NULL OR u.branch_id = $3)
             )
             SELECT a.name AS "agentName", b.branch_name AS "branchName", x.*,
                    CASE WHEN x."dueInPeriod" > 0 THEN round(x."paidTowardsDue" / x."dueInPeriod" * 100, 1) END AS achievement
             FROM agents a LEFT JOIN branches b ON b.id = a.branch_id
             CROSS JOIN LATERAL (SELECT
               (SELECT count(*) FROM collection_assignments ca JOIN loans l ON l.id = ca.loan_id
                 WHERE ca.agent_user_id = a.id AND ca.unassigned_at IS NULL AND l.status IN ('ACTIVE','DEFAULTED')) AS "activeLoans",
               (SELECT count(*) FROM payments p WHERE COALESCE(p.collected_by, p.recorded_by) = a.id AND p.status = 'RECORDED'
                 AND p.payment_date >= $1::date AND p.payment_date < $2::date + 1) AS payments,
               (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE COALESCE(p.collected_by, p.recorded_by) = a.id
                 AND p.status = 'RECORDED' AND p.payment_date >= $1::date AND p.payment_date < $2::date + 1) AS collected,
               (SELECT COALESCE(SUM(s.due_amount), 0) FROM collection_schedules s
                 JOIN collection_assignments ca ON ca.loan_id = s.loan_id AND ca.unassigned_at IS NULL
                 WHERE ca.agent_user_id = a.id AND s.due_date BETWEEN $1::date AND $2::date AND s.status <> 'WAIVED') AS "dueInPeriod",
               (SELECT COALESCE(SUM(s.paid_amount), 0) FROM collection_schedules s
                 JOIN collection_assignments ca ON ca.loan_id = s.loan_id AND ca.unassigned_at IS NULL
                 WHERE ca.agent_user_id = a.id AND s.due_date BETWEEN $1::date AND $2::date AND s.status <> 'WAIVED') AS "paidTowardsDue",
               (SELECT COALESCE(SUM(s.outstanding_amount), 0) FROM v_collection_schedules s
                 JOIN collection_assignments ca ON ca.loan_id = s.loan_id AND ca.unassigned_at IS NULL
                 JOIN loans l ON l.id = s.loan_id
                 WHERE ca.agent_user_id = a.id AND s.effective_status = 'OVERDUE' AND l.status IN ('ACTIVE','DEFAULTED')) AS "overdueAmount"
             ) x
             ORDER BY x.collected DESC`,
      values: [p.from, p.to, p.branch],
    }),
  },
  expenses: {
    title: 'Expenses',
    columns: [
      { key: 'expenseDate', label: 'Date', type: 'date' },
      { key: 'branchName', label: 'Branch', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'submittedBy', label: 'Submitted by', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    totals: ['amount'],
    sql: (p) => ({
      text: `SELECT e.expense_date AS "expenseDate", b.branch_name AS "branchName", e.category, e.description,
                    u.name AS "submittedBy", e.status, e.amount
             FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id JOIN users u ON u.id = e.recorded_by
             WHERE e.expense_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR e.branch_id = $3)
             ORDER BY e.expense_date DESC, e.id DESC`,
      values: [p.from, p.to, p.branch],
    }),
  },
  payments: {
    title: 'Payment history',
    columns: [
      { key: 'paymentDate', label: 'Date', type: 'datetime' },
      { key: 'receiptNumber', label: 'Receipt', type: 'text' },
      { key: 'loanCode', label: 'Loan', type: 'text' },
      { key: 'customerName', label: 'Customer', type: 'text' },
      { key: 'branchName', label: 'Branch', type: 'text' },
      { key: 'collectedBy', label: 'Collected by', type: 'text' },
      { key: 'paymentMethod', label: 'Method', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    totals: ['amount'],
    sql: (p) => ({
      text: `SELECT p.payment_date AS "paymentDate", p.receipt_number AS "receiptNumber", l.loan_code AS "loanCode",
                    c.full_name AS "customerName", b.branch_name AS "branchName", u.name AS "collectedBy",
                    p.payment_method AS "paymentMethod", p.status, p.amount
             FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
             JOIN branches b ON b.id = c.branch_id LEFT JOIN users u ON u.id = COALESCE(p.collected_by, p.recorded_by)
             WHERE p.payment_date >= $1::date AND p.payment_date < $2::date + 1 AND ${branchClause}
             ORDER BY p.payment_date DESC, p.id DESC`,
      values: [p.from, p.to, p.branch],
    }),
  },
};

const reportQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  branchId: z.coerce.number().int().positive().optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
  format: z.enum(['json', 'csv']).default('json'),
});

reportsRouter.get('/', requirePermission('reports.view'), (_req, res) => {
  res.json({ data: Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title })) });
});

reportsRouter.get('/:type', requirePermission('reports.view'), async (req, res) => {
  const def = REPORTS[String(req.params.type)];
  if (!def) throw notFound('Report');
  const q = reportQuery.parse(req.query);
  if (q.format === 'csv' && !hasPermission(req, 'reports.export')) throw forbidden('You cannot export reports.');

  const today = await businessToday(pool);
  const to = q.to ?? today;
  const from = q.from ?? to.slice(0, 8) + '01';
  if (to < from) throw badRequest('"to" must be on or after "from".');
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw badRequest('Choose a range of at most one year.');

  const { text, values } = def.sql({ from, to, branch: effectiveBranch(req, q.branchId), groupBy: q.groupBy });
  const result = await pool.query(`${text} LIMIT ${MAX_ROWS + 1}`, values);
  const truncated = result.rows.length > MAX_ROWS;
  const rows = result.rows.slice(0, MAX_ROWS);
  const totals = def.totals ? sumColumns(rows, def.totals, def.columns) : null;

  if (q.format === 'csv') {
    await audit(pool, req, { action: 'REPORT_EXPORTED', entityType: 'report', details: { report: req.params.type, from, to, rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}_${from}_${to}.csv"`);
    res.send(toCsv(def.columns, rows, totals));
    return;
  }
  res.json({ data: { title: def.title, from, to, columns: def.columns, rows, totals, truncated } });
});

/** Sums numeric columns exactly: money via integer paise, counts as integers. */
function sumColumns(rows: Record<string, unknown>[], keys: string[], columns: Column[]) {
  const totals: Record<string, string | number> = {};
  for (const key of keys) {
    const type = columns.find((c) => c.key === key)?.type;
    if (type === 'money') {
      let paise = 0n;
      for (const r of rows) {
        const [whole, frac = ''] = String(r[key] ?? '0').split('.');
        paise += BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
      }
      totals[key] = `${paise / 100n}.${(paise % 100n).toString().padStart(2, '0')}`;
    } else {
      totals[key] = rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
    }
  }
  return totals;
}

function toCsv(columns: Column[], rows: Record<string, unknown>[], totals: Record<string, unknown> | null): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(formatCell(r[c.key]))).join(','));
  if (totals) lines.push(columns.map((c, i) => csvCell(i === 0 ? 'TOTAL' : formatCell(totals[c.key] ?? ''))).join(','));
  return '﻿' + lines.join('\r\n'); // BOM so Excel opens UTF-8 correctly
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Quotes a CSV cell and neutralises spreadsheet formula injection (=, +, -, @). */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
