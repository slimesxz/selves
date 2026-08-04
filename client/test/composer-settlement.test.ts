// P10-S19 — the twelve ratified cases for settlement.
//
// Settlement ends the lifecycle, so the load-bearing proofs are terminal
// refusals: what the client will not request once the lifecycle says settled,
// proven at the transition boundary against the exact value `onSettled` returns.
//
// One condition is recorded here rather than designed away. The client cannot
// lawfully know when settlement becomes eligible — it may not read the
// Placement, the snapshotted interval, or the clock — so Settle may be pressable
// while the Placement is not yet authoritatively eligible, and the server
// rejects. After rejection the client can say only that settlement did not
// complete. That is the blind-settlement condition, and case 12 records it.
//
// These prove the pure transitions, the request contract, and the hook-free
// presentation in both public forms. They do NOT prove the hook-bound App chain.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Transport } from '../src/api/transport.ts';
import Composer from '../src/composer/Composer.tsx';
import { startCancellation } from '../src/composer/cancellation.ts';
import { permitsCancellation } from '../src/composer/cancellation-state.ts';
import { startDeparture } from '../src/composer/departure.ts';
import {
  noDeparture,
  permitsDeparture,
  type DepartureState,
  type SettlingPendingState,
} from '../src/composer/departure-state.ts';
import type { Dispositions } from '../src/composer/recipient-add.ts';
import { type RecipientState } from '../src/composer/recipient-state.ts';
import { performSettlement, startSettlement, type SettlementDeps } from '../src/composer/settlement.ts';
import { SETTLED_STATUS, SETTLEMENT_PATH } from '../src/composer/settlement-mutations.ts';
import {
  onSettled,
  permitsSettlement,
  type SettlementSettlement,
} from '../src/composer/settlement-state.ts';
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
  apply: (s: SettlementSettlement) => void,
  dispositions: Dispositions,
): SettlementDeps => ({ transport, actingSelfId: ME, apply, dispositions });

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

async function settleOnce(steps: Array<{ status: number }>, lifecycle: DepartureState = departed) {
  const r = recording(steps);
  const s = spies();
  const applied: SettlementSettlement[] = [];
  performSettlement(deps(r.transport, (x) => void applied.push(x), s.dispositions), lifecycle, null);
  await tick();
  return { ...r, ...s, applied, final: applied[applied.length - 1]! };
}

