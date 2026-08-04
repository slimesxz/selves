// P10-S14 — the eight ratified cases for the Composer surface.
//
// The client runner has no DOM implementation installed, so these prove what
// the available boundaries actually expose: the pure surface transitions, the
// pure act, and the Composer element produced by direct invocation and by
// react-dom/server. They mount nothing and click nothing.
//
// What they therefore do NOT prove is named individually in the completion
// report. Above all: that App supplies `performSend` as the Composer's real
// `onSend`. Both ends of that link are proven here; the hook-bound link between
// them is not, and belongs to Segment 10.E.
import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Transport } from '../src/api/transport.ts';
import Composer from '../src/composer/Composer.tsx';
import { performSend, type ActDeps } from '../src/composer/act.ts';
import type { Dispositions } from '../src/composer/create.ts';
import { initialComposer, withText, type ComposerState } from '../src/composer/state.ts';
import {
  onCompose,
  onLeaveComposer,
  type ComposerSurface,
  type CorrespondencesState,
  type Surface,
} from '../src/correspondences/surface.ts';

/** A departed Correspondences state distinct enough that reconstruction shows. */
const DEPARTED: CorrespondencesState = { kind: 'projection', groups: [] };

const composing = (text: string): ComposerState => withText(initialComposer, text);
const creating = (text: string, artifactId: string | null = null): ComposerState => ({
  kind: 'creating',
  text,
  stage: artifactId === null ? 'artifact' : 'placement',
  artifactId,
});
const failed = (text: string, artifactId: string | null = null): ComposerState => ({
  kind: 'failed',
  text,
  stage: artifactId === null ? 'artifact' : 'placement',
  artifactId,
});
const done: ComposerState = { kind: 'created', artifactId: 'artifact-1', placementId: 'placement-1' };

function recording(steps: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    return Promise.resolve(
      step.body === undefined
        ? new Response(null, { status: step.status })
        : new Response(JSON.stringify(step.body), { status: step.status }),
    );
  };
  return { calls, transport };
}

const noDispositions: Dispositions = { onSessionExpired: () => {}, onForbidden: () => {} };

/** Direct invocation: the component is hook-free, so calling it yields the real
 *  element tree with real handler props — no DOM, no mounting. */
type El = ReactElement<{ children?: unknown; onClick?: () => void; type?: string }>;
const invoke = (props: Parameters<typeof Composer>[0]): El => Composer(props) as El;
function descendants(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) descendants(n, out);
    return out;
  }
  if (node && typeof node === 'object' && 'type' in node) {
    const el = node as El;
    out.push(el);
    descendants(el.props.children, out);
  }
  return out;
}
const buttonLabelled = (tree: El, label: string): El | undefined =>
  descendants(tree).find((e) => e.type === 'button' && JSON.stringify(e.props.children) === JSON.stringify(label));

const markup = (state: ComposerState): string =>
  renderToStaticMarkup(
    createElement(Composer, { state, onTextChange: () => {}, onSend: () => {}, onReturn: () => {} }),
  );

const noop = { onTextChange: () => {}, onSend: () => {}, onReturn: () => {} };

