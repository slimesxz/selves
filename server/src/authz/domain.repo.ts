// Protected result reads (Stage 3) and actor-scoped containment lists. A Stage-3
// read runs ONLY after an allow decision, on the same transaction/snapshot as the
// Stage-1 predicate-input reads (§11). The list methods compile authorization
// directly into the WHERE clause and return only authorized rows (addendum §2).
//
// Contract only; the SQL implementation arrives in P5-C. Like the predicate repo,
// it depends on a transaction handle (Tx), never the raw pool.
import type { Tx } from '../db.ts';
import type { Artifact, Placement, PlacementRecipient } from '../domain/records.ts';

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
