import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, bootstrapPool, operatorPool, workerPool, superuserPool } from './helpers/auth.ts';
import { workerPool as workerDbModulePool } from '../src/worker/db.ts';

// P9-F — worker-role containment and new-table RLS/privilege posture (decision
// 0011 Q12, containment ruling; 0008 R6 pattern extended to proj.graph_edges).
//
// selves_worker's reach is EXACTLY: USAGE on proj + EXECUTE on
// proj.process_outbox(integer) and proj.outbox_depth(), both returning scalars.
// A compromised worker credential can process the queue — nothing else: it
// cannot read or write any table directly, cannot call any domain/auth
// function, cannot establish acting-Self context, and cannot invoke the
// destructive rebuild. Every new table denies every non-owner role.

let app: pg.Pool;
let wk: pg.Pool;
let boot: pg.Pool;
let op: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  app = appTestPool();
  wk = workerPool();
  boot = bootstrapPool();
  op = operatorPool();
  su = superuserPool();
});
afterAll(async () => {
  await Promise.all([app.end(), wk.end(), boot.end(), op.end(), su.end()]);
});

async function sqlstate(pool: pg.Pool, text: string, values: unknown[] = []): Promise<string | undefined> {
  try {
    await pool.query(text, values);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

const ALL_TABLES = [
  'public.accounts',
  'public.selves',
  'public.artifacts',
  'public.placements',
  'public.placement_recipients',
  'public.key_grants',
  'public.outbox_events',
  'proj.graph_edges',
  'auth.sessions',
  'auth.account_credentials',
  'domain.acting_self_context',
];

describe('P9 worker attack suite — direct table access denied everywhere', () => {
  it('selves_worker cannot SELECT, INSERT, or DELETE on any table in any schema (42501)', async () => {
    for (const t of ALL_TABLES) {
      expect(await sqlstate(wk, `SELECT count(*) FROM ${t}`), `SELECT ${t}`).toBe('42501');
      expect(await sqlstate(wk, `INSERT INTO ${t} DEFAULT VALUES`), `INSERT ${t}`).toBe('42501');
      expect(await sqlstate(wk, `DELETE FROM ${t}`), `DELETE ${t}`).toBe('42501');
    }
  });

  it('selves_worker cannot call domain or auth functions, cannot establish context, cannot rebuild (42501)', async () => {
    const denied: [string, unknown[]][] = [
      ['SELECT domain.set_acting_self($1, $2)', [Buffer.alloc(32), '00000000-0000-0000-0000-000000000000']],
      ['SELECT domain.current_acting_self()', []],
      ['SELECT domain.settle_placement($1)', ['00000000-0000-0000-0000-000000000000']],
      ['SELECT domain.create_artifact($1)', ['x']],
      ['SELECT domain.revoke_key($1, $2)', ['00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000']],
      ['SELECT auth.authenticate_session($1)', [Buffer.alloc(32)]],
      ['SELECT proj.rebuild_graph()', []],
    ];
    for (const [text, values] of denied) {
      expect(await sqlstate(wk, text, values), text).toBe('42501');
    }
  });

  it('the ruled worker surface works and returns scalars only', async () => {
    const pass = await wk.query('SELECT * FROM proj.process_outbox($1)', [5]);
    expect(Object.keys(pass.rows[0]!).sort()).toEqual(['failed', 'processed']);
    const depth = await wk.query('SELECT * FROM proj.outbox_depth()');
    expect(Object.keys(depth.rows[0]!).sort()).toEqual(['dead', 'oldest_unclaimed_age', 'unclaimed']);
  });

  it('process_outbox rejects a non-positive limit (PT400); the threshold is not caller-suppliable', async () => {
    expect(await sqlstate(wk, 'SELECT * FROM proj.process_outbox($1)', [0])).toBe('PT400');
    expect(await sqlstate(wk, 'SELECT * FROM proj.process_outbox($1)', [null])).toBe('PT400');
    // The EXECUTE surface has exactly one IN parameter (p_limit): a two-argument
    // call does not resolve to any function (B.5 — no caller-suppliable threshold).
    expect(await sqlstate(wk, 'SELECT * FROM proj.process_outbox($1, $2)', [5, 99])).toBe('42883');
  });
});

describe('P9 new-table posture — every non-owner role denied (R6 pattern)', () => {
  it('proj.graph_edges and public.outbox_events deny app, worker, bootstrap, and operator (42501)', async () => {
    const roles: [string, pg.Pool][] = [
      ['selves_app', app],
      ['selves_worker', wk],
      ['selves_bootstrap', boot],
      ['selves_operator', op],
    ];
    for (const [name, pool] of roles) {
      for (const t of ['proj.graph_edges', 'public.outbox_events']) {
        expect(await sqlstate(pool, `SELECT count(*) FROM ${t}`), `${name} SELECT ${t}`).toBe('42501');
        expect(await sqlstate(pool, `INSERT INTO ${t} DEFAULT VALUES`), `${name} INSERT ${t}`).toBe('42501');
        expect(await sqlstate(pool, `DELETE FROM ${t}`), `${name} DELETE ${t}`).toBe('42501');
      }
    }
  });

  it('catalog facts: RLS enabled with zero policies on graph_edges; worker EXECUTE surface is exactly two functions', async () => {
    const { rows: rls } = await su.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'proj' AND c.relname = 'graph_edges'`,
    );
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    const { rows: pol } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'proj' AND tablename = 'graph_edges'",
    );
    expect(pol[0]!.n).toBe(0);

    const { rows: acl } = await su.query<{ ok: boolean; depth: boolean; rebuild: boolean; usage: boolean; tbl: boolean }>(
      `SELECT has_function_privilege('selves_worker', 'proj.process_outbox(integer)', 'EXECUTE') AS ok,
              has_function_privilege('selves_worker', 'proj.outbox_depth()', 'EXECUTE') AS depth,
              has_function_privilege('selves_worker', 'proj.rebuild_graph()', 'EXECUTE') AS rebuild,
              has_schema_privilege('selves_worker', 'proj', 'USAGE') AS usage,
              has_table_privilege('selves_worker', 'proj.graph_edges', 'SELECT') AS tbl`,
    );
    expect(acl[0]).toEqual({ ok: true, depth: true, rebuild: false, usage: true, tbl: false });

    // rebuild_graph is granted to NO login role (Q12).
    for (const role of ['selves_app', 'selves_bootstrap', 'selves_operator', 'selves_migrate']) {
      const { rows } = await su.query<{ x: boolean }>(
        `SELECT has_function_privilege($1, 'proj.rebuild_graph()', 'EXECUTE') AS x`,
        [role],
      );
      expect(rows[0]!.x, `${role} EXECUTE rebuild_graph`).toBe(false);
    }
  });

  it('selves_worker remains NOSUPERUSER / NOBYPASSRLS / no memberships', async () => {
    const { rows } = await su.query<{ rolsuper: boolean; rolbypassrls: boolean; memberships: number }>(
      `SELECT r.rolsuper, r.rolbypassrls,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS memberships
         FROM pg_roles r WHERE r.rolname = 'selves_worker'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, memberships: 0 });
  });
});

describe('P9 worker db module — WORKER_DATABASE_URL only', () => {
  it('fails closed when WORKER_DATABASE_URL is unset, even with the app credential present', () => {
    const saved = process.env.WORKER_DATABASE_URL;
    delete process.env.WORKER_DATABASE_URL;
    try {
      expect(() => workerDbModulePool()).toThrow('WORKER_DATABASE_URL is not set');
    } finally {
      if (saved !== undefined) process.env.WORKER_DATABASE_URL = saved;
    }
  });
});
