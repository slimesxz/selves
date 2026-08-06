// P10-E5 — bindings 37 and 44, after P10-CT and P10-RA removed the route
// blocks. Constructed, not run.
//
// SCOPE. Binding 37 is constructed. Binding 44 CLAUSE B is constructed.
// BINDING 44 CLAUSE A IS HALTED — see the construction report: the retained
// value is held in App component state, and the architecture exposes only the
// downstream Resume control, not the retained-value write itself. Storage is
// named by the wording, so a control's existence may not be substituted for it.
//
// BINDINGS 35, 38, 42, 43 REMAIN OPEN and are not exercised. Bindings 24 and 27
// remain open. No E6 binding is touched.
//
// ROUTE — MECHANISM ONLY. The creation transition is traversed under P10-CT and
// the recipient-add step under P10-RA, solely to reach the objects below.
// Neither traversal is evidence of anything: not that App supplied the create or
// add act, not that a control invoked it, not that the correct identifier was
// supplied, not that pending state was applied on that occasion, not that
// anything settled correctly, and not that any server-side relation exists.
// Route steps appear only under ROUTE: and are asserted only for reachability.
//
// NO CLASS B PROPOSITION IS CONSTRUCTED. Every response is supplied by the
// committed injected recording transport; none may be represented as a real
// server response, real deserialization, or backend authorization.
//
// StrictMode is retained through the committed harness. Renders are never
// counted and no assertion depends on render count.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import App from '../../src/App.tsx';
import { API_PREFIX } from '../../src/api/transport.ts';
import { ARTIFACTS_PATH, PLACEMENTS_PATH } from '../../src/composer/mutations.ts';
import { RECIPIENTS_PATH } from '../../src/composer/recipient-mutations.ts';
import { SELVES_PATH } from '../../src/self/load.ts';
import { mount, type Mounted } from '../harness/mount.ts';

const SELVES_URL = `${API_PREFIX}${SELVES_PATH}`;
const ARTIFACTS_URL = `${API_PREFIX}${ARTIFACTS_PATH}`;
const PLACEMENTS_URL = `${API_PREFIX}${PLACEMENTS_PATH}`;
const ARTIFACT_ID = 'artifact-1';
const PLACEMENT_ID = 'placement-1';
const RECIPIENTS_URL = `${API_PREFIX}${RECIPIENTS_PATH(PLACEMENT_ID)}`;

/** Three Selves, distinct names so `labelSelves` appends no slot. `Wren` is
 *  activated, so the candidates are `Ora` and `Kite` — two, which is what makes
 *  the pending candidate distinguishable from the pre-existing recipient. */
const SELVES = [
  { id: 'self-ora', name: 'Ora', slot: 0 },
  { id: 'self-wren', name: 'Wren', slot: 1 },
  { id: 'self-kite', name: 'Kite', slot: 2 },
];
const ACTIVE = SELVES[1]!;
const FIRST = SELVES[0]!; // added along the ROUTE
const PENDING = SELVES[2]!; // added under observation, held

const AUTHORED = [{ id: 'a-1' }, { id: 'a-2' }];
const DRAFT_TEXT = 'a letter';

type Key = string; // `${method} ${url}`
const key = (method: string, url: string): Key => `${method} ${url}`;

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

interface Recorded {
  readonly phase: string;
  readonly url: string;
  readonly method: string;
  readonly actingSelf: string | null;
  readonly disposition: 'immediate' | 'held';
}

interface Recorder {
  readonly calls: Recorded[];
  phase: (next: string) => void;
  hold: (method: string, url: string, on: boolean) => void;
  release: (method: string, url: string, answer: Answer) => void;
  restore: () => void;
}

