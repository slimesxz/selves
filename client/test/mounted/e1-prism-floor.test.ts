// P10-E1 — the first mounted verification experiment. Constructed, not run.
//
// The mounted subject is the production `App`, reached through the committed
// harness, which renders it inside StrictMode exactly as `client/src/main.tsx`
// does. No wrapper replaces App, no production provider is substituted, and no
// compatibility renderer is introduced.
//
// ASSERTION FORM (P10-F3). Assertions are written in terms of governing
// dependency, transition, and production consequence — never literal
// development invocation count. StrictMode's intentional duplicate development
// invocation of effects is development semantics: it is neither implementation
// failure nor constitutional evidence. Binding 5 in particular is stated as
// "which occasions produce a count request, and for which Self", never as "how
// many times the effect body ran".
//
// TRANSPORT. A recording transport, installed by replacing the global `fetch`
// that `App`'s module-level `browserTransport` calls. No real network, no
// production backend, no server observation. It records occurrence, ordering,
// identity, and the phase of the production flow in which each request was
// issued, and answers from fixtures.
//
// SCOPE. Bindings 1, 2, 3, 4, and 5 only. Bindings 6–10 are assigned to E1 but
// are not addressed here and are not implicitly opened. Binding 21 — that
// returning from Correspondences does not re-fire the count — belongs to E2 and
// is deliberately not exercised: this experiment never presses Back.
//
// BINDING 5, UNDER P10-B5. Navigation is not itself the count-fetch trigger:
// the governing trigger is the production dependency whose change makes a new
// count authoritative. An explicit navigation is a binding-5 occasion only when
// it changes that dependency or enters the count-owning Prism surface with a
// newly established active Self. An explicit human act is therefore not
// constitutionally identical to an explicit count-fetch occasion.
//
// The transition
//
//   no active Self → deliberate activation of self-wren → Prism floor
//
// is the explicit navigation into the count-owning surface for a newly
// established active Self, and it is the positive occasion this experiment
// proves. Continue is exercised only as the non-triggering navigation-away
// occasion binding 5's final limb requires. The Correspondences → Prism return
// is binding 21's dependency-preserving instance of that same final limb; it
// remains an E2 observation and is not exercised here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import App from '../../src/App.tsx';
import { API_PREFIX } from '../../src/api/transport.ts';
import { ARTIFACT_COUNT_PATH } from '../../src/prism/count.ts';
import { SELVES_PATH } from '../../src/self/load.ts';
import { mount, type Mounted } from '../harness/mount.ts';

const SELVES_URL = `${API_PREFIX}${SELVES_PATH}`;
const COUNT_URL = `${API_PREFIX}${ARTIFACT_COUNT_PATH}`;

/** Two Selves with distinct names, so `labelSelves` adds no slot to either. The
 *  Self selected below is the SECOND — binding 2 is about the active Self, not
 *  the first listed, and a one-Self fixture could not tell them apart. */
const SELVES = [
  { id: 'self-ora', name: 'Ora', slot: 0 },
  { id: 'self-wren', name: 'Wren', slot: 1 },
];
const ACTIVE = SELVES[1]!;

/** Three authored Artifacts. Binding 3 is about the displayed count being the
 *  fetched one, so the fixture length must not coincide with any other number
 *  on the floor. */
const AUTHORED = [{ id: 'artifact-1' }, { id: 'artifact-2' }, { id: 'artifact-3' }];

interface Recorded {
  readonly phase: string;
  readonly url: string;
  readonly method: string;
  readonly actingSelf: string | null;
}

interface Recorder {
  readonly calls: Recorded[];
  phase: (next: string) => void;
  restore: () => void;
}

/** The recording transport. It answers `/auth/selves` and `/artifacts` from the
 *  fixtures above and every other path with an empty array, so no request path
 *  throws and none is silently unobserved. */
function record(): Recorder {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  let phase = 'before-active-self';
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      phase,
      url,
      method: String(init.method ?? 'GET'),
      actingSelf: headers['x-acting-self'] ?? null,
    });
    const body = url === SELVES_URL ? SELVES : url === COUNT_URL ? AUTHORED : [];
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
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const countRequests = (r: Recorder, phase?: string): Recorded[] =>
  r.calls.filter((c) => c.url === COUNT_URL && (phase === undefined || c.phase === phase));

const buttons = (app: Mounted): HTMLButtonElement[] =>
  [...app.container.querySelectorAll('button')] as HTMLButtonElement[];

const floor = (app: Mounted): HTMLElement | null => {
  const main = app.container.querySelector('main');
  if (main === null) return null;
  return main.querySelector('h1') === null ? null : main;
};

let recorder: Recorder;
let app: Mounted | null = null;

beforeEach(() => {
  sessionStorage.clear(); // no remembered Self: the flow begins at selection
  recorder = record();
});

