// The only session operations the app role can perform, each a call into an
// approved SECURITY DEFINER function. The app holds no direct table access, so
// it can neither enumerate session hashes nor revoke sessions it does not hold.
import type { Queryable } from '../db.ts';

// SQLSTATE raised by auth.issue_session when the credential is absent/disabled.
const INVALID_AUTHORIZATION = '28000';

/** Verify a presented session token. Returns the account id, or null if the
 *  session is absent, revoked, or expired (uniform — no oracle). */
export async function authenticateSession(db: Queryable, tokenHash: Buffer): Promise<string | null> {
  const { rows } = await db.query<{ account: string | null }>(
    'SELECT auth.authenticate_session($1) AS account',
    [tokenHash],
  );
  return rows[0]?.account ?? null;
}

/** Issue a session for a presented credential hash. Returns the session id, or
 *  null when the credential is not currently active (login failure). */
export async function issueSession(
  db: Queryable,
  credentialHash: Buffer,
  tokenHash: Buffer,
): Promise<string | null> {
  try {
    const { rows } = await db.query<{ id: string }>(
      'SELECT auth.issue_session($1, $2) AS id',
      [credentialHash, tokenHash],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    if ((err as { code?: string }).code === INVALID_AUTHORIZATION) return null;
    throw err;
  }
}

/** Revoke the session bearing this token hash. Idempotent; the count is never
 *  surfaced to the client. */
export async function revokeSession(db: Queryable, tokenHash: Buffer): Promise<void> {
  await db.query('SELECT auth.revoke_session($1)', [tokenHash]);
}

/** Is this Self owned by this account? Checked against the authoritative store on
 *  every protected Self-scoped request — a prior success is never standing auth. */
export async function selfOwnedByAccount(db: Queryable, selfId: string, account: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 AS ok FROM public.selves WHERE id = $1 AND account_id = $2', [selfId, account]);
  return rows.length > 0;
}

export interface SelfSummary {
  id: string;
  name: string;
  slot: number;
}

/** The account's own Selves, deterministically ordered by slot. Supports the
 *  ratified Self switcher. Account-scoped: no acting-Self context required. */
export async function listSelves(db: Queryable, account: string): Promise<SelfSummary[]> {
  const { rows } = await db.query<{ id: string; name: string; self_slot: number }>(
    'SELECT id, name, self_slot FROM public.selves WHERE account_id = $1 ORDER BY self_slot',
    [account],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, slot: r.self_slot }));
}
