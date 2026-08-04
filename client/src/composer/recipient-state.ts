// P10-S15 — recipient state for a completed draft. Synchronous, transport-free,
// callback-free.
//
// This is the ONE authoritative home for recipient state, and it lives outside
// ComposerState deliberately. The committed creation shape
// `{ kind: 'created', artifactId, placementId }` is not widened to carry
// recipients: candidate display, the add request, the successful update, retry,
// and recipient presentation all derive from the state here, so there is no
// second list and no parallel optimistic one to drift from it.
//
// What the client knows is bounded by what it observed. A 204 is authoritative
// evidence that the acknowledged add completed — that this recipient is now
// present. It is not evidence of the server's complete recipient set, and
// nothing here infers one. There is no read-after-write.
//
// Deduplication lives at onAdded rather than at the request boundary. The
// server's add is idempotent by primary key, so a repeat legitimately returns
// 204; recording one recipient per REQUEST rather than per Self would let the
// local set diverge from the durable rows it is supposed to describe.

import { labelSelves, type SelfSummary } from '../self/selves.ts';

export interface RecipientCandidate {
  readonly id: string;
  readonly label: string;
}

/** The pending state, named because recipient-add.ts returns it synchronously
 *  before any transport can settle — the same discipline creation uses. */
export interface AddingState {
  readonly kind: 'adding';
  readonly recipients: readonly string[];
  readonly candidateId: string;
}

/** The pending removal. Symmetric with AddingState, and named separately so the
 *  one-pending-mutation invariant can distinguish which act is outstanding. */
export interface RemovingState {
  readonly kind: 'removing';
  readonly recipients: readonly string[];
  readonly targetId: string;
}

export type RecipientState =
  | { readonly kind: 'idle'; readonly recipients: readonly string[] }
  | AddingState
  | RemovingState
  | { readonly kind: 'failed'; readonly recipients: readonly string[]; readonly candidateId: string }
  | { readonly kind: 'remove-failed'; readonly recipients: readonly string[]; readonly targetId: string };

export const noRecipients: RecipientState = { kind: 'idle', recipients: [] };

/** Candidates are the account-local Selves minus the active Self. The server
 *  would permit a Text Placement to address its sender; this client does not
 *  offer that. Labels are computed over EXACTLY the array returned here, so a
 *  collision can never be decided against a Self the human cannot see. */
export function deriveCandidates(selves: SelfSummary[], activeSelfId: string): RecipientCandidate[] {
  return labelSelves(selves.filter((self) => self.id !== activeSelfId));
}

/** At most one recipient mutation may be pending at any instant.
 *
 *  This is a positive whitelist rather than a negative test, and the difference
 *  is load-bearing. P10-S15 wrote `state.kind !== 'adding'`, which was correct
 *  while `adding` was the only pending kind — but widening the union at P10-S16
 *  would have made it answer true for `removing`, letting an add begin while a
 *  removal was still unsettled. A whitelist inherits the invariant for any later
 *  mutation kind without needing a new exception clause each time.
 *
 *  It also has to live here rather than inside either orchestration module:
 *  `recipient-add.ts` and `recipient-remove.ts` cannot see each other's pending
 *  work, and neither may rely only on its own suppression while the shared state
 *  permits the other act. */
export function permitsMutation(state: RecipientState): boolean {
  return state.kind === 'idle' || state.kind === 'failed' || state.kind === 'remove-failed';
}

/** Kept as the name `recipient-add.ts` imports; it is the shared invariant. */
export function permitsAdd(state: RecipientState): boolean {
  return permitsMutation(state);
}

export function permitsRemove(state: RecipientState): boolean {
  return permitsMutation(state);
}

export function onAddRequested(state: RecipientState, candidateId: string): AddingState {
  return { kind: 'adding', recipients: state.recipients, candidateId };
}

export function onRemoveRequested(state: RecipientState, targetId: string): RemovingState {
  return { kind: 'removing', recipients: state.recipients, targetId };
}

/** The acknowledged recipient is now absent. Total and set-based: applied to an
 *  id the client does not hold, it returns the set unchanged. That totality is a
 *  defensive property of the reducer, not a user-visible action — Rule B keeps
 *  unknown-recipient removal off the surface and out of the request path. No
 *  historical removal entry is recorded and no absence state is invented. */
export function onRemoved(state: RemovingState): RecipientState {
  return { kind: 'idle', recipients: state.recipients.filter((id) => id !== state.targetId) };
}

/** One non-auth removal-failure state, preserving the known set and the target a
 *  deliberate retry would reuse. It is a distinct variant from the add failure
 *  because that one is pinned by an accepted test at its exact shape; widening
 *  or renaming it would be a compatibility edit this sub-step is not assigned. */
export function onRemoveFailed(state: RemovingState): RecipientState {
  return { kind: 'remove-failed', recipients: state.recipients, targetId: state.targetId };
}

/** The acknowledged recipient is now present. Deduplicated by Self id: a
 *  repeated idempotent add records one recipient, not one entry per request. */
export function onAdded(state: AddingState): RecipientState {
  const recipients = state.recipients.includes(state.candidateId)
    ? state.recipients
    : [...state.recipients, state.candidateId];
  return { kind: 'idle', recipients };
}

/** One non-auth failure state. It preserves what is known — the recipients
 *  already acknowledged and the candidate a deliberate retry would use — and
 *  claims nothing about the Placement's later state. */
export function onAddFailed(state: AddingState): RecipientState {
  return { kind: 'failed', recipients: state.recipients, candidateId: state.candidateId };
}

/** 401 or 403: the acting Self under which the attempt was made is no longer
 *  authoritative, so the attempt is abandoned rather than failed. */
export function onAuthorizationLost(): RecipientState {
  return noRecipients;
}
