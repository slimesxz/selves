// P10-S12 — the Correspondences projection. A thin projection only: every
// constitutional decision lives in derive.ts, read.ts, and surface.ts.
//
// Group-level identification only — the counterpart's collision-aware label,
// and nothing else. No internal Self id, no per-group Placement count, no
// individual Placement content. Groups are presented and are not selectable in
// this slice.
//
// The three read states render distinctly: pending is neither groups nor
// unavailability. Return is available from both the presented and the
// unavailable state.
import type { CorrespondencesState } from './surface.ts';

export default function Correspondences({
  state,
  onReturn,
}: {
  state: CorrespondencesState;
  onReturn: () => void;
}) {
  return (
    <main>
      <button type="button" onClick={onReturn}>
        Back
      </button>
      {state.kind === 'pending' ? <p role="status">Loading.</p> : null}
      {state.kind === 'unavailable' ? <p role="status">Unavailable.</p> : null}
      {state.kind === 'projection'
        ? state.groups.map((group) => <p key={group.counterpartSelfId}>{group.label}</p>)
        : null}
    </main>
  );
}
