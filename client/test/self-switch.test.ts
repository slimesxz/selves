// P10-S20 — implementation tests for the direct active-Self switch.
//
// These establish the semantics of the operation the production client now
// contains. They are NOT the criterion-3 mounted observation: nothing here
// mounts App, and nothing here is offered as Phase-exit evidence. The mounted
// A -> B observation belongs to the successor of the halted P10-C3 act.
//
// Pure by the same requirement that governs the rest of this module (0012 §43):
// the constitutional decisions live in `active.ts`, so they are provable without
// a DOM, and the component stays a projection over them.
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_SELF_KEY,
  onSessionExpired,
  onSwitch,
  presentsSelection,
  presentsSwitcher,
  restore,
  type StorageLike,
} from '../src/self/active.ts';
import type { SelfSummary } from '../src/self/selves.ts';

const A: SelfSummary = { id: 'self-a', name: 'Ana', slot: 1 };
const B: SelfSummary = { id: 'self-b', name: 'Bo', slot: 2 };
const SELVES: SelfSummary[] = [A, B];

/** A minimal in-memory stand-in for sessionStorage. It stores; it decides
 *  nothing. */
function store(initial: Record<string, string> = {}): StorageLike & { read: () => string | null } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    read: () => map.get(ACTIVE_SELF_KEY) ?? null,
  };
}

describe('P10-S20 active-Self switch', () => {
  describe('availability — the switcher is persistent chrome, not a selection-only surface', () => {
    it('is offered while a Self is active, which is the state the switch starts from', () => {
      expect(presentsSwitcher(SELVES)).toBe(true);
      // The predicate does not consult the active Self: availability is not
      // conditioned on having released one.
      expect(presentsSelection(A.id)).toBe(false);
    });

    it('is not offered where there is no second context to move to', () => {
      expect(presentsSwitcher([A])).toBe(false);
      expect(presentsSwitcher([])).toBe(false);
    });
  });

  describe('direct transition — A to B, never A to null to B', () => {
    it('a switch from an active Self to a different owned Self yields that Self', () => {
      expect(onSwitch(store(), SELVES, A.id, B.id)).toBe(B.id);
    });

    it('the switch never produces the no-active-Self state', () => {
      const result = onSwitch(store(), SELVES, A.id, B.id);
      expect(result).not.toBeNull();
      expect(presentsSelection(result)).toBe(false);
    });

    it('selecting the already-active Self is not a switch and changes nothing', () => {
      expect(onSwitch(store(), SELVES, A.id, A.id)).toBeNull();
    });
  });

  describe('authority — selecting a context is not being granted one', () => {
    it('an id the authoritative list does not contain is declined, and the active Self is kept', () => {
      expect(onSwitch(store(), SELVES, A.id, 'self-not-owned')).toBeNull();
    });

    it('declining an unlisted id writes nothing to storage', () => {
      const s = store();
      onSwitch(s, SELVES, A.id, 'self-not-owned');
      expect(s.read()).toBeNull();
    });

    it('a remembered id is a restoration input and is still re-verified against the list', () => {
      const s = store();
      expect(onSwitch(s, SELVES, A.id, B.id)).toBe(B.id);
      expect(s.read()).toBe(B.id);
      // The same stored value is discarded when the authoritative list no longer
      // contains it: persistence never outranks the server's answer.
      expect(restore(s, [A])).toBeNull();
      expect(s.read()).toBeNull();
    });

    it('degrades without persistence: the switch still resolves when no store exists', () => {
      expect(onSwitch(null, SELVES, A.id, B.id)).toBe(B.id);
    });
  });

  describe('release remains a separate operation', () => {
    it('session expiry still releases into the no-active-Self state and forgets the id', () => {
      const s = store({ [ACTIVE_SELF_KEY]: A.id });
      onSessionExpired(s);
      expect(s.read()).toBeNull();
      expect(presentsSelection(null)).toBe(true);
    });

    it('a switch is not a release: it forgets nothing and leaves a Self active', () => {
      const s = store({ [ACTIVE_SELF_KEY]: A.id });
      const result = onSwitch(s, SELVES, A.id, B.id);
      expect(s.read()).toBe(B.id);
      expect(result).toBe(B.id);
    });
  });
});
