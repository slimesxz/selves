// P10-E6 — bindings 51, 58, 59, 65, 66, after P10-CT and P10-RA removed the
// route blocks. Constructed, not run.
//
// SCOPE. Five bindings, five cases, one App-level constitutional object each:
//
//   51  App applies the pending departure state before settlement
//   58  App applies cancellation-pending before settlement
//   59  App applies the pure cancellation result
//   65  App applies settlement-pending before completion
//   66  App applies the pure terminal result
//
// BINDINGS 49, 52, 56, 63, AND 69 REMAIN OPEN and are not exercised: 49, 56, 63
// name what App SUPPLIES, 52 names application through the hook-bound call
// site, and 69 names pressability and a causeless failure disposition. Nothing
// below asserts any of them.
//
// BINDINGS 50, 57, 64 ARE NOT REOPENED. Their callback closures are not treated
// here as evidence of App-level state application; the lifecycle controls are
// activated only as production acts, and what is asserted is the STATE App
// applies.
//
// ROUTE — MECHANISM ONLY. Creation is traversed under P10-CT and recipient
// addition under P10-RA, solely to reach a created draft that may depart.
// Neither is evidence: not creation correctness, not recipient-add correctness,
// not callback invocation, not identifier correctness, not settlement, not any
// server-side relation. Route steps appear only as ROUTE:.
//
// TIMING MODEL — the binding-37 precedent. For every pending-state binding the
// lifecycle response is HELD, so request time and settlement time are separable:
//
//   request issued → response held → pending state observed
//                  → response released → completed state observed
//
// A downstream completed state alone would be insufficient.
//
// NO CLASS B PROPOSITION IS CONSTRUCTED. Every response is supplied by the
// committed injected recording transport.
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
const ARTIFACT_ID = 'artifact-7';
const PLACEMENT_ID = 'placement-9';
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

/** The distinguishing status markers. Every lifecycle state below is identified
 *  by EXACT status text, never by substring: `Departing` (the departed state)
 *  is a prefix of `Departing.` (the pending state), so a containment check
 *  could let one pass as the other. */
const DRAFT = 'Draft created';
const DEPARTING_PENDING = 'Departing.';
const DEPARTED = 'Departing';
const CANCELLING_PENDING = 'Cancelling.';
const CANCELLED = 'Cancelled';
const SETTLING_PENDING = 'Settling.';
const SETTLED = 'Settled';

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

  // Keyed by METHOD and URL: `/artifacts` serves the count read and artifact
  // creation; `/placements` serves the Correspondences read and draft creation;
  // the three lifecycle operations are distinct URLs under the placement.
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

/** EXACT status texts, so no state can pass as another by prefix. */
const statuses = (app: Mounted): string[] =>
  [...app.container.querySelectorAll('[role="status"]')].map((p) => p.textContent ?? '');

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
  for (const url of [RECIPIENTS_URL, DEPARTURE_URL, CANCELLATION_URL, SETTLEMENT_URL]) {
    recorder.release('POST', url, { status: 204, body: null });
  }
  if (app !== null) await app.unmount();
  app = null;
  recorder.restore();
});

/** ROUTE: mechanism only, under P10-CT and P10-RA. Reaches a created draft
 *  holding one recipient — the state from which departure is production-
 *  eligible. Nothing here is evidence; only reachability is asserted. */
async function routeToDepartableDraft(): Promise<Mounted> {
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

  // ROUTE: creation, under P10-CT — mechanism only.
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

  // ROUTE: recipient addition, under P10-RA — mechanism only.
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
  return mounted;
}

/** ROUTE: departure taken to completion, for the cancellation and settlement
 *  cases, whose objects begin from the departed state. */
async function routeToDeparted(mounted: Mounted): Promise<void> {
  recorder.phase('depart-resolved');
  const depart = control(mounted, 'Depart');
  expect(depart, 'ROUTE: the draft offers Depart').toBeDefined();
  await mounted.step(() => {
    depart!.click();
  });
  expect(statuses(mounted), 'ROUTE: the departed state was reached').toContain(DEPARTED);
}

