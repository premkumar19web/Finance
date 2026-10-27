import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocatePayment, installmentStatus, OverpaymentError } from './allocation.js';
import { divRoundHalfUp, fromPaise, toPaise, toRateUnits } from './money.js';
import { addPeriods, buildSchedule, calculateFlatInterest } from './schedule.js';

describe('money', () => {
  it('parses and formats amounts exactly', () => {
    assert.equal(toPaise('1234.5'), 123450n);
    assert.equal(toPaise('0.01'), 1n);
    assert.equal(toPaise('100'), 10000n);
    assert.equal(fromPaise(123450n), '1234.50');
    assert.equal(fromPaise(5n), '0.05');
    assert.equal(fromPaise(-250n), '-2.50');
  });

  it('rejects malformed amounts', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1e3', '1,000']) {
      assert.throws(() => toPaise(bad), /Invalid money amount/, bad);
    }
  });

  it('does not suffer floating-point drift', () => {
    assert.equal(toPaise('0.1') + toPaise('0.2'), toPaise('0.3'));
  });

  it('parses rates to 0.0001% units', () => {
    assert.equal(toRateUnits('24'), 240000n);
    assert.equal(toRateUnits('26.5'), 265000n);
    assert.equal(toRateUnits('0.0001'), 1n);
    assert.throws(() => toRateUnits('1.23456'));
  });

  it('rounds half up', () => {
    assert.equal(divRoundHalfUp(5n, 2n), 3n);
    assert.equal(divRoundHalfUp(4n, 3n), 1n);
    assert.equal(divRoundHalfUp(5n, 3n), 2n);
    assert.equal(divRoundHalfUp(-5n, 2n), -3n);
    assert.throws(() => divRoundHalfUp(1n, 0n));
  });
});

describe('flat interest', () => {
  it('matches a hand-calculated example', () => {
    // ₹10,000 at 24% for 10 weeks: 10000 × 0.24 × 10/52 = 461.538… → ₹461.54
    assert.equal(calculateFlatInterest(toPaise('10000'), toRateUnits('24'), 10, 'WEEKLY'), toPaise('461.54'));
    // ₹50,000 at 18% for 12 months = exactly ₹9,000
    assert.equal(calculateFlatInterest(toPaise('50000'), toRateUnits('18'), 12, 'MONTHLY'), toPaise('9000'));
    // ₹20,000 at 30% for 100 days: 20000 × 0.30 × 100/365 = 1643.835… → ₹1,643.84
    assert.equal(calculateFlatInterest(toPaise('20000'), toRateUnits('30'), 100, 'DAILY'), toPaise('1643.84'));
  });

  it('is zero for a zero rate', () => {
    assert.equal(calculateFlatInterest(toPaise('10000'), 0n, 12, 'MONTHLY'), 0n);
  });
});

