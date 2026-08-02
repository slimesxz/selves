// P10-S12.2 — settlement of the forbidden transition. Pure: no React, no DOM,
// no fetch; the single re-verification is injected.
//
// R3 requires that a 403 discard the active Self and re-verify exactly once.
// The committed P10-S12.1 call site discarded the persisted id first and then
// awaited the re-verification, so a REJECTING attempt — a transport throw, or a
// malformed body on a 2xx — left the transition half-finished: the persisted id
// gone, the in-memory active Self still the Self the server refused, the
// rejection escaping uncaught, and Correspondences able to remain pending
// forever. That is the inverse of the P10-S11 recovery state and no ruling
// authorizes it.
//
// This module settles the transition. Containment and completion are BOTH
// required and neither implies the other: a `finally` alone would complete the
// mutations while letting the rejection escape, and a `catch` alone would
// contain it without structurally guaranteeing the mutations. Here the `catch`
// contains, and the single unconditional `return` below — the function's only
// return statement, placed outside the try — is what guarantees completion on
// every path.
//
// The settled state carries no discriminator between a completed non-auth
// response and a rejecting attempt. Both branches terminate in the same place,
// so a runtime discriminator would carry information no ruled behavior
// consumes. The difference remains one of evidence and provenance, not of type.
// Should a future ruling give the completed-response branch its own terminal
// surface, that ruling reopens this return type; implementation does not.
//
// Nothing here classifies authentication. A settlement is never an
// authentication outcome, never presents the gate, and never manufactures a
// 401: the account session is still valid, and what could not be established is
// authoritative Self context.

import { prismSurface, type Surface } from '../correspondences/surface.ts';
import { onForbidden, type StorageLike } from './active.ts';
import type { SelfSummary } from './selves.ts';

/** The completed R3 transition: the authoritative list such as it is, no active
 *  Self, and a surface that is not Correspondences pending. */
export interface ForbiddenSettlement {
  readonly selves: SelfSummary[];
  readonly activeSelfId: null;
  readonly surface: Surface;
}

/** Runs the one permitted re-verification and settles whatever it does. This
 *  function does not reject. There is no retry: `onForbidden` calls `reverify`
 *  once and this settles the single answer, including no answer at all. */
export async function settleForbidden(
  store: StorageLike | null,
  reverify: () => Promise<SelfSummary[]>,
): Promise<ForbiddenSettlement> {
  let listed: SelfSummary[] = [];
  try {
    listed = await onForbidden(store, reverify);
  } catch {
    // Contained here and nowhere else: not retried, not classified, not
    // re-thrown. The transition must complete however the one attempt ended.
    listed = [];
  }
  return { selves: listed, activeSelfId: null, surface: prismSurface };
}
