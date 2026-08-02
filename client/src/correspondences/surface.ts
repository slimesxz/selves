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

import { deriveCorrespondences, type CorrespondenceGroup } from './derive.ts';
import type { ReadOutcome } from './read.ts';
import type { SelfSummary } from '../self/selves.ts';

export const CORRESPONDENCES_STATES = ['pending', 'projection', 'unavailable'] as const;
export type CorrespondencesStateKind = (typeof CORRESPONDENCES_STATES)[number];

export type CorrespondencesState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'projection'; readonly groups: readonly CorrespondenceGroup[] }
  | { readonly kind: 'unavailable' };

export type Surface =
  | { readonly kind: 'prism' }
  | { readonly kind: 'correspondences'; readonly state: CorrespondencesState };

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
