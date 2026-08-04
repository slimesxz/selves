// P10-S17 — the twelve ratified cases for departure.
//
// Departure is the first client act that leaves the correctable state, so these
// cases care as much about what does NOT happen as about what does: no request
// without eligibility, no second attempt, no invented lifecycle state, and no
// moment at which one Placement is representable as both retained draft and
// departing.
//
// The proof boundary is stated rather than blurred. These prove the pure
// transitions, the request contract, and the directly invocable presentation in
// both public forms. They do NOT prove the hook-bound App.tsx chain, and they
// prove nothing about the server's snapshotted departure interval — which this
// slice deliberately never reads.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Transport } from '../src/api/transport.ts';
import Composer from '../src/composer/Composer.tsx';
import { performDeparture, startDeparture, type DepartureDeps } from '../src/composer/departure.ts';
import { DEPARTED_STATUS, DEPARTURE_PATH } from '../src/composer/departure-mutations.ts';
import {
  noDeparture,
  onDeparted,
  permitsDeparture,
  type DepartingPendingState,
  type DepartureSettlement,
  type DepartureState,
} from '../src/composer/departure-state.ts';
import type { Dispositions } from '../src/composer/recipient-add.ts';
import { noRecipients, type RecipientState } from '../src/composer/recipient-state.ts';
import { retain, type RetainedDraft } from '../src/composer/retained-draft.ts';
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
const DEPARTED_FROM: RetainedDraft = retain(ART, DRAFT, held('r1'), { kind: 'projection', groups: [] });

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
  apply: (s: DepartureSettlement) => void,
  dispositions: Dispositions,
): DepartureDeps => ({ transport, actingSelfId: ME, apply, dispositions });

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Settle one departure attempt and return everything observed. */
async function departOnce(
  steps: Array<{ status: number }>,
  recipients: RecipientState = held('r1'),
  departure: DepartureState = noDeparture,
  retained: RetainedDraft | null = DEPARTED_FROM,
) {
  const r = recording(steps);
  const s = spies();
  const applied: DepartureSettlement[] = [];
  performDeparture(
    deps(r.transport, (x) => void applied.push(x), s.dispositions),
    done,
    recipients,
    departure,
    retained,
  );
  await tick();
  return { ...r, ...s, applied, final: applied[applied.length - 1]! };
}

