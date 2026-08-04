// P10-S18 — the cancellation mutation boundary. Pure: no React, no DOM, no
// module-level fetch; the transport is injected.
//
// Its own module rather than an extension of the departure boundary, and that is
// determinable rather than stylistic: an accepted test asserts the departure
// modules name no cancellation route. Extending one would break a prior
// assertion this sub-step is not assigned to edit.
//
// One Self-scoped POST carrying no body, answered through the same runVoid as
// every other lifecycle mutation. A 200 or 201 is not success — it violates the
// audited contract and enters the same failure class as an error status, for a
// different reason the tests keep apart.
//
// The server treats an already-cancelled Placement as a no-op and answers 204,
// so a duplicate cancel is a success here rather than a conflict.

import { sendSelf, type Transport } from '../api/transport.ts';
import { outcomeOf } from '../auth/session.ts';

export const CANCELLATION_PATH = (placementId: string): string =>
  `/placements/${placementId}/cancellation`;

/** The committed cancellation success predicate, defined once. */
export const CANCELLED_STATUS = 204;

export type CancellationOutcome = 'cancelled' | 'session-expired' | 'forbidden' | 'failed';

export async function cancelPlacement(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
): Promise<CancellationOutcome> {
  try {
    const res = await sendSelf(transport, {
      method: 'POST',
      path: CANCELLATION_PATH(placementId),
      actingSelf: actingSelfId,
    });
    const outcome = outcomeOf(res.status);
    if (outcome.kind === 'unauthenticated') return 'session-expired';
    if (outcome.kind === 'forbidden') return 'forbidden';
    return res.status === CANCELLED_STATUS ? 'cancelled' : 'failed';
  } catch {
    return 'failed';
  }
}
