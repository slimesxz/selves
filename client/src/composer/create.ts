// P10-S13 — the injected asynchronous orchestration boundary for the ruled
// two-stage creating act. Pure in the sense that matters: the transport and
// both authorization dispositions are injected, so the whole act is provable
// without a browser.
//
// The start is SYNCHRONOUS and this is the load-bearing part. A value-in /
// promise-out boundary cannot enforce single-flight: two deliberate acts
// holding the same `composing` state would each read `nextRequest` as
// 'artifact' before either promise settled, and each would issue its own
// POST /artifacts. On the client's first irreversible write path that means
// duplicate Artifacts, and an orphan Artifact with no Placement is invisible
// to the human and unremovable through any surface that exists.
//
// So `startCreation` decides acceptance and applies the transition to
// `creating` before it returns. The caller holds the pending state before any
// transport can settle, and a second act evaluated against that state sees
// `nextRequest === null` and starts nothing. No controller, identity,
// retention, disposal, or lifecycle is introduced to achieve it.
//
// The settlement promise carries only the later state. It never carries the
// pending one, because the pending one has already been handed over.

import type { Transport } from '../api/transport.ts';
import { createArtifact, createPlacementDraft } from './mutations.ts';
import {
  nextRequest,
  onArtifactCreated,
  onAuthorizationLost,
  onCreateRequested,
  onCreationFailed,
  onPlacementCreated,
  type ComposerState,
  type CreatingState,
} from './state.ts';

/** The authoritative transitions, injected so this boundary never defines its
 *  own approximation of either (P10-S12.1). */
export interface Dispositions {
  readonly onSessionExpired: () => void;
  readonly onForbidden: () => void | Promise<void>;
}

export type CreationStart =
  | { readonly kind: 'not-started'; readonly state: ComposerState }
  | {
      readonly kind: 'started';
      readonly pendingState: CreatingState;
      readonly settlement: Promise<ComposerState>;
    };

/** Synchronously accepts or declines the deliberate act. Declining issues no
 *  request at all — including for a state that is already `creating`, which is
 *  what makes a second act a no-op rather than a second attempt. */
export function startCreation(
  transport: Transport,
  actingSelfId: string,
  state: ComposerState,
  dispositions: Dispositions,
): CreationStart {
  const stage = nextRequest(state);
  if (stage === null) return { kind: 'not-started', state };
  const pendingState = onCreateRequested(state, stage);
  return { kind: 'started', pendingState, settlement: settle(transport, actingSelfId, pendingState, dispositions) };
}

async function settle(
  transport: Transport,
  actingSelfId: string,
  pending: CreatingState,
  dispositions: Dispositions,
): Promise<ComposerState> {
  let working = pending;

  if (working.stage === 'artifact') {
    const artifact = await createArtifact(transport, actingSelfId, working.text);
    if (artifact.kind === 'session-expired') {
      dispositions.onSessionExpired();
      return onAuthorizationLost();
    }
    if (artifact.kind === 'forbidden') {
      await dispositions.onForbidden();
      return onAuthorizationLost();
    }
    if (artifact.kind !== 'created') return onCreationFailed(working);
    // The id is authoritative from here; a later retry never re-creates it.
    working = onArtifactCreated(working, artifact.id);
  }

  const placement = await createPlacementDraft(transport, actingSelfId, working.artifactId as string);
  if (placement.kind === 'session-expired') {
    dispositions.onSessionExpired();
    return onAuthorizationLost();
  }
  if (placement.kind === 'forbidden') {
    await dispositions.onForbidden();
    return onAuthorizationLost();
  }
  if (placement.kind !== 'created') return onCreationFailed(working);
  return onPlacementCreated(working, placement.id);
}
