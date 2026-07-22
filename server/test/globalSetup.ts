import './helpers/env';
import { execSync } from 'node:child_process';
import pg from 'pg';

// Proves migrate-from-zero on every test run: drop the test schema to bare
// metal, then apply all migrations from empty. If the migrations cannot build
// the schema from zero, the whole suite fails here.
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();

  try {
    execSync(
      'node ./node_modules/node-pg-migrate/bin/node-pg-migrate.js up -d TEST_DATABASE_URL',
      { cwd: process.cwd(), stdio: 'pipe', env: process.env },
    );
  } catch (err) {
    // Surface migration output only when from-zero migration fails.
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(e.stdout?.toString() ?? '');
    process.stderr.write(e.stderr?.toString() ?? '');
    throw new Error('migrate-from-zero failed in test global setup');
  }
}
