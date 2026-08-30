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

// ── outbox-depth (P13-E, T4 operational visibility) ──────────────────────────
//
// Aggregate outbox condition, and nothing else. The authority boundary is
// proj.outbox_depth() — an owner-owned SECURITY DEFINER function returning
// three scalars (0011 containment ruling). The invoking principal is
// selves_worker, which already holds EXECUTE on it and which holds NO table
// privilege in any schema, no domain/auth EXECUTE, no acting-Self context and
// no membership: it is structurally incapable of reading an individual outbox
// row, a payload, a placement, a recipient, or an artifact.
//
// The statement below is FIXED. This module exposes no facility for supplying
// SQL, a function name, or a table name, so the caller cannot reach the other
// function the worker credential can execute (proj.process_outbox, which
// mutates). Authority is constrained by code even though the credential carries
// pre-existing worker authority.
//
// Age is derived numerically IN SQL rather than by parsing an interval's text
// form, so the result never depends on locale or on interval rendering. The
// database function is unchanged: no migration is warranted by a presentation
// concern.
const OUTBOX_DEPTH_SQL =
  'SELECT unclaimed, dead, ' +
  'CASE WHEN oldest_unclaimed_age IS NULL THEN NULL ' +
  'ELSE floor(extract(epoch FROM oldest_unclaimed_age))::bigint END AS oldest_seconds ' +
  'FROM proj.outbox_depth()';

export type OutboxDepthResult =
  | { status: 'observed'; unclaimed: number; dead: number; oldestUnclaimedAgeSeconds: number | null }
  // An observation that did not happen. NEVER rendered as zero backlog.
  | { status: 'error'; type: string; sqlstate?: string };

export async function outboxDepth(db: Queryable): Promise<OutboxDepthResult> {
  try {
    const { rows } = await db.query<{
      unclaimed: string | number;
      dead: string | number;
      oldest_seconds: string | number | null;
    }>(OUTBOX_DEPTH_SQL);
    const r = rows[0];
    if (!r) return { status: 'error', type: 'MalformedResult' };
    const unclaimed = Number(r.unclaimed);
    const dead = Number(r.dead);
    const oldest = r.oldest_seconds === null ? null : Number(r.oldest_seconds);
    // A shape we cannot trust is a failed observation, not a zero one.
    if (!Number.isFinite(unclaimed) || !Number.isFinite(dead) || (oldest !== null && !Number.isFinite(oldest))) {
      return { status: 'error', type: 'MalformedResult' };
    }
    return { status: 'observed', unclaimed, dead, oldestUnclaimedAgeSeconds: oldest };
  } catch (err) {
    // P13-D classification, not exception prose: a database error message can
    // carry row values, DEFINER context, or internal SQL.
    const e = err as { constructor?: { name?: string }; name?: string };
    const type = e?.constructor?.name ?? e?.name ?? 'Error';
    const s = sqlstate(err);
    return s ? { status: 'error', type, sqlstate: s } : { status: 'error', type };
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
