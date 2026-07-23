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

/** The PostgreSQL implementation. Each query is bound to the acting Self and the
 *  requested resource; none loads a cross-Self superset. Requires only the
 *  column-scoped SELECT grants added in the P5-B migration. */
export function createPredicatesRepo(): PredicatesRepo {
  return {
    async artifactFacts(tx, actingSelf, artifactId) {
      // (a) existence + authorship
      const a = await tx.query<{ author_self_id: string | null }>(
        'SELECT author_self_id FROM public.artifacts WHERE id = $1',
        [artifactId],
      );
      const present = a.rows.length > 0;
      const authorSelfId = present ? (a.rows[0]?.author_self_id ?? null) : null;

      // (b) recipient ground, state-resolved, across every placement carrying it
      const r = await tx.query<{ any_settled: boolean | null; any_recipient: boolean | null }>(
        `SELECT bool_or(p.state = 'settled') AS any_settled,
                count(*) > 0                 AS any_recipient
           FROM public.placements p
           JOIN public.placement_recipients pr ON pr.placement_id = p.id
          WHERE p.artifact_id = $1 AND pr.recipient_self_id = $2`,
        [artifactId, actingSelf],
      );

      // (c) Key ground — actor-scoped only, so a Key to a DIFFERENT resource is
      // seen (has_active_elsewhere) and classified KEY_WRONG_RESOURCE, not
      // silently ignored (Gate 1 §4, addendum §4 correction).
      const k = await tx.query<{
        has_active_for_target: boolean | null;
        has_revoked_for_target: boolean | null;
        has_active_elsewhere: boolean | null;
      }>(
        `SELECT bool_or(revoked_at IS NULL     AND protected_resource_id =  $2) AS has_active_for_target,
                bool_or(revoked_at IS NOT NULL AND protected_resource_id =  $2) AS has_revoked_for_target,
                bool_or(revoked_at IS NULL     AND protected_resource_id <> $2) AS has_active_elsewhere
           FROM public.key_grants
          WHERE grantee_self_id = $1`,
        [actingSelf, artifactId],
      );

      return {
        present,
        authorSelfId,
        anySettledRecipient: r.rows[0]?.any_settled === true,
        anyRecipient: r.rows[0]?.any_recipient === true,
        hasActiveForTarget: k.rows[0]?.has_active_for_target === true,
        hasRevokedForTarget: k.rows[0]?.has_revoked_for_target === true,
        hasActiveElsewhere: k.rows[0]?.has_active_elsewhere === true,
      };
    },

    async placementFacts(tx, actingSelf, placementId) {
      const p = await tx.query<{ sender_self_id: string | null; state: string | null }>(
        'SELECT sender_self_id, state FROM public.placements WHERE id = $1',
        [placementId],
      );
      const present = p.rows.length > 0;
      const recipient = await tx.query(
        `SELECT 1 AS ok FROM public.placement_recipients
          WHERE placement_id = $1 AND recipient_self_id = $2 LIMIT 1`,
        [placementId, actingSelf],
      );
      return {
        present,
        senderSelfId: present ? (p.rows[0]?.sender_self_id ?? null) : null,
        state: present ? (p.rows[0]?.state ?? null) : null,
        recipientRow: recipient.rows.length > 0,
      };
    },
  };
}
