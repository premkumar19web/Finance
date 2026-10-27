// Loaded (via --import) before any test code: points the app at a separate test
// database so tests never touch development data.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) in backend/.env');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`;
  return url.toString();
}

const url = testDatabaseUrl();
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!/^[a-z0-9_]+_test$/.test(dbName)) {
  throw new Error(`Refusing to run tests: database "${dbName}" does not end with _test.`);
}

process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
