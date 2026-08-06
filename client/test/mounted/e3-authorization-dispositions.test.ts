// P10-E3 — authorization dispositions, mounted. Constructed, not run.
//
// SCOPE. Bindings 22, 23, 25, 26, 28 are constructed here.
//
// BINDINGS 24 AND 27 ARE HALTED, not constructed. Both name production wiring
// that the mounted boundary exposes no direct observation point for — binding 24
// names one shared `onForbidden` call site reached by three 403 paths, and
// binding 27 names App applying the settlement "at the actual call sites".
// Equivalent visible outcomes after different responses do not prove a shared
// call site, and the binding-11 precedent governs: where the wording names the
// wiring, a downstream consequence does not reach it. The construction report
// states the limitation; production source is not modified to create an
// observation point.
//
// BINDING 29 IS OUTSIDE THIS EXPERIMENT. Its constitutional object is the
// emitted production artifact under its production bootstrap semantics
// (P10-F2), which no mounted-source construct reaches.
//
// BINDING 73 IS OUTSIDE THIS EXPERIMENT (P10-F1). Binding 26 now denotes only
// "no in-application recovery action is exposed in the sub-case A empty shell";
// the reload claim is binding 73 and is separately held. Nothing below
// constructs a reload, observes session-lifecycle persistence, claims evidence
// for binding 73, or recombines the two claims.
//
// E1 AND E2 REMAIN COMPLETE AND CLOSED. The account load, the deliberate
// activation, the count read, and Continue are traversed here only as
// MECHANISM to reach an authorization state. No case asserts a proposition
// belonging to bindings 1–21, and no closed binding is reopened.
//
// MOUNTED SUBJECT. The production `App`, through the committed P10-V1 harness,
// inside StrictMode. No wrapper replaces App, no provider is substituted, no
// compatibility renderer is introduced. Every authorization state is entered
// through the production path the application actually uses.
//
// TRANSPORT. The committed injected recording transport, with one-shot outcomes
// so an initial 401, 403, or non-auth response cannot contaminate a later
// request. No real network, no backend, no server observation. Nothing here may
// be represented as a real server response, real backend authorization, real
// deserialization, or Class B evidence.
//
// STRICTMODE. Retained. Duplicate development invocation is development
// semantics: never asserted against, never a second constitutional occasion.
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

/** Three Selves with distinct names, so `labelSelves` appends no slot. */
const SELVES = [
  { id: 'self-ora', name: 'Ora', slot: 0 },
  { id: 'self-wren', name: 'Wren', slot: 1 },
  { id: 'self-kite', name: 'Kite', slot: 2 },
];
const ACTIVE = SELVES[1]!;
/** What a successful re-verification returns: the authoritative list WITHOUT
 *  `Kite`. Binding 23 turns on this difference — a selection presented from the
 *  stale account list would still show Kite. */
const REVERIFIED = [SELVES[0]!, SELVES[1]!];
const DROPPED = SELVES[2]!;
const AUTHORED = [{ id: 'artifact-1' }, { id: 'artifact-2' }];

