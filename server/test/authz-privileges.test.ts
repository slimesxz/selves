import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, superuserPool } from './helpers/auth.ts';
import { expectPgError } from './helpers/db.ts';

// P5-B — the EXACT selves_app read-privilege matrix (Gate 1 §13, invariant 16).
// Asserted two ways: (1) the catalog ACL, column by column, for every domain
// table — granted columns present, every other column absent, no table-level
// over-grant; (2) live probes as selves_app proving withheld key_grants columns
// fail with 42501.

// The exact approved column grants (decision record 0005 / P5-B migration).
const GRANTED: Record<string, string[]> = {
  artifacts: ['id', 'author_self_id', 'payload_type', 'text_body', 'created_at'],
  placements: ['id', 'sender_self_id', 'artifact_id', 'state', 'created_at', 'departing_at', 'settled_at', 'cancelled_at'],
  placement_recipients: ['placement_id', 'recipient_self_id', 'added_at'],
  key_grants: ['grantee_self_id', 'protected_resource_id', 'revoked_at'],
  // pre-existing (Phase 4), asserted here for completeness of the matrix.
  selves: ['id', 'account_id', 'name', 'self_slot'],
};
// Tables selves_app must hold NOTHING on.
const NO_ACCESS_TABLES = ['accounts', 'outbox_events'];

let su: pg.Pool;
let app: pg.Pool;

beforeAll(() => {
  su = superuserPool();
  app = appTestPool();
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function colPriv(role: string, table: string, col: string): Promise<boolean> {
  const { rows } = await su.query('SELECT has_column_privilege($1, $2, $3, $4) AS ok', [role, `public.${table}`, col, 'SELECT']);
  return rows[0]!.ok as boolean;
}
async function tablePriv(role: string, table: string, priv: string): Promise<boolean> {
  const { rows } = await su.query('SELECT has_table_privilege($1, $2, $3) AS ok', [role, `public.${table}`, priv]);
  return rows[0]!.ok as boolean;
}
async function anyColPriv(role: string, table: string): Promise<boolean> {
  const { rows } = await su.query('SELECT has_any_column_privilege($1, $2, $3) AS ok', [role, `public.${table}`, 'SELECT']);
  return rows[0]!.ok as boolean;
}
async function allColumns(table: string): Promise<string[]> {
  const { rows } = await su.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

describe('P5-B exact selves_app read-privilege matrix', () => {
  it('grants EXACTLY the approved columns on each domain table, and no others', async () => {
    for (const [table, granted] of Object.entries(GRANTED)) {
      const cols = await allColumns(table);
      expect(cols.length, `${table} has columns`).toBeGreaterThan(0);
      for (const col of cols) {
        const expected = granted.includes(col);
        expect(await colPriv('selves_app', table, col), `selves_app SELECT ${table}.${col}`).toBe(expected);
      }
    }
  });

  it('withholds id, grantor_self_id, and granted_at on key_grants', async () => {
    for (const col of ['id', 'grantor_self_id', 'granted_at']) {
      expect(await colPriv('selves_app', 'key_grants', col), `key_grants.${col} withheld`).toBe(false);
    }
  });

  it('confers no table-level SELECT and no write on the domain tables (column grants only)', async () => {
    for (const table of Object.keys(GRANTED)) {
      expect(await tablePriv('selves_app', table, 'SELECT'), `${table} table-level SELECT`).toBe(false);
      for (const w of ['INSERT', 'UPDATE', 'DELETE']) {
        expect(await tablePriv('selves_app', table, w), `${table} ${w}`).toBe(false);
      }
    }
  });

  it('holds nothing at all on accounts and outbox_events', async () => {
    for (const table of NO_ACCESS_TABLES) {
      expect(await anyColPriv('selves_app', table), `${table} any-column SELECT`).toBe(false);
      expect(await tablePriv('selves_app', table, 'SELECT'), `${table} table SELECT`).toBe(false);
    }
  });

  it('live: selves_app can read the granted columns', async () => {
    // LIMIT 0 — we assert privilege, not data.
    await app.query('SELECT id, author_self_id, payload_type, text_body, created_at FROM public.artifacts LIMIT 0');
    await app.query('SELECT id, sender_self_id, artifact_id, state, created_at, departing_at, settled_at, cancelled_at FROM public.placements LIMIT 0');
    await app.query('SELECT placement_id, recipient_self_id, added_at FROM public.placement_recipients LIMIT 0');
    await app.query('SELECT grantee_self_id, protected_resource_id, revoked_at FROM public.key_grants LIMIT 0');
  });

  it('live: selves_app is denied (42501) on withheld key_grants columns and on ungranted tables', async () => {
    await expectPgError(() => app.query('SELECT granted_at FROM public.key_grants'), '42501');
    await expectPgError(() => app.query('SELECT grantor_self_id FROM public.key_grants'), '42501');
    await expectPgError(() => app.query('SELECT id FROM public.key_grants'), '42501');
    await expectPgError(() => app.query('SELECT * FROM public.key_grants'), '42501'); // * spans withheld columns
    await expectPgError(() => app.query('SELECT * FROM public.accounts'), '42501');
    await expectPgError(() => app.query('SELECT * FROM public.outbox_events'), '42501');
  });
});
