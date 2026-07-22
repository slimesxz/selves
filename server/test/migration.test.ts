import { afterAll, describe, expect, it } from 'vitest';
import { testPool } from './helpers/db';

// Structural assertions on the schema the migrations build from zero.
const pool = testPool();
afterAll(async () => { await pool.end(); });

describe('schema structure (migrate from zero)', () => {
  it('creates exactly the seven authoritative tables', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name <> 'pgmigrations'
        ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'accounts',
      'artifacts',
      'key_grants',
      'outbox_events',
      'placement_recipients',
      'placements',
      'selves',
    ]);
  });

  it('freezes the payload_type enum to the five members (invariant 11)', async () => {
    const { rows } = await pool.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'payload_type' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual(['text', 'photo', 'poll', 'gift', 'key']);
  });

  it('defines placement_state with the four ratified states (invariant D1)', async () => {
    const { rows } = await pool.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'placement_state' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual(['draft', 'departing', 'settled', 'cancelled']);
  });

  it('has no Ring or Zone column anywhere (invariants 4 & 10)', async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (column_name ILIKE '%ring%' OR column_name ILIKE '%zone%')`,
    );
    expect(rows).toEqual([]);
  });

  it('has no Key expiration column (invariant 8)', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'key_grants'
        ORDER BY ordinal_position`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toEqual([
      'id',
      'grantor_self_id',
      'grantee_self_id',
      'protected_resource_id',
      'granted_at',
      'revoked_at',
    ]);
    expect(columns.some((c) => /expir|expire|ttl|valid_until/i.test(c))).toBe(false);
  });

  it('does not create projection tables in Phase 3', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('graph_edges', 'signals', 'prism_reflections')`,
    );
    expect(rows).toEqual([]);
  });
});
