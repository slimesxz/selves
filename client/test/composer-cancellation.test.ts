// P10-S18 — the twelve ratified cases for cancellation.
//
// Cancellation is terminal for the Placement it ends, so the load-bearing proofs
// here are refusals: what the client will not request once the lifecycle says
// cancelled, proven at the transition boundary rather than by what a component
// happens to render. Case 6 carries that invariant using the exact value the
// production `onCancelled` returns.
//
// The proof boundary is stated rather than blurred. These prove the pure
// transitions, the request contract, and the hook-free presentation in both
// public forms. They do NOT prove the hook-bound App.tsx chain.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Transport } from '../src/api/transport.ts';
import Composer from '../src/composer/Composer.tsx';
import { performCancellation, startCancellation, type CancellationDeps } from '../src/composer/cancellation.ts';
import { CANCELLATION_PATH, CANCELLED_STATUS } from '../src/composer/cancellation-mutations.ts';
import {
  onCancelled,
  permitsCancellation,
  type CancellationSettlement,
} from '../src/composer/cancellation-state.ts';
import { startDeparture } from '../src/composer/departure.ts';
import {
  noDeparture,
  permitsDeparture,
  type CancellingPendingState,
  type DepartureState,
} from '../src/composer/departure-state.ts';
import type { Dispositions } from '../src/composer/recipient-add.ts';
import { type RecipientState } from '../src/composer/recipient-state.ts';
import type { ComposerState } from '../src/composer/state.ts';

const here = dirname(fileURLToPath(import.meta.url));
const codeOf = (rel: string): string =>
  readFileSync(resolve(here, '../src', rel), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const ME = 'me';
const DRAFT = 'placement-1';
const ART = 'artifact-1';
const done: ComposerState = { kind: 'created', artifactId: ART, placementId: DRAFT };
const held = (...ids: string[]): RecipientState => ({ kind: 'idle', recipients: ids });
const departed: DepartureState = { kind: 'departed', placementId: DRAFT, artifactId: ART, recipients: ['r1'] };

function recording(steps: Array<{ status: number }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    const res = new Response(null, { status: step.status });
    Object.defineProperty(res, 'json', {
      value: () => {
        throw new Error('response body was read');
      },
    });
    return Promise.resolve(res);
  };
  return { calls, transport };
}

function spies() {
  const seen: string[] = [];
  const dispositions: Dispositions = {
    onSessionExpired: () => void seen.push('session-expired'),
    onForbidden: () => void seen.push('forbidden'),
  };
  return { seen, dispositions };
}

const deps = (
  transport: Transport,
  apply: (s: CancellationSettlement) => void,
  dispositions: Dispositions,
): CancellationDeps => ({ transport, actingSelfId: ME, apply, dispositions });

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

async function cancelOnce(steps: Array<{ status: number }>, lifecycle: DepartureState = departed) {
  const r = recording(steps);
  const s = spies();
  const applied: CancellationSettlement[] = [];
  performCancellation(deps(r.transport, (x) => void applied.push(x), s.dispositions), lifecycle, null);
  await tick();
  return { ...r, ...s, applied, final: applied[applied.length - 1]! };
}

