// Payment allocation policy (documented assumption, see OPEN_QUESTIONS.md):
// a payment pays the oldest unpaid installment first, then the next, and so on.
// A payment larger than the loan's total outstanding amount is rejected.

import type { Paise } from './money.js';

export interface OpenInstallment {
  scheduleId: number;
  installmentNumber: number;
  outstanding: Paise;
}

export interface Allocation {
  scheduleId: number;
  amount: Paise;
}

export class OverpaymentError extends Error {
  readonly outstanding: Paise;

  constructor(outstanding: Paise) {
    super('Payment exceeds the outstanding balance');
    this.outstanding = outstanding;
  }
}

export function allocatePayment(amount: Paise, installments: OpenInstallment[]): Allocation[] {
  if (amount <= 0n) throw new Error('Payment amount must be positive');

  const ordered = [...installments]
    .filter((i) => i.outstanding > 0n)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
  const totalOutstanding = ordered.reduce((sum, i) => sum + i.outstanding, 0n);
  if (amount > totalOutstanding) throw new OverpaymentError(totalOutstanding);

  const allocations: Allocation[] = [];
  let remaining = amount;
  for (const installment of ordered) {
    if (remaining === 0n) break;
    const applied = remaining < installment.outstanding ? remaining : installment.outstanding;
    allocations.push({ scheduleId: installment.scheduleId, amount: applied });
    remaining -= applied;
  }
  return allocations;
}

/** Stored installment status after `paid` of `due` has been paid. */
export function installmentStatus(paid: Paise, due: Paise): 'PENDING' | 'PARTIAL' | 'PAID' {
  if (paid === 0n) return 'PENDING';
  return paid >= due ? 'PAID' : 'PARTIAL';
}
