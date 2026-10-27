import { pool } from './db.js';

const EXPECTED_DATABASE = 'lion_finance';

interface ConnectionCheckRow {
  current_database: string;
  now: Date;
}

async function main(): Promise<void> {
  try {
    const result = await pool.query<ConnectionCheckRow>('SELECT current_database(), NOW()');
    const row = result.rows[0];

    if (!row) {
      throw new Error('Query returned no rows.');
    }
    if (row.current_database !== EXPECTED_DATABASE) {
      throw new Error(
        `Connected to database "${row.current_database}", expected "${EXPECTED_DATABASE}".`,
      );
    }

    console.log(`✅ Connected to PostgreSQL database "${row.current_database}"`);
    console.log(`   Server time: ${row.now.toISOString()}`);
  } catch (err) {
    // Only the message and error code are printed: pg error messages do not include the password.
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Database connection test failed${code ? ` [${code}]` : ''}: ${message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
