// P10-S10 — active-Self residency (R3 as amended by P10-M6). Pure: no React,
// no DOM, no fetch.
//
// R3 fixes the mechanism and this module may not relax it: sessionStorage, ID
// ONLY, per tab. Never localStorage, never BroadcastChannel, never server-side.
// Tabs remain independent. The stored id is an assertion and never authority —
// every protected request is re-verified server-side regardless of what is
// stored here.
//
// No auto-selection, in any case: acting as a Self is a deliberate act, and a
// client that chooses for the human makes the session's first act one the human
// did not perform. A one-Self account is offered the same choice as a three-Self
// account — one option makes the choosing brief, not automatic. There is no
// lowest-slot default. Restoration is NOT auto-selection: it returns a choice
// the human already made in this tab, and only after it re-verifies.

import type { SelfSummary } from './selves.ts';

export const ACTIVE_SELF_KEY = 'selves.activeSelfId';

/** The narrow surface actually used. Only sessionStorage is ever passed here. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The single place that touches a storage global, and it reaches for
 *  sessionStorage alone. Unavailable storage — private mode, disabled storage —
 *  degrades to no persistence: selection still works, it just does not survive
 *  a reload. It is never surfaced to the human as an error state. */
export function sessionStorageOrNull(): StorageLike | null {
  try {
    const candidate = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

export function remember(store: StorageLike | null, selfId: string): void {
  try {
    store?.setItem(ACTIVE_SELF_KEY, selfId);
  } catch {
    // degrade silently; the choice simply does not outlive the tab's page
  }
}

export function forget(store: StorageLike | null): void {
  try {
    store?.removeItem(ACTIVE_SELF_KEY);
  } catch {
    // degrade silently
  }
}

function readStored(store: StorageLike | null): string | null {
  try {
    return store?.getItem(ACTIVE_SELF_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Returns a previously chosen id only if it still verifies against the
 *  authoritative list. An id absent from the returned set is discarded rather
 *  than asserted — the stored value never outranks the server's answer. With
 *  nothing stored the result is null for a one-Self account exactly as for a
 *  three-Self one: no auto-selection. */
export function restore(store: StorageLike | null, selves: SelfSummary[]): string | null {
  const stored = readStored(store);
  if (stored === null) return null;
  if (selves.some((self) => self.id === stored)) return stored;
  forget(store);
  return null;
}

/** Selection is presented whenever no verified choice is active. */
export function presentsSelection(activeSelfId: string | null): boolean {
  return activeSelfId === null;
}

/** 403: a valid session asserting an unowned Self (P10-M6). Discard the active
 *  Self and re-verify EXACTLY ONCE against the authoritative list, then return
 *  to selection. There is no retry loop: this function calls `reverify` once
 *  and returns, whatever the answer. */
export async function onForbidden(
  store: StorageLike | null,
  reverify: () => Promise<SelfSummary[]>,
): Promise<SelfSummary[]> {
  forget(store);
  return await reverify();
}

/** 401: the session is no longer valid, so no active-Self assertion is retained
 *  across it. The gate is presented by the caller (R2/P10-M5); this discards. */
export function onSessionExpired(store: StorageLike | null): void {
  forget(store);
}