describe('P10-S14 Composer surface', () => {
  it('Compose enters the Composer in its initial composing state with empty text, and no request occurs because the surface opened', () => {
    const r = recording([{ status: 201, body: { id: 'x' } }]);
    const opened = onCompose(DEPARTED);

    // P10-Q4 compatibility edit K1 (P10-S16), cause: the retained-draft surface
    // shape. P10-S16 widens the Composer surface to carry the exact retained
    // draft-management value a guarded reopen restores. Compose opens fresh, so
    // that value is null here; the assertion stays exact rather than kind-only.
    expect(opened).toEqual({ kind: 'composer', from: DEPARTED, draft: null });
    expect((opened as ComposerSurface).from).toBe(DEPARTED); // the exact departed state
    // Opening is a surface transition and nothing else: it takes no transport
    // and can therefore issue nothing.
    expect(onCompose.length).toBe(1);
    expect(r.calls).toHaveLength(0);
    // The Composer opens empty.
    expect(initialComposer).toEqual({ kind: 'composing', text: '' });
    // No counterpart is selected and no recipient is pre-filled.
    expect(JSON.stringify(opened)).not.toContain('selected');
    expect(JSON.stringify(opened)).not.toContain('recipient');
  });

  it('onLeaveComposer returns the departed Correspondences state from composing, failed, and created, and the exact same surface while creating', () => {
    const composerSurface = onCompose(DEPARTED) as ComposerSurface;
    const settledRecipients = { kind: 'idle', recipients: [] } as const;

    for (const [label, state] of [
      ['composing', composing('a letter')],
      ['failed', failed('a letter', 'artifact-1')],
      ['created', done],
    ] as const) {
      // P10-Q4 compatibility edit K2 (P10-S16), cause: the leave-while-pending
      // ruling widened this transition to receive the authoritative recipient
      // state. Settled recipient state leaves exactly as before.
      const returned = onLeaveComposer(composerSurface, state, settledRecipients);
      expect(returned.kind, label).toBe('correspondences');
      expect((returned as { state: CorrespondencesState }).state, label).toBe(DEPARTED); // exact, not rebuilt
      expect(JSON.stringify(returned), label).not.toContain('pending'); // no refresh is provoked
    }

    // Creating cannot leave — and the guard returns the SAME object, so a
    // reconstruction that silently altered `from` would fail here.
    const held = onLeaveComposer(composerSurface, creating('a letter'), settledRecipients);
    expect(held).toBe(composerSurface);

    // K2 extension: an unsettled recipient mutation refuses departure too, by
    // the same identity guarantee.
    for (const [label, recipients] of [
      ['adding', { kind: 'adding', recipients: [], candidateId: 'r1' } as const],
      ['removing', { kind: 'removing', recipients: ['r1'], targetId: 'r1' } as const],
    ] as const) {
      expect(onLeaveComposer(composerSurface, done, recipients), label).toBe(composerSurface);
    }

    // The transition takes no transport and names no navigation machinery.
    const forbidden = ['history', 'pushState', 'location', 'URL(', 'sessionStorage', 'localStorage', 'fetch('];
    const src = onLeaveComposer.toString() + onCompose.toString();
    for (const construct of forbidden) expect(src.includes(construct), construct).toBe(false);
  });

  it('the Composer renders the ruled controls for each of the four states and no others, and offers an edit affordance only while composing', () => {
    const composingMarkup = markup(composing('a letter'));
    expect(composingMarkup).toContain('<textarea');
    expect(composingMarkup).toContain('Send');
    expect(composingMarkup).toContain('Back');

    const creatingMarkup = markup(creating('a letter'));
    expect(creatingMarkup).not.toContain('<textarea'); // no edit affordance
    expect(creatingMarkup).not.toContain('Send'); // no second Send
    expect(creatingMarkup).not.toContain('Back'); // no return while creating

    const failedMarkup = markup(failed('a letter', 'artifact-1'));
    expect(failedMarkup).not.toContain('<textarea'); // preserved, not editable
    expect(failedMarkup).toContain('a letter'); // preserved
    expect(failedMarkup).toContain('Send'); // retry
    expect(failedMarkup).toContain('Back');

    const createdMarkup = markup(done);
    expect(createdMarkup).not.toContain('<textarea');
    expect(createdMarkup).not.toContain('Send');
    expect(createdMarkup).toContain('Back');
  });

  it('Send is unavailable when the trimmed text is empty and available otherwise', () => {
    for (const text of ['', '   ', '\n\t ']) {
      expect(markup(composing(text)), JSON.stringify(text)).not.toContain('Send');
      expect(buttonLabelled(invoke({ state: composing(text), ...noop }), 'Send'), JSON.stringify(text)).toBeUndefined();
    }
    expect(markup(composing('a'))).toContain('Send');
    expect(buttonLabelled(invoke({ state: composing('a'), ...noop }), 'Send')).toBeDefined();
    // A failed placement stage retries even though its text is not re-read.
    expect(buttonLabelled(invoke({ state: failed('a letter', 'artifact-1'), ...noop }), 'Send')).toBeDefined();
  });

  it('the Send control carries the exact onSend callback supplied to the Composer, and firing the extracted handler invokes that callback exactly once', () => {
    let fired = 0;
    const onSend = (): void => void (fired += 1);
    const tree = invoke({ state: composing('a letter'), onTextChange: () => {}, onSend, onReturn: () => {} });

    const send = buttonLabelled(tree, 'Send');
    expect(send).toBeDefined();
    // Identity: the element carries the supplied callback itself, not a wrapper
    // that might do something else on the way.
    expect(send!.props.onClick).toBe(onSend);
    send!.props.onClick!();
    expect(fired).toBe(1);

    // Back likewise carries the supplied return callback and nothing else.
    let returned = 0;
    const onReturn = (): void => void (returned += 1);
    const back = buttonLabelled(
      invoke({ state: composing('a letter'), onTextChange: () => {}, onSend: () => {}, onReturn }),
      'Back',
    );
    expect(back!.props.onClick).toBe(onReturn);
    back!.props.onClick!();
    expect(returned).toBe(1);
  });

  it('performSend invokes startCreation exactly once, applies the exact pendingState object before settlement resolves, and applies the settled state afterwards', async () => {
    const r = recording([
      { status: 201, body: { id: 'artifact-1' } },
      { status: 201, body: { id: 'placement-1' } },
    ]);
    const applied: ComposerState[] = [];
    const deps: ActDeps = {
      transport: r.transport,
      actingSelfId: 'me',
      apply: (s) => void applied.push(s),
      dispositions: noDispositions,
    };

    const result = performSend(deps, composing('a letter'));
    expect(result).toBe('started');
    // Synchronously — before any await — the creating state has been applied.
    expect(applied).toHaveLength(1);
    expect(applied[0]!.kind).toBe('creating');
    expect(r.calls).toHaveLength(1); // startCreation ran exactly once

    // Settlement applies the later state, and only then.
    await new Promise((resolve) => setImmediate(resolve));
    expect(applied).toHaveLength(2);
    expect(applied[1]).toEqual({ kind: 'created', artifactId: 'artifact-1', placementId: 'placement-1' });
    expect(r.calls).toHaveLength(2);

    // A declined act applies nothing and issues nothing.
    const q = recording([{ status: 201, body: { id: 'x' } }]);
    const none: ComposerState[] = [];
    expect(
      performSend(
        { transport: q.transport, actingSelfId: 'me', apply: (s) => void none.push(s), dispositions: noDispositions },
        composing('   '),
      ),
    ).toBe('not-started');
    expect(none).toHaveLength(0);
    expect(q.calls).toHaveLength(0);
  });

  it('the completed-draft state presents Draft created, displays neither identifier, and offers no recipient, departure, settlement, cancellation, Vault, or Key action', () => {
    const out = markup(done);
    expect(out).toContain('Draft created');
    expect(out).not.toContain('artifact-1');
    expect(out).not.toContain('placement-1');
    for (const action of ['Recipient', 'recipient', 'Depart', 'Settle', 'Cancel', 'Vault', 'Key']) {
      expect(out.includes(action), action).toBe(false);
    }
    // P10-Q4 compatibility edit (P10-S15): the exact button count is replaced by
    // assertions over control identity, because P10-S15 expands this same state
    // to expose recipient add. The behavioral purpose is unchanged — the state
    // exposes return and no unauthorized lifecycle action — and a count would
    // only become brittle again.
    let added = '';
    const tree = invoke({
      state: done,
      ...noop,
      recipients: {
        state: { kind: 'idle', recipients: [] } as const,
        candidates: [{ id: 'r1', label: 'Ora' }],
        onAdd: (id) => void (added = id),
      },
    });
    expect(buttonLabelled(tree, 'Back')).toBeDefined(); // return remains
    const add = buttonLabelled(tree, 'Ora'); // the lawful recipient-add control
    expect(add).toBeDefined();
    add!.props.onClick!(); // and it adds that candidate, not something else
    expect(added).toBe('r1');
    for (const action of ['Remove', 'Depart', 'Settle', 'Cancel', 'Vault', 'Key']) {
      expect(buttonLabelled(tree, action), action).toBeUndefined(); // no unauthorized lifecycle action
    }
  });

  it('the surface, act, and component introduce no router, URL, history, persistence, or automatic read', () => {
    const sources: Array<[string, string]> = [
      ['onCompose', onCompose.toString()],
      ['onLeaveComposer', onLeaveComposer.toString()],
      ['performSend', performSend.toString()],
      ['Composer', Composer.toString()],
    ];
    for (const [label, src] of sources) {
      for (const construct of [
        'createBrowserRouter',
        'useNavigate',
        'history.pushState',
        'window.location',
        'sessionStorage',
        'localStorage',
        'setInterval',
        'setTimeout',
        'readCorrespondences',
      ]) {
        expect(src.includes(construct), `${label} must not use ${construct}`).toBe(false);
      }
    }
    // Rendering any Composer state issues nothing: the component receives no
    // transport and cannot reach one.
    const r = recording([{ status: 201, body: { id: 'x' } }]);
    for (const state of [composing('a'), creating('a'), failed('a'), done]) markup(state);
    expect(r.calls).toHaveLength(0);
  });
});
