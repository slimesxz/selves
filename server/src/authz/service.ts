// The AuthorizationService — the sole application-level authorization decision
// point for Phase-5 domain reads (Gate 1 §1, invariant 1). Handlers import ONLY
// this surface; the predicate and domain repositories are internal and reachable
// only through here, so no protected read can be issued around a decision.
//
// This file declares the public contract. The factory (createAuthorizationService)
// and the pure decision functions arrive in P5-C.
import type { Artifact, Placement, PlacementRecipient } from '../domain/records.ts';
import type { AccountId, SelfId } from '../domain/ids.ts';
import type { Queryable, Tx, TxPool } from '../db.ts';
import type { ArtifactFacts, PlacementFacts, PredicatesRepo } from './predicates.repo.ts';
import type { DomainRepo } from './domain.repo.ts';
import type { MutationsRepo } from './mutations.repo.ts';
import type { ArtifactAllowGround, DecisionSink, Outcome, PlacementAllowGround } from './reasons.ts';
import { NoopSink, isAllow } from './reasons.ts';
import { PLACEMENT_STATES } from '../domain/placement.ts';

// The acting Self reaches the service ONLY through the verified Phase-4 context
// (req.actingSelf). The service never re-derives identity and never trusts an
// acting Self from a body, query, route, client claim, or repository result
// (Gate 1 invariant 3).
export interface ActingContext {
  readonly actingSelf: SelfId;
}

// Account-scoped context for the one operation whose authority is the AUTHENTICATED
// ACCOUNT, not an acting Self: the departure interval is an account-level setting
// (decision 0006, ruling 3). The account id comes from the same verified
// authentication context the auth subsystem uses (req.account); it is never
// derived by resolving the acting-Self header back to an account, and never read
// from the request body.
export interface AccountContext {
  readonly account: AccountId;
}

// A single-resource read result. On deny, the caller receives an opaque
// { ok: false } — no reason, no existence signal. The public mapper turns it
// into the uniform 404 (§13). There is no reusable allow: the value is the
// protected record itself, produced within the decision's own transaction, and
// nothing authorization-bearing outlives the call (invariant 2, Gate 1 §3).
export type Visible<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export interface AuthorizationService {
  // ── Phase-5 reads (unchanged) ───────────────────────────────────────────────
  readArtifact(ctx: ActingContext, artifactId: string): Promise<Visible<Artifact>>;
  listOwnedArtifacts(ctx: ActingContext): Promise<Artifact[]>;
  readPlacement(ctx: ActingContext, placementId: string): Promise<Visible<Placement>>;
  listReadablePlacements(ctx: ActingContext): Promise<Placement[]>;
  listRecipientsOfAuthoredPlacement(
    ctx: ActingContext,
    placementId: string,
  ): Promise<PlacementRecipient[]>;

  // ── Phase-6 mutations (decision 0006) ───────────────────────────────────────
  // Each is bound to the verified acting Self and delegates to exactly one
  // `domain.*` DEFINER function. On failure the function's SQLSTATE propagates
  // unchanged; the route adapter maps it via reasons.mapMutationError. No mutation
  // reads or returns a protected payload — create_* return only the new id.
  createArtifact(ctx: ActingContext, textBody: string): Promise<string>;
  createPlacementDraft(ctx: ActingContext, artifactId: string): Promise<string>;
  addRecipient(ctx: ActingContext, placementId: string, recipientSelf: string): Promise<void>;
  removeRecipient(ctx: ActingContext, placementId: string, recipientSelf: string): Promise<void>;
  beginDeparture(ctx: ActingContext, placementId: string): Promise<void>;
  cancelPlacement(ctx: ActingContext, placementId: string): Promise<void>;
  settlePlacement(ctx: ActingContext, placementId: string): Promise<void>;
  // Account-scoped (NOT acting-Self-bound): authority is the authenticated account.
  setDepartureInterval(ctx: AccountContext, seconds: number): Promise<void>;
}

// ── pure decision functions (no I/O; exported for direct unit testing) ────────
// Precedence is fixed and deterministic. A recognized-but-failing ground yields
// an ordinary_deny; a relationship with no ratified significance yields
// unsupported; a contradictory fact yields invariant_failure (Gate 1 §4/§9).

export function decideArtifact(facts: ArtifactFacts, actingSelf: string): Outcome<ArtifactAllowGround> {
  if (!facts.present) return { kind: 'absent' };
  if (facts.authorSelfId === null) {
    return { kind: 'invariant_failure', detail: 'artifact present with null author_self_id' };
  }
  if (facts.authorSelfId === actingSelf) return { kind: 'allow', ground: 'AUTHOR' };
  if (facts.anySettledRecipient) return { kind: 'allow', ground: 'RECIPIENT_SETTLED' };
  if (facts.hasActiveForTarget) return { kind: 'allow', ground: 'KEY_VALID' };
  // recognized-but-failing grounds (ordinary), in fixed precedence:
  if (facts.anyRecipient) return { kind: 'ordinary_deny', reason: 'RECIPIENT_NOT_SETTLED' };
  if (facts.hasRevokedForTarget) return { kind: 'ordinary_deny', reason: 'KEY_REVOKED' };
  if (facts.hasActiveElsewhere) return { kind: 'ordinary_deny', reason: 'KEY_WRONG_RESOURCE' };
  return { kind: 'unsupported' };
}

