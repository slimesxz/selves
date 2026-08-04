// P10-S15 — the injected asynchronous boundary for one deliberate recipient
// add. The transport, the state applier, and both authorization dispositions
// all arrive as arguments.
//
// The start is SYNCHRONOUS for the same reason creation's is. A value-in /
// promise-out boundary cannot enforce single-flight: two acts holding the same
// idle state would each read `permitsAdd` as true and each issue a POST. The
// server deduplicates by primary key, so no duplicate row results — but the
// server's idempotency is not authority for the client to issue uncontrolled
// duplicate requests, and a client counting attempts rather than acknowledged
// Selves would show a recipient set the durable rows do not support.
//
// So startCreation's shape is repeated: the transition to `adding` is applied
// before the call returns, the caller holds it before settlement exists, and a
// second act evaluated against it starts nothing.
//
// Nothing retries on its own. After a non-auth failure the retry is another
// deliberate human act against the settled failed state, which still carries
// the candidate it would use.

import type { Transport } from '../api/transport.ts';
import { addRecipient } from './recipient-mutations.ts';
import {
  onAddFailed,
  onAdded,
  onAddRequested,
  onAuthorizationLost,
  permitsAdd,
  type AddingState,
  type RecipientState,
} from './recipient-state.ts';

/** The authoritative transitions, injected so this boundary never defines its
 *  own approximation of either (P10-S12.1, extended to mutations at P10-S13). */
export interface Dispositions {
  readonly onSessionExpired: () => void;
  readonly onForbidden: () => void | Promise<void>;
}

export type AddStart =
  | { readonly kind: 'not-started'; readonly state: RecipientState }
  | {
      readonly kind: 'started';
      readonly pendingState: AddingState;
      readonly settlement: Promise<RecipientState>;
    };

export interface AddDeps {
  readonly transport: Transport;
  readonly actingSelfId: string;
  readonly placementId: string;
  readonly apply: (state: RecipientState) => void;
  readonly dispositions: Dispositions;
}

/** Synchronously accepts or declines the deliberate add. Declining issues no
 *  request — including for a state already `adding`, which is what makes a
 *  second act a no-op rather than a second attempt. */
export function startAdd(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
  state: RecipientState,
  candidateId: string,
  dispositions: Dispositions,
): AddStart {
  if (!permitsAdd(state)) return { kind: 'not-started', state };
  const pendingState = onAddRequested(state, candidateId);
  return {
    kind: 'started',
    pendingState,
    settlement: settle(transport, actingSelfId, placementId, pendingState, dispositions),
  };
}

async function settle(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
  pending: AddingState,
  dispositions: Dispositions,
): Promise<RecipientState> {
  const outcome = await addRecipient(transport, actingSelfId, placementId, pending.candidateId);
  if (outcome === 'session-expired') {
    dispositions.onSessionExpired();
    return onAuthorizationLost();
  }
  if (outcome === 'forbidden') {
    await dispositions.onForbidden();
    return onAuthorizationLost();
  }
  return outcome === 'added' ? onAdded(pending) : onAddFailed(pending);
}

/** Performs one deliberate add, applying the pending state synchronously and
 *  the settled state when it resolves. Returns what the boundary decided, so a
 *  declined act is observable rather than silent. */
export function performAdd(deps: AddDeps, state: RecipientState, candidateId: string): 'started' | 'not-started' {
  const start = startAdd(
    deps.transport,
    deps.actingSelfId,
    deps.placementId,
    state,
    candidateId,
    deps.dispositions,
  );
  if (start.kind === 'not-started') return 'not-started';
  deps.apply(start.pendingState);
  void start.settlement.then(deps.apply);
  return 'started';
}
