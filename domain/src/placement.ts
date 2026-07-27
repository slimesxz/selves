// Placement lifecycle (AGENTS.md §5, ruling D1 Option A). Mirrors the Postgres
// `placement_state` enum. Lowercase labels map 1:1 to §5's Draft/Departing/
// Settled/Cancelled.
export const PLACEMENT_STATES = ['draft', 'departing', 'settled', 'cancelled'] as const;
export type PlacementState = (typeof PLACEMENT_STATES)[number];

// Terminal states are immutable once reached ("cannot be recalled", §5).
export type TerminalPlacementState = 'settled' | 'cancelled';
export const TERMINAL_PLACEMENT_STATES: readonly TerminalPlacementState[] = ['settled', 'cancelled'];

// The ratified state machine as descriptive data:
//   draft -> departing -> settled
//                      \-> cancelled   (reachable only from departing, D1)
// This encodes the shape only. Transition orchestration and cancel-vs-settle
// locking are Phase 6 mechanics and are deliberately not implemented here.
export const PLACEMENT_TRANSITIONS: Readonly<Record<PlacementState, readonly PlacementState[]>> = {
  draft: ['departing'],
  departing: ['settled', 'cancelled'],
  settled: [],
  cancelled: [],
};
