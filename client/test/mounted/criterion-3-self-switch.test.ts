// P10-C3B — the mounted client limb of Playbook criterion 3:
//
//   "Switching Self changes authorization context immediately."
//
// The object is narrow and client-side only: when the mounted production client
// has Self A active and the user deliberately selects a different owned Self B
// through the production switch control, the client applies B as the active
// identity context before subsequent Self-scoped behavior can continue under A.
//
// This is a criterion-level observation. It is not a numbered binding, it
// reopens none, and it re-proves nothing of P10-CB1's server-side limb: every
// response below is supplied by the recording transport, so nothing here is
// evidence about a real server. What it does observe is which acting Self the
// production client CONSTRUCTS its next Self-scoped request under, which is a
// client fact and the one criterion 3's client limb names.
//
// The transition it exercises exists only since P10-S20. Before that commit the
// switcher rendered solely while no Self was active, so A -> B could not occur
// at all and P10-C3 halted for implementation absence rather than proof form.
//
// Ordering, not timing. "Immediately" is observed as: at the moment the switch
// settles, Self A's authoritative count is already gone and the next request is
// already B's — not that either happened within some interval.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import App from '../../src/App.tsx';
import { API_PREFIX } from '../../src/api/transport.ts';
import { ARTIFACT_COUNT_PATH } from '../../src/prism/count.ts';
import { SELVES_PATH } from '../../src/self/load.ts';
import { mount, type Mounted } from '../harness/mount.ts';

const SELVES_URL = `${API_PREFIX}${SELVES_PATH}`;
const COUNT_URL = `${API_PREFIX}${ARTIFACT_COUNT_PATH}`;

/** Two owned Selves whose ids and rendered names both differ, so neither the
 *  asserted acting Self nor the rendered name can be confused for the other. */
const A = { id: 'self-ana', name: 'Ana', slot: 1 };
const B = { id: 'self-bo', name: 'Bo', slot: 2 };
const SELVES = [A, B];

/** Distinct, non-zero, single-digit counts that share no digit: three for A,
 *  seven for B. A stale count is therefore visible as itself rather than as a
 *  plausible value for the other Self. */
const A_ARTIFACTS = [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }];
const B_ARTIFACTS = [
  { id: 'b-1' }, { id: 'b-2' }, { id: 'b-3' }, { id: 'b-4' },
  { id: 'b-5' }, { id: 'b-6' }, { id: 'b-7' },
];

interface Recorded {
  readonly phase: string;
  readonly url: string;
  readonly actingSelf: string | null;
}

interface Recorder {
  readonly calls: Recorded[];
  phase: (next: string) => void;
  deferCount: (on: boolean) => void;
  releaseCount: (body: unknown) => void;
  restore: () => void;
}

/** The accepted mounted-test transport form: production `App` reaches its own
 *  `browserTransport`, and that transport's `fetch` is what is recorded. It
 *  records and answers; it decides no active Self and mutates no App state. */
