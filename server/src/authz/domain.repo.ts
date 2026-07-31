// Protected result reads (Stage 3) and actor-scoped containment lists. A Stage-3
// read runs ONLY after an allow decision, on the same transaction/snapshot as the
// Stage-1 predicate-input reads (§11). The list methods compile authorization
// directly into the WHERE clause and return only authorized rows (addendum §2).
//
// Contract only; the SQL implementation arrives in P5-C. Like the predicate repo,
// it depends on a transaction handle (Tx), never the raw pool.
import type { Tx } from '../db.ts';
import type { Artifact, Placement, PlacementRecipient } from '@selves/domain';
import type { ArtifactId, PlacementId, SelfId } from '@selves/domain';
import type { ArtifactPayloadType } from '@selves/domain';
import type { PlacementState } from '@selves/domain';

export interface DomainRepo {
  /** Stage-3 read of an artifact by id (caller must already hold an allow). */
  readArtifact(tx: Tx, artifactId: string): Promise<Artifact | null>;
  /** Stage-3 read of a placement by id (caller must already hold an allow).
   *  P10-M1 ground-conditional projection: the AUTHOR ground's SELECT names
   *  departure_interval_seconds; the RECIPIENT_SETTLED ground's SELECT does not.
   *  The value is never fetched then stripped. */
  readPlacement(
    tx: Tx,
    placementId: string,
    ground: 'AUTHOR' | 'RECIPIENT_SETTLED',
  ): Promise<Placement | null>;
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
  artifact_id: string | null; // null for a Key Placement (decision 0007, R2)
  payload_type: string;
  protected_resource_id: string | null;
  state: string;
  created_at: Date;
  departing_at: Date | null;
  settled_at: Date | null;
  cancelled_at: Date | null;
  // Present ONLY when the author column list was selected (P10-M1); the
  // recipient SQL never names the column, so the property never exists there.
  departure_interval_seconds?: number | null;
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
  const p: Placement = {
    id: r.id as PlacementId,
    senderSelfId: r.sender_self_id as SelfId,
    artifactId: r.artifact_id === null ? null : (r.artifact_id as ArtifactId),
    payloadType: r.payload_type as ArtifactPayloadType,
    protectedResourceId:
      r.protected_resource_id === null ? null : (r.protected_resource_id as ArtifactId),
    state: r.state as PlacementState,
    createdAt: r.created_at,
    departingAt: r.departing_at,
    settledAt: r.settled_at,
    cancelledAt: r.cancelled_at,
  };
  // F3 three-state shape: the key exists exactly when the author SQL selected
  // the column (null until departure snapshots it); the recipient row never
  // carries the property because its SQL never named the column.
  if ('departure_interval_seconds' in r) {
    p.departureIntervalSeconds = r.departure_interval_seconds ?? null;
  }
  return p;
}
function toRecipient(r: RecipientRow): PlacementRecipient {
  return {
    placementId: r.placement_id as PlacementId,
    recipientSelfId: r.recipient_self_id as SelfId,
    addedAt: r.added_at,
  };
}

const ARTIFACT_COLS = 'id, author_self_id, payload_type, text_body, created_at';
// P10-M1 ground-conditional column lists (exported for the S1 static proof).
// Each is a COMPLETE, INDEPENDENT plain string literal (0012 §36 source-shape
// ruling; 0008 F3): neither is constructed from the other and neither nests
// interpolation. The recipient list NEVER names departure_interval_seconds;
// the author list is the recipient list plus exactly that column — a
// relationship asserted in tests, never implemented by construction. Never
// fetch-then-strip.
export const PLACEMENT_COLS_RECIPIENT =
  'id, sender_self_id, artifact_id, payload_type, protected_resource_id, state, created_at, departing_at, settled_at, cancelled_at';
export const PLACEMENT_COLS_AUTHOR =
  'id, sender_self_id, artifact_id, payload_type, protected_resource_id, state, created_at, departing_at, settled_at, cancelled_at, departure_interval_seconds';

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

    async readPlacement(tx, placementId, ground) {
      // P10-M1: two fixed SQL texts, one per ground; the RECIPIENT_SETTLED text
      // never names the interval column. Explicit branches interpolate their own
      // named static constant directly — no intermediate selector variable
      // (0008 F3; 0012 §36 source-shape ruling).
      if (ground === 'AUTHOR') {
        const { rows } = await tx.query<PlacementRow>(
          `SELECT ${PLACEMENT_COLS_AUTHOR} FROM public.placements WHERE id = $1`,
          [placementId],
        );
        return rows[0] ? toPlacement(rows[0]) : null;
      }
      const { rows } = await tx.query<PlacementRow>(
        `SELECT ${PLACEMENT_COLS_RECIPIENT} FROM public.placements WHERE id = $1`,
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

    async listReadablePlacements(_tx, _actingSelf) {
      // P8 I: authorization is enforced by RLS on public.placements — author (any
      // state) ∪ (settled ∧ explicit recipient), keyed on the established acting-Self
      // context. RLS REMAINS THE BOUNDARY (0012 §35 F2): the two fixed-SQL queries
      // below narrow WITHIN the RLS-produced readable set by ground and are not the
      // authorization; absent/invalid context each reads zero rows.
      //
      // P10-M1 two-SELECT split (0012 §35 ruling 5): the authored query names the
      // interval column; the received query's SQL text never does. F1: a
      // self-addressed placement satisfies both grounds — AUTHOR precedence is
      // structural, because the received query EXCLUDES rows the actor authored,
      // so such a placement appears exactly once, under the author column list.
      // Ground membership is resolved in-database via domain.current_acting_self()
      // (the C3 context); no caller-supplied authority reaches the WHERE.
      const authored = await _tx.query<PlacementRow>(
        `SELECT ${PLACEMENT_COLS_AUTHOR} FROM public.placements
          WHERE sender_self_id = domain.current_acting_self()`,
      );
      const received = await _tx.query<PlacementRow>(
        `SELECT ${PLACEMENT_COLS_RECIPIENT} FROM public.placements
          WHERE sender_self_id IS DISTINCT FROM domain.current_acting_self()`,
      );
      // Deterministic contract ordering by (created_at, id) — 0012 §35 ruling 2.
      const rows = [...authored.rows, ...received.rows].sort(
        (a, b) =>
          a.created_at.getTime() - b.created_at.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
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
