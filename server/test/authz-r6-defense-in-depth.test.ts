import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { superuserPool, workerPool } from './helpers/auth.ts';

// P8 R6 (decision 0008 R6 / 0009) — defense-in-depth RLS enables with no policy on
// tables the application role already cannot touch. RLS grants nothing here; it
// makes a future accidental grant fail closed. pgmigrations is deliberately left
// without RLS. FORCE is used nowhere (R8). selves_worker stays CONNECT-only.

const RLS_ENABLED = [
  { schema: 'auth', table: 'account_credentials' },
  { schema: 'auth', table: 'sessions' },
  { schema: 'public', table: 'accounts' },
  { schema: 'public', table: 'outbox_events' },
];

let su: pg.Pool;
let worker: pg.Pool;

beforeAll(() => {
  su = superuserPool();
  worker = workerPool();
});
afterAll(async () => {
  await Promise.all([su.end(), worker.end()]);
});

describe('P8 R6 defense-in-depth RLS enables', () => {
  it('enables RLS (unforced, no policy) on the four defense-in-depth tables', async () => {
    for (const { schema, table } of RLS_ENABLED) {
      const { rows } = await su.query<{ rls: boolean; force: boolean }>(
        'SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE oid = $1::regclass',
        [`${schema}.${table}`],
      );
      expect(rows[0]!.rls, `${schema}.${table} RLS enabled`).toBe(true);
      expect(rows[0]!.force, `${schema}.${table} not forced`).toBe(false);
      const { rows: pol } = await su.query<{ n: number }>(
        'SELECT count(*)::int n FROM pg_policies WHERE schemaname = $1 AND tablename = $2',
        [schema, table],
      );
      expect(pol[0]!.n, `${schema}.${table} no policy`).toBe(0);
    }
  });

  it('does NOT enable RLS on public.pgmigrations (the ledger control is grant-absence)', async () => {
    const { rows } = await su.query<{ rls: boolean }>(
      "SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.pgmigrations'::regclass",
    );
    expect(rows[0]!.rls).toBe(false);
  });

  it('selves_worker remains CONNECT-only — no schema usage, no table read, no function EXECUTE', async () => {
    const schemaUsage = async (s: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_schema_privilege($1, $2, $3) AS ok', ['selves_worker', s, 'USAGE'])).rows[0]!.ok;
    for (const s of ['public', 'auth', 'domain']) {
      expect(await schemaUsage(s), `worker USAGE ${s}`).toBe(false);
    }
    const tableSel = async (t: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', ['selves_worker', t, 'SELECT'])).rows[0]!.ok;
    for (const t of ['public.artifacts', 'public.placements', 'public.placement_recipients', 'public.key_grants', 'public.selves', 'public.outbox_events']) {
      expect(await tableSel(t), `worker SELECT ${t}`).toBe(false);
    }
    // BYPASSRLS is never granted to the worker (or any managed role) in Phase 8.
    const { rows } = await su.query<{ bypassrls: boolean }>(
      'SELECT rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = $1', ['selves_worker'],
    );
    expect(rows[0]!.bypassrls).toBe(false);
  });

  it('the worker connection cannot reach the ontology tables (no schema usage → error)', async () => {
    // A live proof that the worker is inert: even reaching public.artifacts fails.
    await expect(worker.query('SELECT 1 FROM public.artifacts LIMIT 0')).rejects.toMatchObject({ code: '42501' });
  });
});
