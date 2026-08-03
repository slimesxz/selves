// P10-S12.3 — the authoritative account load. Pure: no React, no DOM, no
// module-level fetch; the transport is injected.
//
// One request to the frozen account-scoped `GET /auth/selves` surface, and one
// classification of its answer. Two call sites use it: the one-time mount
// effect, and the successful-authentication path. Before this sub-step the
// second did not exist — authenticating set the session outcome to `ok` while
// the Self list stayed empty, and because the mount effect's dependency array
// is `[]` and cannot re-run within a page load, nothing could ever populate it.
// The human authenticated successfully and arrived at an empty shell.
//
// This module does NOT read or write persisted storage, and in particular it
// never calls `restore`. That is a soundness property, not a convenience: R3's
// restore-loop proof rests on `restore` being reachable from exactly one
// `[]`-keyed effect that cannot re-run within a page load. Keeping the load
// storage-free leaves that call site count at one and the proof untouched.
//
// It is also correct on its own terms. R2/P10-M5 confine the authentication
// gate to 401, and both 401 paths discard the persisted id before the gate can
// appear, so there is nothing left to restore after authentication succeeds —
// `restore` would return null by construction. The human re-chooses, which is
// the ordinary selection act and not a loss.

import { sendAccount, type Transport } from '../api/transport.ts';
import { outcomeOf } from '../auth/session.ts';
import { parseSelves, type SelfSummary } from './selves.ts';

export const SELVES_PATH = '/auth/selves';

/** The three answers the load can produce. `unauthenticated` is the 401
 *  transition and never an ordinary data failure; `unavailable` is every
 *  non-auth failure and never an authentication outcome. */
export type LoadOutcome =
  | { readonly kind: 'listed'; readonly selves: SelfSummary[] }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'unavailable' };

const UNAVAILABLE: LoadOutcome = { kind: 'unavailable' };

/** Issues exactly one request per call. There is no retry, no interval, and no
 *  automatic re-authentication: a failed load is answered, not re-attempted. */
export async function loadSelves(transport: Transport): Promise<LoadOutcome> {
  try {
    const res = await sendAccount(transport, { method: 'GET', path: SELVES_PATH });
    const outcome = outcomeOf(res.status);
    if (outcome.kind === 'unauthenticated') return { kind: 'unauthenticated' };
    if (outcome.kind !== 'ok') return UNAVAILABLE;
    return { kind: 'listed', selves: parseSelves(await res.json()) };
  } catch {
    return UNAVAILABLE;
  }
}

/** An authoritative list is what makes selection possible; the shell falls
 *  through to nothing only when no list was obtained. Stated as a predicate so
 *  the post-authentication claim is provable without mounting anything. */
export function presentsSelectionAfterLoad(outcome: LoadOutcome): boolean {
  return outcome.kind === 'listed' && outcome.selves.length > 0;
}
