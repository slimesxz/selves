// Protected result reads (Stage 3) and actor-scoped containment lists. A Stage-3
// read runs ONLY after an allow decision, on the same transaction/snapshot as the
// Stage-1 predicate-input reads (§11). The list methods compile authorization
// directly into the WHERE clause and return only authorized rows (addendum §2).
//
// Contract only; the SQL implementation arrives in P5-C. Like the predicate repo,
// it depends on a transaction handle (Tx), never the raw pool.
import type { Tx } from '../db.ts';
import type { Artifact, Placement, PlacementRecipient } from '../domain/records.ts';
import type { ArtifactId, PlacementId, SelfId } from '../domain/ids.ts';
import type { ArtifactPayloadType } from '../domain/payload.ts';
import type { PlacementState } from '../domain/placement.ts';

export interface DomainRepo {
  /** Stage-3 read of an artifact by id (caller must already hold an allow). */
  readArtifact(tx: Tx, artifactId: string): Promise<Artifact | null>;
  /** Stage-3 read of a placement by id (caller must already hold an allow). */
  readPlacement(tx: Tx, placementId: string): Promise<Placement | null>;
  /** Containment: the acting Self's own authored artifacts. */
  listOwnedArtifacts(tx: Tx, actingSelf: string): Promise<Artifact[]>;
  /** Containment: authored (any state) ∪ settled placements addressed to the actor. */
  listReadablePlacements(tx: Tx, actingSelf: string): Promise<Placement[]>;
  /** Containment: the recipient rows of a placement the acting Self authored;
   *  a non-author (or absent placement) yields an empty array. */
  listRecipientsOfAuthoredPlacement(
    tx: Tx,
    actingSelf: string,
    placementId: string,
  ): Promise<PlacementRecipient[]>;
}

// Type aliases (not interfaces) so they satisfy the query's Record<string,unknown>
// row constraint via the implicit index signature TS gives object-literal aliases.
type ArtifactRow = {
  id: string;
  author_self_id: string;
  payload_type: string;
  text_body: string;
  created_at: Date;
};
type PlacementRow = {
  id: string;
  sender_self_id: string;
  artifact_id: string;
  state: string;
  created_at: Date;
  departing_at: Date | null;
  settled_at: Date | null;
  cancelled_at: Date | null;
};
type RecipientRow = {
  placement_id: string;
  recipient_self_id: string;
  added_at: Date;
};

function toArtifact(r: ArtifactRow): Artifact {
  return {
    id: r.id as ArtifactId,
    authorSelfId: r.author_self_id as SelfId,
    payloadType: r.payload_type as ArtifactPayloadType,
    textBody: r.text_body,
    createdAt: r.created_at,
  };
}
function toPlacement(r: PlacementRow): Placement {
  return {
    id: r.id as PlacementId,
    senderSelfId: r.sender_self_id as SelfId,
    artifactId: r.artifact_id as ArtifactId,
    state: r.state as PlacementState,
    createdAt: r.created_at,
    departingAt: r.departing_at,
    settledAt: r.settled_at,
    cancelledAt: r.cancelled_at,
  };
}
function toRecipient(r: RecipientRow): PlacementRecipient {
  return {
    placementId: r.placement_id as PlacementId,
    recipientSelfId: r.recipient_self_id as SelfId,
    addedAt: r.added_at,
  };
}

const ARTIFACT_COLS = 'id, author_self_id, payload_type, text_body, created_at';
const PLACEMENT_COLS =
  'id, sender_self_id, artifact_id, state, created_at, departing_at, settled_at, cancelled_at';

/** The PostgreSQL implementation. Single-resource reads are Stage-3 (allow-gated
 *  by the service); list reads compile authorization into the WHERE clause and
 *  return only authorized rows. All queries touch only granted columns. */
export function createDomainRepo(): DomainRepo {
  return {
    async readArtifact(tx, artifactId) {
      const { rows } = await tx.query<ArtifactRow>(
        `SELECT ${ARTIFACT_COLS} FROM public.artifacts WHERE id = $1`,
        [artifactId],
      );
      return rows[0] ? toArtifact(rows[0]) : null;
    },

    async readPlacement(tx, placementId) {
      const { rows } = await tx.query<PlacementRow>(
        `SELECT ${PLACEMENT_COLS} FROM public.placements WHERE id = $1`,
        [placementId],
      );
      return rows[0] ? toPlacement(rows[0]) : null;
    },

    async listOwnedArtifacts(tx, actingSelf) {
      const { rows } = await tx.query<ArtifactRow>(
        `SELECT ${ARTIFACT_COLS} FROM public.artifacts
          WHERE author_self_id = $1
          ORDER BY created_at, id`,
        [actingSelf],
      );
      return rows.map(toArtifact);
    },

    async listReadablePlacements(tx, actingSelf) {
      // authored (any state) ∪ settled placements addressed to the actor.
      const { rows } = await tx.query<PlacementRow>(
        `SELECT ${PLACEMENT_COLS} FROM public.placements p
          WHERE p.sender_self_id = $1
             OR ( p.state = 'settled'
                  AND EXISTS ( SELECT 1 FROM public.placement_recipients r
                                WHERE r.placement_id = p.id AND r.recipient_self_id = $1 ) )
          ORDER BY p.created_at, p.id`,
        [actingSelf],
      );
      return rows.map(toPlacement);
    },

    async listRecipientsOfAuthoredPlacement(tx, actingSelf, placementId) {
      // Author gate compiled into the WHERE: a non-author (or absent placement)
      // yields zero rows — no co-recipient disclosure, no existence signal.
      const { rows } = await tx.query<RecipientRow>(
        `SELECT pr.placement_id, pr.recipient_self_id, pr.added_at
           FROM public.placement_recipients pr
           JOIN public.placements p ON p.id = pr.placement_id
          WHERE pr.placement_id = $1 AND p.sender_self_id = $2
          ORDER BY pr.added_at, pr.recipient_self_id`,
        [placementId, actingSelf],
      );
      return rows.map(toRecipient);
    },
  };
}
