// P10-S11/P10-S12 — the rendered Prism floor. A projection only: the derivation
// lives in floor.ts and the surface transition in correspondences/surface.ts;
// nothing here may acquire logic (0012 §43).
//
// It renders exactly the three derived elements and no fourth. At P10-S11
// Continue rendered without a handler and R10 stood unsatisfied as a stated
// limitation. P10-S12 gives Continue its first behavior under a separate
// ruling: it opens the unselected top-level Correspondences surface. That
// handler is supplied by the caller and is invoked here; this component decides
// nothing about what the transition does.
import { derivePrismFloor } from './floor.ts';
import type { SelfSummary } from '../self/selves.ts';

export default function PrismFloor({
  selves,
  activeSelfId,
  artifactCount,
  onContinue,
}: {
  selves: SelfSummary[];
  activeSelfId: string;
  artifactCount: number;
  onContinue: () => void;
}) {
  return (
    <main>
      {derivePrismFloor(selves, activeSelfId, artifactCount).map((element) => {
        if (element.kind === 'name') return <h1 key="name">{element.value}</h1>;
        if (element.kind === 'artifactCount') return <p key="count">{element.value}</p>;
        return (
          <button key="continue" type="button" onClick={onContinue}>
            Continue
          </button>
        );
      })}
    </main>
  );
}
