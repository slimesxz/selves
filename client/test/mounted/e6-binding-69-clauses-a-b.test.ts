// P10-69 — binding 69, both clauses. Constructed, not run.
//
// ONE BINDING, TWO INDEPENDENTLY VERIFIABLE CLAUSES:
//
//   Clause A — Settle is pressable in the departed state.
//   Clause B — a supplied settlement rejection produces the governed
//              causeless-failure state.
//
// Neither clause is inferred from the other. Each has its own case, its own
// assertions, and its own soundness argument. Binding 69 closes only when both
// are constitutionally disposed; construction closes neither.
//
// BOTH CLAUSES MOUNT App. Clause A does so because the constitutional relation
// is App-derived: the Composer receives `settlement.eligible` as a PROP, so a
// direct component mount would have to supply the very relation the clause
// tests. App computes it at `App.tsx:403` — `eligible: permitsSettlement(
// departureState)` — and nothing in this file supplies an eligibility value.
//
// ROUTE — MECHANISM ONLY. Creation under P10-CT, recipient addition under
// P10-RA, and departure as route. No route step is evidence: not creation
// correctness, not recipient-add correctness, not departure correctness, not
// callback origin, not settlement correctness.
//
// WHAT ACTIVATION SERVES IN CLAUSE A. It is not offered as proof that App
// supplies the settlement callback, that the originating call site is correct,
// or that settlement, pending state, or the terminal result are correct. It
// serves one purpose: to distinguish a visibly rendered control from a
// PRESSABLE one. Bindings 63, 64, 65, 66 do not follow, and binding 64 remains
// closed and unreopened.
//
// NOT CLASSIFIED HERE: 24, 27, 35, 38, 42, 43, 44 Clause A, 49, 52, 56, 63.
// NOT REOPENED: 50, 51, 57, 58, 59, 64, 65, 66.
//
// NO CLASS B PROPOSITION. Every response is supplied by the committed injected
// recording transport. A supplied 409 is the injected non-auth rejection used
// to reach the client's constitutional object; it establishes nothing about why
// a real operation would fail.
//
// StrictMode is retained through the committed harness; renders are never
// counted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import App from '../../src/App.tsx';
import { API_PREFIX } from '../../src/api/transport.ts';
import { CANCELLATION_PATH } from '../../src/composer/cancellation-mutations.ts';
import { DEPARTURE_PATH } from '../../src/composer/departure-mutations.ts';
import { ARTIFACTS_PATH, PLACEMENTS_PATH } from '../../src/composer/mutations.ts';
import { RECIPIENTS_PATH } from '../../src/composer/recipient-mutations.ts';
import { SETTLEMENT_PATH } from '../../src/composer/settlement-mutations.ts';
import { SELVES_PATH } from '../../src/self/load.ts';
import { mount, type Mounted } from '../harness/mount.ts';

const SELVES_URL = `${API_PREFIX}${SELVES_PATH}`;
const ARTIFACTS_URL = `${API_PREFIX}${ARTIFACTS_PATH}`;
const PLACEMENTS_URL = `${API_PREFIX}${PLACEMENTS_PATH}`;
const ARTIFACT_ID = 'artifact-69';
const PLACEMENT_ID = 'placement-69';
const RECIPIENTS_URL = `${API_PREFIX}${RECIPIENTS_PATH(PLACEMENT_ID)}`;
const DEPARTURE_URL = `${API_PREFIX}${DEPARTURE_PATH(PLACEMENT_ID)}`;
const CANCELLATION_URL = `${API_PREFIX}${CANCELLATION_PATH(PLACEMENT_ID)}`;
const SETTLEMENT_URL = `${API_PREFIX}${SETTLEMENT_PATH(PLACEMENT_ID)}`;

const SELVES = [
  { id: 'self-ora', name: 'Ora', slot: 0 },
  { id: 'self-wren', name: 'Wren', slot: 1 },
];
const ACTIVE = SELVES[1]!;
const RECIPIENT = SELVES[0]!;
const AUTHORED = [{ id: 'a-1' }];
const DRAFT_TEXT = 'a letter';

/** Exact status markers. `Settled` is no prefix of `Not settled.`, and
 *  `Departing` is a prefix of `Departing.` — every comparison below is exact. */
const DRAFT = 'Draft created';
const DEPARTING_PENDING = 'Departing.';
const DEPARTED = 'Departing';
const SETTLING_PENDING = 'Settling.';
const SETTLEMENT_FAILED = 'Not settled.';
const SETTLED = 'Settled';

