import { Router } from 'express';
import { z } from 'zod';
import { effectiveBranch, requirePermission } from '../../auth/middleware.js';
import { pool } from '../../db.js';
import { getSettings } from '../settings/service.js';

export const dashboardRouter = Router();

/**
 * All dashboard figures in one request, computed live from the database.
 * Collection achievement (this month) = amount paid towards installments that
 * fell due between the 1st of the month and today ÷ the amount that fell due.
 */
dashboardRouter.get('/summary', requirePermission('dashboard.view'), async (req, res) => {
  const q = z.object({ branchId: z.coerce.number().int().positive().optional() }).parse(req.query);
  const branch = effectiveBranch(req, q.branchId);
  const weekStartsOn = (await getSettings(pool))['collections.week_starts_on'];
  // date_trunc('week') starts on Monday; shift by a day for Sunday-start weeks.
  const weekStart =
    weekStartsOn === 'SUNDAY'
      ? `(date_trunc('week', CURRENT_DATE + 1) - INTERVAL '1 day')::date`
      : `date_trunc('week', CURRENT_DATE)::date`;
  const b = '($1::bigint IS NULL OR c.branch_id = $1)';

  const [metrics, recent, upcoming, agents, branches, trend] = await Promise.all([
    pool.query(
      `SELECT
        (SELECT count(*) FROM customers c WHERE c.is_active AND ${b}) AS "totalCustomers",
        (SELECT count(*) FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.status = 'ACTIVE' AND ${b}) AS "activeLoans",
        (SELECT count(*) FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.status = 'PENDING' AND ${b}) AS "pendingApprovals",
        (SELECT COALESCE(SUM(l.principal_amount), 0) FROM loans l JOIN customers c ON c.id = l.customer_id
           WHERE l.disbursed_at IS NOT NULL AND ${b}) AS "totalDisbursed",
        (SELECT COALESCE(SUM(l.outstanding_balance), 0) FROM loans l JOIN customers c ON c.id = l.customer_id
           WHERE l.status IN ('ACTIVE','DEFAULTED') AND ${b}) AS "totalOutstanding",
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
           WHERE p.status = 'RECORDED' AND p.payment_date >= CURRENT_DATE AND ${b}) AS "collectedToday",
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
           WHERE p.status = 'RECORDED' AND p.payment_date >= ${weekStart} AND ${b}) AS "collectedThisWeek",
        (SELECT COALESCE(SUM(s.due_amount), 0) FROM collection_schedules s JOIN loans l ON l.id = s.loan_id
           JOIN customers c ON c.id = l.customer_id
           WHERE s.due_date = CURRENT_DATE AND l.status IN ('ACTIVE','DEFAULTED','CLOSED') AND ${b}) AS "dueToday",
        (SELECT count(*) FROM v_collection_schedules s JOIN loans l ON l.id = s.loan_id JOIN customers c ON c.id = l.customer_id
           WHERE s.effective_status = 'OVERDUE' AND l.status IN ('ACTIVE','DEFAULTED') AND ${b}) AS "overdueInstallments",
        (SELECT COALESCE(SUM(s.outstanding_amount), 0) FROM v_collection_schedules s JOIN loans l ON l.id = s.loan_id
           JOIN customers c ON c.id = l.customer_id
           WHERE s.effective_status = 'OVERDUE' AND l.status IN ('ACTIVE','DEFAULTED') AND ${b}) AS "overdueAmount",
        (SELECT json_build_object('due', COALESCE(SUM(s.due_amount), 0), 'paid', COALESCE(SUM(s.paid_amount), 0))
           FROM collection_schedules s JOIN loans l ON l.id = s.loan_id JOIN customers c ON c.id = l.customer_id
           WHERE s.due_date BETWEEN date_trunc('month', CURRENT_DATE)::date AND CURRENT_DATE
             AND s.status <> 'WAIVED' AND ${b}) AS "monthToDate"`,
      [branch],
    ),
    pool.query(
      `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount, p.payment_date AS "paymentDate",
              p.payment_method AS "paymentMethod", p.status, l.loan_code AS "loanCode", c.full_name AS "customerName"
       FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
       WHERE ${b} ORDER BY p.payment_date DESC, p.id DESC LIMIT 8`,
      [branch],
    ),
    pool.query(
      `SELECT s.id, s.due_date AS "dueDate", s.outstanding_amount AS "outstandingAmount", s.installment_number AS "installmentNumber",
              l.id AS "loanId", l.loan_code AS "loanCode", c.full_name AS "customerName"
       FROM collection_schedules s JOIN loans l ON l.id = s.loan_id JOIN customers c ON c.id = l.customer_id
       WHERE s.due_date BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 7 AND s.status IN ('PENDING','PARTIAL')
         AND l.status IN ('ACTIVE','DEFAULTED') AND ${b}
       ORDER BY s.due_date, s.outstanding_amount DESC LIMIT 8`,
      [branch],
    ),
    pool.query(
      `SELECT u.id, u.name, bb.branch_name AS "branchName",
              COALESCE(SUM(p.amount), 0) AS "collected", count(p.id) AS "payments"
       FROM payments p
       JOIN users u ON u.id = COALESCE(p.collected_by, p.recorded_by)
       LEFT JOIN branches bb ON bb.id = u.branch_id
       JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
       WHERE p.status = 'RECORDED' AND p.payment_date >= date_trunc('month', CURRENT_DATE) AND ${b}
       GROUP BY u.id, u.name, bb.branch_name ORDER BY "collected" DESC LIMIT 8`,
      [branch],
    ),
    pool.query(
      `SELECT bb.id, bb.branch_name AS "branchName",
              COALESCE((SELECT SUM(p.amount) FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
                        WHERE c.branch_id = bb.id AND p.status = 'RECORDED' AND p.payment_date >= date_trunc('month', CURRENT_DATE)), 0) AS "collectedThisMonth",
              COALESCE((SELECT SUM(l.outstanding_balance) FROM loans l JOIN customers c ON c.id = l.customer_id
                        WHERE c.branch_id = bb.id AND l.status IN ('ACTIVE','DEFAULTED')), 0) AS "outstanding",
              COALESCE((SELECT SUM(s.outstanding_amount) FROM v_collection_schedules s JOIN loans l ON l.id = s.loan_id
                        JOIN customers c ON c.id = l.customer_id
                        WHERE c.branch_id = bb.id AND s.effective_status = 'OVERDUE' AND l.status IN ('ACTIVE','DEFAULTED')), 0) AS "overdue"
       FROM branches bb WHERE bb.is_active AND ($1::bigint IS NULL OR bb.id = $1)
       ORDER BY "collectedThisMonth" DESC LIMIT 8`,
      [branch],
    ),
    pool.query(
      `SELECT d::date AS day,
              COALESCE((SELECT SUM(p.amount) FROM payments p JOIN loans l ON l.id = p.loan_id JOIN customers c ON c.id = l.customer_id
                        WHERE p.status = 'RECORDED' AND p.payment_date >= d AND p.payment_date < d + INTERVAL '1 day' AND ${b}), 0) AS collected,
              COALESCE((SELECT SUM(s.due_amount) FROM collection_schedules s JOIN loans l ON l.id = s.loan_id JOIN customers c ON c.id = l.customer_id
                        WHERE s.due_date = d::date AND ${b}), 0) AS due
       FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, INTERVAL '1 day') d ORDER BY d`,
      [branch],
    ),
  ]);

  const m = metrics.rows[0];
  const due = Number(m.monthToDate.due);
  const achievementPercent = due > 0 ? Math.round((Number(m.monthToDate.paid) / due) * 1000) / 10 : null;

  res.json({
    data: {
      ...m,
      collectionAchievementPercent: achievementPercent,
      recentPayments: recent.rows,
      upcomingInstallments: upcoming.rows,
      agentPerformance: agents.rows,
      branchPerformance: branches.rows,
      collectionTrend: trend.rows,
    },
  });
});
