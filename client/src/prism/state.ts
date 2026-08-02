// P10-S11 corrective — the Prism floor's state transitions. Pure: no React, no
// DOM, no fetch, no storage.
//
// The floor mounts on a complete state and on nothing less: a verified active
// Self and an authoritative artifact count. R6 governs the floor once the floor
// exists; it does not authorize a two-element substitute while the count is
// unknown, so the floor renders all three elements or does not render.
//
// A completed request that yields no authoritative count RELEASES the active
// Self into selection. That consequence is deliberate: a Self the human chose
// is released by a data failure unrelated to session or authorization, ruled
// because the alternative — an unrecoverable empty surface for the rest of the
// tab session — is worse, not because releasing the Self is costless. Recovery
// is then a user-driven act through the existing selection surface, which the
// release itself brings back: no polling, no interval, no focus refetch, no
// background refresh, no routing, no retry loop.
//
// These transitions classify nothing about WHY a count was unavailable.
// Loading, a non-2xx response, a malformed payload, and a transport failure
// all arrive here as the same absence. That collapse is a recorded limitation
// of the count transport boundary and establishes no product rule.
//
// Persistence is untouched here. R3 keys storage discard to authorization
// outcomes — 403 and 401 — and an unavailable count has expressly not been
// classified as one, so no transition below emits a storage instruction. The
// persisted id survives as a restoration input only; it does not make the Self
// active again during the current page load, because restoration runs solely
// in the mount effect.

export interface FloorState {
  readonly activeSelfId: string | null;
  readonly artifactCount: number | null;
}

export const noActiveSelf: FloorState = { activeSelfId: null, artifactCount: null };

/** Start of a count request for a non-null active Self. Any count retained from
 *  a previously active Self is cleared here, so one Self's authoritative fact
 *  can never render beside another Self's name while the new request is
 *  pending. This is a state transition, not incidental wiring. */
export function onCountRequested(activeSelfId: string): FloorState {
  return { activeSelfId, artifactCount: null };
}

/** Completion. An authoritative count — including zero — retains the active
 *  Self and records the count. No authoritative count releases the Self. */
export function onCountResolved(activeSelfId: string, count: number | null): FloorState {
  return count === null ? noActiveSelf : { activeSelfId, artifactCount: count };
}

/** The floor mounts only on a complete state. */
export function presentsFloor(state: FloorState): boolean {
  return state.activeSelfId !== null && state.artifactCount !== null;
}
