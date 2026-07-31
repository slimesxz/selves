// The AuthorizationService — the sole application-level authorization decision
// point for Phase-5 domain reads (Gate 1 §1, invariant 1). Handlers import ONLY
// this surface; the predicate and domain repositories are internal and reachable
// only through here, so no protected read can be issued around a decision.
//
// This file declares the public contract. The factory (createAuthorizationService)
// and the pure decision functions arrive in P5-C.
import type { Artifact, Placement, PlacementRecipient } from '@selves/domain';
import type { AccountId, SelfId } from '@selves/domain';
import type { Queryable, Tx, TxPool } from '../db.ts';
import type { ArtifactFacts, PlacementFacts, PredicatesRepo } from './predicates.repo.ts';
import type { DomainRepo } from './domain.repo.ts';
import type { MutationsRepo } from './mutations.repo.ts';
import type { ArtifactAllowGround, DecisionSink, Outcome, PlacementAllowGround } from './reasons.ts';
import { NoopSink, isAllow } from './reasons.ts';
import { PLACEMENT_STATES } from '@selves/domain';

// The acting Self reaches the service ONLY through the verified Phase-4 context
// (req.actingSelf). The service never re-derives identity and never trusts an
// acting Self from a body, query, route, client claim, or repository result
// (Gate 1 invariant 3).
//
// P8 C3 (decisions 0008 R4-B / 0009 §2): a protected READ additionally carries the
// session token HASH. It is established as the transaction-local acting-Self
// context by the owner-run domain.set_acting_self setter (gated on auth.sessions)
// as the first statement of the read transaction, so the RLS policies admit exactly
// the rows the decision authorizes. The token is OPTIONAL only so pure decision
// tests with mock transactions need not supply one; a real policed read with no
// established context reads zero rows (fail-closed). The token is carried ONLY as a
// bind parameter to the setter — it is never logged, serialized, or placed in
// statement text (0009 §3.4). Mutations do not use it (they run through the DEFINER
// write boundary, which bypasses RLS by ownership).
export interface ActingContext {
  readonly actingSelf: SelfId;
  readonly sessionToken?: Buffer | undefined;
}

// Account-scoped context for the one operation whose authority is the AUTHENTICATED
// ACCOUNT, not an acting Self: the departure interval is an account-level setting
// (decision 0006, ruling 3). P8 L / 8-C §5: it is account-authenticated and
// Self-INDEPENDENT, so it is bound to the SESSION (the DEFINER function derives the
// account from the session token), never to an acting Self and never to a
// caller-supplied account id.
export interface AccountContext {
  readonly sessionToken: Buffer;
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

  // ── Phase-7 Key lifecycle (decision 0007) ───────────────────────────────────
  // A Key is a capability payload carried by a Placement (Q1 Alt A). Opening a Key
  // transmission is a draft Placement over the exact protected Artifact; the grant
  // itself is produced by the Key-aware settle_placement, not here. Revocation is a
  // standalone prospective mutation addressed by (grantee, protected resource).
  createKeyPlacementDraft(ctx: ActingContext, protectedResourceId: string): Promise<string>;
  revokeKey(ctx: ActingContext, granteeSelf: string, protectedResourceId: string): Promise<void>;
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

  // P8 C3: establish the transaction-local acting-Self context as the FIRST
  // statement of every protected read transaction. The setter validates the
  // session token against auth.sessions and that the acting Self belongs to that
  // account, then binds (backend_pid, xid8) → acting Self. RLS policies then admit
  // exactly the authorized rows; absent/invalid context reads zero rows. The token
  // is passed ONLY as a bind parameter — never interpolated, logged, or serialized.
  const establishContext = (tx: Tx, ctx: ActingContext): Promise<unknown> =>
    tx.query('SELECT domain.set_acting_self($1, $2)', [ctx.sessionToken, ctx.actingSelf]);

  // P10-M1: the allow ground reaches the Stage-3 read so the repo can select
  // the ground-conditional projection (author vs recipient column list).
  const readSingle = async <T>(
    operation: string,
    tx: Tx,
    decide: () => Promise<Outcome<string>>,
    read: (ground: string) => Promise<T | null>,
  ): Promise<Visible<T>> => {
    const outcome = await decide();
    sink.onDecision(operation, outcome);
    if (!isAllow(outcome)) return { ok: false };
    const value = await read(outcome.ground);
    if (value === null) return { ok: false }; // defensive; an allow implies present
    return { ok: true, value };
  };

