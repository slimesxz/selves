// P10-S12.1 — the six ratified cases for one forbidden disposition.
//
// A Self-scoped 401 or 403 has one constitutional meaning, and it does not vary
// by the surface that issued the request. These cases prove the classification
// layer and the transition contract. They do not render, require a DOM, or
// inspect markup.
//
// What they therefore do NOT prove is named individually in the completion
// report: that App reaches these transitions from its call sites at all is a
// wiring binding and belongs to Segment 10.E.
import { describe, expect, it } from 'vitest';
import type { Transport } from '../src/api/transport.ts';
import { fetchArtifactCount } from '../src/prism/count.ts';
import { classifyStatus, readCorrespondences } from '../src/correspondences/read.ts';
import { onReadResolved } from '../src/correspondences/surface.ts';
import {
  ACTIVE_SELF_KEY,
  onForbidden,
  onSessionExpired,
  presentsSelection,
  restore,
} from '../src/self/active.ts';
import type { SelfSummary } from '../src/self/selves.ts';

const ME = 'me';
const self = (id: string, name: string, slot: number): SelfSummary => ({ id, name, slot });

/** A transport answering every request with one status and no body. */
const answering =
  (status: number): Transport =>
  () =>
    Promise.resolve(new Response(null, { status }));

/** The minimum StorageLike the active-Self module accepts. */
function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('P10-S12.1 one forbidden disposition', () => {
  it('the count read classifies 401 as session-expired and 403 as forbidden, and neither is an unknown count', async () => {
    expect(await fetchArtifactCount(answering(401), ME)).toEqual({ kind: 'session-expired' });
    expect(await fetchArtifactCount(answering(403), ME)).toEqual({ kind: 'forbidden' });
    // The defect this corrects: both previously collapsed into the unknown count.
    for (const status of [401, 403]) {
      const outcome = await fetchArtifactCount(answering(status), ME);
      expect(outcome.kind, `status ${status}`).not.toBe('unknown');
      expect(outcome.kind, `status ${status}`).not.toBe('count');
    }
  });

  it('a non-auth count failure — 500, malformed body, or transport throw — remains an unknown count and is not an authorization outcome', async () => {
    const malformed: Transport = () =>
      Promise.resolve(new Response(JSON.stringify({ not: 'an array' }), { status: 200 }));
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    for (const [label, transport] of [
      ['500', answering(500)],
      ['400', answering(400)],
      ['malformed', malformed],
      ['throw', throwing],
    ] as const) {
      expect(await fetchArtifactCount(transport, ME), label).toEqual({ kind: 'unknown' });
    }
    // An authoritative count, including zero, is a fact and not an unknown.
    const empty: Transport = () => Promise.resolve(new Response('[]', { status: 200 }));
    expect(await fetchArtifactCount(empty, ME)).toEqual({ kind: 'count', count: 0 });
  });

  it('a 403 from any of the three Self-scoped reads yields the same forbidden disposition', async () => {
    // GET /artifacts.
    const count = await fetchArtifactCount(answering(403), ME);
    // GET /placements.
    const placements = await readCorrespondences(answering(403), ME);
    // GET /placements/:id/recipients — reached only after a settled authored
    // placement is listed, so the transport answers the list first.
    let call = 0;
    const atRecipients: Transport = () => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? new Response(
              JSON.stringify([{ id: 'p1', senderSelfId: ME, state: 'settled', createdAt: '2026-01-01' }]),
              { status: 200 },
            )
          : new Response(null, { status: 403 }),
      );
    };
    const recipients = await readCorrespondences(atRecipients, ME);

    expect(call).toBe(2); // the recipients request really was the failing one
    expect(count.kind).toBe('forbidden');
    expect(placements.kind).toBe('forbidden');
    expect(recipients.kind).toBe('forbidden');
    // One disposition: the three reads agree, and none of them is unavailability.
    expect(new Set([count.kind, placements.kind, recipients.kind]).size).toBe(1);
    expect(classifyStatus(403)).toBe('forbidden');
  });

  it('the forbidden disposition discards the persisted per-tab id and re-verifies exactly once, with no retry loop', async () => {
    const listed = [self('s1', 'Ora', 1), self('s2', 'Wren', 2)];
    const store = memoryStore({ [ACTIVE_SELF_KEY]: 's1' });
    let reverifications = 0;

    const returned = await onForbidden(store, () => {
      reverifications += 1;
      return Promise.resolve(listed);
    });

    expect(reverifications).toBe(1); // exactly once
    expect(store.map.has(ACTIVE_SELF_KEY)).toBe(false); // the persisted id is gone
    expect(returned).toEqual(listed);
    // Nothing can be restored afterwards, so selection is where this lands.
    expect(presentsSelection(restore(store, listed))).toBe(true);
    // A second call re-verifies once more only because it was called again;
    // the transition itself contains no loop.
    await onForbidden(store, () => {
      reverifications += 1;
      return Promise.resolve(listed);
    });
    expect(reverifications).toBe(2);
  });

  it('a 401 from any of the three reads yields session-expired, discards the id, and is never a 403, unknown count, or unavailability', async () => {
    const count = await fetchArtifactCount(answering(401), ME);
    const placements = await readCorrespondences(answering(401), ME);
    let call = 0;
    const atRecipients: Transport = () => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? new Response(
              JSON.stringify([{ id: 'p1', senderSelfId: ME, state: 'settled', createdAt: '2026-01-01' }]),
              { status: 200 },
            )
          : new Response(null, { status: 401 }),
      );
    };
    const recipients = await readCorrespondences(atRecipients, ME);

    for (const [label, kind] of [
      ['count', count.kind],
      ['placements', placements.kind],
      ['recipients', recipients.kind],
    ] as const) {
      expect(kind, label).toBe('session-expired');
      expect(kind, label).not.toBe('forbidden');
      expect(kind, label).not.toBe('unknown');
      expect(kind, label).not.toBe('unavailable');
    }
    expect(classifyStatus(401)).toBe('session-expired');
    // The 401 transition discards the persisted assertion.
    const store = memoryStore({ [ACTIVE_SELF_KEY]: 's1' });
    onSessionExpired(store);
    expect(store.map.has(ACTIVE_SELF_KEY)).toBe(false);
  });

  it('Correspondences non-auth unavailability clears neither the active Self nor the persisted id and remains re-attemptable through Continue', async () => {
    const store = memoryStore({ [ACTIVE_SELF_KEY]: ME });
    const outcome = await readCorrespondences(answering(500), ME);
    expect(outcome.kind).toBe('unavailable');

    // The unavailable state is a fact about the read, not about authorization:
    // it carries no instruction to forget anything, and nothing did.
    const state = onReadResolved(outcome, ME, [self(ME, 'Ora', 1)]);
    expect(state).toEqual({ kind: 'unavailable' });
    expect(store.map.get(ACTIVE_SELF_KEY)).toBe(ME); // persisted id retained
    expect(presentsSelection(ME)).toBe(false); // the active Self is not released
    // …and the state itself carries no active-Self or storage field to act on.
    expect(Object.keys(state)).toEqual(['kind']);
  });
});