describe('schedule', () => {
  it('sums exactly to principal plus interest, with the remainder on the last installment', () => {
    const s = buildSchedule({
      principal: toPaise('10000'),
      annualRateUnits: toRateUnits('24'),
      term: 3,
      frequency: 'MONTHLY',
      startDate: '2026-01-15',
    });
    // Interest: 10000 × 0.24 × 3/12 = 600.00
    assert.equal(s.totalInterest, toPaise('600'));
    assert.deepEqual(s.installments.map((i) => fromPaise(i.principalDue)), ['3333.33', '3333.33', '3333.34']);
    assert.deepEqual(s.installments.map((i) => fromPaise(i.interestDue)), ['200.00', '200.00', '200.00']);
    assert.equal(s.totalPayable, toPaise('10600'));
  });

  it('always reconciles for many combinations', () => {
    for (const frequency of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
      for (const term of [1, 7, 13, 52, 100]) {
        for (const principal of ['1000', '12345.67', '999999.99']) {
          for (const rate of ['0', '13.3333', '36']) {
            const s = buildSchedule({
              principal: toPaise(principal),
              annualRateUnits: toRateUnits(rate),
              term,
              frequency,
              startDate: '2026-03-31',
            });
            const sum = (pick: (i: (typeof s.installments)[number]) => bigint) => s.installments.reduce((a, i) => a + pick(i), 0n);
            assert.equal(sum((i) => i.principalDue), toPaise(principal));
            assert.equal(sum((i) => i.interestDue), s.totalInterest);
            assert.equal(sum((i) => i.totalDue), s.totalPayable);
            assert.equal(s.installments.length, term);
            assert.ok(s.installments.every((i) => i.totalDue > 0n));
          }
        }
      }
    }
  });

  it('starts one period after the start date', () => {
    const daily = buildSchedule({ principal: 100000n, annualRateUnits: 0n, term: 2, frequency: 'DAILY', startDate: '2026-12-31' });
    assert.deepEqual(daily.installments.map((i) => i.dueDate), ['2027-01-01', '2027-01-02']);
    const weekly = buildSchedule({ principal: 100000n, annualRateUnits: 0n, term: 2, frequency: 'WEEKLY', startDate: '2026-10-26' });
    assert.deepEqual(weekly.installments.map((i) => i.dueDate), ['2026-11-02', '2026-11-09']);
    assert.equal(weekly.maturityDate, '2026-11-09');
  });

  it('clamps monthly due dates to the end of shorter months', () => {
    assert.equal(addPeriods('2026-01-31', 'MONTHLY', 1), '2026-02-28');
    assert.equal(addPeriods('2028-01-31', 'MONTHLY', 1), '2028-02-29');
    assert.equal(addPeriods('2026-01-31', 'MONTHLY', 2), '2026-03-31');
    assert.equal(addPeriods('2026-11-30', 'MONTHLY', 3), '2027-02-28');
    assert.equal(addPeriods('2026-03-15', 'MONTHLY', -3), '2025-12-15');
  });

  it('rejects invalid input', () => {
    assert.throws(() => buildSchedule({ principal: 0n, annualRateUnits: 0n, term: 1, frequency: 'DAILY', startDate: '2026-01-01' }));
    assert.throws(() => buildSchedule({ principal: 100n, annualRateUnits: 0n, term: 0, frequency: 'DAILY', startDate: '2026-01-01' }));
    // ₹0.05 over 10 installments would create ₹0.00 installments.
    assert.throws(() => buildSchedule({ principal: 5n, annualRateUnits: 0n, term: 10, frequency: 'DAILY', startDate: '2026-01-01' }));
  });
});

describe('allocation', () => {
  const open = [
    { scheduleId: 12, installmentNumber: 2, outstanding: 1000n },
    { scheduleId: 11, installmentNumber: 1, outstanding: 400n },
    { scheduleId: 13, installmentNumber: 3, outstanding: 1000n },
  ];

  it('pays the oldest installment first', () => {
    assert.deepEqual(allocatePayment(1200n, open), [
      { scheduleId: 11, amount: 400n },
      { scheduleId: 12, amount: 800n },
    ]);
  });

  it('allocates the exact amount, never more', () => {
    const allocations = allocatePayment(2400n, open);
    assert.equal(allocations.reduce((s, a) => s + a.amount, 0n), 2400n);
    assert.equal(allocations.length, 3);
  });

  it('rejects overpayment with the outstanding amount', () => {
    assert.throws(
      () => allocatePayment(2401n, open),
      (err: unknown) => err instanceof OverpaymentError && err.outstanding === 2400n,
    );
  });

  it('rejects zero and negative amounts', () => {
    assert.throws(() => allocatePayment(0n, open));
    assert.throws(() => allocatePayment(-1n, open));
  });

  it('derives installment status', () => {
    assert.equal(installmentStatus(0n, 100n), 'PENDING');
    assert.equal(installmentStatus(1n, 100n), 'PARTIAL');
    assert.equal(installmentStatus(100n, 100n), 'PAID');
  });
});