  return {
    readArtifact(ctx, artifactId) {
      return txPool.withRepeatableRead(async (tx) => {
        await establishContext(tx, ctx);
        return readSingle(
          'readArtifact',
          tx,
          async () => decideArtifact(await predicates.artifactFacts(tx, ctx.actingSelf, artifactId), ctx.actingSelf),
          () => domain.readArtifact(tx, artifactId),
        );
      });
    },

    readPlacement(ctx, placementId) {
      return txPool.withRepeatableRead(async (tx) => {
        await establishContext(tx, ctx);
        return readSingle(
          'readPlacement',
          tx,
          async () => decidePlacement(await predicates.placementFacts(tx, ctx.actingSelf, placementId), ctx.actingSelf),
          (ground) => domain.readPlacement(tx, placementId, ground as 'AUTHOR' | 'RECIPIENT_SETTLED'),
        );
      });
    },

    listOwnedArtifacts(ctx) {
      return txPool.withRepeatableRead(async (tx) => {
        await establishContext(tx, ctx);
        return domain.listOwnedArtifacts(tx, ctx.actingSelf);
      });
    },

    listReadablePlacements(ctx) {
      return txPool.withRepeatableRead(async (tx) => {
        await establishContext(tx, ctx);
        return domain.listReadablePlacements(tx, ctx.actingSelf);
      });
    },

    listRecipientsOfAuthoredPlacement(ctx, placementId) {
      return txPool.withRepeatableRead(async (tx) => {
        await establishContext(tx, ctx);
        const rows = await domain.listRecipientsOfAuthoredPlacement(tx, ctx.actingSelf, placementId);
        // Constitutive operation marker: the author-scoped containment list ran
        // for this actor (§2/§3). Not a per-resource decision; sink is test-only.
        sink.onDecision('listRecipientsOfAuthoredPlacement', { kind: 'allow', ground: 'AUTHOR_RECIPIENT_LIST' });
        return rows;
      });
    },

    // ── mutations (P8 L / Scope B): each acting-Self mutation runs in ONE READ
    // COMMITTED transaction that FIRST establishes C3 context, then invokes the
    // DEFINER function — which derives its acting Self from current_acting_self(),
    // never from a caller-supplied argument. The DEFINER function remains the
    // exclusive authoritative write boundary; C3 does not authorize direct DML.
    createArtifact(ctx, textBody) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.createArtifact(tx, textBody);
      });
    },
    createPlacementDraft(ctx, artifactId) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.createPlacementDraft(tx, artifactId);
      });
    },
    addRecipient(ctx, placementId, recipientSelf) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.addRecipient(tx, placementId, recipientSelf);
      });
    },
    removeRecipient(ctx, placementId, recipientSelf) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.removeRecipient(tx, placementId, recipientSelf);
      });
    },
    beginDeparture(ctx, placementId) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.beginDeparture(tx, placementId);
      });
    },
    cancelPlacement(ctx, placementId) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.cancelPlacement(tx, placementId);
      });
    },
    settlePlacement(ctx, placementId) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.settlePlacement(tx, placementId);
      });
    },
    // Account-scoped and Self-INDEPENDENT (P8 L / 8-C §5): a single autocommit
    // statement carrying the session token; the DEFINER function derives the
    // account from the session. No acting-Self context is established.
    setDepartureInterval(ctx, seconds) {
      return mutations.setDepartureInterval(db, ctx.sessionToken, seconds);
    },

    // ── Key lifecycle: acting Self (the grantor) comes from C3 context, not an
    // argument. Issuance authority is authorship; revocation authority is the
    // grant's recorded grantor — both checked inside the DEFINER function.
    createKeyPlacementDraft(ctx, protectedResourceId) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.createKeyPlacementDraft(tx, protectedResourceId);
      });
    },
    revokeKey(ctx, granteeSelf, protectedResourceId) {
      return txPool.withTransaction(async (tx) => {
        await establishContext(tx, ctx);
        return mutations.revokeKey(tx, granteeSelf, protectedResourceId);
      });
    },
  };
}