afterEach(async () => {
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

/** Mounts the production App and walks the production path to the Prism floor:
 *  the account load resolves, no Self is remembered, so selection is presented;
 *  activating one Self is the explicit human act that makes it active. */
async function reachFloor(): Promise<Mounted> {
  const mounted = await mount(createElement(App));
  app = mounted;
  // The deliberate activation of a Self: it establishes the active Self and
  // enters the count-owning Prism floor. Under P10-B5 this is binding 5's
  // positive explicit-navigation occasion, because it changes the governing
  // dependency `activeSelfId` rather than merely moving a human between
  // surfaces.
  recorder.phase('explicit-navigation-to-prism');
  const control = buttons(mounted).find((b) => b.textContent === ACTIVE.name);
  expect(control, 'the switcher offers the Self to be activated').toBeDefined();
  await mounted.step(() => {
    control!.click();
  });
  return mounted;
}

describe('E1 — Prism floor, mounted', () => {
  it('binding 1 — `PrismFloor` renders exactly three elements, no fourth', async () => {
    const mounted = await reachFloor();
    const main = floor(mounted);
    expect(main).not.toBeNull();
    const rendered = [...main!.children];
    expect(rendered).toHaveLength(3);
    expect(rendered.map((el) => el.tagName)).toEqual(['H1', 'P', 'BUTTON']);
  });

  it('binding 2 — name read from the active Self, not the first listed', async () => {
    const mounted = await reachFloor();
    const name = floor(mounted)!.querySelector('h1');
    expect(name!.textContent).toBe(ACTIVE.name);
    expect(name!.textContent).not.toBe(SELVES[0]!.name); // the first listed
  });

  it('binding 3 — the displayed count is the fetched count', async () => {
    const mounted = await reachFloor();
    const count = floor(mounted)!.querySelector('p');
    expect(count!.textContent).toBe(String(AUTHORED.length));
    // The rendered value came from the response, not from the fixture by
    // coincidence: the count request was issued and answered with that array.
    expect(countRequests(recorder).length).toBeGreaterThan(0);
  });

  it('binding 4 — Prism mounts iff Self active, count known, surface prism', async () => {
    const mounted = await mount(createElement(App));
    app = mounted;
    // No Self active: selection is presented and no floor exists.
    expect(floor(mounted)).toBeNull();
    expect(mounted.container.querySelector('nav')).not.toBeNull();

    recorder.phase('explicit-navigation-to-prism');
    const control = buttons(mounted).find((b) => b.textContent === ACTIVE.name);
    await mounted.step(() => {
      control!.click();
    });
    // Self active and count known: the floor is present.
    expect(floor(mounted)).not.toBeNull();

    // Surface no longer prism: Continue transitions away and the floor goes.
    recorder.phase('navigation-away-from-prism');
    const cont = buttons(mounted).find((b) => b.textContent === 'Continue');
    expect(cont, 'the floor offers Continue').toBeDefined();
    await mounted.step(() => {
      cont!.click();
    });
    expect(floor(mounted)).toBeNull();
  });

  it('binding 5 — the count fetch fires on mount and on explicit navigation, and on no other occasion', async () => {
    const mounted = await reachFloor();

    // Stated as constitutional occasions and governing dependency, never as
    // literal invocation count. StrictMode intentionally invokes effects twice
    // in development; the distinct-tuple assertion below collapses duplicate
    // development representations of ONE occasion, and is applied within a
    // single phase so it can never collapse two different occasions into one.

    // NEGATIVE — no count request exists before an active Self exists.
    expect(countRequests(recorder, 'before-active-self')).toHaveLength(0);

    // POSITIVE — the deliberate activation of self-wren establishes the active
    // Self and enters the count-owning Prism floor, and a count request is
    // attributable to that occasion.
    expect(floor(mounted), 'the occasion entered the Prism floor').not.toBeNull();
    const onEntry = countRequests(recorder, 'explicit-navigation-to-prism');
    expect(onEntry.length).toBeGreaterThan(0);

    // Request identity is governed by self-wren.
    for (const call of onEntry) {
      expect(call.method).toBe('GET');
      expect(call.actingSelf).toBe(ACTIVE.id);
    }
    const distinct = new Set(onEntry.map((c) => `${c.method} ${c.url} ${c.actingSelf}`));
    expect(distinct.size).toBe(1);

    // NO OTHER OCCASION — Continue navigates away from the Prism floor without
    // establishing a different active Self, so the governing dependency is
    // unchanged and no count request follows.
    recorder.phase('navigation-away-from-prism');
    const cont = buttons(mounted).find((b) => b.textContent === 'Continue');
    await mounted.step(() => {
      cont!.click();
    });
    expect(countRequests(recorder, 'navigation-away-from-prism')).toHaveLength(0);
    // The active Self did not change across that navigation.
    const asserted = new Set(recorder.calls.filter((c) => c.actingSelf !== null).map((c) => c.actingSelf));
    expect([...asserted]).toEqual([ACTIVE.id]);
  });
});
