// Creates the test database if missing (never drops anything), then applies
// migrations and the development seed to it. Run via `npm run test:prepare`.
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL!);
const dbName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(dbName)) throw new Error('prepare-db must be run with src/test/env.ts loaded');

const maintenance = new URL(url);
maintenance.pathname = '/postgres';
const admin = new pg.Client({ connectionString: maintenance.toString() });
await admin.connect();
try {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) {
    // dbName is validated above, so it is safe to use as an identifier.
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created test database ${dbName}`);
  }
} finally {
  await admin.end();
}

for (const script of ['src/db/migrate.ts', 'src/db/seed.ts']) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
