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

/** The PostgreSQL implementation. P8 R1 (decision 0008 R1 / 0009): the Stage-1
 *  fact reads are computed by owner-run SECURITY DEFINER functions
 *  (domain.artifact_facts / domain.placement_facts), RLS-exempt by ownership, so
 *  the decider never reads through the RLS mirror and the reason taxonomy survives
 *  once RLS is enabled on the ontology tables (R2). Each function is bound to the
 *  acting Self and the requested resource (equality only — F3); none loads a
 *  cross-Self superset. The call runs inside the caller's REPEATABLE READ
 *  transaction, so Stage-1 and the Stage-3 read share one snapshot (0005).
 *
 *  This repo now requires only EXECUTE on the two domain functions — no direct
 *  table SELECT. (The Phase-7 byte-identity of this file was released by R1.) */
export function createPredicatesRepo(): PredicatesRepo {
  return {
    async artifactFacts(tx, actingSelf, artifactId) {
      const { rows } = await tx.query<{
        present: boolean;
        author_self_id: string | null;
        any_settled_recipient: boolean;
        any_recipient: boolean;
        has_active_for_target: boolean;
        has_revoked_for_target: boolean;
        has_active_elsewhere: boolean;
      }>('SELECT * FROM domain.artifact_facts($1, $2)', [actingSelf, artifactId]);
      const f = rows[0]!; // the DEFINER function always returns exactly one row
      return {
        present: f.present,
        authorSelfId: f.author_self_id ?? null,
        anySettledRecipient: f.any_settled_recipient,
        anyRecipient: f.any_recipient,
        hasActiveForTarget: f.has_active_for_target,
        hasRevokedForTarget: f.has_revoked_for_target,
        hasActiveElsewhere: f.has_active_elsewhere,
      };
    },

    async placementFacts(tx, actingSelf, placementId) {
      const { rows } = await tx.query<{
        present: boolean;
        sender_self_id: string | null;
        state: string | null;
        recipient_row: boolean;
      }>('SELECT * FROM domain.placement_facts($1, $2)', [actingSelf, placementId]);
      const f = rows[0]!; // the DEFINER function always returns exactly one row
      return {
        present: f.present,
        senderSelfId: f.sender_self_id ?? null,
        state: f.state ?? null,
        recipientRow: f.recipient_row,
      };
    },
  };
}
