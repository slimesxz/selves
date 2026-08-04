// P10-S16 — the fourteen ratified cases for recipient correction, retained
// draft, and guarded reopen.
//
// Every case observes real requests through a recording transport and real
// dispositions through injected spies, against the production boundaries. None
// mounts anything.
//
// The proof boundary is stated rather than blurred: these prove the pure
// mechanisms and the directly invocable element behavior. They do NOT prove the
// hook-bound App.tsx chain that stores the retained value on Return and restores
// it on reopen. That chain is named individually in the completion report and
// carried to Segment 10.E.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Transport } from '../src/api/transport.ts';
import Composer from '../src/composer/Composer.tsx';
import { startAdd, type Dispositions } from '../src/composer/recipient-add.ts';
import { ADDED_STATUS, RECIPIENTS_PATH } from '../src/composer/recipient-mutations.ts';
import { performRemove, startRemove, type RemoveDeps } from '../src/composer/recipient-remove.ts';
import {
  noRecipients,
  onRemoved,
  permitsAdd,
  permitsRemove,
  type RecipientState,
  type RemovingState,
} from '../src/composer/recipient-state.ts';
import { onReopenDraft, retain, type RetainedDraft } from '../src/composer/retained-draft.ts';
import type { ComposerState } from '../src/composer/state.ts';
import {
  onCompose,
  onLeaveComposer,
  type ComposerSurface,
  type CorrespondencesState,
} from '../src/correspondences/surface.ts';

