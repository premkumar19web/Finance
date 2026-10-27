import type { PoolClient } from 'pg';
import type { Queryable } from '../../db.js';
import { businessRule } from '../../http/errors.js';
import { fromPaise, toPaise, toRateUnits } from '../../finance/money.js';
import { buildSchedule, type CollectionFrequency, type Schedule } from '../../finance/schedule.js';
import type { Settings } from '../settings/service.js';

export interface LoanTerms {
  principalAmount: string;
  annualInterestRate: string;
  loanTerm: number;
  collectionFrequency: CollectionFrequency;
  loanStartDate: string;
}

/** Validates loan terms against settings and returns the computed schedule. */
export function validateAndBuildSchedule(terms: LoanTerms, settings: Settings, today: string): Schedule {
  const principal = toPaise(terms.principalAmount);
  if (principal < toPaise(settings['loans.min_principal']) || principal > toPaise(settings['loans.max_principal'])) {
    throw businessRule(
      'PRINCIPAL_OUT_OF_RANGE',
      `Principal must be between ₹${settings['loans.min_principal']} and ₹${settings['loans.max_principal']}.`,
    );
  }
  const rate = toRateUnits(terms.annualInterestRate);
  if (rate > toRateUnits(settings['loans.max_annual_interest_rate'])) {
    throw businessRule(
      'RATE_TOO_HIGH',
      `Annual interest rate cannot exceed ${settings['loans.max_annual_interest_rate']}%.`,
    );
  }
  const maxTerm = settings['loans.max_term'][terms.collectionFrequency];
  if (terms.loanTerm > maxTerm) {
    throw businessRule('TERM_TOO_LONG', `A ${terms.collectionFrequency.toLowerCase()} loan can have at most ${maxTerm} installments.`);
  }
  if (terms.loanStartDate < today) {
    throw businessRule('START_DATE_IN_PAST', 'The loan start date cannot be in the past.');
  }
  const latest = new Date(`${today}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() + settings['loans.max_start_days_ahead']);
  if (terms.loanStartDate > latest.toISOString().slice(0, 10)) {
    throw businessRule(
      'START_DATE_TOO_FAR',
      `The loan start date can be at most ${settings['loans.max_start_days_ahead']} days ahead.`,
    );
  }

  try {
    return buildSchedule({
      principal,
      annualRateUnits: rate,
      term: terms.loanTerm,
      frequency: terms.collectionFrequency,
      startDate: terms.loanStartDate,
    });
  } catch (err) {
    throw businessRule('INVALID_SCHEDULE', (err as Error).message);
  }
}

export function scheduleToJson(schedule: Schedule) {
  return {
    totalInterest: fromPaise(schedule.totalInterest),
    totalPayable: fromPaise(schedule.totalPayable),
    maturityDate: schedule.maturityDate,
    installments: schedule.installments.map((i) => ({
      installmentNumber: i.installmentNumber,
      dueDate: i.dueDate,
      principalDue: fromPaise(i.principalDue),
      interestDue: fromPaise(i.interestDue),
      totalDue: fromPaise(i.totalDue),
    })),
  };
}

/** Inserts all installments of a schedule in one statement. */
export async function insertSchedule(db: PoolClient, loanId: number, schedule: Schedule): Promise<void> {
  const i = schedule.installments;
  await db.query(
    `INSERT INTO collection_schedules (loan_id, installment_number, due_date, principal_due, interest_due, due_amount)
     SELECT $1, * FROM unnest($2::int[], $3::date[], $4::numeric[], $5::numeric[], $6::numeric[])`,
    [
      loanId,
      i.map((x) => x.installmentNumber),
      i.map((x) => x.dueDate),
      i.map((x) => fromPaise(x.principalDue)),
      i.map((x) => fromPaise(x.interestDue)),
      i.map((x) => fromPaise(x.totalDue)),
    ],
  );
}

export async function businessToday(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ today: string }>('SELECT CURRENT_DATE AS today');
  return rows[0]!.today;
}

/** Assigns `agentId` to collect `loanId`, ending any current assignment. */
export async function assignAgent(
  db: PoolClient,
  loanId: number,
  agentId: number,
  assignedBy: number,
  notes: string | null,
): Promise<number> {
  const agent = await db.query<{ branch_id: number | null; is_active: boolean; is_agent: boolean }>(
    `SELECT u.branch_id, u.is_active,
            EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id AND r.role_name = 'COLLECTION_AGENT') AS is_agent
     FROM users u WHERE u.id = $1`,
    [agentId],
  );
  const a = agent.rows[0];
  if (!a || !a.is_agent) throw businessRule('NOT_AN_AGENT', 'The selected user is not a collection agent.');
  if (!a.is_active) throw businessRule('AGENT_INACTIVE', 'The selected agent is inactive.');

  const loan = await db.query<{ branch_id: number; status: string }>(
    'SELECT c.branch_id, l.status FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1',
    [loanId],
  );
  const l = loan.rows[0];
  if (!l) throw businessRule('LOAN_NOT_FOUND', 'Loan not found.');
  if (!['APPROVED', 'ACTIVE', 'DEFAULTED'].includes(l.status)) {
    throw businessRule('LOAN_NOT_ASSIGNABLE', 'Only approved, active or defaulted loans can be assigned.');
  }
  if (a.branch_id !== l.branch_id) {
    throw businessRule('AGENT_OTHER_BRANCH', 'The agent must belong to the same branch as the customer.');
  }

  await db.query(
    `UPDATE collection_assignments SET unassigned_at = NOW(), unassigned_by = $2
     WHERE loan_id = $1 AND unassigned_at IS NULL`,
    [loanId, assignedBy],
  );
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO collection_assignments (loan_id, agent_user_id, assigned_by, notes)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [loanId, agentId, assignedBy, notes],
  );
  return rows[0]!.id;
}
