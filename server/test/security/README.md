# Phase 11 security regression corpus

Durable convention for adversarial regressions, established by P11-C under
decision record [0013](../../../docs/decisions/0013-phase-11-opening.md).

It lives inside the existing test architecture: these files are ordinary
Vitest suites picked up by the committed `include: ['test/**/*.test.ts']`
pattern, run against the same real test PostgreSQL substrate, under the same
single-threaded serial pool as the rest of the estate. No separate runner, no
separate configuration, no separate command.

## The three categories

Adversarial regressions are not interchangeable. A defect found by a generator
needs different preservation from one found by an ordered race, and both differ
from a hand-authored contract proof. The corpus keeps them apart.

### `regression/` — hand-authored security regressions

A deterministic reproduction of a specific defect, written by hand against a
named violated invariant. Each file states the defect identifier, the ratified
contract it violates, and the boundary it observes.

### `property/` — generated exploration and its minimized counterexamples

Property suites over ratified invariants. Two distinct things live here and are
never conflated:

- the **property** itself, which explores;
- the **minimized counterexample**, which is a permanent regression.

> **A discovered defect is not closed because its generating property later
> passes.** A passing property is evidence about a distribution of inputs; it is
> not evidence about the specific input that once failed. Every genuine
> counterexample is minimized and preserved as its own deterministic case, and
> that case remains in the corpus permanently — it is never deleted because the
> generator stopped reproducing it, and it is never "fixed" by raising the run
> count until the failure disappears.

### `concurrency/` — regressions requiring deterministic orchestration

Races and contention whose proof depends on a controlled ordering of concurrent
operations. These record the synchronization mechanism explicitly, because the
mechanism is part of the proof. **No sleeps, arbitrary delays,
retry-until-it-happens loops, or probabilistic success** are acceptable as the
proof of a concurrency claim; a harness that cannot establish its ordering
deterministically must fail loudly rather than pass by luck.

## Preservation rule

Preserve the **smallest deterministic reproduction that still captures the
violated invariant** — not the largest scenario that happened to expose it, and
not a narrower one that no longer exercises the invariant.
