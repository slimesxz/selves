import './env';
import pg from 'pg';
import type { Pool } from 'pg';
import { expect } from 'vitest';

// Postgres SQLSTATE codes asserted by the invariant tests.
export const PG = {
  notNull: '23502',
  foreignKey: '23503',
  unique: '23505',
  check: '23514', // CHECK constraints AND our trigger RAISEs (ERRCODE check_violation)
} as const;

export function testPool(): Pool {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is not set');
  return new pg.Pool({ connectionString });
}

const ALL_TABLES =
  'accounts, selves, artifacts, placements, placement_recipients, key_grants, outbox_events';

export async function resetTables(pool: Pool): Promise<void> {
  // TRUNCATE bypasses row-level triggers, so the immutability guards do not
  // block test cleanup. CASCADE + one statement handles the FK ordering.
  await pool.query(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
}

// Assert a query rejects with a specific Postgres SQLSTATE.
export async function expectPgError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect((err as { code?: string }).code, `expected SQLSTATE ${code}`).toBe(code);
    return;
  }
  throw new Error(`expected the query to be rejected with SQLSTATE ${code}, but it succeeded`);
}

// ── Minimal fixture builders (return the new row id). ────────────────────────

export async function newAccount(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO accounts DEFAULT VALUES RETURNING id',
  );
  return rows[0]!.id;
}

export async function newSelf(
  pool: Pool,
  accountId: string,
  slot: number,
  name = `self-${slot}`,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO selves (account_id, self_slot, name) VALUES ($1, $2, $3) RETURNING id',
    [accountId, slot, name],
  );
  return rows[0]!.id;
}

export async function newTextArtifact(
  pool: Pool,
  authorSelfId: string,
  body = 'hello',
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'text', $2) RETURNING id",
    [authorSelfId, body],
  );
  return rows[0]!.id;
}

export async function newDraftPlacement(
  pool: Pool,
  senderSelfId: string,
  artifactId: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'INSERT INTO placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id',
    [senderSelfId, artifactId],
  );
  return rows[0]!.id;
}
