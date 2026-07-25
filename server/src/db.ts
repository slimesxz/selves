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
  /** One request-local REPEATABLE READ transaction on a single connection — for
   *  the read path (Stage-1 predicate reads + Stage-3 protected read share one
   *  snapshot). The caller establishes C3 context as the first statement. */
  withRepeatableRead<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** One request-local READ COMMITTED transaction on a single connection — for the
   *  mutation path (P8 L). READ COMMITTED (not REPEATABLE READ) so the DEFINER
   *  functions' SELECT ... FOR UPDATE block-and-re-read rather than raise a
   *  serialization error. The caller establishes C3 context as the first statement,
   *  so the mutation derives its acting Self from authenticated context on the same
   *  backend and transaction. */
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function appTxPool(pool: pg.Pool): TxPool {
  const run = async <T>(begin: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query(begin);
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
  };
  return {
    withRepeatableRead: (fn) => run('BEGIN ISOLATION LEVEL REPEATABLE READ', fn),
    withTransaction: (fn) => run('BEGIN', fn),
  };
}
