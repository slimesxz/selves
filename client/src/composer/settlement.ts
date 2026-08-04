// P10-S19 — the injected asynchronous boundary for one deliberate settlement.
//
// Startability comes from `permitsSettlement` and nothing else. No second
// eligibility rule exists here, in the component, or in the shell.
//
// The start is synchronous, for the fourth and last lifecycle act: two acts
// holding the same departed lifecycle would each pass the guard before either
// settled, and this one crosses the recipient boundary.
//
// Settlement resolves to ONE result carrying the settled lifecycle and the null
// retained draft together, so terminality holds before any hook-bound call site.
// After it, the very same value makes departure, cancellation, and a second
// settlement all unstartable — not by hiding controls, but because the
// authoritative predicates are positive whitelists that never named it.

import type { Transport } from '../api/transport.ts';
import type { DepartureState, SettlingPendingState } from './departure-state.ts';
import type { Dispositions } from './recipient-add.ts';
import type { RetainedDraft } from './retained-draft.ts';
import { settlePlacement } from './settlement-mutations.ts';
import {
  onAuthorizationLost,
  onSettleRequested,
  onSettled,
  onSettlementFailed,
  permitsSettlement,
  type SettlementSettlement,
} from './settlement-state.ts';

export type SettlementStart =
  | { readonly kind: 'not-started'; readonly state: DepartureState }
  | {
      readonly kind: 'started';
      readonly pendingState: SettlingPendingState;
      readonly settlement: Promise<SettlementSettlement>;
    };

export interface SettlementDeps {
  readonly transport: Transport;
  readonly actingSelfId: string;
  readonly apply: (settlement: SettlementSettlement) => void;
  readonly dispositions: Dispositions;
}

/** Synchronously accepts or declines. A refusal returns the exact unchanged
 *  lifecycle value and issues nothing. */
export function startSettlement(
  transport: Transport,
  actingSelfId: string,
  lifecycle: DepartureState,
  retainedDraft: RetainedDraft | null,
  dispositions: Dispositions,
): SettlementStart {
  if (!permitsSettlement(lifecycle)) return { kind: 'not-started', state: lifecycle };
  const pendingState = onSettleRequested(lifecycle);
  return {
    kind: 'started',
    pendingState,
    settlement: settle(transport, actingSelfId, pendingState, retainedDraft, dispositions),
  };
}

async function settle(
  transport: Transport,
  actingSelfId: string,
  pending: SettlingPendingState,
  retainedDraft: RetainedDraft | null,
  dispositions: Dispositions,
): Promise<SettlementSettlement> {
  const outcome = await settlePlacement(transport, actingSelfId, pending.placementId);
  if (outcome === 'session-expired') {
    dispositions.onSessionExpired();
    return onAuthorizationLost();
  }
  if (outcome === 'forbidden') {
    await dispositions.onForbidden();
    return onAuthorizationLost();
  }
  return outcome === 'settled' ? onSettled(pending) : onSettlementFailed(pending, retainedDraft);
}

/** Performs one deliberate settlement, applying the pending lifecycle
 *  synchronously and the terminal result when it resolves. */
export function performSettlement(
  deps: SettlementDeps,
  lifecycle: DepartureState,
  retainedDraft: RetainedDraft | null,
): 'started' | 'not-started' {
  const start = startSettlement(deps.transport, deps.actingSelfId, lifecycle, retainedDraft, deps.dispositions);
  if (start.kind === 'not-started') return 'not-started';
  deps.apply({ lifecycle: start.pendingState, retainedDraft });
  void start.settlement.then(deps.apply);
  return 'started';
}