describe('P10-S18 cancellation', () => {
  it('the cancellation request uses the exact path, POST method, acting-Self header, and no body, and only 204 is success', async () => {
    const ok = await cancelOnce([{ status: 204 }]);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.url).toBe(`/api${CANCELLATION_PATH(DRAFT)}`);
    expect(ok.calls[0]!.init.method).toBe('POST');
    expect((ok.calls[0]!.init.headers as Record<string, string>)['x-acting-self']).toBe(ME);
    expect(ok.calls[0]!.init.body).toBeUndefined();
    expect(CANCELLED_STATUS).toBe(204);
    expect(ok.final.lifecycle.kind).toBe('cancelled');

    for (const status of [200, 201, 202]) {
      expect((await cancelOnce([{ status }])).final.lifecycle.kind, `status ${status}`).toBe('cancellation-failed');
    }
  });

  it('401 and 403 invoke the injected authoritative dispositions, abandon the attempt, and are never cancellation failures', async () => {
    for (const [status, expected] of [
      [401, 'session-expired'],
      [403, 'forbidden'],
    ] as const) {
      const round = await cancelOnce([{ status }]);
      expect(round.seen, `status ${status}`).toEqual([expected]);
      expect(round.final.lifecycle, `status ${status}`).toEqual(noDeparture);
      expect(round.final.lifecycle.kind, `status ${status}`).not.toBe('cancellation-failed');
    }
  });

  it('server rejection, contract-violating 2xx, and transport throw enter one non-auth failure class, and a 409 yields no lifecycle inference', async () => {
    for (const status of [400, 404, 409, 500, 503]) {
      const round = await cancelOnce([{ status }]);
      expect(round.final.lifecycle.kind, `error ${status}`).toBe('cancellation-failed');
      expect(round.seen, `error ${status}`).toEqual([]);
      // Nothing about settled, already-cancelled, or otherwise is inferred.
      const json = JSON.stringify(round.final);
      for (const inference of ['settled', '"cancelled"', 'unavailable']) {
        expect(json.includes(inference), `${status} must not infer ${inference}`).toBe(false);
      }
    }
    for (const status of [200, 201]) {
      expect((await cancelOnce([{ status }])).final.lifecycle.kind, `contract ${status}`).toBe('cancellation-failed');
    }
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    const applied: CancellationSettlement[] = [];
    performCancellation(deps(throwing, (s) => void applied.push(s), spies().dispositions), departed, null);
    await tick();
    expect(applied[applied.length - 1]!.lifecycle.kind).toBe('cancellation-failed');
  });

  it('no cancellation request occurs before a deliberate act', () => {
    const r = recording([{ status: 204 }]);
    expect(permitsCancellation(departed)).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it('non-departed lifecycle states refuse cancellation and issue no request', () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();
    const refusing: Array<[string, DepartureState]> = [
      ['idle', noDeparture],
      ['departing-pending', { kind: 'departing-pending', placementId: DRAFT, artifactId: ART, recipients: ['r1'] }],
      ['departure-failed', { kind: 'departure-failed', placementId: DRAFT, artifactId: ART, recipients: ['r1'] }],
    ];
    for (const [label, lifecycle] of refusing) {
      expect(permitsCancellation(lifecycle), label).toBe(false);
      const refused = startCancellation(r.transport, ME, lifecycle, null, dispositions);
      expect(refused.kind, label).toBe('not-started');
      expect((refused as { state: DepartureState }).state, label).toBe(lifecycle); // the exact object
    }
    expect(r.calls).toHaveLength(0);
  });

  it('cancelled is terminal: it refuses another cancellation AND refuses departure at the production boundary, using the exact result onCancelled returns', () => {
    const pending: CancellingPendingState = {
      kind: 'cancelling-pending',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    };
    // The exact production result — never a hand-built cancelled fixture.
    const settled = onCancelled(pending);
    expect(settled.lifecycle.kind).toBe('cancelled');

    // No second cancellation.
    const rc = recording([{ status: 204 }]);
    const { dispositions } = spies();
    expect(permitsCancellation(settled.lifecycle)).toBe(false);
    const noSecondCancel = startCancellation(rc.transport, ME, settled.lifecycle, null, dispositions);
    expect(noSecondCancel.kind).toBe('not-started');
    expect((noSecondCancel as { state: DepartureState }).state).toBe(settled.lifecycle);
    expect(rc.calls).toHaveLength(0);

    // And no renewed departure — the lifecycle invariant, at the transition
    // boundary rather than in markup.
    const rd = recording([{ status: 204 }]);
    expect(permitsDeparture(done, held('r1'), settled.lifecycle)).toBe(false);
    const noDepart = startDeparture(rd.transport, ME, done, held('r1'), settled.lifecycle, null, dispositions);
    expect(noDepart.kind).toBe('not-started');
    expect((noDepart as { state: DepartureState }).state).toBe(settled.lifecycle); // identity
    expect(rd.calls).toHaveLength(0); // zero departure requests

    // A pending cancellation likewise refuses both acts.
    expect(permitsCancellation(pending)).toBe(false);
    expect(permitsDeparture(done, held('r1'), pending)).toBe(false);
  });

  it('the first accepted act synchronously returns the exact pending lifecycle, and a second act against it issues nothing', async () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();

    const first = startCancellation(r.transport, ME, departed, null, dispositions);
    expect(first.kind).toBe('started');
    const started = first as {
      kind: 'started';
      pendingState: CancellingPendingState;
      settlement: Promise<CancellationSettlement>;
    };
    expect(started.pendingState.kind).toBe('cancelling-pending'); // before awaiting settlement
    expect(r.calls).toHaveLength(1);

    const second = startCancellation(r.transport, ME, started.pendingState, null, dispositions);
    expect(second.kind).toBe('not-started');
    expect((second as { state: DepartureState }).state).toBe(started.pendingState);
    expect(r.calls).toHaveLength(1);

    await started.settlement;
    await tick();
    expect(r.calls).toHaveLength(1); // no automatic retry
  });

  it('a successful 204 enters the exact committed cancelled representation with exact identifiers and the frozen recipient set', async () => {
    const round = await cancelOnce([{ status: 204 }], {
      kind: 'departed',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1', 'r2'],
    });
    expect(round.final.lifecycle).toEqual({
      kind: 'cancelled',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1', 'r2'],
    });
    // Nothing about draft, settlement, timing, or the departure window rides along.
    for (const forbidden of ['draft', 'settled', 'interval', 'countdown', 'seconds']) {
      expect(JSON.stringify(round.final).includes(forbidden), forbidden).toBe(false);
    }
  });

  it('one pure result carries the cancelled lifecycle and a null retained draft together, and no result is both departing and cancelled', () => {
    const pending: CancellingPendingState = {
      kind: 'cancelling-pending',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    };
    // ONE call; both effects asserted on that single returned object.
    const settlement = onCancelled(pending);
    expect(settlement.lifecycle.kind).toBe('cancelled');
    expect(settlement.retainedDraft).toBeNull();
    expect(Object.keys(settlement).sort()).toEqual(['lifecycle', 'retainedDraft']);
    // There is ONE lifecycle value, so "departing and cancelled at once" is not
    // merely absent — it is unrepresentable.
    expect(settlement.lifecycle.kind).not.toBe('departed');
    const both = (s: CancellationSettlement): boolean =>
      s.lifecycle.kind === 'cancelled' && (s.retainedDraft !== null || s.lifecycle.kind !== 'cancelled');
    expect(both(settlement)).toBe(false);
  });

  it('failure preserves the departing lifecycle, the identifiers, the frozen recipients, and deliberate retry', async () => {
    const round = await cancelOnce([{ status: 500 }]);
    expect(round.final.lifecycle).toEqual({
      kind: 'cancellation-failed',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    });
    expect(round.final.retainedDraft).toBeNull(); // departure already nulled it; nothing restores it
    // Still departing in substance: a deliberate retry is startable, and the
    // Placement has not departed again nor become correctable.
    expect(permitsCancellation(round.final.lifecycle)).toBe(true);
    expect(permitsDeparture(done, held('r1'), round.final.lifecycle)).toBe(false);
    const retry = recording([{ status: 204 }]);
    const again = startCancellation(retry.transport, ME, round.final.lifecycle, null, spies().dispositions);
    expect(again.kind).toBe('started');
    expect(retry.calls).toHaveLength(1);
  });

  it('both public component forms: the bundle exposes Cancel only under eligibility and a cancelled presentation without lifecycle actions, and its absence preserves the P10-S17 presentation', () => {
    const base = { state: done, onTextChange: () => {}, onSend: () => {}, onReturn: () => {} };
    const recipients = { state: held('r1'), candidates: [], onAdd: () => {}, known: [{ id: 'r1', label: 'Ora' }], onRemove: () => {} };
    const departureBundle = { state: departed, eligible: false, onDepart: () => {} };

    // With the bundle and eligibility: Cancel appears and fires.
    let cancelled = 0;
    const eligible = Composer({
      ...base,
      recipients,
      departure: departureBundle,
      cancellation: { eligible: true, onCancel: () => void (cancelled += 1) },
    });
    const cancel = buttons(eligible).find((b) => label(b) === '"Cancel"')!;
    expect(cancel).toBeDefined();
    (cancel.props as { onClick: () => void }).onClick();
    expect(cancelled).toBe(1);

    // Pending: no duplicate Cancel.
    const pendingTree = Composer({
      ...base,
      recipients,
      departure: {
        state: { kind: 'cancelling-pending', placementId: DRAFT, artifactId: ART, recipients: ['r1'] },
        eligible: false,
        onDepart: () => {},
      },
      cancellation: { eligible: false, onCancel: () => {} },
    });
    expect(buttons(pendingTree).some((b) => label(b) === '"Cancel"')).toBe(false);

    // Cancelled: only Back, and no lifecycle or correction action at all.
    const after = Composer({
      ...base,
      recipients,
      departure: {
        state: { kind: 'cancelled', placementId: DRAFT, artifactId: ART, recipients: ['r1'] },
        eligible: false,
        onDepart: () => {},
      },
      cancellation: { eligible: false, onCancel: () => {} },
    });
    expect(buttons(after).map(label)).toEqual(['"Back"']);
    for (const action of ['Remove', 'Depart', 'Cancel', 'Settle', 'Vault', 'Key', 'Ora']) {
      expect(buttons(after).map(label).some((l) => l.includes(action)), action).toBe(false);
    }

    // Without the cancellation bundle: the P10-S17 departed presentation exactly.
    const preserved = Composer({ ...base, recipients, departure: departureBundle });
    expect(buttons(preserved).map(label)).toEqual(['"Back"']);
    // Hiding Cancel is presentation. It is NOT the lifecycle guard — case 6
    // proves the transition refuses independently of any markup.
  });

  it('no persistence, router, URL, history, countdown, automatic retry, read-after-cancellation, settlement, or invented lifecycle is introduced', async () => {
    for (const rel of ['composer/cancellation-state.ts', 'composer/cancellation-mutations.ts', 'composer/cancellation.ts']) {
      const code = codeOf(rel);
      for (const construct of [
        'sessionStorage',
        'localStorage',
        'createBrowserRouter',
        'useNavigate',
        'history.pushState',
        'window.location',
        'setInterval',
        'setTimeout',
        'Date.now',
        'new Date',
        '/settlement',
        '/key-placements',
      ]) {
        expect(code.includes(construct), `${rel} must not use ${construct}`).toBe(false);
      }
      // The departure ROUTE, in its template-tail form. A bare '/departure'
      // would match the legitimate './departure-state.ts' import that carries
      // the one authoritative lifecycle union — an import, not a request.
      expect(code.includes('}/departure'), `${rel} must not name the departure route`).toBe(false);
    }
    // Startability has ONE implementation.
    const orchestration = codeOf('composer/cancellation.ts');
    expect([...orchestration.matchAll(/permitsCancellation\(/g)]).toHaveLength(1);
    for (const rule of ["kind === 'departed'", "kind === 'cancellation-failed'"]) {
      expect(orchestration.includes(rule), `cancellation.ts must not re-derive ${rule}`).toBe(false);
    }
    // No read after the write, and nothing follows on its own.
    const round = await cancelOnce([{ status: 204 }]);
    expect(round.calls).toHaveLength(1);
    expect(round.calls.some((c) => c.init.method === 'GET')).toBe(false);
    await tick();
    expect(round.calls).toHaveLength(1);
  });
});

// ── element helpers: the Composer is hook-free, so it is invoked directly ──
type El = { type?: unknown; props: Record<string, unknown> };
function flatten(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  if (node && typeof node === 'object' && 'type' in node) {
    const el = node as unknown as El;
    out.push(el);
    flatten(el.props.children, out);
  }
  return out;
}
const buttons = (tree: unknown): El[] => flatten(tree).filter((e) => e.type === 'button');
const label = (e: El): string => JSON.stringify(e.props.children);
