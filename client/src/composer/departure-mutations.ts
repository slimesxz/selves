// P10-S17 — the departure mutation boundary. Pure: no React, no DOM, no
// module-level fetch; the transport is injected.
//
// Its own module rather than an extension of recipient-mutations.ts, and that is
// determinable rather than stylistic: an accepted test asserts that the
// recipient mutation module names no departure route. Extending it would break a
// prior assertion this sub-step is not assigned to edit.
//
// One Self-scoped POST carrying no body. The committed route answers through the
// same runVoid as every other lifecycle mutation, so the success predicate is a
// status equality and nothing is parsed. A 200 or 201 is not success: it does
// not match the endpoint's audited contract, and it enters the same failure
// class as an error status for a different reason.

import { sendSelf, type Transport } from '../api/transport.ts';
import { outcomeOf } from '../auth/session.ts';

export const DEPARTURE_PATH = (placementId: string): string => `/placements/${placementId}/departure`;

/** The committed departure success predicate, defined once. */
export const DEPARTED_STATUS = 204;

export type DepartureOutcome = 'departed' | 'session-expired' | 'forbidden' | 'failed';

export async function beginDeparture(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
): Promise<DepartureOutcome> {
  try {
    const res = await sendSelf(transport, {
      method: 'POST',
      path: DEPARTURE_PATH(placementId),
      actingSelf: actingSelfId,
    });
    const outcome = outcomeOf(res.status);
    if (outcome.kind === 'unauthenticated') return 'session-expired';
    if (outcome.kind === 'forbidden') return 'forbidden';
    return res.status === DEPARTED_STATUS ? 'departed' : 'failed';
  } catch {
    return 'failed';
  }
}
