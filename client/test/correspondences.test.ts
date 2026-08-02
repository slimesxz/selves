// P10-S12 — the twelve ratified Correspondences cases (0012 §43).
//
// These test the constitutionally stable layer: the pure pairwise derivation,
// the all-or-none read classification, and the surface state machine. They do
// not render, require a DOM, or inspect markup, layout, styling, copy, or
// composition — §43 records that pinning those is a defect, not coverage.
//
// What they therefore do NOT prove is named individually in the completion
// report: the component's binding of these functions is unproven and belongs
// to Segment 10.E.
import { describe, expect, it } from 'vitest';
import type { Transport } from '../src/api/transport.ts';
import { deriveCorrespondences, type ReadablePlacement } from '../src/correspondences/derive.ts';
import { classifyStatus, readCorrespondences } from '../src/correspondences/read.ts';
import {
  CORRESPONDENCES_STATES,
  onContinue,
  onReadResolved,
  onReturn,
  prismSurface,
} from '../src/correspondences/surface.ts';
import type { SelfSummary } from '../src/self/selves.ts';

const ME = 'me';
const self = (id: string, name: string, slot: number): SelfSummary => ({ id, name, slot });
const placed = (id: string, senderSelfId: string, state: string, createdAt: string): ReadablePlacement => ({
  id,
  senderSelfId,
  state,
  createdAt,
});
const noRecipients = new Map<string, readonly string[]>();

/** A transport answering the placements read, then each recipients read. */
function scripted(steps: Array<{ status: number; body?: unknown }>): Transport {
  let i = 0;
  return () => {
    const step = steps[Math.min(i++, steps.length - 1)]!;
    const init: ResponseInit = { status: step.status };
    return Promise.resolve(
      step.body === undefined ? new Response(null, init) : new Response(JSON.stringify(step.body), init),
    );
  };
}

