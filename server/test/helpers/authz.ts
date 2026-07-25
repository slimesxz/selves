import './env';
import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { appTestPool, superuserPool } from './auth.ts';
import { appTxPool } from '../../src/db.ts';
import { createAuthorizationService, type AuthorizationService, type ActingContext, type AccountContext } from '../../src/authz/service.ts';
import { createPredicatesRepo } from '../../src/authz/predicates.repo.ts';
import { createDomainRepo } from '../../src/authz/domain.repo.ts';
import { createMutationsRepo } from '../../src/authz/mutations.repo.ts';
import type { DecisionSink, Outcome } from '../../src/authz/reasons.ts';
import type { AccountId, SelfId } from '../../src/domain/ids.ts';
import type { PlacementState } from '../../src/domain/placement.ts';

// Wires the REAL AuthorizationService over a selves_app connection (appTestPool),
// exactly as production would compose it. Fixtures below use a superuser pool so
// they can create authoritative rows for test setup; they exercise the real
// state machine (no constraint is disabled or bypassed).

export interface AuthzHarness {
  service: AuthorizationService;
  appPool: pg.Pool;
  su: pg.Pool;
  end(): Promise<void>;
}

export function makeAuthz(sink?: DecisionSink): AuthzHarness {
  const appPool = appTestPool();
  const su = superuserPool();
  const service = createAuthorizationService({
    txPool: appTxPool(appPool),
    db: appPool,
    predicates: createPredicatesRepo(),
    domain: createDomainRepo(),
    mutations: createMutationsRepo(),
    ...(sink ? { sink } : {}),
  });
  return {
    service,
    appPool,
    su,
    async end() {
      await Promise.all([appPool.end(), su.end()]);
    },
  };
}

// P8 C3 harness adaptation (decision 0009 Option A / precedent-boundary note):
// supplies the newly-required acting-Self session context while preserving the
// already-ratified observable outcomes. A real auth.sessions row is provisioned per
// account (via the superuser, mirroring the existing su-backed fixtures) and the
// self→token-hash mapping lets actingCtx(self) present the REAL session-gated path
// to the service, so the reason-exactness test FILES are unchanged.
const _sessionTokenBySelf = new Map<string, Buffer>();
const _sessionTokenByAccount = new Map<string, Buffer>();

function freshTokenHash(): Buffer {
  return createHash('sha256').update(randomBytes(32)).digest();
}

/** Provision (once) a real live session for an account and return its token hash. */
export async function provisionSession(su: pg.Pool, accountId: string): Promise<Buffer> {
  const existing = _sessionTokenByAccount.get(accountId);
  if (existing) return existing;
  const th = freshTokenHash();
  await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [accountId, th]);
  _sessionTokenByAccount.set(accountId, th);
  return th;
}

// actingCtx(self) resolves the self's registered session token (fixtures register
// it). An explicit token may be supplied (the HTTP adapter passes the real cookie
// session). A self with no registered session yields an undefined token, which a
// real policed read fails closed on — a loud, correct failure.
export function actingCtx(selfId: string, sessionToken?: Buffer): ActingContext {
  return { actingSelf: selfId as SelfId, sessionToken: sessionToken ?? _sessionTokenBySelf.get(selfId) };
}

// Account-scoped context (the authenticated account), for set_departure_interval.
export function accountCtx(accountId: string): AccountContext {
  return { account: accountId as AccountId };
}

/** A sink that records every decision, for reason/ground assertions. */
export function capturingSink(): { sink: DecisionSink; events: { operation: string; outcome: Outcome<string> }[] } {
  const events: { operation: string; outcome: Outcome<string> }[] = [];
  return {
    sink: {
      onDecision(operation, outcome) {
        events.push({ operation, outcome });
      },
    },
    events,
  };
}

// ── domain fixtures (superuser; real state machine) ───────────────────────────

export async function newAccount(su: pg.Pool): Promise<string> {
  const { rows } = await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id');
  const id = rows[0]!.id;
  await provisionSession(su, id); // P8 C3: every fixture account gets a real live session
  return id;
}

export async function newSelf(su: pg.Pool, accountId: string, slot: number, name = `self-${slot}`): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, $2, $3) RETURNING id',
    [accountId, slot, name],
  );
  const id = rows[0]!.id;
  // Register this Self against its account's session so actingCtx(id) drives the
  // real session-gated context path (the account's session selects any of its Selves).
  _sessionTokenBySelf.set(id, await provisionSession(su, accountId));
  return id;
}

export async function newArtifact(su: pg.Pool, authorSelfId: string, body = 'hello'): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'text', $2) RETURNING id",
    [authorSelfId, body],
  );
  return rows[0]!.id;
}

/** Create a placement in the requested state, addressed to `recipients`.
 *  Recipients are attached while draft (as the freeze trigger requires), then
 *  the placement is advanced forward through the real state machine. */
export async function newPlacement(
  su: pg.Pool,
  opts: { sender: string; artifact: string; state: PlacementState; recipients?: string[] },
): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    'INSERT INTO public.placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id',
    [opts.sender, opts.artifact],
  );
  const id = rows[0]!.id;
  for (const r of opts.recipients ?? []) {
    await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [id, r]);
  }
  if (opts.state !== 'draft') {
    await su.query("UPDATE public.placements SET state = 'departing', departing_at = now() WHERE id = $1", [id]);
  }
  if (opts.state === 'settled') {
    await su.query("UPDATE public.placements SET state = 'settled', settled_at = now() WHERE id = $1", [id]);
  } else if (opts.state === 'cancelled') {
    await su.query("UPDATE public.placements SET state = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
  }
  return id;
}

/** Create a Key grant. `revoked: true` writes a historical revoked grant. */
export async function newKeyGrant(
  su: pg.Pool,
  opts: { grantor: string; grantee: string; resource: string; revoked?: boolean },
): Promise<void> {
  if (opts.revoked) {
    await su.query(
      `INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id, granted_at, revoked_at)
       VALUES ($1, $2, $3, now() - interval '1 hour', now())`,
      [opts.grantor, opts.grantee, opts.resource],
    );
  } else {
    await su.query(
      'INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES ($1, $2, $3)',
      [opts.grantor, opts.grantee, opts.resource],
    );
  }
}
