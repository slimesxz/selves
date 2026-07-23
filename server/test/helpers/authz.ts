import './env';
import pg from 'pg';
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

export function actingCtx(selfId: string): ActingContext {
  return { actingSelf: selfId as SelfId };
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
  return rows[0]!.id;
}

export async function newSelf(su: pg.Pool, accountId: string, slot: number, name = `self-${slot}`): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, $2, $3) RETURNING id',
    [accountId, slot, name],
  );
  return rows[0]!.id;
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
