// P10-S10 — the Self switcher. A projection only: every constitutional
// decision lives in selves.ts and active.ts, and nothing here may acquire logic
// (0012 §43).
//
// It renders one control per labelled entry and renders no slot except where
// labelSelves has already placed one in a label to resolve a collision. It
// presents no default, no preselection, and no lowest-slot fallback.
import { labelSelves, type SelfSummary } from './selves.ts';

/** P10-S20 — one switcher, two placements. `selection` is the surface presented
 *  when no Self is active; `chrome` is the same control standing beside an
 *  active Self's surface. They are the same component, the same projection and
 *  the same act — only the landmark differs, because a selection surface and
 *  persistent chrome are not the same thing to a reader or to a screen reader.
 *  No second switching model exists. */
export type SwitcherPlacement = 'selection' | 'chrome';

export default function SelfSwitcher({
  selves,
  onSelect,
  placement = 'selection',
}: {
  selves: SelfSummary[];
  onSelect: (selfId: string) => void;
  placement?: SwitcherPlacement;
}) {
  const controls = labelSelves(selves).map((entry) => (
    <button key={entry.id} type="button" onClick={() => onSelect(entry.id)}>
      {entry.label}
    </button>
  ));
  return placement === 'selection' ? (
    <nav aria-label="Selves">{controls}</nav>
  ) : (
    <header aria-label="Switch Self">{controls}</header>
  );
}
