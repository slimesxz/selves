// P10-S16 — the injected asynchronous boundary for one deliberate recipient
// removal. Sibling to recipient-add.ts rather than an extension of it: state,
// transport, and orchestration stay separate, and add and remove each own their
// own orchestration.
//
// The start is synchronous for the reason already proved twice: a value-in /
// promise-out boundary cannot enforce single-flight, because two acts holding
// the same idle state would each pass the guard before either settled. Here the
// guard is stronger than "not already removing" — `permitsRemove` refuses any
// state representing an unsettled recipient mutation, so a removal cannot begin
// while an add is outstanding and vice versa. Neither orchestration module can
// see the other's pending work; the shared state is what makes the invariant
// enforceable rather than conventional.
//
// Local absence is established only on acknowledgement. Nothing is removed
// optimistically: a 204 is evidence that this recipient is absent after the
// mutation, and until it arrives the client keeps showing what it knows.
//
// Nothing retries on its own. After a non-auth failure the retry is another
// deliberate act against the settled state, which still carries its target.

import type { Transport } from '../api/transport.ts';
import { removeRecipient } from './recipient-mutations.ts';
import {
  onAuthorizationLost,
  onRemoveFailed,
  onRemoveRequested,
  onRemoved,
  permitsRemove,
  type RecipientState,
  type RemovingState,
} from './recipient-state.ts';
import type { Dispositions } from './recipient-add.ts';

export type RemoveStart =
  | { readonly kind: 'not-started'; readonly state: RecipientState }
  | {
      readonly kind: 'started';
      readonly pendingState: RemovingState;
      readonly settlement: Promise<RecipientState>;
    };

export interface RemoveDeps {
  readonly transport: Transport;
  readonly actingSelfId: string;
  readonly placementId: string;
  readonly apply: (state: RecipientState) => void;
  readonly dispositions: Dispositions;
}

/** Synchronously accepts or declines the deliberate removal. Declining issues no
 *  request — including while an add or another removal is unsettled. */
export function startRemove(
  transport: Transport,
  actingSelfId: string,
  placementId: string,
  state: RecipientState,
  targetId: string,
  dispositions: Dispositions,
): RemoveStart {
  if (!permitsRemove(state)) return { kind: 'not-started', state };
  const pendingState = onRemoveRequested(state, targetId);
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
  pending: RemovingState,
  dispositions: Dispositions,
): Promise<RecipientState> {
  const outcome = await removeRecipient(transport, actingSelfId, placementId, pending.targetId);
  if (outcome === 'session-expired') {
    dispositions.onSessionExpired();
    return onAuthorizationLost();
  }
  if (outcome === 'forbidden') {
    await dispositions.onForbidden();
    return onAuthorizationLost();
  }
  return outcome === 'added' ? onRemoved(pending) : onRemoveFailed(pending);
}

/** Performs one deliberate removal, applying the pending state synchronously and
 *  the settled state when it resolves. */
export function performRemove(deps: RemoveDeps, state: RecipientState, targetId: string): 'started' | 'not-started' {
  const start = startRemove(
    deps.transport,
    deps.actingSelfId,
    deps.placementId,
    state,
    targetId,
    deps.dispositions,
  );
  if (start.kind === 'not-started') return 'not-started';
  deps.apply(start.pendingState);
  void start.settlement.then(deps.apply);
  return 'started';
}
