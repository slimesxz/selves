// P10-S12 — the surface state machine (§13.6-A, §13.6-B; UNFILED under
// P10-J6). Pure: no React, no DOM, no fetch.
//
// The Correspondences read state is AT LEAST THREE-VALUED — pending,
// projection, unavailable — as a state-machine requirement. A two-state
// encoding that collapses pending into either projection or unavailability
// does not satisfy the ruling: a reader must be able to tell "not yet" from
// "not available" from "here it is, and it is empty".
//
// Continue opens the unselected top-level surface. Return is its inverse and
// nothing more: no router, URL, history, persistence, fetch, selection, or
// active-Self change. A subsequent Continue re-attempts the read — one attempt
// per deliberate human act.
//
// P10-S14 — the union gains a Composer member, reached by an explicit Compose
// act from the top-level Correspondences surface. It carries the Correspondences
// state it departed from, and that is not bookkeeping: leaving the Composer must
// reach top-level Correspondences AND must not refresh it. Returning to a
// `pending` state would fire the read effect, which is a refresh; returning to a
// synthesised `projection` would invent data. Carrying the departed state is the
// only mechanism that satisfies both, and it stays entirely in memory.

import { deriveCorrespondences, type CorrespondenceGroup } from './derive.ts';
import type { ReadOutcome } from './read.ts';
import type { ComposerState } from '../composer/state.ts';
import type { RecipientState } from '../composer/recipient-state.ts';
import type { RetainedDraft } from '../composer/retained-draft.ts';
import type { SelfSummary } from '../self/selves.ts';

export const CORRESPONDENCES_STATES = ['pending', 'projection', 'unavailable'] as const;
export type CorrespondencesStateKind = (typeof CORRESPONDENCES_STATES)[number];

export type CorrespondencesState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'projection'; readonly groups: readonly CorrespondenceGroup[] }
  | { readonly kind: 'unavailable' };

export type Surface =
  | { readonly kind: 'prism' }
  | { readonly kind: 'correspondences'; readonly state: CorrespondencesState }
  | {
      readonly kind: 'composer';
      readonly from: CorrespondencesState;
      /** P10-S16 — the exact retained draft-management value a guarded reopen
       *  restores, or null for a Composer opened fresh by Compose. */
      readonly draft: RetainedDraft | null;
    };

export type ComposerSurface = Extract<Surface, { readonly kind: 'composer' }>;

export const prismSurface: Surface = { kind: 'prism' };

/** Continue: opens the unselected top-level surface, read outstanding. It
 *  selects no counterpart, jumps to nothing, and establishes no ordering
 *  beyond the derivation's own. */
export function onContinue(): Surface {
  return { kind: 'correspondences', state: { kind: 'pending' } };
}

/** Return: the exact inverse of Continue. It fetches nothing. */
export function onReturn(): Surface {
  return prismSurface;
}

/** Compose: the explicit act that opens the Composer from top-level
 *  Correspondences. It selects no counterpart, pre-fills no recipient, and
 *  issues nothing — the Composer opens empty and asks the server for nothing. */
export function onCompose(from: CorrespondencesState): Surface {
  return { kind: 'composer', from, draft: null };
}

/** Leaving the Composer. The guard lives HERE rather than in the absence of a
 *  rendered control, so an unsettled two-stage creation attempt cannot be
 *  abandoned even by a caller that invokes the transition directly.
 *
 *  While `creating`, the SAME surface object is returned — not an equal one.
 *  A reconstruction would be indistinguishable by `kind` while silently losing
 *  or altering the carried `from`, which is the whole reason return can restore
 *  Correspondences without re-reading it. */
export function onLeaveComposer(
  surface: ComposerSurface,
  composerState: ComposerState,
  recipientState: RecipientState,
): Surface {
  if (composerState.kind === 'creating') return surface;
  // P10-S16 — an unsettled recipient mutation may not be walked away from. Its
  // server outcome is unknown at the instant of leaving, and the surface whose
  // content that outcome determines is the one being left. A later settlement
  // writing into retained state does not make the departure safe; it only makes
  // the result observable to someone who happens to come back.
  if (recipientState.kind === 'adding' || recipientState.kind === 'removing') return surface;
  return { kind: 'correspondences', state: surface.from };
}

/** All-or-none: only an `ok` outcome yields a projection. 401 and 403 are
 *  classified for the existing session and forbidden transitions and are not
 *  represented as unavailability here; the caller routes them. */
export function onReadResolved(
  outcome: ReadOutcome,
  activeSelfId: string,
  selves: readonly SelfSummary[],
): CorrespondencesState {
  if (outcome.kind !== 'ok') return { kind: 'unavailable' };
  return {
    kind: 'projection',
    groups: deriveCorrespondences(outcome.placements, outcome.recipients, activeSelfId, selves),
  };
}
