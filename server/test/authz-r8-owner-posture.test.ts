import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { superuserPool } from './helpers/auth.ts';

// P8 R8 (decision 0008 R8 / 0009) — "Enable RLS, do not FORCE" is granted
// CONDITIONALLY on selves_owner remaining unreachable as a login identity. FORCE
// would protect only against a compromised owner (T3, out of scope) and would put
// the ratified write state machine through a context-and-policy redesign; it is
// therefore not used. The ruling is conditional on four owner-posture facts. This
// suite — not anyone's memory — enforces that condition: if any fact changes, these
// tests fail and the FORCE posture returns to chamber automatically.

let su: pg.Pool;
beforeAll(() => { su = superuserPool(); });
afterAll(async () => { await su.end(); });

describe('P8 R8 selves_owner posture (the condition on the no-FORCE ruling)', () => {
  it('is NOLOGIN', async () => {
    const { rows } = await su.query<{ rolcanlogin: boolean }>(
      'SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', ['selves_owner'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rolcanlogin).toBe(false);
  });

  it('has no password', async () => {
    const { rows } = await su.query<{ password_is_null: boolean }>(
      'SELECT (rolpassword IS NULL) AS password_is_null FROM pg_authid WHERE rolname = $1', ['selves_owner'],
    );
    expect(rows[0]!.password_is_null).toBe(true);
  });

  it('has CONNECTION LIMIT 0', async () => {
    const { rows } = await su.query<{ rolconnlimit: number }>(
      'SELECT rolconnlimit FROM pg_roles WHERE rolname = $1', ['selves_owner'],
    );
    expect(rows[0]!.rolconnlimit).toBe(0);
  });

  it('is reachable solely via selves_migrate SET ROLE (exactly one member, with SET)', async () => {
    const { rows } = await su.query<{ member: string; set_option: boolean }>(
      `SELECT m.rolname AS member, am.set_option
         FROM pg_auth_members am
         JOIN pg_roles r ON r.oid = am.roleid
         JOIN pg_roles m ON m.oid = am.member
        WHERE r.rolname = 'selves_owner'
        ORDER BY m.rolname`,
    );
    expect(rows.map((r) => r.member)).toEqual(['selves_migrate']);
    expect(rows[0]!.set_option, 'selves_migrate may SET ROLE selves_owner').toBe(true);
  });

  it('is neither superuser nor BYPASSRLS (owner bypass is by table ownership only)', async () => {
    const { rows } = await su.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', ['selves_owner'],
    );
    expect(rows[0]!.rolsuper).toBe(false);
    expect(rows[0]!.rolbypassrls).toBe(false);
  });

  it('no table anywhere uses FORCE ROW LEVEL SECURITY (R8: FORCE is used nowhere in Phase 8)', async () => {
    const { rows } = await su.query<{ rel: string }>(
      `SELECT n.nspname || '.' || c.relname AS rel
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND c.relforcerowsecurity = true
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.rel)).toEqual([]);
  });
});