function record(): Recorder {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  let phase = 'reach-a';
  let deferring = false;
  const held: Array<(res: Response) => void> = [];

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const actingSelf = headers['x-acting-self'] ?? null;
    calls.push({ phase, url, actingSelf });

    if (url === COUNT_URL && deferring) {
      return new Promise<Response>((resolve) => held.push(resolve));
    }
    const body = url === SELVES_URL ? SELVES : url === COUNT_URL ? A_ARTIFACTS : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    calls,
    phase: (next) => {
      phase = next;
    },
    deferCount: (on) => {
      deferring = on;
    },
    // Every held response is released: development StrictMode may have issued
    // the one occasion's request more than once, and leaving any pending would
    // observe a state no production occasion produces.
    releaseCount: (body) => {
      for (const resolve of held.splice(0, held.length)) {
        resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const buttons = (root: ParentNode): HTMLButtonElement[] =>
  [...root.querySelectorAll('button')] as HTMLButtonElement[];

/** The no-active-Self selection surface. Its landmark is `nav`. */
const selection = (app: Mounted): Element | null => app.container.querySelector('nav');

/** The persistent switch chrome, which is a `header` and never the selection
 *  surface. Keeping the two locators distinct is what fences switch from
 *  release: a case that reached B through selection would find `nav`, not this. */
const chrome = (app: Mounted): Element | null => app.container.querySelector('header');

/** The Prism floor: a `main` bearing the active Self's name. It mounts only on
 *  a complete state, so its absence is itself the pending observation. */
const floor = (app: Mounted): HTMLElement | null => {
  const main = app.container.querySelector('main');
  if (main === null) return null;
  return main.querySelector('h1') === null ? null : main;
};

const countRequests = (r: Recorder, phase: string): Recorded[] =>
  r.calls.filter((c) => c.url === COUNT_URL && c.phase === phase);

let recorder: Recorder;
let app: Mounted | null = null;

beforeEach(() => {
  sessionStorage.clear();
  recorder = record();
});

afterEach(async () => {
  recorder.releaseCount([]); // no held response outlives its case
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

describe('criterion 3 — mounted client limb: a direct Self-to-Self switch', () => {
  it('applies Self B as the active context before any Self-scoped continuation under Self A', async () => {
    // ── Reach Self A active, through the production selection surface. ──────
    const mounted = await mount(createElement(App));
    app = mounted;

    const nav = selection(mounted);
    expect(nav, 'the account load resolved to selection').not.toBeNull();
    const ana = buttons(nav!).find((b) => b.textContent === A.name);
    expect(ana, 'selection offers Ana').toBeDefined();
    await mounted.step(() => {
      ana!.click();
    });

    // ── PRIOR STATE ─────────────────────────────────────────────────────────
    const before = floor(mounted);
    expect(before, "Self A's floor stands").not.toBeNull();
    expect(before!.querySelector('h1')!.textContent, 'Ana is the active Self').toBe(A.name);
    // The Self-scoped discriminator: A's own authoritative count, naturally
    // rendered. Three is A's and nothing else's.
    expect(before!.querySelector('p')!.textContent, "A's count is the operative fact").toBe(
      String(A_ARTIFACTS.length),
    );
    // Persistent chrome is available WHILE A is active — the state the switch
    // starts from — and the selection surface is not present.
    expect(chrome(mounted), 'the switch control is available while A is active').not.toBeNull();
    expect(selection(mounted), 'the app is not in the no-active-Self state').toBeNull();
    const bo = buttons(chrome(mounted)!).find((b) => b.textContent === B.name);
    expect(bo, 'the chrome offers Bo as a switch target').toBeDefined();

    // ── ONE DELIBERATE SWITCH, through the production control ───────────────
    // B's count is held, so the settled switch is observable before any
    // B-scoped continuation completes. Nothing sets state directly: no setter,
    // no `onSwitch` call, no sessionStorage write, no transport-driven mutation.
    recorder.phase('switch');
    recorder.deferCount(true);
    await mounted.step(() => {
      bo!.click();
    });

    // ── POST-SWITCH ACTIVE CONTEXT ──────────────────────────────────────────
    // The next Self-scoped request the client constructs is B's, and no request
    // is constructed under A after the switch. Stated over the SET of asserted
    // Selves, because StrictMode may issue the one occasion more than once.
    const issued = countRequests(recorder, 'switch');
    expect(issued.length, 'the switch produced a Self-scoped request').toBeGreaterThan(0);
    expect(
      [...new Set(issued.map((c) => c.actingSelf))],
      'every post-switch Self-scoped request asserts Bo, and none asserts Ana',
    ).toStrictEqual([B.id]);

    // Ordering: A's authoritative count is ALREADY gone at the moment the switch
    // settles — before B's own count resolves. A floor here would mean either
    // A still active or A's count surviving beside B's name.
    expect(floor(mounted), "A's count did not survive the switch").toBeNull();
    // And the switch did not reach B by releasing to selection.
    expect(selection(mounted), 'the switch did not pass through selection').toBeNull();
    expect(chrome(mounted), 'the switch control remains available').not.toBeNull();

    // ── B'S OWN CONTINUATION ────────────────────────────────────────────────
    recorder.phase('after');
    await mounted.step(() => {
      recorder.releaseCount(B_ARTIFACTS);
    });

    const after = floor(mounted);
    expect(after, "Self B's floor stands").not.toBeNull();
    expect(after!.querySelector('h1')!.textContent, 'Bo is the active Self').toBe(B.name);
    expect(after!.querySelector('h1')!.textContent, 'Ana is no longer active').not.toBe(A.name);
    expect(after!.querySelector('p')!.textContent, "B's count, never A's").toBe(
      String(B_ARTIFACTS.length),
    );
  });
});
