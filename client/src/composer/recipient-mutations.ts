// P10-S15 — the recipient-add mutation boundary. Pure: no React, no DOM, no
// module-level fetch; the transport is injected.
//
// One Self-scoped POST against the frozen surface. The committed route returns
// through runVoid, whose only success path is a 204 with no body — so the
// success predicate is a status equality and nothing is parsed. Reading a body
// here would also be a read-after-write, which this slice does not perform.
//
// A 200 or 201 is NOT success. It does not match the endpoint's audited
// contract, so it enters the same failure state as an error status — for a
// different reason, and that difference is preserved in the tests rather than
// flattened. No response is promoted to success for being in the 2xx range.
//
// 401 and 403 are classified through the committed `outcomeOf`, so no second
// mapping of them is defined here.

import { sendSelf, type Transport } from '../api/transport.ts';
import { outcomeOf } from '../auth/session.ts';

export const RECIPIENTS_PATH = (placementId: string): string => `/placements/${placementId}/recipients`;

/** The committed recipient-add success predicate, defined once. */
export const ADDED_STATUS = 204;

export type AddOutcome = 'added' | 'session-expired' | 'forbidden' | 'failed';

export async function addRecipient(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
  recipientSelfId: string,
): Promise<AddOutcome> {
  try {
    const res = await sendSelf(transport, {
      method: 'POST',
      path: RECIPIENTS_PATH(placementId),
      body: { recipientSelfId },
      actingSelf: actingSelfId,
    });
    const outcome = outcomeOf(res.status);
    if (outcome.kind === 'unauthenticated') return 'session-expired';
    if (outcome.kind === 'forbidden') return 'forbidden';
    return res.status === ADDED_STATUS ? 'added' : 'failed';
  } catch {
    return 'failed';
  }
}

/** P10-S16 — removal shares the contract exactly: a DELETE carrying NO request
 *  body, whose only success is a bodyless 204. The committed route answers
 *  through the same runVoid, and the domain function only DELETEs a recipient
 *  row — it contains no placement UPDATE and no state assignment, so a removal
 *  can never move a draft out of `draft`. */
export async function removeRecipient(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
  recipientSelfId: string,
): Promise<AddOutcome> {
  try {
    const res = await sendSelf(transport, {
      method: 'DELETE',
      path: `${RECIPIENTS_PATH(placementId)}/${recipientSelfId}`,
      actingSelf: actingSelfId,
    });
    const outcome = outcomeOf(res.status);
    if (outcome.kind === 'unauthenticated') return 'session-expired';
    if (outcome.kind === 'forbidden') return 'forbidden';
    return res.status === ADDED_STATUS ? 'added' : 'failed';
  } catch {
    return 'failed';
  }
}
