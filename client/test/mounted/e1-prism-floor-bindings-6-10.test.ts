// P10-E1, second experiment — bindings 6, 7, 8, 9, 10. Constructed, not run.
//
// BINDINGS 8 AND 9 traverse the Self-scoped 403 forbidden transition AS
// MECHANISM ONLY, authorized for that purpose alone. Their constitutional
// objects require a second count request for a different active Self while a
// prior count is known, and that is the only production route to it.
//
// Bindings 18, 24, and 25 govern the forbidden transition itself. They are
// ADJACENT AND UNOPENED. Nothing below asserts that every 403 path reaches
// selection, that the shared forbidden call site is correct, or that the
// visible 403 outcome is constitutionally proven. The one mechanism assertion
// records factually that selection was reached; a failure there is a
// mechanism-path failure and supports no conclusion about 8, 9, 18, 24, or 25.
// Adjacency is not opening. Mechanism is not evidence.
//
// BINDINGS 1–5 ARE NOT REOPENED. Two of the cases below observe the floor's
// presence or absence, which bindings 4 and 5 also touched. Those observations
// are not offered as closure of anything already closed: here they serve
// distinct propositions — when the completed-count transition is applied, and
// what survives an unknown count — and nothing in this file asserts a
// proposition belonging to 1–5.
//
// E2 REMAINS UNOPENED. Back is never pressed. Continue is activated in the
// bindings 8 and 9 cases, and the Correspondences read is issued there, solely
// as the Self-scoped request into which the authorized 403 is injected. Neither
// is asserted about: bindings 11, 12, and 16 — Continue invokes `onContinue`,
// App passes the handler, Back reaches `onReturn` — remain adjacent and
// unopened, as do 18, 24, and 25.
//
// The mounted subject is the production `App` through the committed P10-V1
// harness, inside StrictMode, exactly as bindings 1–5 were mounted. No wrapper
// replaces App, no provider is substituted, no compatibility renderer is used.
//
// StrictMode's intentional duplicate development invocation is development
// semantics. Nothing below asserts a literal invocation count; where the count
// request may be issued more than once in development, every pending request is
// resolved and the assertions speak of occasions and governing dependency.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import App from '../../src/App.tsx';
import { API_PREFIX } from '../../src/api/transport.ts';
import { ARTIFACT_COUNT_PATH } from '../../src/prism/count.ts';
import { ACTIVE_SELF_KEY } from '../../src/self/active.ts';
import { SELVES_PATH } from '../../src/self/load.ts';
import { mount, type Mounted } from '../harness/mount.ts';

const SELVES_URL = `${API_PREFIX}${SELVES_PATH}`;
const COUNT_URL = `${API_PREFIX}${ARTIFACT_COUNT_PATH}`;

const SELVES = [
  { id: 'self-ora', name: 'Ora', slot: 0 },
  { id: 'self-wren', name: 'Wren', slot: 1 },
];
const ACTIVE = SELVES[1]!;
const AUTHORED = [{ id: 'artifact-1' }, { id: 'artifact-2' }, { id: 'artifact-3' }];

/** Bindings 8 and 9 need two Selves and two counts that cannot be confused.
 *  Self A holds THREE authored Artifacts; Self B holds SEVEN. Neither is zero,
 *  neither is the other, and neither coincides with a placeholder: nothing else
 *  on either surface renders a digit, since both names are distinct and
 *  `labelSelves` therefore appends no slot. */
const SELF_A = SELVES[0]!;
const SELF_B = SELVES[1]!;
const COUNT_A = [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }];
const COUNT_B = [
  { id: 'b-1' }, { id: 'b-2' }, { id: 'b-3' }, { id: 'b-4' },
  { id: 'b-5' }, { id: 'b-6' }, { id: 'b-7' },
];
/** The committed Correspondences read path (`correspondences/read.ts`), used
 *  here solely as the Self-scoped request into which the 403 is injected. */
const PLACEMENTS_URL = `${API_PREFIX}/placements`;