describe('E6 — App-level lifecycle state application', () => {
  // BINDING 51 — "App applies the pending departure state before settlement."
  it('binding 51 — App applies the pending departure state before settlement', async () => {
    const mounted = await routeToDepartableDraft();

    // Prior state: the created draft, departure-eligible, not departing.
    expect(statuses(mounted)).toContain(DRAFT);
    expect(statuses(mounted)).not.toContain(DEPARTING_PENDING);
    expect(statuses(mounted)).not.toContain(DEPARTED);
    expect(control(mounted, 'Depart'), 'departure is eligible').toBeDefined();

    recorder.hold('POST', DEPARTURE_URL, true);
    recorder.phase('depart-pending');
    await mounted.step(() => {
      control(mounted, 'Depart')!.click();
    });

    const issued = requestsTo(recorder, 'POST', DEPARTURE_URL, 'depart-pending');
    expect(issued.length).toBeGreaterThan(0);
    for (const call of issued) {
      expect(call.actingSelf).toBe(ACTIVE.id);
      expect(call.disposition).toBe('held');
    }

    // BEFORE SETTLEMENT — pending applied; completed state not applied.
    expect(statuses(mounted), 'pending departure applied').toContain(DEPARTING_PENDING);
    expect(statuses(mounted), 'the completed state is not applied').not.toContain(DEPARTED);
    expect(control(mounted, 'Cancel')).toBeUndefined();
    expect(control(mounted, 'Settle')).toBeUndefined();

    // AFTER SETTLEMENT — completed state applied.
    recorder.phase('depart-resolved');
    await mounted.step(() => {
      recorder.release('POST', DEPARTURE_URL, { status: 204, body: null });
    });
    expect(statuses(mounted)).toContain(DEPARTED);
    expect(statuses(mounted)).not.toContain(DEPARTING_PENDING);
    expect(statuses(mounted)).not.toContain(DRAFT);
  });

  // BINDING 58 — "App applies cancellation-pending before settlement."
  it('binding 58 — App applies cancellation-pending before settlement', async () => {
    const mounted = await routeToDepartableDraft();
    await routeToDeparted(mounted);

    // Prior state: departed, cancellation eligible, nothing pending.
    expect(statuses(mounted)).toContain(DEPARTED);
    expect(statuses(mounted)).not.toContain(CANCELLING_PENDING);
    expect(statuses(mounted)).not.toContain(CANCELLED);

    recorder.hold('POST', CANCELLATION_URL, true);
    recorder.phase('cancel-pending');
    const cancel = control(mounted, 'Cancel');
    expect(cancel, 'cancellation is eligible').toBeDefined();
    await mounted.step(() => {
      cancel!.click();
    });

    const issued = requestsTo(recorder, 'POST', CANCELLATION_URL, 'cancel-pending');
    expect(issued.length).toBeGreaterThan(0);
    for (const call of issued) {
      expect(call.actingSelf).toBe(ACTIVE.id);
      expect(call.disposition).toBe('held');
    }

    // BEFORE SETTLEMENT — cancellation-pending applied; result not applied.
    expect(statuses(mounted), 'cancellation-pending applied').toContain(CANCELLING_PENDING);
    expect(statuses(mounted), 'the result is not applied').not.toContain(CANCELLED);
    // Still the departing lifecycle state, not a new one.
    expect(statuses(mounted)).toContain(DEPARTED);

    // AFTER SETTLEMENT — the pending state gives way.
    recorder.phase('cancel-resolved');
    await mounted.step(() => {
      recorder.release('POST', CANCELLATION_URL, { status: 204, body: null });
    });
    expect(statuses(mounted)).not.toContain(CANCELLING_PENDING);
  });

  // BINDING 59 — "App applies the pure cancellation result."
  // A distinct proposition from 58: not that a pending state appeared, but that
  // the RESULT is applied on completion. Asserted in its own case so neither
  // proposition rests on the other.
  it('binding 59 — App applies the pure cancellation result', async () => {
    const mounted = await routeToDepartableDraft();
    await routeToDeparted(mounted);

    recorder.phase('cancel-resolved');
    const cancel = control(mounted, 'Cancel');
    expect(cancel, 'cancellation is eligible').toBeDefined();
    await mounted.step(() => {
      cancel!.click();
    });
    expect(requestsTo(recorder, 'POST', CANCELLATION_URL, 'cancel-resolved').length).toBeGreaterThan(0);

    // The pure result is applied — and it is none of the alternatives.
    expect(statuses(mounted), 'the cancellation result is applied').toContain(CANCELLED);
    expect(statuses(mounted), 'not still pending').not.toContain(CANCELLING_PENDING);
    expect(statuses(mounted), 'not the prior departed state').not.toContain(DEPARTED);
    expect(statuses(mounted), 'not the prior draft state').not.toContain(DRAFT);
    expect(statuses(mounted), 'not a settlement result').not.toContain(SETTLED);
    // Not merely the controls hidden: the lifecycle state itself changed, and
    // the terminal presentation offers only its return control.
    expect(control(mounted, 'Cancel')).toBeUndefined();
    expect(control(mounted, 'Settle')).toBeUndefined();
    expect(control(mounted, 'Back'), 'the cancelled presentation stands').toBeDefined();
  });

  // BINDING 65 — "App applies settlement-pending before completion."
  it('binding 65 — App applies settlement-pending before completion', async () => {
    const mounted = await routeToDepartableDraft();
    await routeToDeparted(mounted);

    expect(statuses(mounted)).toContain(DEPARTED);
    expect(statuses(mounted)).not.toContain(SETTLING_PENDING);
    expect(statuses(mounted)).not.toContain(SETTLED);

    recorder.hold('POST', SETTLEMENT_URL, true);
    recorder.phase('settle-pending');
    // The eligibility that renders Settle is route setup only; whether it is
    // authoritative is binding 69 and is not asserted here.
    const settle = control(mounted, 'Settle');
    expect(settle, 'settlement is eligible').toBeDefined();
    await mounted.step(() => {
      settle!.click();
    });

    const issued = requestsTo(recorder, 'POST', SETTLEMENT_URL, 'settle-pending');
    expect(issued.length).toBeGreaterThan(0);
    for (const call of issued) {
      expect(call.actingSelf).toBe(ACTIVE.id);
      expect(call.disposition).toBe('held');
    }

    // BEFORE COMPLETION — settlement-pending applied; terminal not applied.
    expect(statuses(mounted), 'settlement-pending applied').toContain(SETTLING_PENDING);
    expect(statuses(mounted), 'the terminal result is not applied').not.toContain(SETTLED);
    expect(statuses(mounted)).toContain(DEPARTED);

    // AFTER COMPLETION — the pending state gives way.
    recorder.phase('settle-resolved');
    await mounted.step(() => {
      recorder.release('POST', SETTLEMENT_URL, { status: 204, body: null });
    });
    expect(statuses(mounted)).not.toContain(SETTLING_PENDING);
  });

  // BINDING 66 — "App applies the pure terminal result."
  it('binding 66 — App applies the pure terminal result', async () => {
    const mounted = await routeToDepartableDraft();
    await routeToDeparted(mounted);

    recorder.phase('settle-resolved');
    const settle = control(mounted, 'Settle');
    expect(settle, 'settlement is eligible').toBeDefined();
    await mounted.step(() => {
      settle!.click();
    });
    expect(requestsTo(recorder, 'POST', SETTLEMENT_URL, 'settle-resolved').length).toBeGreaterThan(0);

    // The pure terminal result is applied — and it is none of the alternatives.
    expect(statuses(mounted), 'the terminal result is applied').toContain(SETTLED);
    expect(statuses(mounted), 'not still pending').not.toContain(SETTLING_PENDING);
    expect(statuses(mounted), 'not the prior departed state').not.toContain(DEPARTED);
    expect(statuses(mounted), 'not the prior draft state').not.toContain(DRAFT);
    expect(statuses(mounted), 'not a cancellation result').not.toContain(CANCELLED);
    expect(control(mounted, 'Cancel')).toBeUndefined();
    expect(control(mounted, 'Settle')).toBeUndefined();
    expect(control(mounted, 'Back'), 'the settled presentation stands').toBeDefined();
  });
});
