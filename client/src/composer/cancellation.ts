// P10-S18 — the injected asynchronous boundary for one deliberate cancellation.
//
// Startability is decided by `permitsCancellation` and by nothing else. No
// second eligibility rule exists here, in the component, or in the shell: a
// control may derive its visibility from the same predicate, but a control that
// offered what this boundary would refuse is the divergence a single
// authoritative rule exists to prevent.
//
// The start is synchronous, for the same reason it has been three times before:
// two acts holding the same eligible lifecycle would each pass the guard before
// either settled.
//
// Settlement resolves to ONE CancellationSettlement carrying the cancelled
// lifecycle and the null retained draft together. The shell applies that result;
// it does not compose it. That is what makes terminality hold before any
// hook-bound call site rather than because of one — and it is why, after
// success, the departure boundary refuses on the very same value.

import type { Transport } from '../api/transport.ts';
import { cancelPlacement } from './cancellation-mutations.ts';
import {
  onAuthorizationLost,
  onCancelRequested,
  onCancellationFailed,
  onCancelled,
  permitsCancellation,
  type CancellationSettlement,
} from './cancellation-state.ts';
import type { CancellingPendingState, DepartureState } from './departure-state.ts';
import type { Dispositions } from './recipient-add.ts';
import type { RetainedDraft } from './retained-draft.ts';

export type CancellationStart =
  | { readonly kind: 'not-started'; readonly state: DepartureState }
  | {
      readonly kind: 'started';
      readonly pendingState: CancellingPendingState;
      readonly settlement: Promise<CancellationSettlement>;
    };

export interface CancellationDeps {
  readonly transport: Transport;
  readonly actingSelfId: string;
  readonly apply: (settlement: CancellationSettlement) => void;
  readonly dispositions: Dispositions;
}

/** Synchronously accepts or declines. A refusal returns the exact unchanged
 *  lifecycle value and issues nothing. */
export function startCancellation(
  transport: Transport,
  actingSelfId: string,
  lifecycle: DepartureState,
  retainedDraft: RetainedDraft | null,
  dispositions: Dispositions,
): CancellationStart {
  if (!permitsCancellation(lifecycle)) return { kind: 'not-started', state: lifecycle };
  const pendingState = onCancelRequested(lifecycle);
  return {
    kind: 'started',
    pendingState,
    settlement: settle(transport, actingSelfId, pendingState, retainedDraft, dispositions),
  };
}

async function settle(
  transport: Transport,
  actingSelfId: string,
  pending: CancellingPendingState,
  retainedDraft: RetainedDraft | null,
  dispositions: Dispositions,
): Promise<CancellationSettlement> {
  const outcome = await cancelPlacement(transport, actingSelfId, pending.placementId);
  if (outcome === 'session-expired') {
    dispositions.onSessionExpired();
    return onAuthorizationLost();
  }
  if (outcome === 'forbidden') {
    await dispositions.onForbidden();
    return onAuthorizationLost();
  }
  return outcome === 'cancelled' ? onCancelled(pending) : onCancellationFailed(pending, retainedDraft);
}

/** Performs one deliberate cancellation, applying the pending lifecycle
 *  synchronously and the joint settlement when it resolves. */
export function performCancellation(
  deps: CancellationDeps,
  lifecycle: DepartureState,
  retainedDraft: RetainedDraft | null,
): 'started' | 'not-started' {
  const start = startCancellation(deps.transport, deps.actingSelfId, lifecycle, retainedDraft, deps.dispositions);
  if (start.kind === 'not-started') return 'not-started';
  deps.apply({ lifecycle: start.pendingState, retainedDraft });
  void start.settlement.then(deps.apply);
  return 'started';
}