interface Recorded {
  readonly phase: string;
  readonly url: string;
  readonly method: string;
  readonly actingSelf: string | null;
}

interface Recorder {
  readonly calls: Recorded[];
  phase: (next: string) => void;
  /** Hold count responses unresolved, so the pre-resolution state is
   *  observable. Required by binding 7 and by nothing else here. */
  deferCount: (on: boolean) => void;
  /** Resolve every held count response. Called inside `act`. */
  releaseCount: (status: number, body: unknown) => void;
  /** The body a count request receives, chosen by asserted acting Self. */
  countBody: (actingSelf: string, body: unknown) => void;
  /** Answer the next request to this url with 403, once. */
  forbidOnce: (url: string) => void;
  restore: () => void;
}

function record(): Recorder {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  let phase = 'before-active-self';
  let deferring = false;
  const held: Array<(res: Response) => void> = [];
  const countBodies = new Map<string, unknown>();
  const forbidden = new Set<string>();

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      phase,
      url,
      method: String(init.method ?? 'GET'),
      actingSelf: headers['x-acting-self'] ?? null,
    });
    if (forbidden.has(url)) {
      forbidden.delete(url); // once, on the named request only
      return new Response(JSON.stringify({}), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === COUNT_URL && deferring) {
      return new Promise<Response>((resolve) => held.push(resolve));
    }
    const asserted = headers['x-acting-self'] ?? '';
    const body =
      url === SELVES_URL
        ? SELVES
        : url === COUNT_URL
          ? (countBodies.get(asserted) ?? AUTHORED)
          : [];
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
    releaseCount: (status, body) => {
      // Every held response is released: in development StrictMode the request
      // may have been issued more than once for the one occasion, and leaving
      // any pending would observe a state no production occasion produces.
      const waiting = held.splice(0, held.length);
      for (const resolve of waiting) {
        resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
    },
    countBody: (actingSelf, body) => {
      countBodies.set(actingSelf, body);
    },
    forbidOnce: (url) => {
      forbidden.add(url);
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

const floor = (app: Mounted): HTMLElement | null => {
  const main = app.container.querySelector('main');
  if (main === null) return null;
  return main.querySelector('h1') === null ? null : main;
};

const selection = (app: Mounted): Element | null => app.container.querySelector('nav');

let recorder: Recorder;
let app: Mounted | null = null;

beforeEach(() => {
  sessionStorage.clear();
  recorder = record();
});

afterEach(async () => {
  recorder.releaseCount(200, []); // no held response outlives its case
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

/** Mounts production App and stops at selection: the account load resolves and
 *  no Self is remembered, so no Self is active. */
async function reachSelection(): Promise<Mounted> {
  const mounted = await mount(createElement(App));
  app = mounted;
  return mounted;
}

/** The deliberate activation of a Self, which changes `activeSelfId`. */
async function activateSelf(mounted: Mounted, self: { id: string; name: string }): Promise<void> {
  const control = buttons(mounted).find((b) => b.textContent === self.name);
  expect(control, `the switcher offers ${self.name}`).toBeDefined();
  await mounted.step(() => {
    control!.click();
  });
}

const activate = (mounted: Mounted): Promise<void> => activateSelf(mounted, ACTIVE);

describe('E1 — Prism floor, bindings 6, 7, 10', () => {
  // BINDING 6 — accepted wording:
  //   "that no fetch is issued while `activeSelfId` is null"
  // Constitutional object: the mounted application in its no-active-Self state.
  // Transport-dependent. The two positive assertions exist so the absence
  // cannot pass because nothing mounted: the account load proves the transport
  // is live and reached, and the switcher proves the null-active-Self state was
  // actually entered.
  it('binding 6 — no fetch is issued while `activeSelfId` is null', async () => {
    const mounted = await reachSelection();

    expect(selection(mounted), 'the no-active-Self state was entered').not.toBeNull();
    expect(floor(mounted)).toBeNull();
    expect(
      requestsTo(recorder, SELVES_URL).length,
      'the transport is live and was reached',
    ).toBeGreaterThan(0);

    // The Self-scoped count read is issued on no occasion in this state.
    expect(requestsTo(recorder, COUNT_URL)).toHaveLength(0);
    // And nothing asserted an acting Self, since there is none to assert.
    expect(recorder.calls.every((c) => c.actingSelf === null)).toBe(true);
  });

  // BINDING 7 — accepted wording:
  //   "that `App` applies the completed-count transition at the actual request
  //    resolution point"
  // Constitutional object: App's application of the completed-count transition,
  // observed against the resolution of the request it completes. Transport-
  // dependent, and it requires a HELD response: with an immediate response the
  // request point and the resolution point are indistinguishable, and the
  // observation would prove nothing about which one the transition follows.
  it('binding 7 — the completed-count transition is applied at the request resolution point', async () => {
    const mounted = await reachSelection();
    recorder.deferCount(true);
    recorder.phase('count-request-pending');
    await activate(mounted);

    // The request has been issued for this Self and has NOT resolved.
    const pending = requestsTo(recorder, COUNT_URL, 'count-request-pending');
    expect(pending.length).toBeGreaterThan(0);
    for (const call of pending) expect(call.actingSelf).toBe(ACTIVE.id);
    // Before the resolution point, the completed-count transition has not been
    // applied: no count is held, so the floor does not present.
    expect(floor(mounted), 'no completed count before resolution').toBeNull();

    // The resolution point.
    recorder.phase('count-resolved');
    await mounted.step(() => {
      recorder.releaseCount(200, AUTHORED);
    });

    // After it, and only after it, the transition has been applied.
    const main = floor(mounted);
    expect(main, 'the completed count is applied at resolution').not.toBeNull();
    expect(main!.querySelector('p')!.textContent).toBe(String(AUTHORED.length));
    expect(main!.querySelector('h1')!.textContent).toBe(ACTIVE.name);
  });

  // BINDING 10 — accepted wording:
  //   "that the persisted id is retained while the in-memory active Self is
  //    released."
  // Constitutional object: the relationship between two effects of one
  // production transition — the in-memory release and the persisted retention —
  // at the point an unknown count resolves. Transport-dependent for the
  // unknown-count response; storage-dependent for the retention.
  it('binding 10 — the persisted id is retained while the in-memory active Self is released', async () => {
    const mounted = await reachSelection();
    recorder.deferCount(true);
    recorder.phase('unknown-count-release');
    await activate(mounted);

    // The activation persisted the choice and issued the Self-scoped request.
    expect(sessionStorage.getItem(ACTIVE_SELF_KEY)).toBe(ACTIVE.id);
    const issued = requestsTo(recorder, COUNT_URL, 'unknown-count-release');
    expect(issued.length).toBeGreaterThan(0);
    for (const call of issued) expect(call.actingSelf).toBe(ACTIVE.id);

    // A non-2xx count is an unknown count, and no authoritative count releases
    // the Self.
    await mounted.step(() => {
      recorder.releaseCount(500, {});
    });

    // RELEASED in memory: selection is presented again and no floor stands.
    expect(selection(mounted), 'the in-memory active Self was released').not.toBeNull();
    expect(floor(mounted)).toBeNull();
    // RETAINED in storage: the human's choice outlives the release.
    expect(sessionStorage.getItem(ACTIVE_SELF_KEY)).toBe(ACTIVE.id);
  });
  // BINDING 8 — accepted wording:
  //   "that `App` clears `artifactCount` at the beginning of every count
  //    request for a non-null active Self"
  // Observable only on a SECOND count request, because on the first the value
  // is already null and a clear would be indistinguishable from the initial
  // state. Reaching a second request for a different Self is what the 403
  // mechanism is authorized for.
  it('binding 8 — `artifactCount` is cleared at the beginning of every count request for a non-null active Self', async () => {
    const mounted = await reachSelection();
    recorder.countBody(SELF_A.id, COUNT_A);
    recorder.countBody(SELF_B.id, COUNT_B);

    // 1 — Self A's count becomes known and stands rendered.
    recorder.phase('self-a-count-known');
    await activateSelf(mounted, SELF_A);
    const aFloor = floor(mounted);
    expect(aFloor, "Self A's floor stands").not.toBeNull();
    expect(aFloor!.querySelector('p')!.textContent).toBe(String(COUNT_A.length));

    // 2 — MECHANISM ONLY. A Self-scoped 403 is injected into the Correspondences
    // read; the production forbidden transition carries the application back to
    // selection. Bindings 18, 24, 25 adjacent and unopened; a failure of the
    // next assertion is a mechanism-path failure and concludes nothing about
    // binding 8.
    recorder.phase('forbidden-mechanism');
    recorder.forbidOnce(PLACEMENTS_URL);
    const cont = buttons(mounted).find((b) => b.textContent === 'Continue');
    expect(cont).toBeDefined();
    await mounted.step(() => {
      cont!.click();
    });
    expect(
      selection(mounted),
      'MECHANISM: the forbidden transition reached selection — bindings 18/24/25 adjacent and unopened',
    ).not.toBeNull();

    // 3 — Self B is deliberately activated and its count request is held.
    recorder.deferCount(true);
    recorder.phase('self-b-count-pending');
    await activateSelf(mounted, SELF_B);
    const pending = requestsTo(recorder, COUNT_URL, 'self-b-count-pending');
    expect(pending.length, "Self B's count request was issued").toBeGreaterThan(0);
    for (const call of pending) expect(call.actingSelf).toBe(SELF_B.id);

    // THE ASSERTION — at the beginning of Self B's request the client holds no
    // count. Were Self A's count still held, the floor would stand.
    expect(floor(mounted), 'no count is held when the request begins').toBeNull();

    // 4 — and the clearing is a clear, not a loss: B's own count arrives after.
    recorder.phase('self-b-count-resolved');
    await mounted.step(() => {
      recorder.releaseCount(200, COUNT_B);
    });
    const bFloor = floor(mounted);
    expect(bFloor).not.toBeNull();
    expect(bFloor!.querySelector('p')!.textContent).toBe(String(COUNT_B.length));
  });

  // BINDING 9 — accepted wording:
  //   "that a prior Self's count cannot render during another Self's pending
  //    request"
  // The rendered consequence, distinct from binding 8's state claim. Self A's
  // count is 3 and Self B's is 7, so a stale render is distinguishable from the
  // eventual one, from zero, and from any placeholder.
  it("binding 9 — a prior Self's count cannot render during another Self's pending request", async () => {
    const mounted = await reachSelection();
    recorder.countBody(SELF_A.id, COUNT_A);
    recorder.countBody(SELF_B.id, COUNT_B);

    recorder.phase('self-a-count-known');
    await activateSelf(mounted, SELF_A);
    // The prior count exists to be suppressed: it is rendered here.
    expect(floor(mounted)!.querySelector('p')!.textContent).toBe(String(COUNT_A.length));

    recorder.phase('forbidden-mechanism');
    recorder.forbidOnce(PLACEMENTS_URL);
    const cont = buttons(mounted).find((b) => b.textContent === 'Continue');
    await mounted.step(() => {
      cont!.click();
    });
    expect(
      selection(mounted),
      'MECHANISM: the forbidden transition reached selection — bindings 18/24/25 adjacent and unopened',
    ).not.toBeNull();

    recorder.deferCount(true);
    recorder.phase('self-b-count-pending');
    await activateSelf(mounted, SELF_B);
    expect(requestsTo(recorder, COUNT_URL, 'self-b-count-pending').length).toBeGreaterThan(0);

    // THE ASSERTION — during Self B's pending request, Self A's count renders
    // nowhere in the mounted tree, and no floor stands at all.
    expect(mounted.container.textContent ?? '').not.toContain(String(COUNT_A.length));
    expect(floor(mounted)).toBeNull();

    // Released so no case leaves a pending response behind.
    recorder.phase('self-b-count-resolved');
    await mounted.step(() => {
      recorder.releaseCount(200, COUNT_B);
    });
  });
});
