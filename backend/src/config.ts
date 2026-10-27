import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  // Comma-separated list of browser origins allowed to call the API.
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Business time zone: decides what "today" and "overdue" mean.
  APP_TIMEZONE: z
    .string()
    .regex(/^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/, 'APP_TIMEZONE must be an IANA zone such as Asia/Kolkata')
    .default('Asia/Kolkata'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(60),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Only variable names and problems are printed — never the values.
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(
    `Invalid environment configuration:\n${problems}\nCopy backend/.env.example to backend/.env and fill it in.`,
  );
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.FRONTEND_URL.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
};
