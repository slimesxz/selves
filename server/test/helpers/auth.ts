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

/** Add another Self to an account (superuser; test-only — self creation is a
 *  future phase). Returns the new Self id. */
export async function addSelf(su: pg.Pool, accountId: string, slot: number, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, $2, $3) RETURNING id',
    [accountId, slot, name],
  );
  return rows[0]!.id;
}

/** Reassign a Self to another account — a constraint-legal ownership change used
 *  to prove a prior ownership check never becomes standing authorization. */
export async function reassignSelf(su: pg.Pool, selfId: string, newAccountId: string): Promise<void> {
  await su.query('UPDATE public.selves SET account_id = $1 WHERE id = $2', [newAccountId, selfId]);
}

/** A fresh account with no Selves (superuser). */
export async function newEmptyAccount(su: pg.Pool): Promise<string> {
  const { rows } = await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id');
  return rows[0]!.id;
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
