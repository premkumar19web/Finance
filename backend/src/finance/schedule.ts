// Repayment schedule generation — the interest and rounding policy lives here.
//
// Policy (documented assumption until confirmed, see OPEN_QUESTIONS.md):
//  1. Flat interest: total interest = principal × annual rate × (term ÷ periods per year),
//     where periods per year is 365 (DAILY), 52 (WEEKLY) or 12 (MONTHLY).
//     Rounded half-up to the paisa once, on the total.
//  2. Principal and interest are each split evenly across installments, rounded
//     down to the paisa; the final installment absorbs the remainder, so the
//     schedule always sums exactly to principal + total interest.
//  3. The first installment is due one period after the loan start date.
//     Monthly due dates keep the start day-of-month, clamped to the month's last day.

import { divRoundHalfUp, type Paise } from './money.js';

export const COLLECTION_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type CollectionFrequency = (typeof COLLECTION_FREQUENCIES)[number];

export const PERIODS_PER_YEAR: Record<CollectionFrequency, bigint> = {
  DAILY: 365n,
  WEEKLY: 52n,
  MONTHLY: 12n,
};

export interface ScheduleInput {
  principal: Paise;
  /** Annual rate in units of 0.0001 % (see toRateUnits). */
  annualRateUnits: bigint;
  /** Number of installments. */
  term: number;
  frequency: CollectionFrequency;
  /** 'YYYY-MM-DD' */
  startDate: string;
}

export interface Installment {
  installmentNumber: number;
  dueDate: string;
  principalDue: Paise;
  interestDue: Paise;
  totalDue: Paise;
}

export interface Schedule {
  totalInterest: Paise;
  totalPayable: Paise;
  maturityDate: string;
  installments: Installment[];
}

/** rate units are 1/10000 of a percent → divide by 100 × 10000. */
const RATE_DENOMINATOR = 1_000_000n;

export function calculateFlatInterest(
  principal: Paise,
  annualRateUnits: bigint,
  term: number,
  frequency: CollectionFrequency,
): Paise {
  return divRoundHalfUp(principal * annualRateUnits * BigInt(term), PERIODS_PER_YEAR[frequency] * RATE_DENOMINATOR);
}

export function buildSchedule(input: ScheduleInput): Schedule {
  const { principal, annualRateUnits, term, frequency, startDate } = input;
  if (!Number.isInteger(term) || term <= 0) throw new Error('Term must be a positive whole number');
  if (principal <= 0n) throw new Error('Principal must be positive');
  if (annualRateUnits < 0n) throw new Error('Interest rate cannot be negative');

  const n = BigInt(term);
  const totalInterest = calculateFlatInterest(principal, annualRateUnits, term, frequency);
  const basePrincipal = principal / n;
  const baseInterest = totalInterest / n;

  const installments: Installment[] = [];
  for (let k = 1; k <= term; k++) {
    const isLast = k === term;
    const principalDue = isLast ? principal - basePrincipal * (n - 1n) : basePrincipal;
    const interestDue = isLast ? totalInterest - baseInterest * (n - 1n) : baseInterest;
    installments.push({
      installmentNumber: k,
      dueDate: addPeriods(startDate, frequency, k),
      principalDue,
      interestDue,
      totalDue: principalDue + interestDue,
    });
  }

  if (installments.some((i) => i.totalDue <= 0n)) {
    throw new Error('Each installment must be at least ₹0.01; use a larger principal or a shorter term');
  }

  return {
    totalInterest,
    totalPayable: principal + totalInterest,
    maturityDate: installments[installments.length - 1]!.dueDate,
    installments,
  };
}

/** Date `count` periods after `date` ('YYYY-MM-DD' in, 'YYYY-MM-DD' out). */
export function addPeriods(date: string, frequency: CollectionFrequency, count: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (frequency === 'MONTHLY') {
    const monthIndex = m - 1 + count;
    const year = y + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return formatUtcDate(new Date(Date.UTC(year, month, Math.min(d, lastDay))));
  }
  const days = frequency === 'DAILY' ? count : count * 7;
  return formatUtcDate(new Date(Date.UTC(y, m - 1, d + days)));
}

export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
