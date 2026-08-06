// P10-E2 — Correspondences mounted experiment. Constructed, not run.
//
// SCOPE. Bindings 11, 12, 13, 14, 15, 16, 17, 18, 20, 21 — the ten Class A
// bindings assigned to E2. BINDING 19 IS CLASS B and is not constructed here:
// it names the real server's `GET /placements` and recipients responses
// deserializing into `read.ts`'s shapes, and an injected transport cannot
// establish it. Nothing below may be represented as a real server response,
// real deserialization, real backend authorization, or any Class B evidence.
//
// E1 REMAINS COMPLETE AND CLOSED. Bindings 1–10 are not reopened. Reaching
// Correspondences requires the Prism floor, so the account load, the deliberate
// activation, and the count read are traversed here — as already-closed
// production behavior, not as fresh assertions. No case asserts a proposition
// belonging to 1–10.
//
// MOUNTED SUBJECT. The production `App`, through the committed P10-V1 harness,
// inside StrictMode, reached by the production path:
//
//   account load → active Self → Prism floor → Continue → Correspondences
//                → Back → Prism floor
//
// No wrapper replaces App, no provider is substituted, no compatibility
// renderer is introduced, and no Correspondences-only mount is used.
//
// ASSERTION FORM (P10-F3, P10-B5). Governing dependency, production transition,
// stable rendered consequence, and ruled request occasion. StrictMode's
// intentional duplicate development invocation is development semantics: it is
// never asserted against and never counted as a second constitutional occasion.
// Where a request may be issued more than once for one occasion, every held
// response is released and the assertions speak of occasions, not counts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import App from '../../src/App.tsx';
import { API_PREFIX } from '../../src/api/transport.ts';
import { ARTIFACT_COUNT_PATH } from '../../src/prism/count.ts';
import { SELVES_PATH } from '../../src/self/load.ts';
import { mount, type Mounted } from '../harness/mount.ts';

const SELVES_URL = `${API_PREFIX}${SELVES_PATH}`;
const COUNT_URL = `${API_PREFIX}${ARTIFACT_COUNT_PATH}`;
/** The committed Correspondences read path (`correspondences/read.ts:58`). */
const PLACEMENTS_URL = `${API_PREFIX}/placements`;

/** Three Selves with distinct names, so `labelSelves` appends no slot. `Wren`
 *  is activated; `Ora` is the sole counterpart; `Kite` is in the account list
 *  and is NEVER a counterpart — it exists so binding 15 can show the projection
 *  derives from the read outcome rather than from the Self list. */
const SELVES = [
  { id: 'self-ora', name: 'Ora', slot: 0 },
  { id: 'self-wren', name: 'Wren', slot: 1 },
  { id: 'self-kite', name: 'Kite', slot: 2 },
];
const ACTIVE = SELVES[1]!;
const COUNTERPART = SELVES[0]!;
const NON_COUNTERPART = SELVES[2]!;

/** Two authored Artifacts for the count read. Its value is irrelevant to E2 and
 *  is fixed only so the floor can stand. */
const AUTHORED = [{ id: 'artifact-1' }, { id: 'artifact-2' }];

/** One settled Placement RECEIVED from the counterpart. Because the active Self
 *  is not its sender, `read.ts` issues no recipients request for it, so the
 *  read is one request and the flow stays minimal. */
