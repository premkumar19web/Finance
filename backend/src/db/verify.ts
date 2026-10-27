// Prints row counts for every table and checks relationships and financial
// invariants. Read-only. Exit code 1 if any invariant fails.
//
//   npm run db:verify

import { pool } from '../db.js';
import { INTEGRITY_CHECKS, MIN_ROWS, ROW_COUNT_EXCEPTIONS } from './integrity.js';

async function main() {
  let failures = 0;

  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  );
  console.log('\nRow counts');
  console.log('──────────────────────────────────────────────────────────────────────────────');
  for (const { table_name } of tables.rows) {
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*) AS n FROM "${table_name}"`);
    const n = rows[0]!.n;
    const exception = ROW_COUNT_EXCEPTIONS[table_name];
    const note = n >= MIN_ROWS ? '✅' : exception ? `ℹ️  ${exception}` : `⚠️  below ${MIN_ROWS}`;
    console.log(`${table_name.padEnd(24)} ${String(n).padStart(7)}  ${note}`);
  }

  const statuses = await pool.query<{ effective_status: string; n: number }>(
    `SELECT effective_status, count(*) AS n FROM v_collection_schedules GROUP BY 1 ORDER BY 1`,
  );
  const loanStatuses = await pool.query<{ status: string; n: number }>('SELECT status, count(*) AS n FROM loans GROUP BY 1 ORDER BY 1');
  console.log('\nInstallments by status:', statuses.rows.map((r) => `${r.effective_status}=${r.n}`).join('  '));
  console.log('Loans by status:       ', loanStatuses.rows.map((r) => `${r.status}=${r.n}`).join('  '));
  // "Overdue" takes precedence in effective_status, so partly paid installments are counted by stored status.
  const partial = await pool.query<{ n: number }>(`SELECT count(*) AS n FROM collection_schedules WHERE status = 'PARTIAL'`);
  console.log(`Partly paid (stored status, incl. overdue ones): ${partial.rows[0]!.n}`);
  const missing = ['PAID', 'PENDING', 'OVERDUE'].filter((s) => !statuses.rows.some((r) => r.effective_status === s));
  if (!partial.rows[0]!.n) missing.push('PARTIAL');
  if (missing.length && statuses.rows.length) console.log(`⚠️  No installments with status: ${missing.join(', ')}`);

  console.log('\nIntegrity checks');
  console.log('──────────────────────────────────────────────────────────────────────────────');
  for (const [label, sql] of INTEGRITY_CHECKS) {
    const { rows } = await pool.query(sql);
    const violations = Number(Object.values(rows[0] ?? {})[0] ?? 0);
    if (violations === 0) console.log(`✅ ${label}`);
    else {
      failures++;
      console.log(`❌ ${label} — ${violations} violation(s)`);
    }
  }

  console.log(failures ? `\n❌ ${failures} check(s) failed.` : '\n✅ All integrity checks passed.');
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (err) {
  console.error(`❌ Verification could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
