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
