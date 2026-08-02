// P10-S11 — the five ratified Prism-floor cases (0012 §43).
//
// These test the constitutionally stable layer: exact floor cardinality, the
// zero-count rule, the authoritative name source, the Self-scoped count
// request, and the ruled non-repair of the duplicate-name gap. They do not
// render, require a DOM, or inspect markup, layout, styling, copy, or
// composition — §43 records that pinning those is a defect, not coverage.
//
// What they do NOT prove is named individually in the completion report: the
// component's binding of these functions is unproven and belongs to Segment
// 10.E.
import { describe, expect, it } from 'vitest';
import { derivePrismFloor } from '../src/prism/floor.ts';
import { buildArtifactCountRequest, fetchArtifactCount } from '../src/prism/count.ts';
import { buildAccountRequest, type Transport } from '../src/api/transport.ts';
import type { SelfSummary } from '../src/self/selves.ts';

const self = (id: string, name: string, slot: number): SelfSummary => ({ id, name, slot });

describe('P10-S11 Prism floor', () => {
  it('the Prism floor yields exactly three elements — active Self name, authored artifact count, and Continue', () => {
    const selves = [self('a', 'Ora', 1), self('b', 'Wren', 2)];
    const floor = derivePrismFloor(selves, 'a', 7);

    expect(floor).toHaveLength(3);
    expect(floor.map((e) => e.kind)).toEqual(['name', 'artifactCount', 'continue']);
    // No fourth element appears at any count, including counts that would tempt
    // a delta, trend, or comparison — R6 prohibits all of them.
    for (const count of [0, 1, 7, 999]) {
      expect(derivePrismFloor(selves, 'a', count)).toHaveLength(3);
    }
    // Continue is an element, not a derived value: it carries no payload, so
    // nothing here asserts that it acts.
    expect(Object.keys(floor[2]!)).toEqual(['kind']);
  });

  it('an authored-artifact count of zero renders as zero and is not suppressed', () => {
    const floor = derivePrismFloor([self('a', 'Ora', 1)], 'a', 0);
    const count = floor.find((e) => e.kind === 'artifactCount');

    expect(count).toBeDefined();
    expect(count).toEqual({ kind: 'artifactCount', value: 0 });
    // Cardinality does not vary with the value: a zero floor is still three
    // elements, so absence never carries the count.
    expect(floor).toHaveLength(3);
    expect(derivePrismFloor([self('a', 'Ora', 1)], 'a', 0).map((e) => e.kind)).toEqual(
      derivePrismFloor([self('a', 'Ora', 1)], 'a', 12).map((e) => e.kind),
    );
  });

  it('the active Self name derives from the authoritative SelfSummary and not from labelSelves', () => {
    const selves = [self('a', 'Ora', 1), self('b', 'Wren', 2), self('c', 'Ash', 3)];
    // The name is the active Self's own, not the first in the list.
    expect(derivePrismFloor(selves, 'b', 0)[0]).toEqual({ kind: 'name', value: 'Wren' });
    expect(derivePrismFloor(selves, 'c', 0)[0]).toEqual({ kind: 'name', value: 'Ash' });
    // …and it is the bare authoritative name, carrying no slot and no id.
    const name = derivePrismFloor(selves, 'b', 0)[0] as { kind: 'name'; value: string };
    expect(name.value).toBe('Wren');
    expect(name.value).not.toContain('2');
    expect(name.value).not.toContain('b');
  });

  it('the artifact-count request is Self-scoped and asserts the verified active Self', () => {
    const built = buildArtifactCountRequest('the-active-self');
    expect(built.url).toBe('/api/artifacts');
    expect(built.init.method).toBe('GET');
    expect((built.init.headers as Record<string, string>)['x-acting-self']).toBe('the-active-self');
    // It is not the account-scoped request, which carries no Self at all.
    const account = buildAccountRequest({ method: 'GET', path: '/auth/selves' });
    expect(Object.hasOwn(account.init.headers as Record<string, string>, 'x-acting-self')).toBe(false);
    expect(built.url).not.toBe(account.url);
  });

  it('two same-named Selves are not disambiguated on the Prism floor', async () => {
    // The gap is real in the substrate: these two are distinguishable only by
    // id or slot, and the floor repairs neither.
    const twins = [self('first', 'Ora', 1), self('second', 'Ora', 2)];
    const active = derivePrismFloor(twins, 'second', 3)[0] as { kind: 'name'; value: string };

    expect(active.value).toBe('Ora'); // the bare authoritative name
    expect(active.value).not.toContain('2'); // no slot
    expect(active.value).not.toContain('second'); // no id
    expect(active.value).not.toMatch(/[()[\]·]/); // no invented descriptor or separator
    // Both Selves yield the identical rendered name — the non-repair, stated.
    const other = derivePrismFloor(twins, 'first', 3)[0] as { kind: 'name'; value: string };
    expect(other.value).toBe(active.value);

    // An unobtainable count is not a zero: nothing is substituted for it.
    const failing: Transport = () => Promise.resolve(new Response(null, { status: 500 }));
    expect(await fetchArtifactCount(failing, 'second')).toEqual({ kind: 'unknown' });
  });
});
