// Operator command core (no I/O, no TTY): each function calls exactly one
// approved SECURITY DEFINER function through a least-privilege role connection
// and classifies the outcome. The CLIs wrap these with argument parsing, the
// interactive-only guard, and secret display.
import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../db.ts';

export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}
function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

// A PostgreSQL SQLSTATE is a 5-char code. Its presence means the server sent an
// ErrorResponse and the implicit transaction rolled back (acknowledged failure).
// Its absence (connection/ack failure) means the commit outcome is unknown.
function sqlstate(err: unknown): string | undefined {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Za-z]{5}$/.test(code) ? code : undefined;
}

// ── enroll ───────────────────────────────────────────────────────────────────
export type EnrollResult =
  | { status: 'committed'; accountId: string; selfId: string; credentialId: string; secret: string }
  | { status: 'db_failure'; sqlstate: string }
  | { status: 'ambiguous'; accountRef: string };

/** Enroll account + slot-1 Self + first credential in one autocommit statement.
 *  The secret is returned ONLY on acknowledged commit — never for db_failure or
 *  ambiguous, so nothing downstream can display it before commit. */
export async function enrollAccount(db: Queryable, opts: { accountRef: string; name: string }): Promise<EnrollResult> {
  const secret = newSecret();
  try {
    const { rows } = await db.query<{ account_id: string; self_id: string; credential_id: string }>(
      'SELECT * FROM auth.enroll_account($1, $2, $3)',
      [opts.accountRef, opts.name, sha256(secret)],
    );
    const r = rows[0]!;
    return { status: 'committed', accountId: r.account_id, selfId: r.self_id, credentialId: r.credential_id, secret };
  } catch (err) {
    const s = sqlstate(err);
    return s ? { status: 'db_failure', sqlstate: s } : { status: 'ambiguous', accountRef: opts.accountRef };
  }
}

// ── add-self (P10-S5 operator provisioning; 0012 §39) ────────────────────────
// Trusted operator tooling only: the authoritative write is the ratified
// auth.add_self DEFINER function — never a direct INSERT here, and never over
// selves_app credentials. Slot validity and name presence stay schema-owned;
// this layer parses and passes through, and maps only the two ruled classes.
export type AddSelfResult =
  | { status: 'added'; selfId: string }
  | { status: 'not_found' }      // PT404: no such account (never created here)
  | { status: 'slot_occupied' }  // PT409: incumbent Self untouched
  | { status: 'error'; sqlstate?: string };

export async function addSelf(
  db: Queryable,
  opts: { account: string; slot: number; name: string },
): Promise<AddSelfResult> {
  try {
    const { rows } = await db.query<{ id: string }>(
      'SELECT auth.add_self($1, $2, $3) AS id',
      [opts.account, opts.slot, opts.name],
    );
    return { status: 'added', selfId: rows[0]!.id };
  } catch (err) {
    const s = sqlstate(err);
    if (s === 'PT404') return { status: 'not_found' };
    if (s === 'PT409') return { status: 'slot_occupied' };
    return s ? { status: 'error', sqlstate: s } : { status: 'error' };
  }
}

// ── rotate (compare-and-swap) ────────────────────────────────────────────────
export type RotateResult =
  | { status: 'rotated'; credentialId: string; secret: string }
  | { status: 'stale' }         // 40001: active credential changed; NOT retried
  | { status: 'not_found' }     // P0002
  | { status: 'error'; sqlstate?: string };

export async function rotateCredential(db: Queryable, opts: { account: string; expectedActiveId: string }): Promise<RotateResult> {
  const secret = newSecret();
  try {
    const { rows } = await db.query<{ id: string }>(
      'SELECT auth.rotate_credential($1, $2, $3) AS id',
      [opts.account, opts.expectedActiveId, sha256(secret)],
    );
    return { status: 'rotated', credentialId: rows[0]!.id, secret };
  } catch (err) {
    const s = sqlstate(err);
    if (s === '40001') return { status: 'stale' };
    if (s === 'P0002') return { status: 'not_found' };
    return s ? { status: 'error', sqlstate: s } : { status: 'error' };
  }
}

// ── recover (ambiguous-enrollment recovery) ──────────────────────────────────
export type RecoverResult =
  | { status: 'recovered'; credentialId: string; secret: string }  // enrollment DID commit
  | { status: 'not_committed' }                                    // P0002: no such account
  | { status: 'ineligible'; sqlstate: string }                     // 23514: not exactly one active credential
  | { status: 'error'; sqlstate?: string };

export async function recoverEnrollment(db: Queryable, opts: { account: string }): Promise<RecoverResult> {
  const secret = newSecret();
  try {
    const { rows } = await db.query<{ id: string }>(
      'SELECT auth.recover_enrollment_credential($1, $2) AS id',
      [opts.account, sha256(secret)],
    );
    return { status: 'recovered', credentialId: rows[0]!.id, secret };
  } catch (err) {
    const s = sqlstate(err);
    if (s === 'P0002') return { status: 'not_committed' };
    if (s === '23514') return { status: 'ineligible', sqlstate: s };
    return s ? { status: 'error', sqlstate: s } : { status: 'error' };
  }
}

// ── contain (compromise containment) ─────────────────────────────────────────
export type ContainResult =
  | { status: 'contained'; credentialsDisabled: number; sessionsRevoked: number; alreadyContained: boolean }
  | { status: 'not_found' }     // P0002 — never reported as success
  | { status: 'error'; sqlstate?: string };

export async function containAccount(db: Queryable, account: string): Promise<ContainResult> {
  try {
    const { rows } = await db.query<{ credentials_disabled: number; sessions_revoked: number; already_contained: boolean }>(
      'SELECT * FROM auth.contain_account($1)',
      [account],
    );
    const r = rows[0]!;
    return {
      status: 'contained',
      credentialsDisabled: r.credentials_disabled,
      sessionsRevoked: r.sessions_revoked,
      alreadyContained: r.already_contained,
    };
  } catch (err) {
    const s = sqlstate(err);
    if (s === 'P0002') return { status: 'not_found' };
    return s ? { status: 'error', sqlstate: s } : { status: 'error' };
  }
}
