// P10-S19 — the settlement mutation boundary. Pure: no React, no DOM, no
// module-level fetch; the transport is injected.
//
// Its own module rather than an extension of the departure or cancellation
// boundaries, and that is determinable: four accepted tests assert those modules
// name no settlement route. Extending one would break a prior assertion this
// sub-step is not assigned to edit.
//
// One Self-scoped POST carrying no body, answered through the same runVoid as
// the other lifecycle mutations. The server enforces the snapshotted interval
// and answers 409 until it has elapsed; nothing here anticipates that, and a 409
// is classified with every other failure rather than read as a timing signal.
//
// An already-settled Placement returns 204 — the domain function returns early —
// so a repeated settlement reads as success at this boundary.

import { sendSelf, type Transport } from '../api/transport.ts';
import { outcomeOf } from '../auth/session.ts';

export const SETTLEMENT_PATH = (placementId: string): string => `/placements/${placementId}/settlement`;

/** The committed settlement success predicate, defined once. */
export const SETTLED_STATUS = 204;

export type SettlementOutcome = 'settled' | 'session-expired' | 'forbidden' | 'failed';

export async function settlePlacement(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
): Promise<SettlementOutcome> {
  try {
    const res = await sendSelf(transport, {
      method: 'POST',
      path: SETTLEMENT_PATH(placementId),
      actingSelf: actingSelfId,
    });
    const outcome = outcomeOf(res.status);
    if (outcome.kind === 'unauthenticated') return 'session-expired';
    if (outcome.kind === 'forbidden') return 'forbidden';
    return res.status === SETTLED_STATUS ? 'settled' : 'failed';
  } catch {
    return 'failed';
  }
}
