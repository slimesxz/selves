// P10-S12 — the all-or-none Correspondences read (§13.6-B, UNFILED under
// P10-J6). Pure: no React, no DOM, no module-level fetch.
//
// The read is one placements request plus zero or more authored-recipient
// requests, so partial failure is the expected shape of a degraded read rather
// than an edge case. A plausible-but-incomplete projection is inadmissible:
// any failure at any layer yields no projection at all.
//
// Unavailability is never emptiness. A valid empty set is 2xx with an empty
// array on the placements read and yields zero groups; a failure is a distinct
// outcome and never renders as zero groups.
//
// An empty recipient array for an AUTHORED SETTLED Placement is not an empty
// recipient set. It contradicts the committed invariant that a departure
// requires at least one recipient, so it is classified as an invalid
// authoritative response and enters the failure branch rather than silently
// dropping the Placement from every group.
//
// 401 and 403 are classified separately and are not absorbed into
// unavailability: they belong to the existing session-expired and forbidden
// transitions.

import { sendSelf, type Transport } from '../api/transport.ts';
import type { ReadablePlacement, RecipientsByPlacement } from './derive.ts';

export type ReadOutcome =
  | { readonly kind: 'ok'; readonly placements: ReadablePlacement[]; readonly recipients: RecipientsByPlacement }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'forbidden' };

const SETTLED = 'settled';

/** Maps a completed non-2xx response onto its ruled classification. */
export function classifyStatus(status: number): 'session-expired' | 'forbidden' | 'unavailable' {
  if (status === 401) return 'session-expired';
  if (status === 403) return 'forbidden';
  return 'unavailable';
}

function isPlacement(value: unknown): value is ReadablePlacement {
  const p = value as ReadablePlacement;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof p.id === 'string' &&
    typeof p.senderSelfId === 'string' &&
    typeof p.state === 'string' &&
    typeof p.createdAt === 'string'
  );
}

export async function readCorrespondences(
  transport: Transport,
  activeSelfId: string,
): Promise<ReadOutcome> {
  try {
    const listed = await sendSelf(transport, { method: 'GET', path: '/placements', actingSelf: activeSelfId });
    if (!listed.ok) return { kind: classifyStatus(listed.status) };
    const body: unknown = await listed.json();
    if (!Array.isArray(body) || !body.every(isPlacement)) return { kind: 'unavailable' };
    const placements = body as ReadablePlacement[];

    const recipients = new Map<string, readonly string[]>();
    for (const placement of placements) {
      if (placement.state !== SETTLED || placement.senderSelfId !== activeSelfId) continue;
      const res = await sendSelf(transport, {
        method: 'GET',
        path: `/placements/${placement.id}/recipients`,
        actingSelf: activeSelfId,
      });
      if (!res.ok) return { kind: classifyStatus(res.status) };
      const rows: unknown = await res.json();
      if (!Array.isArray(rows)) return { kind: 'unavailable' };
      // A settled Placement always has at least one recipient. An empty array
      // here is an invalid authoritative response, not an empty set.
      if (rows.length === 0) return { kind: 'unavailable' };
      const ids = rows.map((r) => (r as { recipientSelfId?: unknown }).recipientSelfId);
      if (!ids.every((id): id is string => typeof id === 'string')) return { kind: 'unavailable' };
      recipients.set(placement.id, ids);
    }
    return { kind: 'ok', placements, recipients };
  } catch {
    return { kind: 'unavailable' };
  }
}
