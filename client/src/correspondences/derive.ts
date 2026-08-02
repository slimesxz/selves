// P10-S12 — the Correspondences derivation (§13.6 and §13.6-A, UNFILED under
// P10-J6 and carried into this sub-step's completion report). Pure: no React,
// no DOM, no fetch.
//
// Correspondence is not a first-class object. It has no identifier, no
// persistence apart from Placement, no lifecycle, and no authorization beyond
// Placement readability. This is an actor-relative read-only projection.
//
// The unit is pairwise: one Correspondence per visible counterpart Self,
// keyed on the counterpart id relative to the active acting Self. The key is a
// derivation key only — never displayed, never a Correspondence identifier.
//
// Only settled Placements participate. Draft, departing, and cancelled are
// excluded. A received Placement's counterpart is its sender, and it
// contributes to exactly one group; no co-recipient information is inferred or
// exposed, and none is available — the server returns recipient rows to the
// author alone. An authored Placement contributes once per recipient, so a
// multi-recipient Placement may appear in several actor-relative groups. That
// is projection, not duplication of the underlying record.
//
// All payload types participate; nothing here is payload-specific.

import { labelSelves, type SelfSummary } from '../self/selves.ts';

/** A Placement as the client reads it from GET /placements. */
export interface ReadablePlacement {
  readonly id: string;
  readonly senderSelfId: string;
  readonly state: string;
  readonly createdAt: string;
}

/** Recipient ids per authored Placement id. Populated only for Placements the
 *  acting Self authored; never consulted for received ones. */
export type RecipientsByPlacement = ReadonlyMap<string, readonly string[]>;

/** Group-level identification only. The group carries ordered Placement ids so
 *  the ruled within-group order is derivable, and carries no Placement content,
 *  no sender, and no recipient set. */
export interface CorrespondenceGroup {
  readonly counterpartSelfId: string;
  readonly label: string;
  readonly placementIds: readonly string[];
}

const SETTLED = 'settled';

/** Committed deterministic Placement ordering: (created_at, id). */
function byCreatedAtThenId(a: ReadablePlacement, b: ReadablePlacement): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function deriveCorrespondences(
  placements: readonly ReadablePlacement[],
  recipientsByPlacement: RecipientsByPlacement,
  activeSelfId: string,
  selves: readonly SelfSummary[],
): CorrespondenceGroup[] {
  const byCounterpart = new Map<string, ReadablePlacement[]>();
  const add = (counterpart: string, placement: ReadablePlacement): void => {
    const existing = byCounterpart.get(counterpart);
    if (existing) existing.push(placement);
    else byCounterpart.set(counterpart, [placement]);
  };

  for (const placement of placements) {
    if (placement.state !== SETTLED) continue;
    if (placement.senderSelfId === activeSelfId) {
      // Authored: once into each recipient's pairwise group.
      for (const recipient of recipientsByPlacement.get(placement.id) ?? []) add(recipient, placement);
    } else {
      // Received: the sender is the counterpart, and the only one knowable.
      add(placement.senderSelfId, placement);
    }
  }

  // Collision is determined over the counterpart set ACTUALLY PRESENTED, not
  // over the account's whole SelfSummary[]. A same-named Self that is not a
  // presented counterpart contributes nothing to the label.
  const presented = [...byCounterpart.keys()];
  const counterpartSummaries = selves.filter((self) => presented.includes(self.id));
  const labelById = new Map(labelSelves(counterpartSummaries).map((e) => [e.id, e.label]));

  return presented
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((counterpartSelfId) => ({
      counterpartSelfId,
      label: labelById.get(counterpartSelfId) ?? '',
      placementIds: (byCounterpart.get(counterpartSelfId) ?? [])
        .slice()
        .sort(byCreatedAtThenId)
        .map((placement) => placement.id),
    }));
}
