// P10-S11 corrective — the five ratified recovery cases (0012 §43).
//
// Cases 1–4 prove pure state transitions. Case 5 is a source-text absence audit
// over every changed production path, in the style of the committed P10-S7
// credential audit.
//
// None of these proves component mounting or call-site wiring. The completion
// report names each unproven binding individually; they belong to Segment 10.E.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  noActiveSelf,
  onCountRequested,
  onCountResolved,
  presentsFloor,
  type FloorState,
} from '../src/prism/state.ts';
import { presentsSelection } from '../src/self/active.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '../src', rel), 'utf8');
/** Comments describe the prohibitions; only code may be asserted against them. */
const codeOf = (rel: string): string =>
  read(rel)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

describe('P10-S11 corrective — unknown count releases the active Self', () => {
  it('a completed unknown count clears the active Self into selection state', () => {
    const next = onCountResolved('active-self', null);

    expect(next.activeSelfId).toBeNull();
    expect(next.artifactCount).toBeNull();
    expect(next).toEqual(noActiveSelf);
    // The selection surface returns, because it mounts on exactly this state.
    expect(presentsSelection(next.activeSelfId)).toBe(true);
    expect(presentsFloor(next)).toBe(false);
    // No storage instruction is emitted: the transition returns state only, and
    // the persisted id is untouched by it.
    expect(Object.keys(next).sort()).toEqual(['activeSelfId', 'artifactCount']);
  });

  it('selecting a Self after that transition re-establishes a non-null active id, making the count trigger observable again', () => {
    const released = onCountResolved('active-self', null);
    expect(presentsSelection(released.activeSelfId)).toBe(true);

    // A selection act drives the id from null to a value; the count trigger is
    // keyed on that value being non-null, so it becomes observable again.
    const reselected: FloorState = onCountRequested('chosen-again');
    expect(reselected.activeSelfId).toBe('chosen-again');
    expect(presentsSelection(reselected.activeSelfId)).toBe(false);
    expect(released.activeSelfId).not.toBe(reselected.activeSelfId); // the value changed
    // Still pending, so the floor does not mount yet.
    expect(presentsFloor(reselected)).toBe(false);
  });

  it('a successful count, including zero, does not clear the active Self', () => {
    for (const count of [0, 1, 42]) {
      const next = onCountResolved('active-self', count);
      expect(next.activeSelfId, `count ${count}`).toBe('active-self');
      expect(next.artifactCount, `count ${count}`).toBe(count);
      expect(presentsFloor(next), `count ${count}`).toBe(true);
    }
    // Zero is authoritative and is not treated as unknown.
    expect(onCountResolved('active-self', 0)).not.toEqual(noActiveSelf);
  });

  it('beginning a count request for a newly active Self clears any count retained from the previously active Self', () => {
    const settled = onCountResolved('self-a', 5);
    expect(settled).toEqual({ activeSelfId: 'self-a', artifactCount: 5 });

    const pending = onCountRequested('self-b');
    expect(pending.activeSelfId).toBe('self-b');
    expect(pending.artifactCount).toBeNull(); // self-a's 5 does not survive
    // No cross-Self count can reach the floor: the pending state does not mount.
    expect(presentsFloor(pending)).toBe(false);
    // …and this holds for re-requesting the SAME Self too, so a stale count is
    // never displayed while a fresh request is in flight.
    expect(onCountRequested('self-a').artifactCount).toBeNull();
  });

  it('the correction introduces no polling, interval, focus refetch, background refresh, routing, or Continue handler', () => {
    const changed = ['App.tsx', 'prism/state.ts', 'prism/count.ts', 'prism/floor.ts', 'prism/PrismFloor.tsx'];
    for (const rel of changed) {
      const code = codeOf(rel);
      for (const construct of [
        'setInterval',
        'setTimeout',
        'addEventListener',
        'visibilitychange',
        'requestAnimationFrame',
        'history.pushState',
        'useNavigate',
        'createBrowserRouter',
      ]) {
        expect(code.includes(construct), `${rel} must not use ${construct}`).toBe(false);
      }
    }
    // Continue renders as an element and acquires no handler.
    const floor = codeOf('prism/PrismFloor.tsx');
    expect(floor).toContain('<button key="continue" type="button">');
    expect(floor.includes('onClick'), 'Continue must carry no handler').toBe(false);
    // The count request is issued from the effect path only — one call site.
    expect([...codeOf('App.tsx').matchAll(/fetchArtifactCount\(/g)]).toHaveLength(1);
  });
});
