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

import { buildSelfRequest, sendSelf, type BuiltRequest, type Transport } from '../api/transport.ts';

export const ARTIFACT_COUNT_PATH = '/artifacts';

export function buildArtifactCountRequest(activeSelfId: string): BuiltRequest {
  return buildSelfRequest({ method: 'GET', path: ARTIFACT_COUNT_PATH, actingSelf: activeSelfId });
}

/** Returns the authoritative count, or null when no authoritative answer was
 *  obtained. Null is not zero: a zero is an authoritative fact and renders as
 *  0, whereas null means the count is unknown and the floor is not derived
 *  from it. Nothing is substituted for an unknown count. */
export async function fetchArtifactCount(
  transport: Transport,
  activeSelfId: string,
): Promise<number | null> {
  try {
    const res = await sendSelf(transport, {
      method: 'GET',
      path: ARTIFACT_COUNT_PATH,
      actingSelf: activeSelfId,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return Array.isArray(body) ? body.length : null;
  } catch {
    return null;
  }
}
