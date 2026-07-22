import './helpers/env';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';

// P4-B — proves the `auth` schema contains EXACTLY the approved inventory and
// nothing else, with the exact owners, security modes, search_path pins, and
// EXECUTE ACLs. The auth schema must not become an unguarded second schema.

const su = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
afterAll(async () => { await su.end(); });

const CALLABLE: Record<string, string> = {
  'auth.authenticate_session(bytea)': 'selves_app',
  'auth.issue_session(bytea,bytea)': 'selves_app',
  'auth.revoke_session(bytea)': 'selves_app',
  'auth.enroll_account(uuid,text,bytea)': 'selves_bootstrap',
  'auth.rotate_credential(uuid,uuid,bytea)': 'selves_bootstrap',
  'auth.disable_credential(uuid)': 'selves_bootstrap',
  'auth.recover_enrollment_credential(uuid,bytea)': 'selves_bootstrap',
  'auth.contain_account(uuid)': 'selves_operator',
};
const TRIGGER_FNS = ['auth.tg_sessions_set_expiry()', 'auth.tg_sessions_guard_update()', 'auth.tg_credentials_guard_update()'];
const ALL_ROLES = ['selves_app', 'selves_bootstrap', 'selves_operator', 'selves_worker', 'selves_migrate'];

describe('P4-B auth schema inventory', () => {
  it('has exactly two tables, owned by selves_owner', async () => {
    const { rows } = await su.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relkind = 'r' ORDER BY 1`,
    );
    expect(rows).toEqual([
      { relname: 'account_credentials', owner: 'selves_owner' },
      { relname: 'sessions', owner: 'selves_owner' },
    ]);
  });

  it('has exactly the seven approved indexes', async () => {
    const { rows } = await su.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND c.relkind = 'i' ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      'account_credentials_acct_idx',
      'account_credentials_hash_key',
      'account_credentials_one_active',
      'account_credentials_pkey',
      'sessions_acct_idx',
      'sessions_pkey',
      'sessions_token_hash_key',
    ]);
  });

  it('has no unapproved relation kinds (no views, sequences, or materialized views)', async () => {
    const { rows } = await su.query(
      `SELECT c.relkind, count(*)::int AS n FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' GROUP BY 1 ORDER BY 1`,
    );
    expect(rows).toEqual([
      { relkind: 'i', n: 7 },
      { relkind: 'r', n: 2 },
    ]);
  });

  it('has exactly the eleven functions: 8 DEFINER + 3 INVOKER triggers, all search_path="" owned by selves_owner', async () => {
    const { rows } = await su.query(
      `SELECT p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') AS cfg,
              pg_get_userbyid(p.proowner) AS owner
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' ORDER BY 1`,
    );
    expect(rows.length).toBe(11);
    for (const r of rows) {
      expect(r.owner, `${r.proname} owner`).toBe('selves_owner');
      expect(r.cfg, `${r.proname} search_path`).toBe('search_path=""');
    }
    const definer = rows.filter((r) => r.prosecdef).map((r) => r.proname).sort();
    const invoker = rows.filter((r) => !r.prosecdef).map((r) => r.proname).sort();
    expect(definer).toEqual([
      'authenticate_session', 'contain_account', 'disable_credential', 'enroll_account',
      'issue_session', 'recover_enrollment_credential', 'revoke_session', 'rotate_credential',
    ]);
    expect(invoker).toEqual([
      'tg_credentials_guard_update', 'tg_sessions_guard_update', 'tg_sessions_set_expiry',
    ]);
  });

  it('has exactly the three triggers', async () => {
    const { rows } = await su.query(
      `SELECT t.tgname, c.relname FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'auth' AND NOT t.tgisinternal ORDER BY 1`,
    );
    expect(rows).toEqual([
      { tgname: 'credentials_guard_update', relname: 'account_credentials' },
      { tgname: 'sessions_guard_update', relname: 'sessions' },
      { tgname: 'sessions_set_expiry', relname: 'sessions' },
    ]);
  });

  it('grants EXECUTE on each callable function to exactly its one approved role (PUBLIC revoked)', async () => {
    for (const [fn, approved] of Object.entries(CALLABLE)) {
      for (const role of ALL_ROLES) {
        const { rows } = await su.query('SELECT has_function_privilege($1, $2, $3) AS ok', [role, fn, 'EXECUTE']);
        expect(rows[0].ok, `${role} EXECUTE ${fn}`).toBe(role === approved);
      }
    }
  });

  it('grants no EXECUTE on trigger functions to any managed role (PUBLIC revoked)', async () => {
    for (const fn of TRIGGER_FNS) {
      for (const role of ALL_ROLES) {
        const { rows } = await su.query('SELECT has_function_privilege($1, $2, $3) AS ok', [role, fn, 'EXECUTE']);
        expect(rows[0].ok, `${role} EXECUTE ${fn}`).toBe(false);
      }
    }
  });

  it('the only direct table grant is selves_app column-scoped SELECT on public.selves', async () => {
    const colSel = async (role: string, col: string) =>
      (await su.query('SELECT has_column_privilege($1, $2, $3, $4) AS ok', [role, 'public.selves', col, 'SELECT'])).rows[0].ok;
    // app: granted exactly (id, account_id, name, self_slot)
    for (const c of ['id', 'account_id', 'name', 'self_slot']) expect(await colSel('selves_app', c), `app SELECT ${c}`).toBe(true);
    expect(await colSel('selves_app', 'created_at'), 'app SELECT created_at (not granted)').toBe(false);
    // app: no write on selves, nothing on accounts / auth tables
    const tbl = async (role: string, t: string, p: string) =>
      (await su.query('SELECT has_table_privilege($1, $2, $3) AS ok', [role, t, p])).rows[0].ok;
    expect(await tbl('selves_app', 'public.selves', 'INSERT')).toBe(false);
    expect(await tbl('selves_app', 'public.accounts', 'SELECT')).toBe(false);
    expect(await tbl('selves_app', 'auth.sessions', 'SELECT')).toBe(false);
    expect(await tbl('selves_app', 'auth.account_credentials', 'SELECT')).toBe(false);
    // bootstrap / operator hold no direct table DML anywhere in auth
    for (const role of ['selves_bootstrap', 'selves_operator', 'selves_worker']) {
      for (const t of ['auth.sessions', 'auth.account_credentials']) {
        for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          expect(await tbl(role, t, p), `${role} ${p} ${t}`).toBe(false);
        }
      }
    }
  });

  it('public still contains exactly the seven authoritative tables (auth is separate)', async () => {
    const { rows } = await su.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'pgmigrations' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'accounts', 'artifacts', 'key_grants', 'outbox_events', 'placement_recipients', 'placements', 'selves',
    ]);
  });
});
