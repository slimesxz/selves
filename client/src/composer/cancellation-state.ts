// P10-S18 — cancellation transitions over the ONE authoritative lifecycle.
//
// This module declares no lifecycle value of its own. It reads and returns the
// same union `departure-state.ts` owns, because two values describing one
// Placement lifecycle can disagree — and the specific disagreement this avoids
// is a cancelled Placement whose departure value has been reset, which would let
// the departure boundary permit an act that can never lawfully succeed.
//
// The committed transition is `departing → cancelled`. It is not a return to
// draft: no `state = 'draft'` assignment exists in the domain function. So
// cancelled is terminal for that Placement — recipients stay frozen, the same
// Placement can never depart again, and trying again means composing a new
// draft and a new Placement. Nothing here implies otherwise.
//
// An already-cancelled row returns 204 from the server rather than a conflict,
// so a duplicate cancel reads as success. The client still records one
// cancellation and no history.

import type { CancellingPendingState, DepartureState } from './departure-state.ts';
import { noDeparture } from './departure-state.ts';
import type { RetainedDraft } from './retained-draft.ts';

/** The one authoritative cancellation rule, reading the one lifecycle value.
 *  Only a departed Placement may be cancelled, and only a failed attempt may be
 *  deliberately retried. Pending and cancelled both refuse. */
export function permitsCancellation(lifecycle: DepartureState): boolean {
  return lifecycle.kind === 'departed' || lifecycle.kind === 'cancellation-failed';
}

export function onCancelRequested(lifecycle: DepartureState): CancellingPendingState {
  // permitsCancellation has already established one of the two eligible kinds,
  // both of which carry the identifiers and the frozen recipient snapshot.
  const held = lifecycle as Extract<DepartureState, { readonly placementId: string }>;
  return {
    kind: 'cancelling-pending',
    placementId: held.placementId,
    artifactId: held.artifactId,
    recipients: held.recipients,
  };
}

/** One result, one lifecycle. Splitting the cancelled state from the retained
 *  draft — or from the departure value — is exactly the duplication that would
 *  let them disagree, so both effects settle together or not at all. */
export interface CancellationSettlement {
  readonly lifecycle: DepartureState;
  readonly retainedDraft: RetainedDraft | null;
}

export function onCancelled(pending: CancellingPendingState): CancellationSettlement {
  return {
    lifecycle: {
      kind: 'cancelled',
      placementId: pending.placementId,
      artifactId: pending.artifactId,
      recipients: pending.recipients,
    },
    retainedDraft: null,
  };
}

/** Failure leaves the Placement exactly as departing as it was, with the
 *  identifiers and frozen recipients intact and a deliberate retry available.
 *  It enters neither cancelled nor settled, and a 409 tells the client its act
 *  did not take — never what the server now holds. */
export function onCancellationFailed(
  pending: CancellingPendingState,
  retainedDraft: RetainedDraft | null,
): CancellationSettlement {
  return {
    lifecycle: {
      kind: 'cancellation-failed',
      placementId: pending.placementId,
      artifactId: pending.artifactId,
      recipients: pending.recipients,
    },
    retainedDraft,
  };
}

/** 401 or 403: the acting Self is no longer authoritative, so the attempt is
 *  abandoned rather than failed. */
export function onAuthorizationLost(): CancellationSettlement {
  return { lifecycle: noDeparture, retainedDraft: null };
}
