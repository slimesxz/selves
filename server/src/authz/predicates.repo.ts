// Stage-1 predicate-input reads: the minimum authoritative facts needed to
// DECIDE a single-resource read, never the protected payload (§11, addendum §2).
// Every query binds the acting Self and the requested resource in SQL — no
// cross-Self or cross-recipient superset is loaded for in-memory filtering.
//
// This module declares the contract only. The SQL implementation and the exact
// selves_app privileges it requires arrive in P5-B. The implementation depends
// on a transaction handle (Tx), never on the raw pool — so it can never open its
// own connection or escape the caller's snapshot.
import type { Tx } from '../db.ts';

// Facts for readArtifact. Booleans are resolved in SQL (bool_or over the actor-
// and resource-scoped rows); `present`/`authorSelfId` come from the artifact row.
export interface ArtifactFacts {
  /** an artifacts row with the requested id exists */
  readonly present: boolean;
  /** author_self_id of that row (null only if absent, or — impossibly — null) */
  readonly authorSelfId: string | null;
  /** the actor is an explicit recipient of a SETTLED placement carrying it */
  readonly anySettledRecipient: boolean;
  /** the actor is an explicit recipient of ANY placement carrying it */
  readonly anyRecipient: boolean;
  /** the actor holds an active (unrevoked) Key to the requested resource */
  readonly hasActiveForTarget: boolean;
  /** the actor holds a revoked Key to the requested resource */
  readonly hasRevokedForTarget: boolean;
  /** the actor holds an active Key to a DIFFERENT resource (KEY_WRONG_RESOURCE) */
  readonly hasActiveElsewhere: boolean;
}

// Facts for readPlacement.
export interface PlacementFacts {
  /** a placements row with the requested id exists */
  readonly present: boolean;
  /** sender_self_id of that row */
  readonly senderSelfId: string | null;
  /** state label of that row (validated against the enum by the decision fn) */
  readonly state: string | null;
  /** an explicit placement_recipients row names the acting Self */
  readonly recipientRow: boolean;
}

export interface PredicatesRepo {
  artifactFacts(tx: Tx, actingSelf: string, artifactId: string): Promise<ArtifactFacts>;
  placementFacts(tx: Tx, actingSelf: string, placementId: string): Promise<PlacementFacts>;
}