function record(): Recorder {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  let phase = 'route-to-created';
  const holding = new Set<Key>();
  const held = new Map<Key, Array<(res: Response) => void>>();

  // Keyed by METHOD and url: `/artifacts` is the count read AND artifact
  // creation; `/placements` is the correspondences read AND draft creation.
  const answers = new Map<Key, Answer>([
    [key('GET', SELVES_URL), { status: 200, body: SELVES }],
    [key('GET', ARTIFACTS_URL), { status: 200, body: AUTHORED }],
    [key('GET', PLACEMENTS_URL), { status: 200, body: [] }],
    [key('POST', ARTIFACTS_URL), { status: 201, body: { id: ARTIFACT_ID } }],
    [key('POST', PLACEMENTS_URL), { status: 201, body: { id: PLACEMENT_ID } }],
  ]);

  const respond = ({ status, body }: Answer): Response =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });

  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method ?? 'GET');
    const headers = (init.headers ?? {}) as Record<string, string>;
    const k = key(method, url);
    const willHold = holding.has(k);
    calls.push({
      phase,
      url,
      method,
      actingSelf: headers['x-acting-self'] ?? null,
      disposition: willHold ? 'held' : 'immediate',
    });
    if (willHold) {
      return new Promise<Response>((resolve) => {
        const queue = held.get(k) ?? [];
        queue.push(resolve);
        held.set(k, queue);
      });
    }
    // The recipient-add contract is 204 with no body.
    if (k === key('POST', RECIPIENTS_URL)) return respond({ status: 204, body: null });
    return respond(answers.get(k) ?? { status: 200, body: [] });
  }) as typeof fetch;

  return {
    calls,
    phase: (next) => {
      phase = next;
    },
    hold: (method, url, on) => {
      if (on) holding.add(key(method, url));
      else holding.delete(key(method, url));
    },
    release: (method, url, answer) => {
      const k = key(method, url);
      const queue = held.get(k) ?? [];
      held.set(k, []);
      // Every held response is released: development may issue the request more
      // than once for one occasion.
      for (const resolve of queue.splice(0, queue.length)) resolve(respond(answer));
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const requestsTo = (r: Recorder, method: string, url: string, phase?: string): Recorded[] =>
  r.calls.filter(
    (c) => c.method === method && c.url === url && (phase === undefined || c.phase === phase),
  );

const buttons = (app: Mounted): HTMLButtonElement[] =>
  [...app.container.querySelectorAll('button')] as HTMLButtonElement[];

const control = (app: Mounted, label: string): HTMLButtonElement | undefined =>
  buttons(app).find((b) => b.textContent === label);

const aria = (app: Mounted, label: string): HTMLButtonElement | undefined =>
  buttons(app).find((b) => b.getAttribute('aria-label') === label);

const statuses = (app: Mounted): string[] =>
  [...app.container.querySelectorAll('[role="status"]')].map((p) => p.textContent ?? '');

const text = (app: Mounted): string => app.container.textContent ?? '';

/** Types into the production textarea the way a human does, through a native
 *  input event React observes. No production code is touched. */
function type(area: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(area, value);
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

let recorder: Recorder;
let app: Mounted | null = null;

beforeEach(() => {
  sessionStorage.clear();
  recorder = record();
});

afterEach(async () => {
  recorder.release('POST', RECIPIENTS_URL, { status: 204, body: null });
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

/** ROUTE: mechanism only, under P10-CT and P10-RA.
 *  Reaches a created draft holding exactly one recipient. Nothing observed here
 *  is evidence: not creation, not the add act, not the identifier, not pending
 *  state, not settlement. Only reachability is asserted. */
async function routeToCreatedDraftWithRecipient(): Promise<Mounted> {
  const mounted = await mount(createElement(App));
  app = mounted;

  // ROUTE: active Self.
  const self = control(mounted, ACTIVE.name);
  expect(self, 'ROUTE: the switcher offers the Self').toBeDefined();
  await mounted.step(() => {
    self!.click();
  });

  // ROUTE: Correspondences, then the Composer.
  const cont = control(mounted, 'Continue');
  expect(cont, 'ROUTE: the floor offers Continue').toBeDefined();
  await mounted.step(() => {
    cont!.click();
  });
  const compose = control(mounted, 'Compose');
  expect(compose, 'ROUTE: Correspondences offers Compose').toBeDefined();
  await mounted.step(() => {
    compose!.click();
  });

  // ROUTE: the creation transition, under P10-CT — mechanism only.
  const area = mounted.container.querySelector('textarea');
  expect(area, 'ROUTE: the Composer offers its text area').not.toBeNull();
  await mounted.step(() => {
    type(area as HTMLTextAreaElement, DRAFT_TEXT);
  });
  const send = control(mounted, 'Send');
  expect(send, 'ROUTE: the Composer offers Send').toBeDefined();
  await mounted.step(() => {
    send!.click();
  });
  expect(text(mounted), 'ROUTE: the created draft was reached').toContain('Draft created');

  // ROUTE: the recipient-add step, under P10-RA — mechanism only.
  recorder.phase('route-recipient-established');
  const addFirst = aria(mounted, `Add recipient ${FIRST.name}`);
  expect(addFirst, 'ROUTE: a candidate control is offered').toBeDefined();
  await mounted.step(() => {
    addFirst!.click();
  });
  expect(
    aria(mounted, `Remove recipient ${FIRST.name}`),
    'ROUTE: the draft holds one recipient',
  ).toBeDefined();

  return mounted;
}

describe('E5 — bindings 37 and 44 clause B, mounted', () => {
  // BINDING 37 — accepted wording:
  //   "`App.tsx` applies the synchronous recipient pending state before
  //    settlement."
  // The constitutional object is App's application of the pending state BEFORE
  // the add settles. It is not App supplying the callback, not the control
  // invoking it, not the route, not the settled list, and not any server-side
  // relation. The held response is what separates request time from resolution
  // time; without it the two are indistinguishable.
  it('binding 37 — App applies the synchronous recipient-pending state before settlement', async () => {
    const mounted = await routeToCreatedDraftWithRecipient();

    // Hold the NEXT recipient-add settlement.
    recorder.hold('POST', RECIPIENTS_URL, true);
    recorder.phase('recipient-add-pending');

    const addPending = aria(mounted, `Add recipient ${PENDING.name}`);
    expect(addPending, 'the second candidate is offered').toBeDefined();
    await mounted.step(() => {
      addPending!.click();
    });

    // The request was issued and is unresolved.
    const issued = requestsTo(recorder, 'POST', RECIPIENTS_URL, 'recipient-add-pending');
    expect(issued.length).toBeGreaterThan(0);
    for (const call of issued) {
      expect(call.actingSelf).toBe(ACTIVE.id);
      expect(call.disposition).toBe('held');
    }

    // BEFORE SETTLEMENT — the synchronous pending state is already applied.
    expect(statuses(mounted), 'the pending state is applied').toContain('Adding.');
    // And it is neither the prior state nor the settled state: the pending
    // candidate is not yet a known recipient, while the prior one still is.
    expect(aria(mounted, `Remove recipient ${FIRST.name}`)).toBeDefined();
    expect(aria(mounted, `Remove recipient ${PENDING.name}`)).toBeUndefined();

    // AFTER SETTLEMENT — the settled state replaces the pending one.
    recorder.phase('recipient-add-resolved');
    await mounted.step(() => {
      recorder.release('POST', RECIPIENTS_URL, { status: 204, body: null });
    });
    expect(statuses(mounted)).not.toContain('Adding.');
    expect(aria(mounted, `Remove recipient ${PENDING.name}`), 'the settled state applied').toBeDefined();
    expect(aria(mounted, `Remove recipient ${FIRST.name}`)).toBeDefined();
  });

  // BINDING 44 — CLAUSE B — accepted wording:
  //   "App … restores it on reopen."
  // Clause A ("creates and stores the retained value during permitted Return")
  // is HALTED and is not asserted here; nothing below is offered as evidence of
  // storage. This clause is constructed so that restoration cannot be satisfied
  // by state that merely survived: after Return, the live Composer state is
  // deliberately RESET through the production Compose control, so the only
  // surviving source of the draft's recipient is the retained value itself.
  it('binding 44 clause B — App restores the retained value on reopen', async () => {
    const mounted = await routeToCreatedDraftWithRecipient();

    // ROUTE: the permitted Return transition.
    recorder.phase('permitted-return');
    // The Composer's leave control is labelled `Back` in production.
    const back = control(mounted, 'Back');
    expect(back, 'ROUTE: the draft offers its leave control').toBeDefined();
    await mounted.step(() => {
      back!.click();
    });
    expect(text(mounted), 'ROUTE: the Composer was left').not.toContain('Draft created');

    // ROUTE: reset the live Composer state through the production Compose
    // control, which opens an empty Composer and clears the live draft and
    // recipients. After this, no live state could reconstruct the draft.
    recorder.phase('reopen-before-activation');
    const compose = control(mounted, 'Compose');
    expect(compose, 'ROUTE: Compose is offered').toBeDefined();
    await mounted.step(() => {
      compose!.click();
    });
    // The empty Composer holds no draft and no recipients.
    expect(text(mounted)).not.toContain('Draft created');
    expect(aria(mounted, `Remove recipient ${FIRST.name}`)).toBeUndefined();
    const leaveEmpty = control(mounted, 'Back');
    expect(leaveEmpty, 'ROUTE: the empty Composer may be left').toBeDefined();
    await mounted.step(() => {
      leaveEmpty!.click();
    });

    // THE OBJECT — reopen restores the retained draft-management state.
    recorder.phase('reopen-restored');
    const resume = control(mounted, 'Resume draft');
    expect(resume, 'the reopen control is offered').toBeDefined();
    await mounted.step(() => {
      resume!.click();
    });

    // The restored state is the retained draft, not a new or default one: it
    // presents the completed draft AND the recipient held before Return, which
    // the reset live state can no longer supply.
    expect(text(mounted), 'the completed draft was restored').toContain('Draft created');
    expect(
      aria(mounted, `Remove recipient ${FIRST.name}`),
      'the retained recipient was restored',
    ).toBeDefined();
    // Not a default or unrelated draft: the candidate never added is not known.
    expect(aria(mounted, `Remove recipient ${PENDING.name}`)).toBeUndefined();
    // Restoration issued no request: nothing was re-fetched to rebuild it.
    expect(requestsTo(recorder, 'GET', PLACEMENTS_URL, 'reopen-restored')).toHaveLength(0);
    expect(requestsTo(recorder, 'POST', RECIPIENTS_URL, 'reopen-restored')).toHaveLength(0);
  });
});