describe('P10-S19 settlement', () => {
  it('the settlement request uses the exact path, POST method, acting-Self header, and no body, and only 204 is success', async () => {
    const ok = await settleOnce([{ status: 204 }]);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.url).toBe(`/api${SETTLEMENT_PATH(DRAFT)}`);
    expect(ok.calls[0]!.init.method).toBe('POST');
    expect((ok.calls[0]!.init.headers as Record<string, string>)['x-acting-self']).toBe(ME);
    expect(ok.calls[0]!.init.body).toBeUndefined();
    expect(SETTLED_STATUS).toBe(204);
    expect(ok.final.lifecycle.kind).toBe('settled');

    for (const status of [200, 201, 202]) {
      expect((await settleOnce([{ status }])).final.lifecycle.kind, `status ${status}`).toBe('settlement-failed');
    }
  });

  it('settlement is client-initiated: no automatic path exists and nothing settles without a deliberate act', async () => {
    // Every settlement request in the owned modules originates from the one
    // orchestration entry point; no timer, interval, or loop can reach it.
    for (const rel of ['composer/settlement-state.ts', 'composer/settlement-mutations.ts', 'composer/settlement.ts']) {
      const code = codeOf(rel);
      for (const automatic of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'while (', 'for (']) {
        expect(code.includes(automatic), `${rel} must not use ${automatic}`).toBe(false);
      }
    }
    const r = recording([{ status: 204 }]);
    // Holding an eligible lifecycle requests nothing by itself.
    expect(permitsSettlement(departed)).toBe(true);
    await tick();
    expect(r.calls).toHaveLength(0);
  });

  it('401 and 403 invoke the injected authoritative dispositions, abandon the attempt, and are never settlement failures', async () => {
    for (const [status, expected] of [
      [401, 'session-expired'],
      [403, 'forbidden'],
    ] as const) {
      const round = await settleOnce([{ status }]);
      expect(round.seen, `status ${status}`).toEqual([expected]);
      expect(round.final.lifecycle, `status ${status}`).toEqual(noDeparture);
      expect(round.final.lifecycle.kind, `status ${status}`).not.toBe('settlement-failed');
    }
  });

  it('server rejection, contract-violating 2xx, and transport throw enter one non-auth class, and a 409 yields no timing or lifecycle inference', async () => {
    for (const status of [400, 404, 409, 500, 503]) {
      const round = await settleOnce([{ status }]);
      expect(round.final.lifecycle.kind, `error ${status}`).toBe('settlement-failed');
      expect(round.seen, `error ${status}`).toEqual([]);
      // Nothing about the interval, the race, or a prior settlement is inferred.
      const json = JSON.stringify(round.final);
      for (const inference of ['interval', 'elapsed', 'cancelled', '"settled"', 'seconds', 'countdown']) {
        expect(json.includes(inference), `${status} must not infer ${inference}`).toBe(false);
      }
    }
    for (const status of [200, 201]) {
      expect((await settleOnce([{ status }])).final.lifecycle.kind, `contract ${status}`).toBe('settlement-failed');
    }
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    const applied: SettlementSettlement[] = [];
    performSettlement(deps(throwing, (s) => void applied.push(s), spies().dispositions), departed, null);
    await tick();
    expect(applied[applied.length - 1]!.lifecycle.kind).toBe('settlement-failed');
  });

  it('no settlement request occurs before a deliberate act, and ineligible lifecycle states refuse by identity', () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();
    const ineligible: Array<[string, DepartureState]> = [
      ['idle', noDeparture],
      ['departure-failed', { kind: 'departure-failed', placementId: DRAFT, artifactId: ART, recipients: ['r1'] }],
      ['cancelled', { kind: 'cancelled', placementId: DRAFT, artifactId: ART, recipients: ['r1'] }],
      ['cancellation-failed', { kind: 'cancellation-failed', placementId: DRAFT, artifactId: ART, recipients: ['r1'] }],
    ];
    for (const [label, lifecycle] of ineligible) {
      expect(permitsSettlement(lifecycle), label).toBe(false);
      const refused = startSettlement(r.transport, ME, lifecycle, null, dispositions);
      expect(refused.kind, label).toBe('not-started');
      expect((refused as { state: DepartureState }).state, label).toBe(lifecycle);
    }
    expect(r.calls).toHaveLength(0);
  });

  it('at most one lifecycle mutation is pending: departure-pending, cancellation-pending, and settlement-pending each refuse settlement, using production-generated states', () => {
    const { dispositions } = spies();

    // Departure pending, produced by the production departure boundary.
    const rd = recording([{ status: 204 }]);
    const departing = startDeparture(rd.transport, ME, done, held('r1'), noDeparture, null, dispositions) as {
      pendingState: DepartureState;
    };
    expect(rd.calls).toHaveLength(1);
    expect(permitsSettlement(departing.pendingState)).toBe(false);
    const blockedByDeparture = startSettlement(rd.transport, ME, departing.pendingState, null, dispositions);
    expect(blockedByDeparture.kind).toBe('not-started');
    expect((blockedByDeparture as { state: DepartureState }).state).toBe(departing.pendingState);
    expect(rd.calls).toHaveLength(1); // no settlement request

    // Cancellation pending, produced by the production cancellation boundary.
    const rc = recording([{ status: 204 }]);
    const cancelling = startCancellation(rc.transport, ME, departed, null, dispositions) as {
      pendingState: DepartureState;
    };
    expect(rc.calls).toHaveLength(1);
    expect(permitsSettlement(cancelling.pendingState)).toBe(false);
    const blockedByCancellation = startSettlement(rc.transport, ME, cancelling.pendingState, null, dispositions);
    expect(blockedByCancellation.kind).toBe('not-started');
    expect((blockedByCancellation as { state: DepartureState }).state).toBe(cancelling.pendingState);
    expect(rc.calls).toHaveLength(1); // no settlement request

    // Settlement pending, produced by its own production boundary.
    const rs = recording([{ status: 204 }]);
    const settling = startSettlement(rs.transport, ME, departed, null, dispositions) as {
      pendingState: SettlingPendingState;
    };
    expect(rs.calls).toHaveLength(1);
    const second = startSettlement(rs.transport, ME, settling.pendingState, null, dispositions);
    expect(second.kind).toBe('not-started');
    expect((second as { state: DepartureState }).state).toBe(settling.pendingState);
    expect(rs.calls).toHaveLength(1);
  });

  it('the first accepted act synchronously returns the exact pending lifecycle, and no automatic retry follows', async () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();
    const first = startSettlement(r.transport, ME, departed, null, dispositions);
    expect(first.kind).toBe('started');
    const started = first as {
      kind: 'started';
      pendingState: SettlingPendingState;
      settlement: Promise<SettlementSettlement>;
    };
    expect(started.pendingState.kind).toBe('settling-pending'); // before awaiting
    expect(r.calls).toHaveLength(1);
    await started.settlement;
    await tick();
    expect(r.calls).toHaveLength(1);
  });

  it('a successful 204 enters the exact settled representation with exact identifiers and the frozen recipient set', async () => {
    const round = await settleOnce([{ status: 204 }], {
      kind: 'departed',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1', 'r2'],
    });
    expect(round.final.lifecycle).toEqual({
      kind: 'settled',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1', 'r2'],
    });
    // Nothing about receipt, viewing, acknowledgement, Vault, Key, or the
    // emitted outbox event rides along. Scoped to the lifecycle value: the
    // settlement result's own `retainedDraft` field is lawful and is asserted
    // separately below.
    for (const forbidden of ['receipt', 'viewed', 'acknowledg', 'vault', 'key', 'outbox', 'draft']) {
      expect(JSON.stringify(round.final.lifecycle).toLowerCase().includes(forbidden), forbidden).toBe(false);
    }
    expect(round.final.retainedDraft).toBeNull();
  });

  it('one pure result carries the settled lifecycle and a null retained draft together', () => {
    const pending: SettlingPendingState = {
      kind: 'settling-pending',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    };
    const settlement = onSettled(pending);
    expect(settlement.lifecycle.kind).toBe('settled');
    expect(settlement.retainedDraft).toBeNull();
    expect(Object.keys(settlement).sort()).toEqual(['lifecycle', 'retainedDraft']);
    // One lifecycle value, so departing-and-settled, cancelled-and-settled, and
    // correctable-and-settled are unrepresentable rather than merely absent.
    expect(settlement.lifecycle.kind).not.toBe('departed');
    expect(settlement.lifecycle.kind).not.toBe('cancelled');
  });

  it('settled is terminal: it cannot depart, cannot cancel, and cannot settle again, proven against the exact onSettled result', () => {
    const pending: SettlingPendingState = {
      kind: 'settling-pending',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    };
    const settled = onSettled(pending); // the production result, not a fixture
    expect(settled.lifecycle.kind).toBe('settled');
    const { dispositions } = spies();

    // 1 — cannot depart.
    const rd = recording([{ status: 204 }]);
    expect(permitsDeparture(done, held('r1'), settled.lifecycle)).toBe(false);
    const noDepart = startDeparture(rd.transport, ME, done, held('r1'), settled.lifecycle, null, dispositions);
    expect(noDepart.kind).toBe('not-started');
    expect((noDepart as { state: DepartureState }).state).toBe(settled.lifecycle);
    expect(rd.calls).toHaveLength(0);

    // 2 — cannot cancel.
    const rc = recording([{ status: 204 }]);
    expect(permitsCancellation(settled.lifecycle)).toBe(false);
    const noCancel = startCancellation(rc.transport, ME, settled.lifecycle, null, dispositions);
    expect(noCancel.kind).toBe('not-started');
    expect((noCancel as { state: DepartureState }).state).toBe(settled.lifecycle);
    expect(rc.calls).toHaveLength(0);

    // 3 — cannot settle again. The server would answer 204 to a repeat, since
    // its function returns early on an already-settled row; terminality here is
    // therefore the CLIENT's rule, and the asymmetry is recorded not smoothed.
    const rs = recording([{ status: 204 }]);
    expect(permitsSettlement(settled.lifecycle)).toBe(false);
    const noSettle = startSettlement(rs.transport, ME, settled.lifecycle, null, dispositions);
    expect(noSettle.kind).toBe('not-started');
    expect((noSettle as { state: DepartureState }).state).toBe(settled.lifecycle);
    expect(rs.calls).toHaveLength(0);

    // 4 — and a cancelled Placement cannot settle either.
    const cancelled: DepartureState = { kind: 'cancelled', placementId: DRAFT, artifactId: ART, recipients: ['r1'] };
    const rx = recording([{ status: 204 }]);
    expect(permitsSettlement(cancelled)).toBe(false);
    const noSettleAfterCancel = startSettlement(rx.transport, ME, cancelled, null, dispositions);
    expect(noSettleAfterCancel.kind).toBe('not-started');
    expect((noSettleAfterCancel as { state: DepartureState }).state).toBe(cancelled);
    expect(rx.calls).toHaveLength(0);
  });

  it('failure preserves the pre-settlement lifecycle and deliberate retry, and both public component forms behave as ruled', async () => {
    const round = await settleOnce([{ status: 409 }]);
    expect(round.final.lifecycle).toEqual({
      kind: 'settlement-failed',
      placementId: DRAFT,
      artifactId: ART,
      recipients: ['r1'],
    });
    expect(round.final.retainedDraft).toBeNull();
    expect(permitsSettlement(round.final.lifecycle)).toBe(true); // deliberate retry
    expect(permitsDeparture(done, held('r1'), round.final.lifecycle)).toBe(false);
    const retry = recording([{ status: 204 }]);
    expect(startSettlement(retry.transport, ME, round.final.lifecycle, null, spies().dispositions).kind).toBe('started');
    expect(retry.calls).toHaveLength(1);

    const base = { state: done, onTextChange: () => {}, onSend: () => {}, onReturn: () => {} };
    const recipients = { state: held('r1'), candidates: [], onAdd: () => {}, known: [{ id: 'r1', label: 'Ora' }], onRemove: () => {} };
    const departureBundle = { state: departed, eligible: false, onDepart: () => {} };

    // With the bundle and observable eligibility: Settle appears and fires.
    let settled = 0;
    const withBundle = Composer({
      ...base, recipients, departure: departureBundle,
      settlement: { eligible: true, onSettle: () => void (settled += 1) },
    });
    const settle = buttons(withBundle).find((b) => label(b) === '"Settle"')!;
    expect(settle).toBeDefined();
    (settle.props as { onClick: () => void }).onClick();
    expect(settled).toBe(1);

    // Settled: only Back, and no lifecycle or correction action at all.
    const after = Composer({
      ...base, recipients,
      departure: { state: { kind: 'settled', placementId: DRAFT, artifactId: ART, recipients: ['r1'] }, eligible: false, onDepart: () => {} },
      settlement: { eligible: false, onSettle: () => {} },
    });
    expect(buttons(after).map(label)).toEqual(['"Back"']);
    for (const action of ['Remove', 'Depart', 'Cancel', 'Settle', 'Vault', 'Key', 'Ora']) {
      expect(buttons(after).map(label).some((l) => l.includes(action)), action).toBe(false);
    }

    // Without the bundle: the P10-S18 presentation exactly — no Settle.
    const preserved = Composer({ ...base, recipients, departure: departureBundle });
    expect(buttons(preserved).map(label)).toEqual(['"Back"']);
  });

  it('no persistence, router, URL, history, fabricated countdown, automatic retry, or read-after-settlement — and the blind-settlement condition is recorded', async () => {
    for (const rel of ['composer/settlement-state.ts', 'composer/settlement-mutations.ts', 'composer/settlement.ts']) {
      const code = codeOf(rel);
      for (const construct of [
        'sessionStorage', 'localStorage', 'createBrowserRouter', 'useNavigate',
        'history.pushState', 'window.location', 'Date.now', 'new Date',
        'departure_interval', 'departingAt', 'elapsed',
      ]) {
        expect(code.includes(construct), `${rel} must not use ${construct}`).toBe(false);
      }
      // No route but its own.
      expect(code.includes('}/departure'), `${rel} must not name the departure route`).toBe(false);
      expect(code.includes('}/cancellation'), `${rel} must not name the cancellation route`).toBe(false);
    }
    // Startability has ONE implementation.
    expect([...codeOf('composer/settlement.ts').matchAll(/permitsSettlement\(/g)]).toHaveLength(1);

    // No read after the write; nothing follows on its own.
    const round = await settleOnce([{ status: 204 }]);
    expect(round.calls).toHaveLength(1);
    expect(round.calls.some((c) => c.init.method === 'GET')).toBe(false);
    await tick();
    expect(round.calls).toHaveLength(1);

    // THE BLIND-SETTLEMENT CONDITION, recorded as behavior rather than prose.
    // The client's observable eligibility does not track authoritative
    // eligibility: a departed Placement permits the act, the server rejects
    // until the snapshotted interval elapses, and the failure that comes back
    // says only that settlement did not complete.
    expect(permitsSettlement(departed)).toBe(true); // pressable…
    const rejected = await settleOnce([{ status: 409 }]); // …and rejected
    expect(rejected.calls).toHaveLength(1);
    expect(rejected.final.lifecycle.kind).toBe('settlement-failed');
    // It cannot distinguish among the reasons, and states none of them.
    expect(Object.keys(rejected.final.lifecycle).sort()).toEqual([
      'artifactId', 'kind', 'placementId', 'recipients',
    ]);
    // Retry is possible only through another deliberate act.
    expect(permitsSettlement(rejected.final.lifecycle)).toBe(true);
    await tick();
    expect(rejected.calls).toHaveLength(1); // nothing retried on its own
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
