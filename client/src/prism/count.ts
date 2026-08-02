// P10-S11 — the authored-Artifact count, fetched Self-scoped. Pure: no React,
// no DOM, no module-level fetch; the transport is injected.
//
// The count is a fact about the acting Self's own making (R6). It is fetched
// on Prism mount for a verified active Self and on explicit navigation to that
// surface, and on no other occasion: no focus refetch, no polling, no
// interval, no background refresh, and no attachment to the account-scoped
// /auth/selves request. That is consistent with R12, which permits fetches on
// navigation and explicit human acts.
//
// The request is Self-scoped and carries the verified active Self. It reaches
// the frozen `GET /artifacts` surface; the count is the length of the returned
// owned-artifact array, and no count route exists or is invented.
//
// P10-S12.1 — a Self-scoped 401 and 403 are authorization transitions, not
// unknown counts. This read previously collapsed every non-2xx response into
// null, so a 403 became an unknown count and a 401 never reached the gate. The
// classification now runs through the existing `outcomeOf`, which is the
// committed 401/403 separation (P10-M6); no second mapping is defined here.

import { outcomeOf } from '../auth/session.ts';
import { buildSelfRequest, sendSelf, type BuiltRequest, type Transport } from '../api/transport.ts';

export const ARTIFACT_COUNT_PATH = '/artifacts';

export function buildArtifactCountRequest(activeSelfId: string): BuiltRequest {
  return buildSelfRequest({ method: 'GET', path: ARTIFACT_COUNT_PATH, actingSelf: activeSelfId });
}

/** The four outcomes of the count read, kept distinct because they are four
 *  different facts. `count` is authoritative and includes zero. `unknown` is a
 *  non-auth failure and is not zero: nothing is substituted for it. The two
 *  authorization outcomes are not unknown counts and never render as one. */
export type CountOutcome =
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'forbidden' };

const UNKNOWN: CountOutcome = { kind: 'unknown' };

export async function fetchArtifactCount(
  transport: Transport,
  activeSelfId: string,
): Promise<CountOutcome> {
  try {
    const res = await sendSelf(transport, {
      method: 'GET',
      path: ARTIFACT_COUNT_PATH,
      actingSelf: activeSelfId,
    });
    if (!res.ok) {
      const outcome = outcomeOf(res.status);
      if (outcome.kind === 'unauthenticated') return { kind: 'session-expired' };
      if (outcome.kind === 'forbidden') return { kind: 'forbidden' };
      return UNKNOWN;
    }
    const body: unknown = await res.json();
    return Array.isArray(body) ? { kind: 'count', count: body.length } : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}
