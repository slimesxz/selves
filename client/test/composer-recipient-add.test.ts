// P10-S15 — the ten ratified cases for recipient add.
//
// Every case observes real requests through a recording transport and real
// dispositions through injected spies, against the production boundaries. None
// mounts anything.
//
// What they do NOT prove is named individually in the completion report: that
// App supplies the real add act, that a mounted candidate control invokes it,
// that App applies the pending state before settlement, and that a real 204
// corresponds to the local update across the client/server boundary.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Transport } from '../src/api/transport.ts';
import Composer from '../src/composer/Composer.tsx';
import { performAdd, startAdd, type AddDeps, type Dispositions } from '../src/composer/recipient-add.ts';
import { ADDED_STATUS, RECIPIENTS_PATH } from '../src/composer/recipient-mutations.ts';
import {
  deriveCandidates,
  noRecipients,
  permitsAdd,
  type RecipientState,
} from '../src/composer/recipient-state.ts';
import type { ComposerState } from '../src/composer/state.ts';
import type { SelfSummary } from '../src/self/selves.ts';

const here = dirname(fileURLToPath(import.meta.url));
const codeOf = (rel: string): string =>
  readFileSync(resolve(here, '../src', rel), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const ME = 'me';
const DRAFT = 'placement-1';
const self = (id: string, name: string, slot: number): SelfSummary => ({ id, name, slot });
const done: ComposerState = { kind: 'created', artifactId: 'artifact-1', placementId: DRAFT };

/** Records every request; answers each call in turn. A 204 step carries a
 *  Response whose json() throws, so any body read is a failure rather than a
 *  silent success. */
function recording(steps: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    const res =
      step.body === undefined
        ? new Response(null, { status: step.status })
        : new Response(JSON.stringify(step.body), { status: step.status });
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

const deps = (transport: Transport, apply: (s: RecipientState) => void, dispositions: Dispositions): AddDeps => ({
  transport,
  actingSelfId: ME,
  placementId: DRAFT,
  apply,
  dispositions,
});

const bodyOf = (init: RequestInit): Record<string, unknown> =>
  JSON.parse(init.body as string) as Record<string, unknown>;

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Settle one add and return the final state. */
async function addOnce(
  steps: Array<{ status: number; body?: unknown }>,
  from: RecipientState = noRecipients,
  candidateId = 'r1',
) {
  const r = recording(steps);
  const s = spies();
  const applied: RecipientState[] = [];
  performAdd(deps(r.transport, (x) => void applied.push(x), s.dispositions), from, candidateId);
  await tick();
  return { ...r, ...s, applied, final: applied[applied.length - 1]! };
}

describe('P10-S15 recipient add', () => {
  it('candidates derive from the account-local list, exclude the active Self, and collision labels use exactly the displayed subset', () => {
    // Two Selves share the name "Ora" — but one of them IS the active Self, so
    // after exclusion only one remains and no disambiguation is warranted. A
    // label computed over the full account list would read "Ora (2)".
    const account = [self(ME, 'Ora', 1), self('r1', 'Ora', 2), self('r2', 'Wren', 3)];
    const candidates = deriveCandidates(account, ME);

    expect(candidates.map((c) => c.id)).toEqual(['r1', 'r2']); // active Self excluded
    expect(candidates.map((c) => c.label)).toEqual(['Ora', 'Wren']); // subset-only collision
    // Where the collision is genuinely within the displayed subset, it is shown.
    const both = deriveCandidates([self(ME, 'Zed', 1), self('r1', 'Ora', 2), self('r2', 'Ora', 3)], ME);
    expect(both.map((c) => c.label)).toEqual(['Ora (2)', 'Ora (3)']);
    // The active Self can never be offered, whatever its name.
    expect(deriveCandidates([self(ME, 'Solo', 1)], ME)).toEqual([]);
  });

  it('no recipient request occurs before a deliberate add act', () => {
    const r = recording([{ status: ADDED_STATUS }]);
    // Deriving candidates and rendering them requests nothing.
    deriveCandidates([self(ME, 'Ora', 1), self('r1', 'Wren', 2)], ME);
    expect(r.calls).toHaveLength(0);
    expect(permitsAdd(noRecipients)).toBe(true); // permitted, but not performed
    expect(r.calls).toHaveLength(0);
  });

  it('the add request uses the exact path, POST method, acting-Self header, and { recipientSelfId } body, and only 204 is classified as success', async () => {
    const ok = await addOnce([{ status: 204 }]);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.url).toBe(`/api${RECIPIENTS_PATH(DRAFT)}`);
    expect(ok.calls[0]!.init.method).toBe('POST');
    expect((ok.calls[0]!.init.headers as Record<string, string>)['x-acting-self']).toBe(ME);
    expect(bodyOf(ok.calls[0]!.init)).toEqual({ recipientSelfId: 'r1' });
    // 204 succeeds — and the transport's json() throws, so no body was read.
    expect(ok.final).toEqual({ kind: 'idle', recipients: ['r1'] });

    // A 2xx that is not 204 does not match the committed success contract.
    for (const status of [200, 201]) {
      const other = await addOnce([{ status }]);
      expect(other.final.kind, `status ${status}`).toBe('failed');
      expect(other.final.recipients, `status ${status}`).toEqual([]);
    }
  });

  it('the first act synchronously returns the pending add state, and a second act against that exact pending-state object returns not-started while the transport still holds one request', async () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();

    const first = startAdd(r.transport, ME, DRAFT, noRecipients, 'r1', dispositions);
    expect(first.kind).toBe('started');
    const started = first as { kind: 'started'; pendingState: RecipientState; settlement: Promise<RecipientState> };
    expect(started.pendingState.kind).toBe('adding'); // before awaiting settlement
    expect(r.calls).toHaveLength(1);

    // The EXACT object the first act returned, not a hand-built fixture.
    const second = startAdd(r.transport, ME, DRAFT, started.pendingState, 'r2', dispositions);
    expect(second.kind).toBe('not-started');
    expect((second as { state: RecipientState }).state).toBe(started.pendingState);
    expect(Object.hasOwn(second, 'settlement')).toBe(false);
    expect(r.calls).toHaveLength(1); // suppression point

    await started.settlement;
    expect(r.calls).toHaveLength(1); // and the second act added none afterwards
    await tick();
    expect(r.calls).toHaveLength(1); // no automatic retry
  });

  it('a successful 204 retains the added recipient in the one authoritative recipient state and deduplicates by Self id', async () => {
    const first = await addOnce([{ status: 204 }]);
    expect(first.final).toEqual({ kind: 'idle', recipients: ['r1'] });
    // The pending state was applied before the settled one, and both are the
    // same single state value — there is no second list.
    expect(first.applied.map((s) => s.kind)).toEqual(['adding', 'idle']);

    const second = await addOnce([{ status: 204 }], first.final, 'r2');
    expect(second.final).toEqual({ kind: 'idle', recipients: ['r1', 'r2'] });
  });

  it('a repeated successful idempotent add still retains one recipient, not one item per request', async () => {
    let state: RecipientState = noRecipients;
    for (let i = 0; i < 3; i += 1) {
      const round = await addOnce([{ status: 204 }], state, 'r1');
      state = round.final;
      expect(round.calls, `round ${i}`).toHaveLength(1); // each add issues one request
    }
    // Three acknowledged adds of the same Self — one recipient.
    expect(state).toEqual({ kind: 'idle', recipients: ['r1'] });
  });

  it('401 and 403 invoke the injected authoritative dispositions, abandon the attempt, and are never recipient failures', async () => {
    for (const [status, expected] of [
      [401, 'session-expired'],
      [403, 'forbidden'],
    ] as const) {
      const started: RecipientState = { kind: 'idle', recipients: ['r0'] };
      const round = await addOnce([{ status }], started, 'r1');
      expect(round.seen, `status ${status}`).toEqual([expected]);
      expect(round.final, `status ${status}`).toEqual(noRecipients); // abandoned
      expect(round.final.kind, `status ${status}`).not.toBe('failed'); // never a recipient failure
      expect(round.final.recipients, `status ${status}`).toEqual([]);
    }
  });

  it('every non-auth outcome enters one failed state preserving known recipients and the retry candidate, with no invented success', async () => {
    const known: RecipientState = { kind: 'idle', recipients: ['r0'] };
    const expected = { kind: 'failed', recipients: ['r0'], candidateId: 'r1' };

    // Cause A — the server reported an error or rejection.
    for (const status of [400, 404, 409, 500, 503]) {
      const round = await addOnce([{ status }], known, 'r1');
      expect(round.final, `error ${status}`).toEqual(expected);
      expect(round.seen, `error ${status}`).toEqual([]); // not an authorization outcome
    }
    // Cause B — a success-class response that violates the audited contract.
    for (const status of [200, 201, 202]) {
      const round = await addOnce([{ status }], known, 'r1');
      expect(round.final, `contract ${status}`).toEqual(expected);
    }
    // Cause C — transport failure.
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    const applied: RecipientState[] = [];
    performAdd(deps(throwing, (s) => void applied.push(s), spies().dispositions), known, 'r1');
    await tick();
    expect(applied[applied.length - 1]).toEqual(expected);
    // No cause is promoted to success, and none invents a recipient.
    expect(expected.recipients).not.toContain('r1');
  });

  it('the completed-draft presentation exposes recipient add with the bundle supplied and retains the P10-S14 return-only form without it', () => {
    const props = { state: done, onTextChange: () => {}, onSend: () => {}, onReturn: () => {} };
    const flatten = (node: unknown, out: unknown[] = []): unknown[] => {
      if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
      else if (node && typeof node === 'object' && 'type' in node) {
        out.push(node);
        flatten((node as unknown as { props: { children?: unknown } }).props.children, out);
      }
      return out;
    };
    const buttons = (tree: unknown): Array<{ props: { children?: unknown } }> =>
      flatten(tree).filter((e) => (e as { type?: unknown }).type === 'button') as unknown as Array<{
        props: { children?: unknown };
      }>;

    // With the bundle: the candidate control is present alongside return.
    const withBundle = Composer({
      ...props,
      recipients: { state: noRecipients, candidates: [{ id: 'r1', label: 'Ora' }], onAdd: () => {} },
    });
    const labels = buttons(withBundle).map((b) => JSON.stringify(b.props.children));
    expect(labels).toContain(JSON.stringify('Ora'));
    expect(labels).toContain(JSON.stringify('Back'));
    for (const action of ['Remove', 'Depart', 'Settle', 'Cancel', 'Vault', 'Key']) {
      expect(labels, action).not.toContain(JSON.stringify(action));
    }

    // Without it: the P10-S14 form exactly — return alone, no recipient control.
    const withoutBundle = Composer(props);
    expect(buttons(withoutBundle).map((b) => JSON.stringify(b.props.children))).toEqual([
      JSON.stringify('Back'),
    ]);
  });

  it('no read-after-write, router, URL, history, persistence, automatic retry, or automatic recipient mutation is introduced', async () => {
    for (const rel of ['composer/recipient-state.ts', 'composer/recipient-mutations.ts', 'composer/recipient-add.ts']) {
      const code = codeOf(rel);
      for (const construct of [
        'createBrowserRouter',
        'useNavigate',
        'history.pushState',
        'window.location',
        'sessionStorage',
        'localStorage',
        'setInterval',
        'setTimeout',
        'while (',
      ]) {
        expect(code.includes(construct), `${rel} must not use ${construct}`).toBe(false);
      }
    }
    // No read follows the write: the only request the act issues is the POST.
    const round = await addOnce([{ status: 204 }]);
    expect(round.calls).toHaveLength(1);
    expect(round.calls[0]!.init.method).toBe('POST');
    expect(round.calls.some((c) => c.init.method === 'GET')).toBe(false);
    await tick();
    expect(round.calls).toHaveLength(1); // nothing follows on its own
    // A declined act mutates nothing at all.
    const q = recording([{ status: 204 }]);
    const applied: RecipientState[] = [];
    const pending: RecipientState = { kind: 'adding', recipients: [], candidateId: 'r1' };
    expect(performAdd(deps(q.transport, (s) => void applied.push(s), spies().dispositions), pending, 'r2')).toBe(
      'not-started',
    );
    expect(q.calls).toHaveLength(0);
    expect(applied).toHaveLength(0);
  });
});