const here = dirname(fileURLToPath(import.meta.url));
const codeOf = (rel: string): string =>
  readFileSync(resolve(here, '../src', rel), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const ME = 'me';
const DRAFT = 'placement-1';
const ART = 'artifact-1';
const DEPARTED: CorrespondencesState = { kind: 'projection', groups: [] };
const done: ComposerState = { kind: 'created', artifactId: ART, placementId: DRAFT };
const known = (...ids: string[]): RecipientState => ({ kind: 'idle', recipients: ids });

/** Records every request. A 204 answer carries a Response whose json() throws,
 *  so any body read is a failure rather than a silent success. */
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

const deps = (transport: Transport, apply: (s: RecipientState) => void, dispositions: Dispositions): RemoveDeps => ({
  transport,
  actingSelfId: ME,
  placementId: DRAFT,
  apply,
  dispositions,
});

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Settle one removal and return everything observed. */
async function removeOnce(
  steps: Array<{ status: number; body?: unknown }>,
  from: RecipientState = known('r1'),
  targetId = 'r1',
) {
  const r = recording(steps);
  const s = spies();
  const applied: RecipientState[] = [];
  performRemove(deps(r.transport, (x) => void applied.push(x), s.dispositions), from, targetId);
  await tick();
  return { ...r, ...s, applied, final: applied[applied.length - 1]! };
}

describe('P10-S16 recipient correction and retained draft', () => {
  it('the remove request uses the exact path, DELETE method, acting-Self header, and no body, and only 204 is success', async () => {
    const ok = await removeOnce([{ status: 204 }]);
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.url).toBe(`/api${RECIPIENTS_PATH(DRAFT)}/r1`);
    expect(ok.calls[0]!.init.method).toBe('DELETE');
    expect((ok.calls[0]!.init.headers as Record<string, string>)['x-acting-self']).toBe(ME);
    expect(ok.calls[0]!.init.body).toBeUndefined(); // a DELETE carries no body
    expect(ADDED_STATUS).toBe(204);
    expect(ok.final).toEqual({ kind: 'idle', recipients: [] });

    // A 2xx that is not 204 violates the committed contract and is not success.
    for (const status of [200, 201, 202]) {
      const other = await removeOnce([{ status }], known('r1'), 'r1');
      expect(other.final.kind, `status ${status}`).toBe('remove-failed');
      expect(other.final.recipients, `status ${status}`).toEqual(['r1']); // nothing removed
    }
  });

  it('401 and 403 invoke the injected authoritative dispositions, abandon the attempt, and are never removal failures', async () => {
    for (const [status, expected] of [
      [401, 'session-expired'],
      [403, 'forbidden'],
    ] as const) {
      const round = await removeOnce([{ status }], known('r1', 'r2'), 'r1');
      expect(round.seen, `status ${status}`).toEqual([expected]);
      expect(round.final, `status ${status}`).toEqual(noRecipients); // abandoned
      expect(round.final.kind, `status ${status}`).not.toBe('remove-failed');
    }
  });

  it('server rejection, contract-violating 2xx, and transport throw enter one non-auth removal-failure state with causes distinguishable', async () => {
    const expected = { kind: 'remove-failed', recipients: ['r1'], targetId: 'r1' };
    // Cause A — the server reported an error or rejection.
    for (const status of [400, 404, 409, 500, 503]) {
      const round = await removeOnce([{ status }], known('r1'), 'r1');
      expect(round.final, `error ${status}`).toEqual(expected);
      expect(round.seen, `error ${status}`).toEqual([]); // not an authorization outcome
    }
    // Cause B — a success-class response violating the audited contract.
    for (const status of [200, 201]) {
      expect((await removeOnce([{ status }], known('r1'), 'r1')).final, `contract ${status}`).toEqual(expected);
    }
    // Cause C — transport failure.
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    const applied: RecipientState[] = [];
    performRemove(deps(throwing, (s) => void applied.push(s), spies().dispositions), known('r1'), 'r1');
    await tick();
    expect(applied[applied.length - 1]).toEqual(expected);
  });

  it('no request occurs before a deliberate act; the first act returns the exact pending removal state synchronously and a second act against it issues nothing', async () => {
    const r = recording([{ status: 204 }]);
    const { dispositions } = spies();
    expect(r.calls).toHaveLength(0); // constructing state requests nothing

    const first = startRemove(r.transport, ME, DRAFT, known('r1', 'r2'), 'r1', dispositions);
    expect(first.kind).toBe('started');
    const started = first as { kind: 'started'; pendingState: RemovingState; settlement: Promise<RecipientState> };
    expect(started.pendingState.kind).toBe('removing'); // before awaiting settlement
    expect(r.calls).toHaveLength(1);

    const second = startRemove(r.transport, ME, DRAFT, started.pendingState, 'r2', dispositions);
    expect(second.kind).toBe('not-started');
    expect((second as { state: RecipientState }).state).toBe(started.pendingState); // the exact object
    expect(r.calls).toHaveLength(1);

    await started.settlement;
    await tick();
    expect(r.calls).toHaveLength(1); // no automatic retry
  });

  it('removal controls exist only for locally known recipients, and no unknown-recipient request can be issued through the presentation', () => {
    let removed = '';
    const tree = Composer({
      state: done,
      onTextChange: () => {},
      onSend: () => {},
      onReturn: () => {},
      recipients: {
        state: known('r1'),
        candidates: [
          { id: 'r1', label: 'Ora' },
          { id: 'r2', label: 'Wren' },
        ],
        onAdd: () => {},
        known: [{ id: 'r1', label: 'Ora' }], // only what the client holds
        onRemove: (id) => void (removed = id),
      },
    });
    const buttons = flatten(tree).filter((e) => tag(e) === 'button');
    const removeLabels = buttons.map(aria).filter((a) => a.startsWith('Remove recipient'));
    expect(removeLabels).toEqual(['Remove recipient Ora']); // r2 is a candidate, never a removal target
    const control = buttons.find((b) => aria(b) === 'Remove recipient Ora')!;
    (control.props as { onClick: () => void }).onClick();
    expect(removed).toBe('r1');
  });

  it('a successful 204 establishes local absence with no optimistic removal', async () => {
    const r = recording([{ status: 204 }]);
    const applied: RecipientState[] = [];
    performRemove(deps(r.transport, (s) => void applied.push(s), spies().dispositions), known('r1', 'r2'), 'r1');
    // The pending state still holds the recipient: nothing is removed on hope.
    expect(applied).toHaveLength(1);
    expect(applied[0]!.recipients).toEqual(['r1', 'r2']);
    await tick();
    expect(applied[1]).toEqual({ kind: 'idle', recipients: ['r2'] }); // and only the target went
  });

  it('repeated idempotent removal invents no history, and onRemoved is total for an already-absent id', async () => {
    let state: RecipientState = known('r1');
    for (let i = 0; i < 3; i += 1) {
      const round = await removeOnce([{ status: 204 }], state, 'r1');
      state = round.final;
      expect(round.calls, `round ${i}`).toHaveLength(1);
    }
    expect(state).toEqual({ kind: 'idle', recipients: [] }); // no history, no duplicate absence
    // Total: applied to an id the set does not hold, it returns the set unchanged.
    const absent: RemovingState = { kind: 'removing', recipients: ['r2'], targetId: 'r1' };
    expect(onRemoved(absent)).toEqual({ kind: 'idle', recipients: ['r2'] });
  });

  it('at most one recipient mutation is pending at any instant, proven at the request level in both directions', () => {
    const { dispositions } = spies();

    // A removal is outstanding; an add attempted against THAT EXACT pending
    // state, produced by production startRemove, must not start or request.
    const rRemove = recording([{ status: 204 }]);
    const removeStarted = startRemove(rRemove.transport, ME, DRAFT, known('r1'), 'r1', dispositions) as {
      pendingState: RemovingState;
    };
    expect(rRemove.calls).toHaveLength(1);
    const addBlocked = startAdd(rRemove.transport, ME, DRAFT, removeStarted.pendingState, 'r2', dispositions);
    expect(addBlocked.kind).toBe('not-started');
    expect((addBlocked as { state: RecipientState }).state).toBe(removeStarted.pendingState);
    expect(rRemove.calls).toHaveLength(1); // no add request was issued

    // And symmetrically: an add is outstanding, a removal must not begin.
    const rAdd = recording([{ status: 204 }]);
    const addStarted = startAdd(rAdd.transport, ME, DRAFT, known('r1'), 'r2', dispositions) as {
      pendingState: RecipientState;
    };
    expect(rAdd.calls).toHaveLength(1);
    const removeBlocked = startRemove(rAdd.transport, ME, DRAFT, addStarted.pendingState, 'r1', dispositions);
    expect(removeBlocked.kind).toBe('not-started');
    expect((removeBlocked as { state: RecipientState }).state).toBe(addStarted.pendingState);
    expect(rAdd.calls).toHaveLength(1); // no remove request was issued
  });

  it('recipient-add.ts compiles unchanged against the widened RecipientState and cannot begin an add from a pending state', () => {
    // The module names no state kind of its own: it depends on the shared
    // predicate, which is what lets the invariant widen without editing it.
    const add = codeOf('composer/recipient-add.ts');
    for (const kind of ["'removing'", "'remove-failed'", 'switch', 'default:']) {
      expect(add.includes(kind), `recipient-add.ts must not name ${kind}`).toBe(false);
    }
    // Predicate results, asserted in addition to — never instead of — the
    // request-level proof above.
    expect(permitsAdd({ kind: 'removing', recipients: [], targetId: 'r1' })).toBe(false);
    expect(permitsRemove({ kind: 'adding', recipients: [], candidateId: 'r1' })).toBe(false);
    expect(permitsAdd(noRecipients)).toBe(true);
    expect(permitsRemove(noRecipients)).toBe(true);
    expect(permitsAdd({ kind: 'remove-failed', recipients: [], targetId: 'r1' })).toBe(true);
  });

  it('the pure retention boundary creates one retained value from the exact inputs, without duplicating identifiers or recipient state', () => {
    const recipients = known('r1', 'r2');
    const retained = retain(ART, DRAFT, recipients, DEPARTED);

    expect(retained.artifactId).toBe(ART); // the exact identifiers of the completed draft
    expect(retained.placementId).toBe(DRAFT);
    expect(retained.recipients).toBe(recipients); // the exact RecipientState, not a copy
    expect(retained.from).toBe(DEPARTED); // the exact departed state
    expect(Object.keys(retained).sort()).toEqual(['artifactId', 'from', 'placementId', 'recipients']);
    // No Artifact Text and no second recipient list ride along.
    expect(JSON.stringify(retained)).not.toContain('text');
    expect(retain.length).toBe(4);
  });

  it('reopen with retained state restores that exact value, and reopen without it returns the exact same surface', () => {
    const current = onCompose(DEPARTED) as ComposerSurface;
    const retained: RetainedDraft = retain(ART, DRAFT, known('r1'), DEPARTED);

    const reopened = onReopenDraft(current, retained);
    expect(reopened.kind).toBe('composer');
    expect((reopened as ComposerSurface).draft).toBe(retained); // the exact value, not rebuilt
    expect((reopened as ComposerSurface).from).toBe(DEPARTED);

    // No retained draft: the exact same object is returned and nothing opens.
    const unchanged = onReopenDraft(current, null);
    expect(unchanged).toBe(current);
  });

  it('creating, adding, and removing each prevent leave through the production transition, by identity', () => {
    const surface = onCompose(DEPARTED) as ComposerSurface;
    const settled = known('r1');

    expect(
      onLeaveComposer(surface, { kind: 'creating', text: 'a', stage: 'artifact', artifactId: null }, settled),
    ).toBe(surface);
    expect(onLeaveComposer(surface, done, { kind: 'adding', recipients: [], candidateId: 'r1' })).toBe(surface);
    expect(onLeaveComposer(surface, done, { kind: 'removing', recipients: ['r1'], targetId: 'r1' })).toBe(surface);

    // Settled on both axes: leaving restores the exact departed state.
    const left = onLeaveComposer(surface, done, settled);
    expect(left.kind).toBe('correspondences');
    expect((left as { state: CorrespondencesState }).state).toBe(DEPARTED);
  });

  it('no departure, settlement, cancellation, Vault, or Key action is introduced', async () => {
    const round = await removeOnce([{ status: 204 }]);
    for (const path of ['/departure', '/cancellation', '/settlement', '/key-placements', '/keys']) {
      expect(round.calls.some((c) => c.url.includes(path)), path).toBe(false);
    }
    for (const rel of ['composer/recipient-remove.ts', 'composer/retained-draft.ts', 'composer/recipient-mutations.ts']) {
      const code = codeOf(rel);
      for (const path of ['/departure', '/cancellation', '/settlement', '/key-placements']) {
        expect(code.includes(path), `${rel} must not name ${path}`).toBe(false);
      }
    }
    const tree = Composer({
      state: done,
      onTextChange: () => {},
      onSend: () => {},
      onReturn: () => {},
      recipients: { state: known('r1'), candidates: [], onAdd: () => {}, known: [{ id: 'r1', label: 'Ora' }], onRemove: () => {} },
    });
    const labels = flatten(tree)
      .filter((e) => tag(e) === 'button')
      .map((b) => JSON.stringify((b.props as { children?: unknown }).children));
    for (const action of ['Depart', 'Send', 'Settle', 'Cancel', 'Vault', 'Key']) {
      expect(labels.some((l) => l.includes(action)), action).toBe(false);
    }
  });

  it('no persistence, router, URL, history, automatic retry, read-after-return, or read-after-reopen; the correction mechanisms exist while the hook-bound chain and reload recovery stay open', async () => {
    for (const rel of ['composer/recipient-remove.ts', 'composer/retained-draft.ts', 'composer/recipient-state.ts']) {
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
        'fetch(',
      ]) {
        expect(code.includes(construct), `${rel} must not use ${construct}`).toBe(false);
      }
    }
    // Leaving and reopening issue nothing: neither transition takes a transport.
    const r = recording([{ status: 204 }]);
    const surface = onCompose(DEPARTED) as ComposerSurface;
    const retained = retain(ART, DRAFT, known('r1'), DEPARTED);
    onLeaveComposer(surface, done, known('r1'));
    onReopenDraft(surface, retained);
    onReopenDraft(surface, null);
    expect(r.calls).toHaveLength(0);
    // The removal act itself performs no read after its write.
    const round = await removeOnce([{ status: 204 }]);
    expect(round.calls).toHaveLength(1);
    expect(round.calls.some((c) => c.init.method === 'GET')).toBe(false);
    await tick();
    expect(round.calls).toHaveLength(1);
    // The mechanisms compose: a permitted leave yields a retained value, and a
    // reopen restores it exactly. The App.tsx chain that stores and supplies it
    // is NOT proven here and is carried to Segment 10.E; page-reload recovery is
    // separately open, since nothing above touches any persistence API.
    expect((onReopenDraft(surface, retain(ART, DRAFT, known('r1'), DEPARTED)) as ComposerSurface).draft)
      .not.toBeNull();
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
const tag = (e: El): unknown => e.type;
const aria = (e: El): string => String(e.props['aria-label'] ?? '');
