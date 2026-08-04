// P10-S19 — settlement transitions over the ONE authoritative lifecycle.
//
// Like cancellation, this module declares no lifecycle value of its own. It
// reads and returns the union `departure-state.ts` owns, so no second value can
// disagree with it about what a Placement is.
//
// Settlement is client-initiated. AGENTS §5 states it directly — "Settlement is
// client-initiated and permitted only once the snapshotted interval has elapsed
// (server-enforced floor); there is no automatic settlement" — and the Phase-9
// worker confirms it by omission: it polls the outbox and settles nothing.
//
// The client cannot know eligibility. It may not read the Placement, read the
// snapshotted interval, reconstruct one from account configuration, or time the
// window locally. So `permitsSettlement` answers only what the client can
// actually observe — that the Placement is departed, or that a previous attempt
// failed — and the server remains the sole eligibility guard. That is the
// blind-settlement condition, recorded rather than designed away.
//
// Settled is the end of the lifecycle. Nothing leaves it.

import type { DepartureState, SettlingPendingState } from './departure-state.ts';
import { noDeparture } from './departure-state.ts';
import type { RetainedDraft } from './retained-draft.ts';

/** The one authoritative settlement rule, over the one lifecycle value. It
 *  asserts nothing about the interval: eligibility in the authoritative sense
 *  is the server's, and this predicate answers only what the client observes. */
export function permitsSettlement(lifecycle: DepartureState): boolean {
  return lifecycle.kind === 'departed' || lifecycle.kind === 'settlement-failed';
}

export function onSettleRequested(lifecycle: DepartureState): SettlingPendingState {
  const held = lifecycle as Extract<DepartureState, { readonly placementId: string }>;
  return {
    kind: 'settling-pending',
    placementId: held.placementId,
    artifactId: held.artifactId,
    recipients: held.recipients,
  };
}

/** One result, one lifecycle — the same discipline cancellation settles under. */
export interface SettlementSettlement {
  readonly lifecycle: DepartureState;
  readonly retainedDraft: RetainedDraft | null;
}

export function onSettled(pending: SettlingPendingState): SettlementSettlement {
  return {
    lifecycle: {
      kind: 'settled',
      placementId: pending.placementId,
      artifactId: pending.artifactId,
      recipients: pending.recipients,
    },
    retainedDraft: null,
  };
}

/** Failure preserves what the client can honestly claim: the Placement is still
 *  departing as far as it knows, the identifiers and frozen recipients stand,
 *  and a deliberate retry is available. It infers nothing about WHY — not the
 *  interval, not the race, not a prior settlement. */
export function onSettlementFailed(
  pending: SettlingPendingState,
  retainedDraft: RetainedDraft | null,
): SettlementSettlement {
  return {
    lifecycle: {
      kind: 'settlement-failed',
      placementId: pending.placementId,
      artifactId: pending.artifactId,
      recipients: pending.recipients,
    },
    retainedDraft,
  };
}

export function onAuthorizationLost(): SettlementSettlement {
  return { lifecycle: noDeparture, retainedDraft: null };
}
