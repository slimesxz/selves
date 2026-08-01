// P10-S10 — the six ratified Self-selection cases (0012 §43).
//
// These test the constitutionally stable layer: the extracted functions and the
// disambiguation predicate. They deliberately do NOT render, require a DOM, or
// inspect markup, layout, styling, copy, or composition — §43 records that
// pinning those is a defect, not coverage.
//
// What they therefore do NOT prove is stated plainly in the completion report:
// the component's binding of these functions is unproven and belongs to
// Segment 10.E's real-surface integration.
import { describe, expect, it } from 'vitest';
import { buildAccountRequest, buildSelfRequest } from '../src/api/transport.ts';
import {
  ACTIVE_SELF_KEY,
  forget,
  onForbidden,
  onSessionExpired,
  presentsSelection,
  remember,
  restore,
  sessionStorageOrNull,
  type StorageLike,
} from '../src/self/active.ts';
import { labelSelves, type SelfSummary } from '../src/self/selves.ts';

const self = (id: string, name: string, slot: number): SelfSummary => ({ id, name, slot });

/** An in-memory stand-in for sessionStorage. It fabricates no authoritative
 *  data — it observes what the residency functions write and read. */
function memoryStore(seed?: Record<string, string>): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('P10-S10 Self selection and active-Self residency', () => {
  it('the selected Self id is emitted in the shape consumed by a Self-scoped request', () => {
    const store = memoryStore();
    remember(store, 'chosen-self-id');
    const active = restore(store, [self('chosen-self-id', 'a', 1), self('other', 'b', 2)]);
    expect(active).toBe('chosen-self-id');

    const req = buildSelfRequest({ method: 'GET', path: '/artifacts', actingSelf: active! });
    expect((req.init.headers as Record<string, string>)['x-acting-self']).toBe('chosen-self-id');
    expect(req.url).toBe('/api/artifacts');

    // The assertion is an assertion, not authority: account-scoped construction
    // still carries no Self at all.
    const acct = buildAccountRequest({ method: 'GET', path: '/auth/selves' });
    expect(Object.hasOwn(acct.init.headers as Record<string, string>, 'x-acting-self')).toBe(false);
  });

  it('a 403 discards the active Self, reverifies once, and returns to selection without a retry loop', async () => {
    const listed = [self('s1', 'a', 1), self('s2', 'b', 2)];
    const store = memoryStore({ [ACTIVE_SELF_KEY]: 's1' });
    let reverifications = 0;
    const returned = await onForbidden(store, () => {
      reverifications += 1;
      return Promise.resolve(listed);
    });

    expect(reverifications).toBe(1); // exactly once — no loop
    expect(store.map.has(ACTIVE_SELF_KEY)).toBe(false); // the active Self was discarded
    expect(returned).toEqual(listed); // and the authoritative list is returned
    expect(presentsSelection(restore(store, listed))).toBe(true); // back to selection
  });

  it('selection is presented for both one-Self and multi-Self accounts when no verified persisted choice exists', () => {
    const one = [self('only', 'solo', 1)];
    const three = [self('s1', 'a', 1), self('s2', 'b', 2), self('s3', 'c', 3)];
    for (const [label, listed] of [['one-Self', one], ['multi-Self', three]] as const) {
      const store = memoryStore();
      const active = restore(store, listed);
      expect(active, `${label}: nothing is auto-selected`).toBeNull();
      expect(presentsSelection(active), `${label}: selection is presented`).toBe(true);
    }
    // Specifically: a lone Self is not chosen for the human, and there is no
    // lowest-slot default even when a slot 1 exists in both lists.
    expect(restore(memoryStore(), one)).not.toBe('only');
    expect(restore(memoryStore(), three)).not.toBe('s1');
  });

  it('labelSelves returns { id, label } without slot, adds slots only to duplicate-name groups, and adds none when every name is distinct', () => {
    const mixed = [self('d1', 'Ora', 1), self('d2', 'Ora', 2), self('u1', 'Wren', 3)];
    const labelled = labelSelves(mixed);

    // Ruled return shape: exactly id and label, with no slot carried through.
    for (const entry of labelled) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'label']);
      expect(Object.hasOwn(entry, 'slot')).toBe(false);
    }
    // The colliding pair is disambiguated; the distinct Self is not touched.
    expect(labelled.map((e) => e.label)).toEqual(['Ora (1)', 'Ora (2)', 'Wren']);
    expect(labelled.map((e) => e.id)).toEqual(['d1', 'd2', 'u1']);

    // An all-distinct list carries no slot in any label.
    const distinct = labelSelves([self('a', 'Ora', 1), self('b', 'Wren', 2), self('c', 'Ash', 3)]);
    expect(distinct.map((e) => e.label)).toEqual(['Ora', 'Wren', 'Ash']);
    for (const entry of distinct) expect(/\(\d\)/.test(entry.label)).toBe(false);
  });

  it('an active Self persists per tab as an id, is discarded when the session expires, and never uses localStorage or BroadcastChannel', () => {
    const store = memoryStore();
    remember(store, 'kept');
    // ID only: the stored value is the bare id, not a record of the Self.
    expect([...store.map.entries()]).toEqual([[ACTIVE_SELF_KEY, 'kept']]);
    expect(restore(store, [self('kept', 'a', 1)])).toBe('kept');

    // An invalid session retains no active-Self assertion.
    onSessionExpired(store);
    expect(store.map.has(ACTIVE_SELF_KEY)).toBe(false);

    // The prohibited channels are never reached. Traps throw if touched.
    const g = globalThis as Record<string, unknown>;
    const had = { local: 'localStorage' in g, bc: 'BroadcastChannel' in g };
    const prior = { local: g.localStorage, bc: g.BroadcastChannel };
    const trap = (name: string) =>
      new Proxy(function () {} as unknown as object, {
        get() {
          throw new Error(`${name} touched`);
        },
        construct() {
          throw new Error(`${name} constructed`);
        },
        apply() {
          throw new Error(`${name} called`);
        },
      });
    Object.defineProperty(g, 'localStorage', { value: trap('localStorage'), configurable: true });
    Object.defineProperty(g, 'BroadcastChannel', { value: trap('BroadcastChannel'), configurable: true });
    try {
      const s2 = memoryStore();
      remember(s2, 'x');
      restore(s2, [self('x', 'n', 1)]);
      onSessionExpired(s2);
      forget(s2);
      expect(sessionStorageOrNull()).toBe(sessionStorageOrNull()); // reaches for sessionStorage only
    } finally {
      if (had.local) Object.defineProperty(g, 'localStorage', { value: prior.local, configurable: true });
      else delete g.localStorage;
      if (had.bc) Object.defineProperty(g, 'BroadcastChannel', { value: prior.bc, configurable: true });
      else delete g.BroadcastChannel;
    }
  });

  it('an absent stored id is discarded and unavailable sessionStorage degrades to no persistence', () => {
    // A stored id that no longer verifies against the returned set is dropped,
    // not asserted — the stored value never outranks the server's answer.
    const store = memoryStore({ [ACTIVE_SELF_KEY]: 'revoked-or-gone' });
    expect(restore(store, [self('s1', 'a', 1), self('s2', 'b', 2)])).toBeNull();
    expect(store.map.has(ACTIVE_SELF_KEY)).toBe(false);

    // Unavailable storage degrades to no persistence rather than failing: every
    // residency call is a silent no-op and selection still works.
    expect(() => remember(null, 'x')).not.toThrow();
    expect(() => forget(null)).not.toThrow();
    expect(() => onSessionExpired(null)).not.toThrow();
    expect(restore(null, [self('s1', 'a', 1)])).toBeNull();

    // A storage that throws on access is treated as absent, not as an error.
    const hostile: StorageLike = {
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
    expect(() => remember(hostile, 'x')).not.toThrow();
    expect(restore(hostile, [self('s1', 'a', 1)])).toBeNull();

    const g = globalThis as Record<string, unknown>;
    const had = 'sessionStorage' in g;
    const prior = g.sessionStorage;
    Object.defineProperty(g, 'sessionStorage', {
      get() {
        throw new Error('storage disabled');
      },
      configurable: true,
    });
    try {
      expect(sessionStorageOrNull()).toBeNull(); // unavailable, not fatal
    } finally {
      if (had) Object.defineProperty(g, 'sessionStorage', { value: prior, configurable: true });
      else delete g.sessionStorage;
    }
  });
});
