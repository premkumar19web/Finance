import { z } from 'zod';

/** Route parameter `:id` → positive integer. */
export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Turns `?sort=name` / `?sort=-name` into a safe ORDER BY clause. Only keys in
 * `allowed` are accepted, so user input never reaches SQL directly.
 */
export function orderBy(sort: string | undefined, allowed: Record<string, string>, fallback: string): string {
  if (sort) {
    const desc = sort.startsWith('-');
    const column = allowed[desc ? sort.slice(1) : sort];
    if (column) return `ORDER BY ${column} ${desc ? 'DESC' : 'ASC'} NULLS LAST`;
  }
  return `ORDER BY ${fallback}`;
}

/** Calendar date 'YYYY-MM-DD' that actually exists. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Not a valid calendar date');

/** Money amount as a string with up to 2 decimals, e.g. "1500" or "1500.50". */
export const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimal places'));

/** Interest rate (percent) with up to 4 decimals. */
export const rateString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'Enter a rate with at most 4 decimal places'));

export const phoneString = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{6,18}$/, 'Enter a valid phone number');

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** Query-string boolean: "true" / "false". */
export const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const searchText = z.string().trim().max(100).optional();
