import pg from 'pg';
import { config } from './config.js';

// BIGINT ids and COUNT(*) results arrive as strings by default; they stay far below
// 2^53, so plain numbers are safe and simpler. NUMERIC (money) stays a string so no
// precision is ever lost. DATE stays a 'YYYY-MM-DD' string (no time-zone shifting).
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// One shared pool for the whole process. Import `pool` wherever a query is needed;
// never create a new Pool per request.
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Every session uses the business time zone, so CURRENT_DATE means "today" locally.
  options: `-c timezone=${config.APP_TIMEZONE}`,
});

// An idle client can lose its connection (e.g. PostgreSQL restarts). Without this
// handler the 'error' event would crash the process; the pool replaces the client.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

export type Queryable = pg.Pool | pg.PoolClient;

/** Runs `fn` inside BEGIN/COMMIT; any thrown error rolls everything back. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