/** Tokens that would name a CAUSE. The governed marker's own words are absent
 *  from this list by design: the clause forbids stating why, not stating that. */
const CAUSE_TOKENS = [
  'interval',
  'elapsed',
  'race',
  'conflict',
  '409',
  'already',
  'prior',
  'authoriz',
  'backend',
  'server',
  'cancel',
];

type Key = string;
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

  const answers = new Map<Key, Answer>([
    [key('GET', SELVES_URL), { status: 200, body: SELVES }],
    [key('GET', ARTIFACTS_URL), { status: 200, body: AUTHORED }],
    [key('GET', PLACEMENTS_URL), { status: 200, body: [] }],
    [key('POST', ARTIFACTS_URL), { status: 201, body: { id: ARTIFACT_ID } }],
    [key('POST', PLACEMENTS_URL), { status: 201, body: { id: PLACEMENT_ID } }],
  ]);
  const noBody = new Set<Key>([
    key('POST', RECIPIENTS_URL),
    key('POST', DEPARTURE_URL),
    key('POST', CANCELLATION_URL),
    key('POST', SETTLEMENT_URL),
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
    if (noBody.has(k)) return respond({ status: 204, body: null });
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

const text = (app: Mounted): string => (app.container.textContent ?? '').toLowerCase();

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
  // No held response outlives its case.
  for (const url of [RECIPIENTS_URL, DEPARTURE_URL, CANCELLATION_URL, SETTLEMENT_URL]) {
    recorder.release('POST', url, { status: 204, body: null });
  }
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

/** ROUTE: mechanism only. Creation under P10-CT, recipient addition under
 *  P10-RA, departure as route — reaching the App-DERIVED departed lifecycle
 *  state. Nothing observed here is evidence; only reachability is asserted. */
async function routeToDeparted(): Promise<Mounted> {
  const mounted = await mount(createElement(App));
  app = mounted;

  const self = control(mounted, ACTIVE.name);
  expect(self, 'ROUTE: the switcher offers the Self').toBeDefined();
  await mounted.step(() => {
    self!.click();
  });
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

  // ROUTE: creation, under P10-CT.
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
  expect(statuses(mounted), 'ROUTE: the created draft was reached').toContain(DRAFT);

  // ROUTE: recipient addition, under P10-RA.
  recorder.phase('route-recipient-established');
  const add = aria(mounted, `Add recipient ${RECIPIENT.name}`);
  expect(add, 'ROUTE: a candidate control is offered').toBeDefined();
  await mounted.step(() => {
    add!.click();
  });
  expect(
    aria(mounted, `Remove recipient ${RECIPIENT.name}`),
    'ROUTE: the draft holds one recipient',
  ).toBeDefined();

  // ROUTE: departure, as route only.
  recorder.phase('route-to-departed');
  const depart = control(mounted, 'Depart');
  expect(depart, 'ROUTE: the draft offers Depart').toBeDefined();
  await mounted.step(() => {
    depart!.click();
  });
  expect(statuses(mounted), 'ROUTE: the departed state was reached').toContain(DEPARTED);
  return mounted;
}

describe('binding 69 — both clauses', () => {
  // CLAUSE A — "Settle is pressable in the departed state."
  //
  // The complete relation: App holds the lifecycle as departed, App computes
  // settlement eligibility from that state, and the mounted control is
  // pressable. Nothing here supplies an eligibility value — the whole
  // application is mounted and App derives it.
  it('binding 69 clause A — Settle is pressable in the App-derived departed state', async () => {
    const mounted = await routeToDeparted();
    recorder.phase('clause-a-before-activation');

    // App holds the lifecycle as departed, and not as departing-pending.
    expect(statuses(mounted), 'the departed state is held').toContain(DEPARTED);
    expect(statuses(mounted)).not.toContain(DEPARTING_PENDING);

    // The control exists and is not withheld by any production disabled-state
    // mechanism. Visibility alone is not the object; these exclude a rendered
    // control that could not be pressed.
    const settle = control(mounted, 'Settle');
    expect(settle, 'Settle is rendered in the departed state').toBeDefined();
    expect(settle!.disabled, 'Settle is not disabled').toBe(false);
    expect(settle!.hasAttribute('disabled')).toBe(false);
    expect(settle!.getAttribute('aria-disabled')).toBeNull();

    // Nothing has been settled yet.
    expect(requestsTo(recorder, 'POST', SETTLEMENT_URL)).toHaveLength(0);

    // ACTIVATION — held at issuance, so the case does not proceed into
    // settlement completion. Activation serves only to distinguish a rendered
    // control from a pressable one.
    recorder.hold('POST', SETTLEMENT_URL, true);
    recorder.phase('clause-a-settlement-issued');
    await mounted.step(() => {
      settle!.click();
    });

    // The press took effect: the production settlement operation was entered.
    const issued = requestsTo(recorder, 'POST', SETTLEMENT_URL, 'clause-a-settlement-issued');
    expect(issued.length, 'the press reached the production settlement operation').toBeGreaterThan(0);
    for (const call of issued) {
      expect(call.actingSelf, 'attributable to the active Self').toBe(ACTIVE.id);
      expect(call.url, 'attributable to the current placement').toContain(PLACEMENT_ID);
      expect(call.method).toBe('POST');
      expect(call.disposition).toBe('held');
    }
    // It was the settlement operation, not another lifecycle operation.
    expect(requestsTo(recorder, 'POST', CANCELLATION_URL)).toHaveLength(0);
    expect(
      requestsTo(recorder, 'POST', DEPARTURE_URL, 'clause-a-settlement-issued'),
    ).toHaveLength(0);

    // Settlement completion is outside Clause A: the response stays held and is
    // released by the case teardown.
  });

  // CLAUSE B — "a supplied settlement rejection produces the governed
  // causeless-failure state."
  //
  // Not pressability, and not settlement success. The rejection is injected to
  // reach the client's constitutional object; it establishes nothing about why
  // a real operation would fail.
  it('binding 69 clause B — a supplied rejection produces the causeless-failure state', async () => {
    const mounted = await routeToDeparted();
    recorder.phase('clause-b-before-settlement');

    // Prior state.
    expect(statuses(mounted)).toContain(DEPARTED);
    expect(statuses(mounted)).not.toContain(SETTLING_PENDING);
    expect(statuses(mounted)).not.toContain(SETTLEMENT_FAILED);
    expect(statuses(mounted)).not.toContain(SETTLED);

    recorder.hold('POST', SETTLEMENT_URL, true);
    recorder.phase('clause-b-settlement-pending');
    const settle = control(mounted, 'Settle');
    expect(settle, 'the settlement act can be initiated').toBeDefined();
    await mounted.step(() => {
      settle!.click();
    });

    const issued = requestsTo(recorder, 'POST', SETTLEMENT_URL, 'clause-b-settlement-pending');
    expect(issued.length).toBeGreaterThan(0);
    for (const call of issued) {
      expect(call.actingSelf).toBe(ACTIVE.id);
      expect(call.url).toContain(PLACEMENT_ID);
      expect(call.disposition).toBe('held');
    }

    // Pending, before the rejection.
    expect(statuses(mounted)).toContain(SETTLING_PENDING);
    expect(statuses(mounted)).not.toContain(SETTLEMENT_FAILED);
    expect(statuses(mounted)).not.toContain(SETTLED);

    // THE REJECTION — a supplied non-auth 409.
    recorder.phase('clause-b-settlement-rejected');
    await mounted.step(() => {
      recorder.release('POST', SETTLEMENT_URL, { status: 409, body: {} });
    });

    recorder.phase('clause-b-failure-applied');

    // The governed failure state, and none of its alternatives.
    expect(statuses(mounted), 'the failure state is applied').toContain(SETTLEMENT_FAILED);
    expect(statuses(mounted), 'not still pending').not.toContain(SETTLING_PENDING);
    expect(statuses(mounted), 'not settled').not.toContain(SETTLED);
    expect(statuses(mounted), 'still departing').toContain(DEPARTED);

    // CAUSELESSNESS — the mounted result states THAT it did not complete and
    // never WHY. The status set is exactly the lifecycle marker and the failure
    // marker, with no third status, and no cause-naming token anywhere.
    expect(statuses(mounted)).toEqual([DEPARTED, SETTLEMENT_FAILED]);
    for (const token of CAUSE_TOKENS) {
      expect(text(mounted).includes(token), `no cause named: ${token}`).toBe(false);
    }

    // Not an authorization outcome: a 409 is neither 401 nor 403.
    expect(mounted.container.querySelector('form'), 'no authentication gate').toBeNull();
    expect(mounted.container.querySelector('nav'), 'no selection surface').toBeNull();
  });
});
