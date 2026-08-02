// P10-S11 — the rendered Prism floor. A projection only: the derivation lives
// in floor.ts and nothing here may acquire logic (0012 §43).
//
// It renders exactly the three derived elements and no fourth. Continue
// renders as an element and acquires no handler at P10-S11: it is not
// disabled, not omitted, and is not functional. R10 governs what Continue does
// when it acts, and this sub-step ships no acting — that limitation is stated,
// not concealed by a disabled control, which P10-C2 would forbid as a designed
// empty-state affordance.
import { derivePrismFloor } from './floor.ts';
import type { SelfSummary } from '../self/selves.ts';

export default function PrismFloor({
  selves,
  activeSelfId,
  artifactCount,
}: {
  selves: SelfSummary[];
  activeSelfId: string;
  artifactCount: number;
}) {
  return (
    <main>
      {derivePrismFloor(selves, activeSelfId, artifactCount).map((element) => {
        if (element.kind === 'name') return <h1 key="name">{element.value}</h1>;
        if (element.kind === 'artifactCount') return <p key="count">{element.value}</p>;
        return (
          <button key="continue" type="button">
            Continue
          </button>
        );
      })}
    </main>
  );
}
