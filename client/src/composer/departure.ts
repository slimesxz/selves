// P10-S17 — the injected asynchronous boundary for one deliberate departure.
//
// Startability is decided by `permitsDeparture` and by nothing else. This module
// implements no second eligibility rule, and neither does the component or the
// shell: a control may derive its visibility from the same predicate, but a
// control that offered what this boundary would refuse is exactly the divergence
// a single authoritative rule exists to prevent.
//
// The start is synchronous, for the third time and for the same reason: two acts
// holding the same eligible state would each pass the guard before either
// settled, and here the duplicate would be a second attempt to begin an
// irreversible transition.
//
// Settlement resolves to ONE DepartureSettlement carrying both effects together.
// The shell applies that result; it does not compose it. That is what makes the
// exclusivity invariant — never both retained draft and departing — hold before
// any hook-bound call site rather than because of one.

import type { Transport } from '../api/transport.ts';
import { beginDeparture } from './departure-mutations.ts';
import {
  onAuthorizationLost,
  onDepartureFailed,
  onDepartureRequested,
  onDeparted,
  permitsDeparture,
  type DepartingPendingState,
  type DepartureSettlement,
  type DepartureState,
} from './departure-state.ts';
import type { Dispositions } from './recipient-add.ts';
import type { RecipientState } from './recipient-state.ts';
import type { RetainedDraft } from './retained-draft.ts';
import type { ComposerState } from './state.ts';

export type DepartureStart =
  | { readonly kind: 'not-started'; readonly state: DepartureState }
  | {
      readonly kind: 'started';
      readonly pendingState: DepartingPendingState;
      readonly settlement: Promise<DepartureSettlement>;
    };

export interface DepartureDeps {
  readonly transport: Transport;
  readonly actingSelfId: string;
  readonly apply: (settlement: DepartureSettlement) => void;
  readonly dispositions: Dispositions;
}

/** Synchronously accepts or declines the deliberate departure. A refusal returns
 *  the exact unchanged departure state and issues nothing. */
export function startDeparture(
  transport: Transport,
  actingSelfId: string,
  composer: ComposerState,
  recipients: RecipientState,
  departure: DepartureState,
  retainedDraft: RetainedDraft | null,
  dispositions: Dispositions,
): DepartureStart {
  if (!permitsDeparture(composer, recipients, departure)) return { kind: 'not-started', state: departure };
  // permitsDeparture has already established the composer is `created`.
  const created = composer as Extract<ComposerState, { readonly kind: 'created' }>;
  const pendingState = onDepartureRequested(created, recipients);
  return {
    kind: 'started',
    pendingState,
    settlement: settle(transport, actingSelfId, pendingState, retainedDraft, dispositions),
  };
}

async function settle(
  transport: Transport,
  actingSelfId: string,
  pending: DepartingPendingState,
  retainedDraft: RetainedDraft | null,
  dispositions: Dispositions,
): Promise<DepartureSettlement> {
  const outcome = await beginDeparture(transport, actingSelfId, pending.placementId);
  if (outcome === 'session-expired') {
    dispositions.onSessionExpired();
    return onAuthorizationLost();
  }
  if (outcome === 'forbidden') {
    await dispositions.onForbidden();
    return onAuthorizationLost();
  }
  return outcome === 'departed' ? onDeparted(pending) : onDepartureFailed(pending, retainedDraft);
}

/** Performs one deliberate departure, applying the pending state synchronously
 *  and the joint settlement when it resolves. */
export function performDeparture(
  deps: DepartureDeps,
  composer: ComposerState,
  recipients: RecipientState,
  departure: DepartureState,
  retainedDraft: RetainedDraft | null,
): 'started' | 'not-started' {
  const start = startDeparture(
    deps.transport,
    deps.actingSelfId,
    composer,
    recipients,
    departure,
    retainedDraft,
    deps.dispositions,
  );
  if (start.kind === 'not-started') return 'not-started';
  deps.apply({ departure: start.pendingState, retainedDraft });
  void start.settlement.then(deps.apply);
  return 'started';
}
