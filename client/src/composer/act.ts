// P10-S14 — the deliberate creation act, as a pure injected boundary. No React,
// no DOM, no module-level fetch: the transport, the state applier, and both
// authorization dispositions all arrive as arguments.
//
// This module exists so the ordering that P10-S13's synchronous start was built
// to guarantee is observable. `startCreation` hands back the pending state
// before any transport can settle; the act's job is to APPLY that exact object
// first, and only then to await settlement. A caller that awaited settlement
// before applying the pending state would reopen the single-flight hole,
// because a second act would still see a `composing` state.
//
// The act decides nothing about authorization. Both dispositions are passed
// straight through to `startCreation`, which routes 401 and 403 to them.

import type { Transport } from '../api/transport.ts';
import { startCreation, type Dispositions } from './create.ts';
import type { ComposerState } from './state.ts';

export interface ActDeps {
  readonly transport: Transport;
  readonly actingSelfId: string;
  /** The caller's own state applier. Called with the pending state
   *  synchronously, and again with the settled state when it resolves. */
  readonly apply: (state: ComposerState) => void;
  readonly dispositions: Dispositions;
}

/** Performs one deliberate Send. Returns what the production boundary decided,
 *  so a declined act is observable rather than silent. */
export function performSend(deps: ActDeps, state: ComposerState): 'started' | 'not-started' {
  const start = startCreation(deps.transport, deps.actingSelfId, state, deps.dispositions);
  if (start.kind === 'not-started') return 'not-started';
  // Synchronous first: the caller holds `creating` before settlement exists.
  deps.apply(start.pendingState);
  void start.settlement.then(deps.apply);
  return 'started';
}
