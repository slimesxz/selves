// P10-S12.2 — the six ratified cases for completion and containment of the
// forbidden transition.
//
// These prove the settled transition state. They do not render, require a DOM,
// or inspect markup. The client runner has no DOM implementation installed —
// jsdom and happy-dom appear in the lockfile only as vitest's optional peer
// declarations — so a behavioral proof is possible only against a pure module,
// which is why one exists.
//
// What they do NOT prove is named individually in the completion report: that
// App applies this settlement at its call sites is a wiring binding and belongs
// to Segment 10.E.
import { describe, expect, it } from 'vitest';
import { outcomeOf, presentsGate } from '../src/auth/session.ts';
import { onContinue, prismSurface } from '../src/correspondences/surface.ts';
import { ACTIVE_SELF_KEY, presentsSelection } from '../src/self/active.ts';
import { settleForbidden, type ForbiddenSettlement } from '../src/self/forbidden.ts';
import type { SelfSummary } from '../src/self/selves.ts';

const self = (id: string, name: string, slot: number): SelfSummary => ({ id, name, slot });

/** The narrow StorageLike the active-Self module accepts. */
function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** The two forms a rejecting single re-verification takes in the real client:
 *  a transport that throws, and a malformed body on an otherwise fine 2xx. */
const throwing = (): Promise<SelfSummary[]> => Promise.reject(new Error('offline'));
const malformed = async (): Promise<SelfSummary[]> => {
  await new Response('{ not json', { status: 200 }).json();
  return []; // unreachable: the parse above rejects
};
/** A completed non-auth response: the one attempt answered, with no list. */
const empty = (): Promise<SelfSummary[]> => Promise.resolve([]);

describe('P10-S12.2 forbidden settlement', () => {
  it('a rejecting re-verification fulfils rather than rejects', async () => {
    for (const [label, reverify] of [
      ['transport throw', throwing],
      ['malformed body on a 2xx', malformed],
    ] as const) {
      // If the transition rejected, this would throw and the case would fail.
      await expect(settleForbidden(memoryStore(), reverify), label).resolves.toBeDefined();
      const settled = await settleForbidden(memoryStore(), reverify);
      expect(settled.selves, label).toEqual([]);
    }
    // The rejection is contained, not deferred: nothing is left to escape later.
    const settled: ForbiddenSettlement = await settleForbidden(memoryStore(), throwing);
    expect(Object.keys(settled).sort()).toEqual(['activeSelfId', 'selves', 'surface']);
  });

  it('the in-memory active Self is cleared on the rejecting path', async () => {
    for (const reverify of [throwing, malformed]) {
      const settled = await settleForbidden(memoryStore({ [ACTIVE_SELF_KEY]: 'refused' }), reverify);
      expect(settled.activeSelfId).toBeNull();
      // Null is exactly the value the selection surface mounts on, so the
      // client cannot continue issuing Self-scoped requests as the refused Self.
      expect(presentsSelection(settled.activeSelfId)).toBe(true);
    }
  });

  it('the persisted per-tab id remains discarded across the rejecting path, and nothing rewrites it', async () => {
    for (const reverify of [throwing, malformed]) {
      const store = memoryStore({ [ACTIVE_SELF_KEY]: 'refused' });
      expect(store.map.has(ACTIVE_SELF_KEY)).toBe(true); // present before
      const settled = await settleForbidden(store, reverify);
      expect(store.map.has(ACTIVE_SELF_KEY)).toBe(false); // discarded, and stays discarded
      // The settlement carries no instruction that could restore it: it holds
      // no id at all, only the absence of one.
      expect(settled.activeSelfId).toBeNull();
      expect(JSON.stringify(settled)).not.toContain('refused');
    }
    // A storage that throws on every access is treated as absent, not as an
    // error, so the transition still settles.
    const hostile = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect((await settleForbidden(hostile, throwing)).activeSelfId).toBeNull();
  });

  it('Correspondences leaves pending on the rejecting path and cannot be re-entered without a fresh human act', async () => {
    for (const reverify of [throwing, malformed]) {
      const settled = await settleForbidden(memoryStore(), reverify);
      expect(settled.surface).toEqual(prismSurface);
      expect(settled.surface.kind).toBe('prism');
      expect(settled.surface.kind).not.toBe('correspondences');
      // Nothing pending survives the settlement, in any nesting.
      expect(JSON.stringify(settled.surface)).not.toContain('pending');
    }
    // Re-entry exists only through Continue — a deliberate human act — and the
    // settlement is not it.
    const reopened = onContinue();
    expect(reopened).toEqual({ kind: 'correspondences', state: { kind: 'pending' } });
    expect((await settleForbidden(memoryStore(), throwing)).surface).not.toEqual(reopened);
  });

  it('a completed non-auth re-verification manufactures no 401 and presents no AuthGate', async () => {
    const settled = await settleForbidden(memoryStore({ [ACTIVE_SELF_KEY]: 'refused' }), empty);

    // The session outcome is untouched by the settlement: it holds no outcome
    // field at all, so nothing here can rewrite one.
    expect(Object.keys(settled).sort()).toEqual(['activeSelfId', 'selves', 'surface']);
    expect(JSON.stringify(settled)).not.toContain('unauthenticated');
    // The account session remains ok, and ok does not present the gate.
    expect(presentsGate({ kind: 'ok' })).toBe(false);
    // A non-auth status is not classified as an authentication failure.
    for (const status of [500, 503, 400, 404]) {
      expect(outcomeOf(status).kind, `status ${status}`).not.toBe('unauthenticated');
      expect(presentsGate(outcomeOf(status)), `status ${status}`).toBe(false);
    }
    // The terminal state is the unrecovered one: no active Self and no list,
    // which is neither the gate nor the selection surface.
    expect(settled.activeSelfId).toBeNull();
    expect(settled.selves).toEqual([]);
  });

  it('completed non-auth and rejecting re-verification both settle without producing an authentication outcome', async () => {
    const completed = await settleForbidden(memoryStore({ [ACTIVE_SELF_KEY]: 'refused' }), empty);
    const rejected = await settleForbidden(memoryStore({ [ACTIVE_SELF_KEY]: 'refused' }), throwing);

    // Both fulfil, both complete the same mandatory R3 transition, and the
    // settled states are identical — no discriminator is carried, because no
    // ruled behavior consumes one.
    expect(completed).toEqual(rejected);
    for (const [label, settled] of [
      ['completed', completed],
      ['rejected', rejected],
    ] as const) {
      expect(settled.activeSelfId, label).toBeNull();
      expect(settled.selves, label).toEqual([]);
      expect(settled.surface, label).toEqual(prismSurface);
      expect(JSON.stringify(settled), label).not.toContain('unauthenticated');
      expect(JSON.stringify(settled), label).not.toContain('forbidden');
    }
    // A successful re-verification is the branch that differs, and it differs
    // only in the authoritative list — never in an authentication outcome.
    const listed = [self('s1', 'Ora', 1)];
    const ok = await settleForbidden(memoryStore(), () => Promise.resolve(listed));
    expect(ok.selves).toEqual(listed);
    expect(ok.activeSelfId).toBeNull();
    expect(ok.surface).toEqual(prismSurface);
  });
});
