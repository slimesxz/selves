// P9-E — the projection worker's OWN database module (decision 0011 Q10).
//
// The worker is a separate process with its own credential: it connects as
// selves_worker via WORKER_DATABASE_URL and NOTHING ELSE. This module follows
// the operator/cli.ts precedent — a non-server principal with its own db module
// — and is the single chamber-authorized addition to the pg-importer positive
// lock. It never resolves the application credential (asserted by test), and
// the worker tree never value-imports db.ts or any authz module.
import pg from 'pg';

export function workerPool(connectionString: string | undefined = process.env.WORKER_DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('WORKER_DATABASE_URL is not set');
  return new pg.Pool({ connectionString });
}
