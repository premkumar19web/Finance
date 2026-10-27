import { z } from 'zod';
import type { Queryable } from '../../db.js';
import { moneyString, rateString } from '../../http/validation.js';

export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const termLimit = z.number().int().min(1).max(10_000);

/** Shape of every supported setting; values that fail validation fall back to DEFAULTS. */
export const SETTING_SCHEMAS = {
  'company.name': z.string().trim().min(1).max(100),
  'company.currency': z.string().regex(/^[A-Z]{3}$/),
  'receipts.prefix': z.string().regex(/^[A-Z0-9]{1,6}$/, 'Use 1-6 capital letters or digits'),
  'loans.min_principal': moneyString,
  'loans.max_principal': moneyString,
  'loans.max_annual_interest_rate': rateString,
  'loans.max_term': z.object({ DAILY: termLimit, WEEKLY: termLimit, MONTHLY: termLimit }),
  'loans.max_start_days_ahead': z.number().int().min(0).max(365),
  'loans.require_different_approver': z.boolean(),
  'payments.enabled_methods': z.array(z.enum(PAYMENT_METHODS)).min(1),
  'payments.reversal_window_days': z.number().int().min(0).max(365),
  'collections.week_starts_on': z.enum(['MONDAY', 'SUNDAY']),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type Settings = { [K in SettingKey]: z.output<(typeof SETTING_SCHEMAS)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  'company.name': 'Lion Finance',
  'company.currency': 'INR',
  'receipts.prefix': 'LF',
  'loans.min_principal': '1000.00',
  'loans.max_principal': '1000000.00',
  'loans.max_annual_interest_rate': '36.0000',
  'loans.max_term': { DAILY: 365, WEEKLY: 104, MONTHLY: 60 },
  'loans.max_start_days_ahead': 90,
  'loans.require_different_approver': true,
  'payments.enabled_methods': [...PAYMENT_METHODS],
  'payments.reversal_window_days': 30,
  'collections.week_starts_on': 'MONDAY',
};

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_SCHEMAS, key);
}

export async function getSettings(db: Queryable): Promise<Settings> {
  const { rows } = await db.query<{ setting_key: string; setting_value: unknown }>(
    'SELECT setting_key, setting_value FROM app_settings',
  );
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!isSettingKey(row.setting_key)) continue;
    const parsed = SETTING_SCHEMAS[row.setting_key].safeParse(row.setting_value);
    if (parsed.success) settings[row.setting_key] = parsed.data;
    else console.warn(`Ignoring invalid value for setting ${row.setting_key}; using default.`);
  }
  return settings as Settings;
}