const PLACEMENTS = [
  {
    id: 'placement-1',
    senderSelfId: COUNTERPART.id,
    state: 'settled',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

interface Recorded {
  readonly phase: string;
  readonly url: string;
  readonly method: string;
  readonly actingSelf: string | null;
  readonly disposition: 'completed' | 'held';
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

interface Recorder {
  readonly calls: Recorded[];
  phase: (next: string) => void;
  /** Standing answer for a url. */
  answer: (url: string, answer: Answer) => void;
  /** Answer one request to this url with this status, once. */
  answerOnce: (url: string, answer: Answer) => void;
  /** Hold responses for this url unresolved, so pending state is observable. */
  hold: (url: string, on: boolean) => void;
  /** Resolve every held response for this url. Called inside `act`. */
  release: (url: string, answer: Answer) => void;
  restore: () => void;
}

function record(): Recorder {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  let phase = 'account-load';
  const answers = new Map<string, Answer>([
    [SELVES_URL, { status: 200, body: SELVES }],
    [COUNT_URL, { status: 200, body: AUTHORED }],
    [PLACEMENTS_URL, { status: 200, body: PLACEMENTS }],
  ]);
  const once = new Map<string, Answer>();
  const holding = new Set<string>();
  const held = new Map<string, Array<(res: Response) => void>>();

  const respond = ({ status, body }: Answer): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const willHold = holding.has(url) && !once.has(url);
    calls.push({
      phase,
      url,
      method: String(init.method ?? 'GET'),
      actingSelf: headers['x-acting-self'] ?? null,
      disposition: willHold ? 'held' : 'completed',
    });
    if (willHold) {
      return new Promise<Response>((resolve) => {
        const queue = held.get(url) ?? [];
        queue.push(resolve);
        held.set(url, queue);
      });
    }
    const single = once.get(url);
    if (single !== undefined) {
      once.delete(url);
      return respond(single);
    }
    return respond(answers.get(url) ?? { status: 200, body: [] });
  }) as typeof fetch;

  return {
    calls,
    phase: (next) => {
      phase = next;
    },
    answer: (url, a) => {
      answers.set(url, a);
    },
    answerOnce: (url, a) => {
      once.set(url, a);
    },
    hold: (url, on) => {
      if (on) holding.add(url);
      else holding.delete(url);
    },
    release: (url, a) => {
      const queue = held.get(url) ?? [];
      held.set(url, []);
      // Every held response is released: development may have issued the
      // request more than once for the one occasion.
      for (const resolve of queue.splice(0, queue.length)) resolve(respond(a));
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const requestsTo = (r: Recorder, url: string, phase?: string): Recorded[] =>
  r.calls.filter((c) => c.url === url && (phase === undefined || c.phase === phase));

const buttons = (app: Mounted): HTMLButtonElement[] =>
  [...app.container.querySelectorAll('button')] as HTMLButtonElement[];

const control = (app: Mounted, label: string): HTMLButtonElement | undefined =>
  buttons(app).find((b) => b.textContent === label);

const floor = (app: Mounted): HTMLElement | null => {
  const main = app.container.querySelector('main');
  if (main === null) return null;
  return main.querySelector('h1') === null ? null : main;
};

/** The Correspondences surface: a `main` with Back and no floor heading. */
const correspondences = (app: Mounted): HTMLElement | null => {
  const main = app.container.querySelector('main');
  if (main === null || main.querySelector('h1') !== null) return null;
  return control(app, 'Back') === undefined ? null : main;
};

const gate = (app: Mounted): HTMLFormElement | null =>
  app.container.querySelector('form');
const selection = (app: Mounted): Element | null => app.container.querySelector('nav');
const text = (app: Mounted): string => app.container.textContent ?? '';

let recorder: Recorder;
let app: Mounted | null = null;

beforeEach(() => {
  sessionStorage.clear();
  recorder = record();
});

afterEach(async () => {
  // No held response outlives its case.
  recorder.release(PLACEMENTS_URL, { status: 200, body: PLACEMENTS });
  recorder.release(COUNT_URL, { status: 200, body: AUTHORED });
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

/** Mounts production App and walks the already-closed E1 path to the floor:
 *  account load, deliberate activation, count read. Nothing here is asserted as
 *  E2 evidence; it is the production route to Correspondences. */
async function reachFloor(): Promise<Mounted> {
  const mounted = await mount(createElement(App));
  app = mounted;
  recorder.phase('active-self-established');
  const self = control(mounted, ACTIVE.name);
  expect(self, 'the switcher offers the Self to be activated').toBeDefined();
  await mounted.step(() => {
    self!.click();
  });
  expect(floor(mounted), 'ROUTE: the Prism floor was reached').not.toBeNull();
  return mounted;
}

/** Activates Continue from the floor. */
async function activateContinue(mounted: Mounted): Promise<void> {
  const cont = control(mounted, 'Continue');
  expect(cont, 'the floor offers Continue').toBeDefined();
  await mounted.step(() => {
    cont!.click();
  });
}

describe('E2 — Correspondences, mounted', () => {
  // BINDING 11 — accepted wording:
  //   "That `PrismFloor`'s Continue button actually invokes the `onContinue`
  //    prop when activated."
  // Object: the rendered control reaching the prop it was supplied. Observable
  // only through the prop's effect, so the assertion is that activation
  // produces a surface transition at all — if the control did not reach its
  // prop, the floor would simply remain.
  it('binding 11 — the rendered Continue control invokes the `onContinue` prop it was supplied', async () => {
    const mounted = await reachFloor();
    expect(floor(mounted)).not.toBeNull();

    recorder.phase('continue-to-correspondences');
    await activateContinue(mounted);

    // The prop was reached: the floor is gone and the surface has moved.
    expect(floor(mounted), 'activation reached the prop').toBeNull();
    expect(correspondences(mounted)).not.toBeNull();
  });

  // BINDING 12 — accepted wording:
  //   "That `App` passes `() => setSurface(onContinue())` as that prop — the
  //    binding is source-visible but untested."
  // Object: WHICH handler App supplies. Distinct from 11: 11 asks whether the
  // control reaches its prop, 12 asks whether the prop App supplied is the one
  // that sets `onContinue()`'s surface. `onContinue()` returns the
  // correspondences surface in `pending` state, so the read is held here and
  // the pending presentation is the evidence — an App supplying any other
  // handler could not produce it.
  it('binding 12 — App supplies the handler that sets `onContinue()`\'s surface', async () => {
    const mounted = await reachFloor();
    recorder.hold(PLACEMENTS_URL, true);
    recorder.phase('read-pending');
    await activateContinue(mounted);

    const main = correspondences(mounted);
    expect(main, 'the correspondences surface was produced').not.toBeNull();
    // Exactly `onContinue()`'s value: correspondences, state `pending`.
    expect(main!.querySelector('[role="status"]')!.textContent).toBe('Loading.');
    expect(text(mounted)).not.toContain('Unavailable.');
    expect(text(mounted)).not.toContain(COUNTERPART.name);

    await mounted.step(() => {
      recorder.release(PLACEMENTS_URL, { status: 200, body: PLACEMENTS });
    });
  });

  // BINDING 13 — accepted wording:
  //   "That the read effect fires exactly once per `pending` surface, and not
  //    twice under React's effect semantics."
  // Evaluated by governing dependency and ruled occasion, never by literal
  // development invocation count: one pending surface is one read occasion, and
  // a resolved surface is no occasion at all.
  it('binding 13 — one pending surface is one read occasion, and a resolved surface is none', async () => {
    const mounted = await reachFloor();

    // No read occasion exists before the surface is pending.
    expect(requestsTo(recorder, PLACEMENTS_URL)).toHaveLength(0);

    recorder.phase('read-pending');
    await activateContinue(mounted);

    const onPending = requestsTo(recorder, PLACEMENTS_URL, 'read-pending');
    expect(onPending.length).toBeGreaterThan(0);
    for (const call of onPending) {
      expect(call.method).toBe('GET');
      expect(call.actingSelf).toBe(ACTIVE.id);
    }
    // One occasion: every request in it is the same request.
    const distinct = new Set(onPending.map((c) => `${c.method} ${c.url} ${c.actingSelf}`));
    expect(distinct.size).toBe(1);

    // The surface is no longer pending, and no further read occasion follows.
    recorder.phase('read-resolved');
    await mounted.step(() => {});
    expect(text(mounted)).toContain(COUNTERPART.name);
    expect(requestsTo(recorder, PLACEMENTS_URL, 'read-resolved')).toHaveLength(0);
  });

  // BINDING 14 — accepted wording:
  //   "That the effect's cleanup actually suppresses a late resolution after
  //    unmount or surface change."
  // Object: the cleanup flag's effect on a resolution arriving after the
  // surface has changed. The read is held, Back changes the surface, and only
  // then is the response released.
  it('binding 14 — cleanup suppresses a resolution arriving after the surface changed', async () => {
    const mounted = await reachFloor();
    recorder.hold(PLACEMENTS_URL, true);
    recorder.phase('read-pending');
    await activateContinue(mounted);
    expect(requestsTo(recorder, PLACEMENTS_URL, 'read-pending').length).toBeGreaterThan(0);
    expect(correspondences(mounted)).not.toBeNull();

    // Surface change while the read is still in flight.
    recorder.phase('back-to-prism');
    const back = control(mounted, 'Back');
    expect(back).toBeDefined();
    await mounted.step(() => {
      back!.click();
    });
    expect(floor(mounted), 'the surface changed before the response arrived').not.toBeNull();

    // The late resolution arrives and is suppressed: it writes no state.
    recorder.phase('late-resolution');
    await mounted.step(() => {
      recorder.release(PLACEMENTS_URL, { status: 200, body: PLACEMENTS });
    });
    expect(floor(mounted), 'the late resolution wrote nothing').not.toBeNull();
    expect(correspondences(mounted)).toBeNull();
    expect(text(mounted)).not.toContain(COUNTERPART.name);
  });

  // BINDING 15 — accepted wording:
  //   "That `Correspondences.tsx` receives the state produced by
  //    `onReadResolved` rather than some other value."
  // The fixture makes the difference visible: the projection must contain the
  // counterpart derived from the READ OUTCOME, and must not contain a Self that
  // exists in the account list but is no counterpart.
  it('binding 15 — Correspondences receives the state `onReadResolved` produced', async () => {
    const mounted = await reachFloor();
    recorder.phase('read-resolved');
    await activateContinue(mounted);

    const main = correspondences(mounted);
    expect(main).not.toBeNull();
    const groups = [...main!.querySelectorAll('p')].map((p) => p.textContent);
    // The derived projection: the counterpart of the settled Placement.
    expect(groups).toContain(COUNTERPART.name);
    // Not the Self list: a non-counterpart Self renders nowhere.
    expect(text(mounted)).not.toContain(NON_COUNTERPART.name);
    // Not another state value.
    expect(text(mounted)).not.toContain('Loading.');
    expect(text(mounted)).not.toContain('Unavailable.');
  });

  // BINDING 16 — accepted wording:
  //   "That the `Back` button's `onReturn` reaches `setSurface(onReturn())`."
  // `onReturn()` returns the prism surface, so the evidence is the floor
  // standing again after activation. Distinct from 14, which concerns what a
  // late response does, not what Back does.
  it('binding 16 — the Back control reaches `setSurface(onReturn())`', async () => {
    const mounted = await reachFloor();
    recorder.phase('read-resolved');
    await activateContinue(mounted);
    expect(correspondences(mounted)).not.toBeNull();

    recorder.phase('back-to-prism');
    const back = control(mounted, 'Back');
    expect(back).toBeDefined();
    await mounted.step(() => {
      back!.click();
    });

    // Exactly `onReturn()`'s value: the prism surface.
    expect(floor(mounted)).not.toBeNull();
    expect(correspondences(mounted)).toBeNull();
  });

  // BINDING 17 — accepted wording:
  //   "That a 401 at the Correspondences layer visibly produces the auth gate."
  it('binding 17 — a 401 at the Correspondences layer visibly produces the auth gate', async () => {
    const mounted = await reachFloor();
    recorder.answerOnce(PLACEMENTS_URL, { status: 401, body: {} });
    recorder.phase('read-401');
    await activateContinue(mounted);

    const form = gate(mounted);
    expect(form, 'the auth gate is visible').not.toBeNull();
    expect(form!.querySelector('input[type="password"]')).not.toBeNull();
    expect(control(mounted, 'Authenticate')).toBeDefined();
    expect(floor(mounted)).toBeNull();
    expect(correspondences(mounted)).toBeNull();
  });

  // BINDING 18 — accepted wording:
  //   "That a 403 at that layer visibly returns the user to the selection
  //    surface."
  it('binding 18 — a 403 at the Correspondences layer visibly returns the user to selection', async () => {
    const mounted = await reachFloor();
    recorder.answerOnce(PLACEMENTS_URL, { status: 403, body: {} });
    recorder.phase('read-403');
    await activateContinue(mounted);

    expect(selection(mounted), 'the selection surface is visible').not.toBeNull();
    expect(control(mounted, ACTIVE.name), 'selection offers the Selves').toBeDefined();
    expect(floor(mounted)).toBeNull();
    expect(correspondences(mounted)).toBeNull();
    expect(gate(mounted), 'a 403 is not an authentication outcome').toBeNull();
  });

  // BINDING 20 — accepted wording:
  //   "That the surface renders at all: no case mounts a component."
  // Distinct from 15: this is that the Correspondences component renders when
  // the surface is correspondences, asserted in the PENDING state, where no
  // projection value exists to be received.
  it('binding 20 — the Correspondences surface renders when it is the surface', async () => {
    const mounted = await reachFloor();
    recorder.hold(PLACEMENTS_URL, true);
    recorder.phase('read-pending');
    await activateContinue(mounted);

    const main = correspondences(mounted);
    expect(main, 'the component rendered').not.toBeNull();
    expect(main!.tagName).toBe('MAIN');
    expect(control(mounted, 'Back'), 'its Return control rendered').toBeDefined();
    expect(main!.querySelector('[role="status"]'), 'its pending state rendered').not.toBeNull();

    await mounted.step(() => {
      recorder.release(PLACEMENTS_URL, { status: 200, body: PLACEMENTS });
    });
  });

  // BINDING 21 — construed through the common proposition of its two accepted
  // formulations, as ruled:
  //   "returning from Correspondences to the Prism floor does not re-fire the
  //    artifact-count operation because activeSelfId does not change across the
  //    transition."
  // The textual-authority question between the two formulations remains open
  // and is not resolved here. Literal development invocation count is not the
  // constitutional object: the assertion is that the human-directed navigation
  // leaves the governing dependency unchanged and produces no new count
  // occasion.
  it('binding 21 — returning to the Prism floor produces no new count occasion', async () => {
    const mounted = await reachFloor();
    const beforeContinue = requestsTo(recorder, COUNT_URL);
    expect(beforeContinue.length).toBeGreaterThan(0);
    for (const call of beforeContinue) expect(call.actingSelf).toBe(ACTIVE.id);

    recorder.phase('read-resolved');
    await activateContinue(mounted);
    expect(correspondences(mounted)).not.toBeNull();

    // The human-directed navigation back.
    recorder.phase('back-to-prism');
    const back = control(mounted, 'Back');
    await mounted.step(() => {
      back!.click();
    });

    // The floor stands again, with its count intact.
    const main = floor(mounted);
    expect(main).not.toBeNull();
    expect(main!.querySelector('p')!.textContent).toBe(String(AUTHORED.length));
    // The governing dependency did not change across the transition.
    const asserted = new Set(
      recorder.calls.filter((c) => c.actingSelf !== null).map((c) => c.actingSelf),
    );
    expect([...asserted]).toEqual([ACTIVE.id]);
    // And no new count occasion followed the return.
    expect(requestsTo(recorder, COUNT_URL, 'back-to-prism')).toHaveLength(0);
    expect(requestsTo(recorder, COUNT_URL, 'read-resolved')).toHaveLength(0);
  });
});
