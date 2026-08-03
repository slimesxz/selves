// P10-S13 — the Composer's creation state. Synchronous, transport-free, and
// callback-free by ruling: no async, no fetch, no dispositions. Request
// execution and authorization callbacks live in create.ts and nowhere else.
//
// The committed substrate forces two mutations in order — an Artifact must
// exist and be authored by the acting Self before a draft Placement can name
// it — so a single human act spans two authoritative boundaries. This module
// is where that fact becomes a state machine rather than a sequence of calls.
//
// `nextRequest` is the single enforcement point for four separate rules, which
// is why it exists at all rather than being inlined at the call site:
//
//   - no Artifact is created while the human is still composing;
//   - an empty or whitespace-only text cannot begin the act;
//   - creation is single-flight — a state already `creating` requests nothing;
//   - retry resumes from the last authoritative boundary, so a retained
//     Artifact id sends the next attempt straight to the Placement stage and
//     no second Artifact is ever created.
//
// A completed draft requests nothing further. The returned identifiers are
// held here in memory only: nothing in this module persists them, and nothing
// here instructs any surface to display them.

export type CreationStage = 'artifact' | 'placement';

/** The pending state. Named because create.ts returns it synchronously, before
 *  any transport can settle — that is what makes single-flight enforceable. */
export interface CreatingState {
  readonly kind: 'creating';
  readonly text: string;
  readonly stage: CreationStage;
  /** Authoritative once the Artifact stage has succeeded; null before that. */
  readonly artifactId: string | null;
}

export type ComposerState =
  | { readonly kind: 'composing'; readonly text: string }
  | CreatingState
  | {
      readonly kind: 'failed';
      readonly text: string;
      readonly stage: CreationStage;
      readonly artifactId: string | null;
    }
  | { readonly kind: 'created'; readonly artifactId: string; readonly placementId: string };

export const initialComposer: ComposerState = { kind: 'composing', text: '' };

export function withText(state: ComposerState, text: string): ComposerState {
  if (state.kind === 'created' || state.kind === 'creating') return state;
  return { ...state, text };
}

/** The permitted next request, or null where the deliberate act may not begin.
 *  Null for a pending attempt and for a completed draft, so neither can issue
 *  a second one. */
export function nextRequest(state: ComposerState): CreationStage | null {
  switch (state.kind) {
    case 'composing':
      return state.text.trim().length > 0 ? 'artifact' : null;
    case 'failed':
      // Retry from the last authoritative boundary: a retained Artifact id is
      // authoritative and is never re-created.
      if (state.artifactId !== null) return 'placement';
      return state.text.trim().length > 0 ? 'artifact' : null;
    case 'creating':
    case 'created':
      return null;
  }
}

/** Applies the transition into `creating`. Total: the caller resolves `stage`
 *  from `nextRequest` and calls this only for an accepted act. */
export function onCreateRequested(state: ComposerState, stage: CreationStage): CreatingState {
  const text = state.kind === 'created' ? '' : state.text;
  const artifactId = state.kind === 'composing' || state.kind === 'created' ? null : state.artifactId;
  return { kind: 'creating', text, stage, artifactId };
}

/** The Artifact stage succeeded; its id is authoritative from here on. */
export function onArtifactCreated(state: CreatingState, artifactId: string): CreatingState {
  return { kind: 'creating', text: state.text, stage: 'placement', artifactId };
}

export function onPlacementCreated(state: CreatingState, placementId: string): ComposerState {
  // Unreachable without an authoritative Artifact id: the Placement stage is
  // entered only through onArtifactCreated or a retained id.
  return { kind: 'created', artifactId: state.artifactId as string, placementId };
}

/** Non-auth failure. Records which stage failed, preserves the composed text
 *  and any authoritative Artifact id, and invents no Placement id. */
export function onCreationFailed(state: CreatingState): ComposerState {
  return { kind: 'failed', text: state.text, stage: state.stage, artifactId: state.artifactId };
}

/** 401 or 403: the acting Self under which the attempt was made is no longer
 *  authoritative, so the attempt is abandoned rather than failed. */
export function onAuthorizationLost(): ComposerState {
  return initialComposer;
}
