import './helpers/env';
import { execSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { superuserPool } from './helpers/auth.ts';

// P4-F — convergence is adversarial: hostile global + per-database settings,
// attributes, and memberships are all healed to the exact approved state; and
// database targeting uses the EXACT configured allowlist (no prefix sweep),
// failing closed on invalid targets.

const MANAGED = "'selves_owner','selves_migrate','selves_app','selves_worker','selves_bootstrap','selves_operator'";
const PW_ENV = ['SELVES_GOVERNED_DATABASES', 'SELVES_MIGRATE_PASSWORD', 'SELVES_APP_PASSWORD', 'SELVES_WORKER_PASSWORD', 'SELVES_BOOTSTRAP_PASSWORD', 'SELVES_OPERATOR_PASSWORD'];

let su: pg.Pool;
beforeAll(() => { su = superuserPool(); });
afterAll(async () => {
  runBootstrap(); // leave the cluster converged for later test files
  await su.end();
});

function runBootstrap(): void {
  execSync('bash ./bootstrap/bootstrap.sh', { cwd: process.cwd(), stdio: 'pipe', env: process.env });
}

// Run roles.sql directly with a crafted governed allowlist; return exit status.
function runRoles(governed: string): { status: number } {
  const flags = PW_ENV.map((v) => `-e ${v}`).join(' ');
  try {
    execSync(
      `docker compose -f ../docker-compose.yml exec ${flags} -T postgres psql -U selves -d postgres -v ON_ERROR_STOP=1 -f - < bootstrap/roles.sql`,
      { cwd: process.cwd(), stdio: 'pipe', env: { ...process.env, SELVES_GOVERNED_DATABASES: governed } },
    );
    return { status: 0 };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 1 };
  }
}

describe('P4-F convergence heals hostile state', () => {
  afterEach(async () => { try { await su.query('DROP ROLE IF EXISTS conv_unrelated'); } catch { /* ignore */ } });

  it('normalizes hostile attributes, passwords, memberships, and role config (global + per-db)', async () => {
    // Seed a hostile cluster.
    await su.query("ALTER ROLE selves_app SUPERUSER REPLICATION CREATEDB CREATEROLE BYPASSRLS CONNECTION LIMIT 100 VALID UNTIL '2000-01-01 00:00:00+00'");
    await su.query("ALTER ROLE selves_app SET search_path = 'evil_global'");
    await su.query("ALTER ROLE selves_app IN DATABASE selves_test SET search_path = 'evil_db'");
    await su.query("ALTER ROLE selves_owner PASSWORD 'sneaky-owner'");
    await su.query('GRANT selves_owner TO selves_app');
    await su.query('GRANT selves_migrate TO selves_worker');
    await su.query('GRANT pg_read_all_data TO selves_app');
    await su.query('CREATE ROLE conv_unrelated NOLOGIN');
    await su.query('GRANT selves_owner TO conv_unrelated');

    runBootstrap();

    // Attributes healed.
    const { rows } = await su.query(
      `SELECT rolname, rolsuper, rolreplication, rolcreatedb, rolcreaterole, rolbypassrls, rolconnlimit,
              (rolvaliduntil='infinity') AS vi, (rolpassword IS NULL) AS nopw
       FROM pg_authid WHERE rolname LIKE 'selves\\_%' ORDER BY rolname`);
    const app = rows.find((r) => r.rolname === 'selves_app')!;
    expect(app).toMatchObject({ rolsuper: false, rolreplication: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolconnlimit: -1, vi: true });
    expect(rows.find((r) => r.rolname === 'selves_owner')!.nopw).toBe(true);

    // Membership graph reduced to exactly the one approved edge (all grantors).
    const mem = await su.query(
      `SELECT gr.rolname AS roleid, mr.rolname AS member, gt.rolname AS grantor, am.inherit_option, am.set_option, am.admin_option
       FROM pg_auth_members am
       JOIN pg_roles gr ON gr.oid=am.roleid JOIN pg_roles mr ON mr.oid=am.member JOIN pg_roles gt ON gt.oid=am.grantor
       WHERE gr.rolname IN (${MANAGED}) OR mr.rolname IN (${MANAGED})`);
    expect(mem.rows).toEqual([
      { roleid: 'selves_owner', member: 'selves_migrate', grantor: 'selves', inherit_option: false, set_option: true, admin_option: false },
    ]);

    // No role-level config in any scope.
    const cfg = await su.query(`SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole WHERE r.rolname LIKE 'selves\\_%'`);
    expect(cfg.rowCount).toBe(0);
  });

  it('normalizes per-database config on BOTH configured databases (dev and test)', async () => {
    await su.query("ALTER ROLE selves_app IN DATABASE selves_dev SET search_path = 'x'");
    await su.query("ALTER ROLE selves_app IN DATABASE selves_test SET search_path = 'y'");
    runBootstrap();
    const cfg = await su.query(`SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole WHERE r.rolname LIKE 'selves\\_%'`);
    expect(cfg.rowCount).toBe(0);
  });
});

describe('P4-F exact-allowlist database targeting', () => {
  it('never touches an unrelated matching-name database (no prefix sweep)', async () => {
    await su.query('DROP DATABASE IF EXISTS selves_conv_unrelated');
    await su.query('CREATE DATABASE selves_conv_unrelated');
    try {
      await su.query("ALTER ROLE selves_app IN DATABASE selves_conv_unrelated SET search_path = 'keep_me'");
      runBootstrap(); // governed = selves_dev,selves_test only
      const { rows } = await su.query(
        `SELECT s.setconfig FROM pg_db_role_setting s
         JOIN pg_roles r ON r.oid=s.setrole JOIN pg_database d ON d.oid=s.setdatabase
         WHERE r.rolname='selves_app' AND d.datname='selves_conv_unrelated'`);
      expect(rows).toHaveLength(1); // untouched — not in the allowlist despite the name
    } finally {
      await su.query('DROP DATABASE IF EXISTS selves_conv_unrelated');
    }
  });

  it('fails closed (before mutating config) when a configured target is missing', async () => {
    await su.query("ALTER ROLE selves_app IN DATABASE selves_test SET search_path = 'pre_missing'");
    const r = runRoles('selves_dev,selves_missing_xyz');
    expect(r.status).not.toBe(0);
    // validation runs before the config reset, so the seeded setting survives
    const cfg = await su.query(
      `SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole JOIN pg_database d ON d.oid=s.setdatabase
       WHERE r.rolname='selves_app' AND d.datname='selves_test'`);
    expect(cfg.rowCount).toBe(1);
    runBootstrap(); // clean up the seeded setting
  });

  it('rejects a duplicate governed list', () => {
    expect(runRoles('selves_dev,selves_dev').status).not.toBe(0);
  });

  it('rejects an empty governed list and an empty element', () => {
    expect(runRoles('').status).not.toBe(0);
    expect(runRoles('selves_dev,').status).not.toBe(0);
  });
});