interface Recorded {
  readonly phase: string;
  readonly url: string;
  readonly method: string;
  readonly actingSelf: string | null;
  readonly disposition: 'immediate' | 'one-shot' | 'held';
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

interface Recorder {
  readonly calls: Recorded[];
  phase: (next: string) => void;
  answer: (url: string, answer: Answer) => void;
  /** One-shot: consumed by the next request to that url only. */
  answerOnce: (url: string, answer: Answer) => void;
  hold: (url: string, on: boolean) => void;
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
    [PLACEMENTS_URL, { status: 200, body: [] }],
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
    const single = once.get(url);
    const willHold = single === undefined && holding.has(url);
    calls.push({
      phase,
      url,
      method: String(init.method ?? 'GET'),
      actingSelf: headers['x-acting-self'] ?? null,
      disposition: single !== undefined ? 'one-shot' : willHold ? 'held' : 'immediate',
    });
    if (single !== undefined) {
      once.delete(url);
      return respond(single);
    }
    if (willHold) {
      return new Promise<Response>((resolve) => {
        const queue = held.get(url) ?? [];
        queue.push(resolve);
        held.set(url, queue);
      });
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
      for (const resolve of queue.splice(0, queue.length)) resolve(respond(a));
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const requestsTo = (r: Recorder, url: string, phase?: string): Recorded[] =>
  r.calls.filter((c) => c.url === url && (phase === undefined || c.phase === phase));

const selfScoped = (r: Recorder, phase: string): Recorded[] =>
  r.calls.filter((c) => c.phase === phase && c.actingSelf !== null);

const buttons = (app: Mounted): HTMLButtonElement[] =>
  [...app.container.querySelectorAll('button')] as HTMLButtonElement[];

const control = (app: Mounted, label: string): HTMLButtonElement | undefined =>
  buttons(app).find((b) => b.textContent === label);

const floor = (app: Mounted): HTMLElement | null => {
  const main = app.container.querySelector('main');
  if (main === null) return null;
  return main.querySelector('h1') === null ? null : main;
};

const gate = (app: Mounted): HTMLFormElement | null => app.container.querySelector('form');
const selection = (app: Mounted): Element | null => app.container.querySelector('nav');
const labels = (app: Mounted): string[] =>
  [...(selection(app)?.querySelectorAll('button') ?? [])].map((b) => b.textContent ?? '');

let recorder: Recorder;
let app: Mounted | null = null;

beforeEach(() => {
  sessionStorage.clear();
  recorder = record();
});

afterEach(async () => {
  recorder.release(SELVES_URL, { status: 200, body: SELVES });
  recorder.release(COUNT_URL, { status: 200, body: AUTHORED });
  recorder.release(PLACEMENTS_URL, { status: 200, body: [] });
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

/** Fresh production mount, replacing any previous one. */
async function freshMount(): Promise<Mounted> {
  if (app !== null) await app.unmount();
  const mounted = await mount(createElement(App));
  app = mounted;
  return mounted;
}

/** MECHANISM ONLY — the closed E1/E2 route to an active Self and the floor. */
async function reachFloor(): Promise<Mounted> {
  const mounted = await freshMount();
  recorder.phase('active-self-established');
  const self = control(mounted, ACTIVE.name);
  expect(self, 'ROUTE: the switcher offers the Self').toBeDefined();
  await mounted.step(() => {
    self!.click();
  });
  expect(floor(mounted), 'ROUTE: the Prism floor was reached').not.toBeNull();
  return mounted;
}

/** MECHANISM ONLY — Continue, to reach the Correspondences read boundary. */
async function activateContinue(mounted: Mounted): Promise<void> {
  const cont = control(mounted, 'Continue');
  expect(cont, 'ROUTE: the floor offers Continue').toBeDefined();
  await mounted.step(() => {
    cont!.click();
  });
}

describe('E3 — authorization dispositions, mounted', () => {
  // BINDING 22 — accepted wording:
  //   "that App supplies a reverify thunk which actually performs the
  //    /auth/selves request"
  // The object is the thunk's PERFORMANCE of the request, and the request is
  // what the transport records — so this is direct, not a downstream inference.
  // Phase separation distinguishes the re-verification from the account load,
  // which uses the same account-scoped path at mount.
  it('binding 22 — App supplies a reverify thunk that performs the `/auth/selves` request', async () => {
    const mounted = await reachFloor();
    const atMount = requestsTo(recorder, SELVES_URL, 'account-load').length;
    expect(atMount, 'the account load used the same path at mount').toBeGreaterThan(0);

    recorder.phase('self-scoped-403');
    recorder.answerOnce(PLACEMENTS_URL, { status: 403, body: {} });
    await activateContinue(mounted);

    // The re-verification: an account-scoped request to the same path, issued
    // in the forbidden phase and not at mount.
    const reverify = requestsTo(recorder, SELVES_URL, 'self-scoped-403');
    expect(reverify.length, 'the thunk performed the request').toBeGreaterThan(0);
    for (const call of reverify) {
      expect(call.method).toBe('GET');
      // Account-scoped: the re-verification asserts no Self.
      expect(call.actingSelf).toBeNull();
    }
  });

  // BINDING 23 — accepted wording:
  //   "that the authoritative returned Self list reaches setSelves before
  //    selection is presented"
  // TWO CLAUSES, and the construct addresses both. That the list REACHES
  // setSelves is shown by the presented labels being the re-verified list, not
  // the stale account list. That it does so BEFORE selection is presented is
  // shown by observing every DOM state of the selection surface: an
  // implementation applying the list after presenting selection would produce a
  // state containing the dropped Self.
  it('binding 23 — the returned list reaches `setSelves` before selection is presented', async () => {
    const mounted = await reachFloor();
    // The re-verification answers a SHORTER authoritative list.
    recorder.answer(SELVES_URL, { status: 200, body: REVERIFIED });

    // Every rendered state of the selection surface, from this point on.
    const states: string[][] = [];
    const observer = new MutationObserver(() => {
      const nav = mounted.container.querySelector('nav');
      if (nav !== null) {
        states.push([...nav.querySelectorAll('button')].map((b) => b.textContent ?? ''));
      }
    });
    observer.observe(mounted.container, { childList: true, subtree: true, characterData: true });

    recorder.phase('self-scoped-403');
    recorder.answerOnce(PLACEMENTS_URL, { status: 403, body: {} });
    await activateContinue(mounted);
    observer.disconnect();

    // Selection is presented, from the authoritative returned list.
    expect(selection(mounted)).not.toBeNull();
    expect(labels(mounted)).toEqual(REVERIFIED.map((s) => s.name));

    // The observation is fenced: at least one rendered state was captured, so
    // the absence below cannot pass because nothing was observed.
    expect(states.length, 'selection states were observed').toBeGreaterThan(0);
    // No rendered state of selection ever contained the dropped Self, so the
    // list was in state before selection was presented.
    for (const state of states) expect(state).not.toContain(DROPPED.name);
  });

  // BINDING 25 — accepted wording:
  //   "that the visible 401 and 403 outcomes occur as ruled when components are
  //    mounted"
  // Observed at the COUNT read, the Self-scoped path E2's bindings 17 and 18 did
  // not cover; those closed the Correspondences layer and are not reused here.
  // The two outcomes are asserted separately and never merged.
  it('binding 25 — the visible 401 and 403 outcomes occur as ruled when mounted', async () => {
    // 401 — the authentication gate.
    const first = await freshMount();
    recorder.phase('count-401');
    recorder.answerOnce(COUNT_URL, { status: 401, body: {} });
    const self401 = control(first, ACTIVE.name);
    await first.step(() => {
      self401!.click();
    });
    const form = gate(first);
    expect(form, '401 produces the authentication gate').not.toBeNull();
    expect(form!.querySelector('input[type="password"]')).not.toBeNull();
    expect(floor(first)).toBeNull();

    // 403 — release to selection. A separate mount, so no outcome carries over.
    sessionStorage.clear();
    const second = await freshMount();
    recorder.phase('count-403');
    recorder.answerOnce(COUNT_URL, { status: 403, body: {} });
    const self403 = control(second, ACTIVE.name);
    await second.step(() => {
      self403!.click();
    });
    expect(selection(second), '403 returns the user to selection').not.toBeNull();
    expect(gate(second), '403 is not an authentication outcome').toBeNull();
    expect(floor(second)).toBeNull();
  });

  // BINDING 26 — accepted wording, as split at P10-R26:
  //   "no in-application recovery action is exposed in the sub-case A empty
  //    shell"
  // Sub-case A: the one permitted re-verification completes with a NON-AUTH
  // failure and yields no authoritative Self list. No reload is constructed and
  // no session-lifecycle persistence is observed — that is binding 73, held.
  it('binding 26 — no in-application recovery action is exposed in the sub-case A empty shell', async () => {
    const mounted = await reachFloor();

    recorder.phase('re-verification-non-auth-failure');
    recorder.answerOnce(PLACEMENTS_URL, { status: 403, body: {} });
    // The single re-verification completes with a non-auth failure.
    recorder.answerOnce(SELVES_URL, { status: 500, body: {} });
    await activateContinue(mounted);

    // The empty shell: no floor, no selection, no gate, no correspondences.
    expect(floor(mounted)).toBeNull();
    expect(selection(mounted)).toBeNull();
    expect(gate(mounted)).toBeNull();
    // And no in-application recovery action of any kind is exposed.
    expect(buttons(mounted)).toHaveLength(0);
    expect(mounted.container.querySelectorAll('input')).toHaveLength(0);
    expect((mounted.container.textContent ?? '').trim()).toBe('');
  });

  // BINDING 28 — accepted wording:
  //   "that the settled state is applied before any subsequent Self-scoped
  //    request could be issued when mounted"
  // The object is the ordering: once the forbidden transition has settled, no
  // Self-scoped request follows, and in particular none continues to assert the
  // Self the server refused.
  it('binding 28 — the settled state is applied before any subsequent Self-scoped request could be issued', async () => {
    const mounted = await reachFloor();
    const asserted = new Set(
      recorder.calls.filter((c) => c.actingSelf !== null).map((c) => c.actingSelf),
    );
    expect([...asserted], 'the refused Self was asserted before settlement').toEqual([ACTIVE.id]);

    recorder.phase('self-scoped-403');
    recorder.answerOnce(PLACEMENTS_URL, { status: 403, body: {} });
    await activateContinue(mounted);
    expect(selection(mounted), 'the transition settled').not.toBeNull();

    // After settlement: nothing Self-scoped follows.
    recorder.phase('post-settlement');
    await mounted.step(() => {});
    expect(selfScoped(recorder, 'post-settlement')).toHaveLength(0);
    expect(
      recorder.calls.filter((c) => c.phase === 'post-settlement' && c.actingSelf === ACTIVE.id),
    ).toHaveLength(0);
  });
});
