// P10-S10 — the Self switcher. A projection only: every constitutional
// decision lives in selves.ts and active.ts, and nothing here may acquire logic
// (0012 §43).
//
// It renders one control per labelled entry and renders no slot except where
// labelSelves has already placed one in a label to resolve a collision. It
// presents no default, no preselection, and no lowest-slot fallback.
import { labelSelves, type SelfSummary } from './selves.ts';

export default function SelfSwitcher({
  selves,
  onSelect,
}: {
  selves: SelfSummary[];
  onSelect: (selfId: string) => void;
}) {
  return (
    <nav aria-label="Selves">
      {labelSelves(selves).map((entry) => (
        <button key={entry.id} type="button" onClick={() => onSelect(entry.id)}>
          {entry.label}
        </button>
      ))}
    </nav>
  );
}