export function decidePlacement(facts: PlacementFacts, actingSelf: string): Outcome<PlacementAllowGround> {
  if (!facts.present) return { kind: 'absent' };
  if (facts.senderSelfId === null || facts.state === null) {
    return { kind: 'invariant_failure', detail: 'placement present with null sender_self_id or state' };
  }
  // A state outside the ratified enum is impossible in the real DB (enum column);
  // reachable only via a test double, and it is an invariant failure, not policy.
  if (!(PLACEMENT_STATES as readonly string[]).includes(facts.state)) {
    return { kind: 'invariant_failure', detail: `unknown placement state ${facts.state}` };
  }
  if (facts.senderSelfId === actingSelf) return { kind: 'allow', ground: 'AUTHOR' };
  if (facts.recipientRow && facts.state === 'settled') {
    return { kind: 'allow', ground: 'RECIPIENT_SETTLED' };
  }
  if (facts.recipientRow) return { kind: 'ordinary_deny', reason: 'RECIPIENT_NOT_SETTLED' };
  return { kind: 'unsupported' };
}

export interface ServiceDeps {
  readonly txPool: TxPool;
  /** The app pool as a plain Queryable, for single-statement DEFINER mutations
   *  (each does its own locking; no REPEATABLE READ wrapper is used for writes). */
  readonly db: Queryable;
  readonly predicates: PredicatesRepo;
  readonly domain: DomainRepo;
  readonly mutations: MutationsRepo;
  /** Injected only by tests; production passes nothing and gets NoopSink. */
  readonly sink?: DecisionSink;
}

/** Compose the AuthorizationService. Each single-resource read runs Stage-1
 *  predicate-input reads, a Stage-2 decision, and (only on allow) the Stage-3
 *  protected read on ONE request-local REPEATABLE READ transaction and snapshot
 *  (decision record 0005). No allow value crosses a boundary. */
export function createAuthorizationService(deps: ServiceDeps): AuthorizationService {
  const { txPool, db, predicates, domain, mutations } = deps;
  const sink: DecisionSink = deps.sink ?? NoopSink;

  const readSingle = async <T>(
    operation: string,
    tx: Tx,
    decide: () => Promise<Outcome<string>>,
    read: () => Promise<T | null>,
  ): Promise<Visible<T>> => {
    const outcome = await decide();
    sink.onDecision(operation, outcome);
    if (!isAllow(outcome)) return { ok: false };
    const value = await read();
    if (value === null) return { ok: false }; // defensive; an allow implies present
    return { ok: true, value };
  };

  return {
    readArtifact(ctx, artifactId) {
      return txPool.withRepeatableRead((tx) =>
        readSingle(
          'readArtifact',
          tx,
          async () => decideArtifact(await predicates.artifactFacts(tx, ctx.actingSelf, artifactId), ctx.actingSelf),
          () => domain.readArtifact(tx, artifactId),
        ),
      );
    },

    readPlacement(ctx, placementId) {
      return txPool.withRepeatableRead((tx) =>
        readSingle(
          'readPlacement',
          tx,
          async () => decidePlacement(await predicates.placementFacts(tx, ctx.actingSelf, placementId), ctx.actingSelf),
          () => domain.readPlacement(tx, placementId),
        ),
      );
    },

    listOwnedArtifacts(ctx) {
      return txPool.withRepeatableRead((tx) => domain.listOwnedArtifacts(tx, ctx.actingSelf));
    },

    listReadablePlacements(ctx) {
      return txPool.withRepeatableRead((tx) => domain.listReadablePlacements(tx, ctx.actingSelf));
    },

    listRecipientsOfAuthoredPlacement(ctx, placementId) {
      return txPool.withRepeatableRead(async (tx) => {
        const rows = await domain.listRecipientsOfAuthoredPlacement(tx, ctx.actingSelf, placementId);
        // Constitutive operation marker: the author-scoped containment list ran
        // for this actor (§2/§3). Not a per-resource decision; sink is test-only.
        sink.onDecision('listRecipientsOfAuthoredPlacement', { kind: 'allow', ground: 'AUTHOR_RECIPIENT_LIST' });
        return rows;
      });
    },

    // ── mutations: each binds the write to the verified acting Self and delegates
    // to one DEFINER function. Failures propagate with the function's SQLSTATE for
    // the route adapter to map; authorization is enforced inside the function.
    createArtifact(ctx, textBody) {
      return mutations.createArtifact(db, ctx.actingSelf, textBody);
    },
    createPlacementDraft(ctx, artifactId) {
      return mutations.createPlacementDraft(db, ctx.actingSelf, artifactId);
    },
    addRecipient(ctx, placementId, recipientSelf) {
      return mutations.addRecipient(db, ctx.actingSelf, placementId, recipientSelf);
    },
    removeRecipient(ctx, placementId, recipientSelf) {
      return mutations.removeRecipient(db, ctx.actingSelf, placementId, recipientSelf);
    },
    beginDeparture(ctx, placementId) {
      return mutations.beginDeparture(db, ctx.actingSelf, placementId);
    },
    cancelPlacement(ctx, placementId) {
      return mutations.cancelPlacement(db, ctx.actingSelf, placementId);
    },
    settlePlacement(ctx, placementId) {
      return mutations.settlePlacement(db, ctx.actingSelf, placementId);
    },
    // Account-scoped: the account id comes from the verified authentication
    // context (AccountContext), never from an acting Self.
    setDepartureInterval(ctx, seconds) {
      return mutations.setDepartureInterval(db, ctx.account, seconds);
    },
  };
}
