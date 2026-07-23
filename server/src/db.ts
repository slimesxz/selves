// Runtime database access uses the least-privilege selves_app role. The app role
// holds no direct DML on the auth tables; every operation goes through the
// SECURITY DEFINER functions (owned by selves_owner) that enforce the write
// boundary and per-account serialization.
import pg from 'pg';

/** The subset of a pg Pool/Client the auth queries need — lets tests inject a pool. */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export function appPool(connectionString: string | undefined = process.env.APP_DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('APP_DATABASE_URL is not set');
  return new pg.Pool({ connectionString });
}

// A transaction-bound handle. Structurally identical to Queryable (a pg
// PoolClient satisfies it), but named separately to signal that the caller is
// inside an open transaction on a single dedicated connection — the invariant
// the Phase-5 decision-and-read linearization depends on.
export type Tx = Queryable;

// Runs a unit of work inside ONE request-local REPEATABLE READ transaction on a
// single connection. The AuthorizationService threads the supplied Tx through
// its predicate-input reads (Stage 1) and its protected read (Stage 3) so both
// observe one snapshot (decision record 0005). This is the ONLY place the raw
// pool is turned into a transaction; it lives in the db-access layer so the
// isolation level is not restated per call site.
export interface TxPool {
  withRepeatableRead<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function appTxPool(pool: pg.Pool): TxPool {
  return {
    async withRepeatableRead(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // A failed ROLLBACK (e.g. a dead connection) must not mask the
          // original error; the client is discarded on release below.
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