describe('P10-S12 Correspondences', () => {
  it('only settled placements contribute to the derivation', () => {
    const placements = [
      placed('p-draft', 'other', 'draft', '2026-01-01'),
      placed('p-departing', 'other', 'departing', '2026-01-02'),
      placed('p-cancelled', 'other', 'cancelled', '2026-01-03'),
      placed('p-settled', 'other', 'settled', '2026-01-04'),
    ];
    const groups = deriveCorrespondences(placements, noRecipients, ME, [self('other', 'Ora', 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.placementIds).toEqual(['p-settled']);
  });

  it('a received settled placement groups under its sender as counterpart', () => {
    const groups = deriveCorrespondences(
      [placed('p1', 'sender-a', 'settled', '2026-01-01')],
      noRecipients,
      ME,
      [self('sender-a', 'Ora', 1)],
    );
    expect(groups.map((g) => g.counterpartSelfId)).toEqual(['sender-a']);
  });

  it("an authored settled placement contributes once to each recipient's pairwise group", () => {
    const recipients = new Map<string, readonly string[]>([['p1', ['r1', 'r2']]]);
    const groups = deriveCorrespondences(
      [placed('p1', ME, 'settled', '2026-01-01')],
      recipients,
      ME,
      [self('r1', 'Ora', 1), self('r2', 'Wren', 2)],
    );
    expect(groups.map((g) => g.counterpartSelfId)).toEqual(['r1', 'r2']);
    for (const group of groups) expect(group.placementIds).toEqual(['p1']);
  });

  it('groups order by counterpart Self id and placements within a group by created_at then id', () => {
    const placements = [
      placed('b', 'z-self', 'settled', '2026-01-02'),
      placed('a', 'z-self', 'settled', '2026-01-01'),
      placed('d', 'z-self', 'settled', '2026-01-03'),
      placed('c', 'z-self', 'settled', '2026-01-03'),
      placed('e', 'a-self', 'settled', '2026-01-01'),
    ];
    const groups = deriveCorrespondences(placements, noRecipients, ME, [
      self('z-self', 'Zed', 1),
      self('a-self', 'Ash', 2),
    ]);
    expect(groups.map((g) => g.counterpartSelfId)).toEqual(['a-self', 'z-self']);
    // created_at ascending, ties broken by id.
    expect(groups[1]!.placementIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a valid empty readable settled set yields zero groups and no placeholder', () => {
    expect(deriveCorrespondences([], noRecipients, ME, [self('other', 'Ora', 1)])).toEqual([]);
    const state = onReadResolved({ kind: 'ok', placements: [], recipients: noRecipients }, ME, []);
    expect(state).toEqual({ kind: 'projection', groups: [] });
  });

  it('a received-ground group carries no co-recipient information', () => {
    const groups = deriveCorrespondences(
      [placed('p1', 'sender-a', 'settled', '2026-01-01')],
      // Even if a recipient set were somehow present for a received placement,
      // the derivation must not consult it.
      new Map([['p1', ['secret-co-recipient']]]),
      ME,
      [self('sender-a', 'Ora', 1), self('secret-co-recipient', 'Hidden', 2)],
    );
    expect(groups.map((g) => g.counterpartSelfId)).toEqual(['sender-a']);
    expect(Object.keys(groups[0]!).sort()).toEqual(['counterpartSelfId', 'label', 'placementIds']);
    expect(JSON.stringify(groups)).not.toContain('secret-co-recipient');
  });

  it('counterpart labels disambiguate only where another presented counterpart shares the name', () => {
    // Two presented counterparts share "Ora" — both are disambiguated.
    const collide = deriveCorrespondences(
      [placed('p1', 'c1', 'settled', '2026-01-01'), placed('p2', 'c2', 'settled', '2026-01-02')],
      noRecipients,
      ME,
      [self('c1', 'Ora', 1), self('c2', 'Ora', 2)],
    );
    expect(collide.map((g) => g.label)).toEqual(['Ora (1)', 'Ora (2)']);

    // A same-named Self that is NOT a presented counterpart contributes nothing.
    const solo = deriveCorrespondences(
      [placed('p1', 'c1', 'settled', '2026-01-01')],
      noRecipients,
      ME,
      [self('c1', 'Ora', 1), self('absent', 'Ora', 2)],
    );
    expect(solo.map((g) => g.label)).toEqual(['Ora']);
  });

  it('any failed or invalid read yields unavailability and never zero groups', async () => {
    const unavailable = { kind: 'unavailable' } as const;
    expect(onReadResolved(unavailable, ME, [])).toEqual({ kind: 'unavailable' });
    // A non-2xx placements read, a malformed body, and a transport throw all
    // classify as unavailable — and none of them is an empty projection.
    expect((await readCorrespondences(scripted([{ status: 500 }]), ME)).kind).toBe('unavailable');
    expect((await readCorrespondences(scripted([{ status: 200, body: { not: 'an array' } }]), ME)).kind).toBe(
      'unavailable',
    );
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    expect((await readCorrespondences(throwing, ME)).kind).toBe('unavailable');
    expect(onReadResolved(unavailable, ME, [])).not.toEqual({ kind: 'projection', groups: [] });
  });

  it('an empty recipient array for an authored settled placement is invalid and enters the failure branch', async () => {
    const outcome = await readCorrespondences(
      scripted([
        { status: 200, body: [{ id: 'p1', senderSelfId: ME, state: 'settled', createdAt: '2026-01-01' }] },
        { status: 200, body: [] }, // contradicts the committed >=1-recipient invariant
      ]),
      ME,
    );
    expect(outcome.kind).toBe('unavailable');
  });

  it('pending is distinct in state from both presented groups and unavailability', () => {
    expect(CORRESPONDENCES_STATES).toEqual(['pending', 'projection', 'unavailable']);
    expect(new Set(CORRESPONDENCES_STATES).size).toBe(3);
    const opened = onContinue();
    expect(opened).toEqual({ kind: 'correspondences', state: { kind: 'pending' } });
    const projection = onReadResolved({ kind: 'ok', placements: [], recipients: noRecipients }, ME, []);
    expect(projection.kind).not.toBe('pending');
    expect(onReadResolved({ kind: 'unavailable' }, ME, []).kind).not.toBe('pending');
    expect(projection.kind).not.toBe(onReadResolved({ kind: 'unavailable' }, ME, []).kind);
  });

  it('Continue opens the unselected top-level surface and return restores the Prism floor without fetching', () => {
    const opened = onContinue();
    expect(opened.kind).toBe('correspondences');
    // Unselected: the opened surface carries no selected counterpart.
    expect(JSON.stringify(opened)).not.toContain('selected');
    expect(onReturn()).toEqual(prismSurface);
    expect(onReturn()).toEqual({ kind: 'prism' });
    // The inverse transition takes no transport and therefore cannot fetch.
    expect(onReturn.length).toBe(0);
  });

  it('401 and 403 are classified for the existing session and forbidden transitions rather than as unavailability', async () => {
    expect(classifyStatus(401)).toBe('session-expired');
    expect(classifyStatus(403)).toBe('forbidden');
    expect(classifyStatus(500)).toBe('unavailable');
    expect((await readCorrespondences(scripted([{ status: 401 }]), ME)).kind).toBe('session-expired');
    expect((await readCorrespondences(scripted([{ status: 403 }]), ME)).kind).toBe('forbidden');
    // The same classification applies at the recipients layer.
    const atRecipients = await readCorrespondences(
      scripted([
        { status: 200, body: [{ id: 'p1', senderSelfId: ME, state: 'settled', createdAt: '2026-01-01' }] },
        { status: 403 },
      ]),
      ME,
    );
    expect(atRecipients.kind).toBe('forbidden');
  });
});
