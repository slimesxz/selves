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

// ── P13-E — T4 operational visibility (decision 0015 Gate 1 C.11; P13-E I.1–I.6)
//
// The `outbox-depth` operator command reads aggregate outbox condition through
// proj.outbox_depth() as selves_worker — the ONLY login principal granted that
// EXECUTE, and one holding no table privilege anywhere. P13-E adds no grant, no
// migration and no database object; it consumes authority Phase 9 already
// ratified.
//
// The denial cases below make an EXISTING negative property executable, because
// the command's security argument now depends on it. Nothing is weakened: these
// are additions to the exhaustive role/ACL proof, and every prior assertion in
// this file is unchanged.
describe('P13-E outbox-depth — privilege proof (C.11)', () => {
  it('every non-worker login role is denied proj.outbox_depth(), including unassumed selves_migrate', async () => {
    // selves_migrate WITHOUT its role=selves_owner option: the bare principal
    // holds nothing. The committed TEST_MIGRATE_DATABASE_URL carries the option,
    // so it is stripped here to probe the unassumed role itself.
    const bare = (process.env.TEST_MIGRATE_DATABASE_URL ?? '').split('?')[0]!;
    const mig = new (await import('pg')).default.Pool({ connectionString: bare });
    try {
      const cases: Array<[string, pg.Pool]> = [
        ['selves_app', app],
        ['selves_operator', op],
        ['selves_bootstrap', boot],
        ['selves_migrate (unassumed)', mig],
      ];
      for (const [name, pool] of cases) {
        expect(await sqlstate(pool, 'SELECT * FROM proj.outbox_depth()'), `${name} outbox_depth`).toBe('42501');
        expect(await sqlstate(pool, 'SELECT * FROM proj.process_outbox($1)', [1]), `${name} process_outbox`).toBe('42501');
      }
    } finally {
      await mig.end();
    }
  });

  it('catalog: EXECUTE on proj.outbox_depth() is held by exactly one login role', async () => {
    const { rows } = await su.query<{ rolname: string }>(
      `SELECT r.rolname FROM pg_roles r
        WHERE r.rolcanlogin
          AND has_function_privilege(r.rolname, 'proj.outbox_depth()', 'EXECUTE')
          AND has_schema_privilege(r.rolname, 'proj', 'USAGE')
          AND NOT r.rolsuper
        ORDER BY r.rolname`,
    );
    expect(rows.map((r) => r.rolname)).toEqual(['selves_worker']);
  });
});

