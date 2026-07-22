import './helpers/env';
import { execSync } from 'node:child_process';
import pg from 'pg';

// Proves migrate-from-zero on every test run under the Phase-4 privilege
// boundary:
//   1. Ensure the six managed roles exist + public ownership + db grants
//      (convergent bootstrap; roles are cluster-global, so this is idempotent).
//   2. Reset the TEST substrate in dependency-safe order — auth first (it FKs
//      public.accounts), then public (which also drops node-pg-migrate's
//      `pgmigrations` bookkeeping), then re-establish owner + PUBLIC revoke.
//   3. Run migrations as selves_migrate with current_user=selves_owner, so all
//      objects are owned by selves_owner. The 27 Phase-3 tests still connect as
//      the superuser (TEST_DATABASE_URL) and are unaffected by ownership.
export default async function setup(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  const migrateUrl = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set');
  if (!migrateUrl) throw new Error('TEST_MIGRATE_DATABASE_URL is not set');

  // 1. Convergent role bootstrap (idempotent).
  execSync('bash ./bootstrap/bootstrap.sh', { cwd: process.cwd(), stdio: 'pipe', env: process.env });

  // 2. Reset substrate as the superuser.
  const su = new pg.Client({ connectionString: testUrl });
  await su.connect();
  await su.query('DROP SCHEMA IF EXISTS auth CASCADE');            // auth references public.accounts
  await su.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await su.query('ALTER SCHEMA public OWNER TO selves_owner');     // recreate resets owner to superuser
  await su.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await su.end();

  // 3. Migrate from zero as selves_migrate (role=selves_owner).
  try {
    execSync(
      'node ./node_modules/node-pg-migrate/bin/node-pg-migrate.js up -d TEST_MIGRATE_DATABASE_URL',
      { cwd: process.cwd(), stdio: 'pipe', env: process.env },
    );
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(e.stdout?.toString() ?? '');
    process.stderr.write(e.stderr?.toString() ?? '');
    throw new Error('migrate-from-zero failed in test global setup');
  }
}
