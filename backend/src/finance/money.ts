// Exact money arithmetic. Amounts are handled as BigInt paise (1 rupee = 100 paise)
// and interest rates as BigInt units of 0.0001 %. JavaScript floating-point numbers
// are never used for money, so 0.1 + 0.2 problems cannot happen.

export type Paise = bigint;

const MONEY_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;
const RATE_PATTERN = /^(\d+)(?:\.(\d{1,4}))?$/;

/** "1234.5" → 123450n. Accepts PostgreSQL NUMERIC strings. Throws on bad input. */
export function toPaise(amount: string): Paise {
  const match = MONEY_PATTERN.exec(amount.trim());
  if (!match) throw new Error(`Invalid money amount: ${amount}`);
  const [, rupees, fraction = ''] = match;
  return BigInt(rupees!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** 123450n → "1234.50" (the format PostgreSQL NUMERIC(14,2) accepts). */
export function fromPaise(paise: Paise): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${rupees}.${fraction}`;
}

/** "24.5" → 245000n (units of 0.0001 percent). */
export function toRateUnits(rate: string): bigint {
  const match = RATE_PATTERN.exec(rate.trim());
  if (!match) throw new Error(`Invalid interest rate: ${rate}`);
  const [, whole, fraction = ''] = match;
  return BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

/** Integer division rounding half away from zero (for non-negative inputs: half up). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  if (numerator < 0n) return -divRoundHalfUp(-numerator, denominator);
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function sumPaise(values: Iterable<Paise>): Paise {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