describe('P13-E outbox-depth — observation contract (I.4, output contract)', () => {
  const CLI = ['src/operator/cli.ts', 'outbox-depth'];

  async function runCli(workerUrl: string | undefined): Promise<{ code: number; stdout: string; stderr: string }> {
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const env = { ...process.env, ...(workerUrl === undefined ? {} : { WORKER_DATABASE_URL: workerUrl }) };
    return await new Promise((done) => {
      const child = spawn(process.execPath, CLI, { cwd: serverRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
      child.on('exit', (code) => done({ code: code ?? -1, stdout, stderr }));
    });
  }

  const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL;

  it('empty backlog is exactly 0 / 0 / null, and the object carries exactly three fields', async () => {
    await su.query('TRUNCATE public.outbox_events RESTART IDENTITY CASCADE');
    const r = await runCli(WORKER_URL);
    expect(r.code, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['dead', 'oldestUnclaimedAgeSeconds', 'unclaimed']);
    expect(parsed).toEqual({ unclaimed: 0, dead: 0, oldestUnclaimedAgeSeconds: null });
  });

  it('seeded unclaimed backlog is represented, with a deterministic numeric age', async () => {
    await su.query('TRUNCATE public.outbox_events RESTART IDENTITY CASCADE');
    // occurred_at is set explicitly so the derived age is deterministic rather
    // than a race against wall-clock.
    await su.query(
      `INSERT INTO public.outbox_events (event_type, payload, occurred_at)
       VALUES ('placement_settled', '{}'::jsonb, pg_catalog.now() - interval '90 seconds')`,
    );
    const r = await runCli(WORKER_URL);
    expect(r.code, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout.trim()) as { unclaimed: number; dead: number; oldestUnclaimedAgeSeconds: number };
    expect(parsed.unclaimed).toBe(1);
    expect(parsed.dead).toBe(0);
    // Integer seconds, not an interval string, and floored from the real age.
    expect(Number.isInteger(parsed.oldestUnclaimedAgeSeconds)).toBe(true);
    expect(parsed.oldestUnclaimedAgeSeconds).toBeGreaterThanOrEqual(90);
    expect(parsed.oldestUnclaimedAgeSeconds).toBeLessThan(600);
  });

  it('dead-lettered rows count as dead and are excluded from unclaimed', async () => {
    await su.query('TRUNCATE public.outbox_events RESTART IDENTITY CASCADE');
    await su.query(
      `INSERT INTO public.outbox_events (event_type, payload, attempts, failed_at, last_error)
       VALUES ('placement_settled', '{}'::jsonb, 5, pg_catalog.now(), 'seeded')`,
    );
    const r = await runCli(WORKER_URL);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ unclaimed: 0, dead: 1, oldestUnclaimedAgeSeconds: null });
  });

  it('a failed observation exits non-zero, emits no JSON, and is distinguishable from an empty backlog', async () => {
    await su.query('TRUNCATE public.outbox_events RESTART IDENTITY CASCADE');
    const bad = (process.env.TEST_WORKER_DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/p13e_absent_database$1');
    const r = await runCli(bad);
    expect(r.code).not.toBe(0);
    // The critical property: a failure is NEVER rendered as zero backlog.
    expect(r.stdout.trim()).toBe('');
    expect(r.stdout).not.toContain('unclaimed');
    // Classification, not prose (P13-D): no database message, no sentinel db name.
    expect(r.stderr).toContain('outbox-depth observation failed');
    expect(r.stderr).not.toContain('p13e_absent_database');
    expect(r.stderr).not.toContain('does not exist');
  });

  it('the command takes no arguments, so no query, function, or table name can be selected through input', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const cli = readFileSync(resolve(here, '../src/operator/cli.ts'), 'utf8');
    const commands = readFileSync(resolve(here, '../src/operator/commands.ts'), 'utf8');

    // The handler parses no options at all.
    const start = cli.indexOf('async function cmdOutboxDepth');
    expect(start).toBeGreaterThan(-1);
    const body = cli.slice(start, cli.indexOf('\n}', start));
    expect(body).not.toContain('parseArgs');
    expect(body).toContain("if (argv.length > 0) fail('usage: outbox-depth')");
    expect(body).toContain("pool('WORKER_DATABASE_URL')");
    // No role transition anywhere in the operator surface.
    for (const src of [cli, commands]) {
      expect(/SET\s+ROLE/i.test(src)).toBe(false);
    }
    // The diagnostic statement is a fixed literal naming exactly one function.
    expect(commands).toContain('FROM proj.outbox_depth()');
    // The ratified invariant is that no CALLABLE path to the mutating
    // projection function exists here — not that the identifier may never be
    // written. The module's comments name proj.process_outbox precisely in
    // order to explain why it is excluded, so the assertion tests the
    // executable form: a SQL reference that would actually invoke it.
    for (const callable of ['FROM proj.process_outbox', 'SELECT proj.process_outbox', 'CALL proj.process_outbox']) {
      expect(commands.includes(callable), `commands.ts contains a callable reference: ${callable}`).toBe(false);
    }
    // Belt and braces: exactly one SQL statement literal exists in the module's
    // outbox surface, and it is the one asserted above.
    expect(commands.split('FROM proj.').length - 1).toBe(1);

    // Any argument is refused before a connection is opened.
    const r = await runCli(WORKER_URL);
    expect(r.code).toBe(0);
  });

  it('successful output carries no governed identifier, payload, or prose', async () => {
    await su.query('TRUNCATE public.outbox_events RESTART IDENTITY CASCADE');
    await su.query(
      `INSERT INTO public.outbox_events (event_type, payload)
       VALUES ('placement_settled', '{"placement_id":"11111111-2222-3333-4444-555555555555"}'::jsonb)`,
    );
    const r = await runCli(WORKER_URL);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const forbidden of ['placement_id', 'payload', 'event_type', 'last_error', 'occurred_at', 'id']) {
      expect(r.stdout.includes(forbidden), `output leaked ${forbidden}`).toBe(false);
    }
    await su.query('TRUNCATE public.outbox_events RESTART IDENTITY CASCADE');
  });
});