describe('P10-S17 departure', () => {
  it('the departure request uses the exact path, POST method, acting-Self header, and no body, and only 204 is success', async () => {
    const ok = await departOnce([{ status: 204 }]);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.url).toBe(`/api${DEPARTURE_PATH(DRAFT)}`);
    expect(ok.calls[0]!.init.method).toBe('POST');
    expect((ok.calls[0]!.init.headers as Record<string, string>)['x-acting-self']).toBe(ME);
    expect(ok.calls[0]!.init.body).toBeUndefined(); // departure carries no body
    expect(DEPARTED_STATUS).toBe(204);
    expect(ok.final.departure.kind).toBe('departed');

    // A 2xx that is not 204 violates the audited contract and is not success.
    for (const status of [200, 201, 202]) {
      const other = await departOnce([{ status }]);
      expect(other.final.departure.kind, `status ${status}`).toBe('departure-failed');
    }
  });

  it('401 and 403 invoke the injected authoritative dispositions, abandon the attempt, and are never departure failures', async () => {
    for (const [status, expected] of [
      [401, 'session-expired'],
      [403, 'forbidden'],
    ] as const) {
      const round = await departOnce([{ status }]);
      expect(round.seen, `status ${status}`).toEqual([expected]);
      expect(round.final.departure, `status ${status}`).toEqual(noDeparture); // abandoned
      expect(round.final.departure.kind, `status ${status}`).not.toBe('departure-failed');
      expect(round.final.retainedDraft, `status ${status}`).toBeNull();
    }
  });

  it('server rejection, contract-violating 2xx, and transport throw enter one non-auth failure class with causes distinguishable', async () => {
    // Cause A — the server reported an error or rejection. A 409 in particular
    // tells the client its act did not take, never what the server now holds.
    for (const status of [400, 404, 409, 500, 503]) {
      const round = await departOnce([{ status }]);
      expect(round.final.departure.kind, `error ${status}`).toBe('departure-failed');
      expect(round.seen, `error ${status}`).toEqual([]);
      expect(JSON.stringify(round.final), `error ${status}`).not.toContain('settled');
      expect(JSON.stringify(round.final), `error ${status}`).not.toContain('cancelled');
    }
    // Cause B — a success-class response violating the audited contract.
    for (const status of [200, 201]) {
      expect((await departOnce([{ status }])).final.departure.kind, `contract ${status}`).toBe('departure-failed');
    }
    // Cause C — transport failure.
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    const applied: DepartureSettlement[] = [];
    performDeparture(
      deps(throwing, (s) => void applied.push(s), spies().dispositions),
      done,
      held('r1'),
      noDeparture,
      DEPARTED_FROM,
    );
    await tick();
    expect(applied[applied.length - 1]!.departure.kind).toBe('departure-failed');
  });

  it('no departure request occurs before a deliberate act', () => {
    const r = recording([{ status: 204 }]);
    // Eligibility can be evaluated freely; nothing is requested by asking.
    expect(permitsDeparture(done, held('r1'), noDeparture)).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it('zero recipients refuses departure and issues no request', () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();
    expect(permitsDeparture(done, noRecipients, noDeparture)).toBe(false);
    const refused = startDeparture(r.transport, ME, done, noRecipients, noDeparture, DEPARTED_FROM, dispositions);
    expect(refused.kind).toBe('not-started');
    expect((refused as { state: DepartureState }).state).toBe(noDeparture); // exact unchanged state
    expect(r.calls).toHaveLength(0);
  });

  it('creation pending, add pending, removal pending, and departure already pending each refuse departure by identity', () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();
    const pending: DepartingPendingState = {
      kind: 'departing-pending',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    };
    const cases: Array<[string, ComposerState, RecipientState, DepartureState]> = [
      ['creating', { kind: 'creating', text: 'a', stage: 'artifact', artifactId: null }, held('r1'), noDeparture],
      ['adding', done, { kind: 'adding', recipients: ['r1'], candidateId: 'r2' }, noDeparture],
      ['removing', done, { kind: 'removing', recipients: ['r1'], targetId: 'r1' }, noDeparture],
      ['departing-pending', done, held('r1'), pending],
      ['departed', done, held('r1'), { kind: 'departed', placementId: DRAFT, artifactId: ART, recipients: ['r1'] }],
    ];
    for (const [label, composer, recipients, departure] of cases) {
      expect(permitsDeparture(composer, recipients, departure), label).toBe(false);
      const refused = startDeparture(r.transport, ME, composer, recipients, departure, DEPARTED_FROM, dispositions);
      expect(refused.kind, label).toBe('not-started');
      expect((refused as { state: DepartureState }).state, label).toBe(departure); // the exact object
    }
    expect(r.calls).toHaveLength(0); // not one request across every refusal
  });

  it('the first accepted act synchronously returns the exact pending state, and a second act against it issues nothing', async () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();

    const first = startDeparture(r.transport, ME, done, held('r1'), noDeparture, DEPARTED_FROM, dispositions);
    expect(first.kind).toBe('started');
    const started = first as {
      kind: 'started';
      pendingState: DepartingPendingState;
      settlement: Promise<DepartureSettlement>;
    };
    expect(started.pendingState.kind).toBe('departing-pending'); // before awaiting settlement
    expect(r.calls).toHaveLength(1);

    const second = startDeparture(
      r.transport, ME, done, held('r1'), started.pendingState, DEPARTED_FROM, dispositions,
    );
    expect(second.kind).toBe('not-started');
    expect((second as { state: DepartureState }).state).toBe(started.pendingState); // the exact object
    expect(r.calls).toHaveLength(1);

    await started.settlement;
    await tick();
    expect(r.calls).toHaveLength(1); // no automatic retry
  });

  it('a successful 204 enters departed with the exact identifiers and the frozen locally known recipient set', async () => {
    const round = await departOnce([{ status: 204 }], held('r1', 'r2'));
    const departed = round.final.departure;
    expect(departed).toEqual({
      kind: 'departed',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1', 'r2'],
    });
    // Frozen: the snapshot is the client's own array, not a live reference that
    // a later recipient change could edit underneath it.
    const live = held('r1', 'r2');
    const snapshotRound = await departOnce([{ status: 204 }], live);
    expect((snapshotRound.final.departure as { recipients: readonly string[] }).recipients).not.toBe(live.recipients);
    // No time, interval, or settlement is invented.
    for (const forbidden of ['interval', 'departingAt', 'settledAt', 'countdown', 'seconds']) {
      expect(JSON.stringify(round.final).includes(forbidden), forbidden).toBe(false);
    }
  });

  it('the pure joint transition returns ONE value carrying departed state and a null retained draft together', () => {
    const pending: DepartingPendingState = {
      kind: 'departing-pending',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    };
    // A single call, and both effects asserted on that single returned object —
    // combining two separate calls would leave their simultaneity unproven,
    // which is the whole content of the exclusivity rule.
    const settlement = onDeparted(pending);
    expect(settlement.departure.kind).toBe('departed');
    expect(settlement.retainedDraft).toBeNull();
    expect(Object.keys(settlement).sort()).toEqual(['departure', 'retainedDraft']);
    expect((settlement.departure as { placementId: string }).placementId).toBe(DRAFT);
    expect((settlement.departure as { artifactId: string }).artifactId).toBe(ART);

    // And through the production settlement path, no result ever represents the
    // Placement as retained draft and departing at once.
    const bothAtOnce = (s: DepartureSettlement): boolean =>
      s.departure.kind === 'departed' && s.retainedDraft !== null;
    expect(bothAtOnce(settlement)).toBe(false);
  });

  it('failure preserves the draft, the recipients, retained-draft reachability, and deliberate retry', async () => {
    const round = await departOnce([{ status: 500 }], held('r1'), noDeparture, DEPARTED_FROM);
    expect(round.final.departure).toEqual({
      kind: 'departure-failed',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    });
    expect(round.final.retainedDraft).toBe(DEPARTED_FROM); // reachability intact, exactly
    // Correction remains available and a deliberate retry remains startable.
    expect(permitsDeparture(done, held('r1'), round.final.departure)).toBe(true);
    const retry = recording([{ status: 204 }]);
    const again = startDeparture(
      retry.transport, ME, done, held('r1'), round.final.departure, DEPARTED_FROM, spies().dispositions,
    );
    expect(again.kind).toBe('started');
    expect(retry.calls).toHaveLength(1);
  });

  it('both public component forms: the bundle exposes Depart only under eligibility and a departed presentation without correction, and its absence preserves the P10-S16 form', () => {
    const base = { state: done, onTextChange: () => {}, onSend: () => {}, onReturn: () => {} };
    const recipients = { state: held('r1'), candidates: [], onAdd: () => {}, known: [{ id: 'r1', label: 'Ora' }], onRemove: () => {} };

    // With the bundle and eligibility: Depart appears and fires.
    let departed = 0;
    const eligible = Composer({
      ...base,
      recipients,
      departure: { state: noDeparture, eligible: true, onDepart: () => void (departed += 1) },
    });
    const depart = buttons(eligible).find((b) => label(b) === '"Depart"')!;
    expect(depart).toBeDefined();
    (depart.props as { onClick: () => void }).onClick();
    expect(departed).toBe(1);

    // With the bundle but ineligible: no Depart.
    const ineligible = Composer({
      ...base,
      recipients,
      departure: { state: noDeparture, eligible: false, onDepart: () => {} },
    });
    expect(buttons(ineligible).some((b) => label(b) === '"Depart"')).toBe(false);

    // Departed: no correction, no reopen, no Cancel, Settle, Vault, or Key.
    const after = Composer({
      ...base,
      recipients,
      departure: {
        state: { kind: 'departed', placementId: DRAFT, artifactId: ART, recipients: ['r1'] },
        eligible: false,
        onDepart: () => {},
      },
    });
    const afterLabels = buttons(after).map(label);
    expect(afterLabels).toEqual(['"Back"']);
    for (const action of ['Remove', 'Depart', 'Cancel', 'Settle', 'Vault', 'Key', 'Ora']) {
      expect(afterLabels.some((l) => l.includes(action)), action).toBe(false);
    }

    // Without the bundle: the P10-S16 form exactly — no Depart, no lifecycle.
    const preserved = Composer({ ...base, recipients });
    const preservedLabels = buttons(preserved).map(label);
    expect(preservedLabels.some((l) => l.includes('Depart'))).toBe(false);
    expect(preservedLabels).toContain('"Back"');
    expect(preservedLabels.some((l) => l.includes('Remove Ora'))).toBe(true); // correction still offered
  });

  it('no persistence, router, URL, history, countdown, automatic retry, read-after-departure, or inferred lifecycle state is introduced', async () => {
    for (const rel of ['composer/departure-state.ts', 'composer/departure-mutations.ts', 'composer/departure.ts']) {
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
        '/cancellation',
        '/settlement',
        '/key-placements',
      ]) {
        expect(code.includes(construct), `${rel} must not use ${construct}`).toBe(false);
      }
    }
    // Startability has ONE implementation: the orchestration boundary calls the
    // predicate and never re-derives the rule.
    const orchestration = codeOf('composer/departure.ts');
    expect([...orchestration.matchAll(/permitsDeparture\(/g)]).toHaveLength(1);
    for (const rule of ["recipients.length", "kind === 'adding'", "kind === 'removing'", "kind !== 'created'"]) {
      expect(orchestration.includes(rule), `departure.ts must not re-derive ${rule}`).toBe(false);
    }
    // The act performs no read after its write and nothing follows on its own.
    const round = await departOnce([{ status: 204 }]);
    expect(round.calls).toHaveLength(1);
    expect(round.calls.some((c) => c.init.method === 'GET')).toBe(false);
    await tick();
    expect(round.calls).toHaveLength(1);
    // The authoritative snapshotted departure interval is never observed here.
    expect(codeOf('composer/departure-mutations.ts').includes('interval')).toBe(false);
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
