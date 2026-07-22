import './helpers/env';
import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { expectPgError } from './helpers/db';

// P4-A — proves the managed-role bootstrap converges to the exact approved
// catalog state. Self-contained: runs the (idempotent) convergent bootstrap,
// then asserts pg_authid / pg_auth_members / pg_db_role_setting exactly.

const MANAGED = [
  'selves_owner', 'selves_migrate', 'selves_app',
  'selves_worker', 'selves_bootstrap', 'selves_operator',
];

const superuser = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });

beforeAll(() => {
  // Convergent + idempotent — running it here makes the suite reproducible from
  // a fresh cluster without a manual bootstrap step.
  execSync('bash ./bootstrap/bootstrap.sh', { cwd: process.cwd(), stdio: 'pipe', env: process.env });
}, 60_000);

afterAll(async () => { await superuser.end(); });

describe('P4-A managed-role convergence', () => {
  it('creates exactly the six managed roles with exact attributes', async () => {
    const { rows } = await superuser.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls,
              rolreplication, rolinherit, rolconnlimit,
              (rolvaliduntil = 'infinity') AS valid_infinity,
              (rolpassword IS NULL) AS no_password
       FROM pg_authid WHERE rolname LIKE 'selves\\_%' ORDER BY rolname`,
    );
    expect(rows.map((r) => r.rolname)).toEqual([...MANAGED].sort());
    for (const r of rows) {
      expect(r.rolsuper, `${r.rolname} superuser`).toBe(false);
      expect(r.rolcreatedb, `${r.rolname} createdb`).toBe(false);
      expect(r.rolcreaterole, `${r.rolname} createrole`).toBe(false);
      expect(r.rolbypassrls, `${r.rolname} bypassrls`).toBe(false);
      expect(r.rolreplication, `${r.rolname} replication`).toBe(false);
      expect(r.rolinherit, `${r.rolname} inherit`).toBe(false);
      expect(r.valid_infinity, `${r.rolname} valid until infinity`).toBe(true);
    }
    const owner = rows.find((r) => r.rolname === 'selves_owner')!;
    expect(owner.rolcanlogin).toBe(false);
    expect(owner.no_password).toBe(true); // no usable password
    expect(owner.rolconnlimit).toBe(0);
    for (const r of rows.filter((x) => x.rolname !== 'selves_owner')) {
      expect(r.rolcanlogin, `${r.rolname} login`).toBe(true);
      expect(r.no_password, `${r.rolname} has password`).toBe(false);
      expect(r.rolconnlimit, `${r.rolname} connlimit`).toBe(-1);
    }
  });

  it('reduces the membership graph to the single approved grantor-verified edge', async () => {
    const { rows } = await superuser.query(
      `SELECT gr.rolname AS roleid, mr.rolname AS member, gt.rolname AS grantor,
              am.admin_option, am.inherit_option, am.set_option
       FROM pg_auth_members am
       JOIN pg_roles gr ON gr.oid = am.roleid
       JOIN pg_roles mr ON mr.oid = am.member
       JOIN pg_roles gt ON gt.oid = am.grantor
       WHERE gr.rolname LIKE 'selves\\_%' OR mr.rolname LIKE 'selves\\_%'
       ORDER BY 1, 2`,
    );
    expect(rows).toEqual([
      {
        roleid: 'selves_owner',
        member: 'selves_migrate',
        grantor: 'selves', // the bootstrap superuser
        admin_option: false,
        inherit_option: false,
        set_option: true,
      },
    ]);
  });

  it('leaves no role-level config (global or per-database) for managed roles', async () => {
    const { rows } = await superuser.query(
      `SELECT r.rolname FROM pg_db_role_setting s
       JOIN pg_roles r ON r.oid = s.setrole
       WHERE r.rolname LIKE 'selves\\_%'`,
    );
    expect(rows).toEqual([]);
  });

  it('migrations connect as selves_migrate with current_user = selves_owner', async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_MIGRATE_DATABASE_URL });
    try {
      const { rows } = await pool.query('SELECT session_user, current_user');
      expect(rows[0]).toEqual({ session_user: 'selves_migrate', current_user: 'selves_owner' });
    } finally {
      await pool.end();
    }
  });

  it('app cannot SET ROLE into owner/migrate and cannot create a schema', async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_APP_DATABASE_URL });
    try {
      await expectPgError(() => pool.query('SET ROLE selves_owner'), '42501');
      await expectPgError(() => pool.query('SET ROLE selves_migrate'), '42501');
      await expectPgError(() => pool.query('CREATE SCHEMA app_should_not'), '42501');
    } finally {
      await pool.end();
    }
  });

  it('worker cannot SET ROLE into owner/migrate and cannot create a schema', async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_WORKER_DATABASE_URL });
    try {
      await expectPgError(() => pool.query('SET ROLE selves_owner'), '42501');
      await expectPgError(() => pool.query('CREATE SCHEMA worker_should_not'), '42501');
    } finally {
      await pool.end();
    }
  });
});
