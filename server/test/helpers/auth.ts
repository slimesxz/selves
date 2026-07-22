import './env';
import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

// Test helpers for the Phase-4 auth flow. Each role connects via its own
// TEST_*_DATABASE_URL so the privilege boundary is exercised as in production.

export function bootstrapPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env.TEST_BOOTSTRAP_DATABASE_URL });
}
export function appTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env.TEST_APP_DATABASE_URL });
}
export function operatorPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env.TEST_OPERATOR_DATABASE_URL });
}
export function workerPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env.TEST_WORKER_DATABASE_URL });
}
export function superuserPool(): pg.Pool {
  return new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
}

export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}
export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

export interface Enrolled {
  accountId: string;
  selfId: string;
  credentialId: string;
  secret: string;
}

/** Enroll a fresh account (+ slot-1 Self + first credential) via the bootstrap
 *  role's approved function. Returns ids and the raw secret. */
export async function enroll(
  bootstrap: pg.Pool,
  opts: { accountId?: string; name?: string; secret?: string } = {},
): Promise<Enrolled> {
  const accountId = opts.accountId ?? randomUUID();
  const name = opts.name ?? 'test-self';
  const secret = opts.secret ?? randomSecret();
  const { rows } = await bootstrap.query<{ account_id: string; self_id: string; credential_id: string }>(
    'SELECT * FROM auth.enroll_account($1, $2, $3)',
    [accountId, name, sha256(secret)],
  );
  const r = rows[0]!;
  return { accountId: r.account_id, selfId: r.self_id, credentialId: r.credential_id, secret };
}

/** Extract a Set-Cookie value for a given cookie name from an inject() response. */
export function cookieFromSetCookie(setCookie: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const h of headers) {
    const m = h.match(new RegExp(`^${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  return undefined;
}
