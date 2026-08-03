// P10-S13 — the nine ratified cases for the Composer's first creating act.
//
// Every case observes real requests through a recording transport and real
// dispositions through injected spies, against the production `startCreation`
// boundary. None renders, requires a DOM, or inspects markup.
//
// What they therefore do NOT prove is named individually in the completion
// report: that a rendered Composer invokes this boundary, that Send is bound to
// it, that a real call site supplies the concrete authorization transitions,
// and that the caller applies `pendingState` before awaiting settlement. Those
// belong to the next Composer-surface sub-step or Segment 10.E.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Transport } from '../src/api/transport.ts';
import { startCreation, type Dispositions } from '../src/composer/create.ts';
import { ARTIFACTS_PATH, PLACEMENTS_PATH } from '../src/composer/mutations.ts';
import { initialComposer, nextRequest, withText, type ComposerState } from '../src/composer/state.ts';

const here = dirname(fileURLToPath(import.meta.url));
const codeOf = (rel: string): string =>
  readFileSync(resolve(here, '../src', rel), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const ME = 'acting-self';
const composed = (text: string): ComposerState => withText(initialComposer, text);

/** Answers each call in turn, recording every request it receives. */
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

const created = (id: string) => ({ status: 201, body: { id } });

/** Dispositions that record invocation instead of acting. */
function spies() {
  const seen: string[] = [];
  const dispositions: Dispositions = {
    onSessionExpired: () => void seen.push('session-expired'),
    onForbidden: () => void seen.push('forbidden'),
  };
  return { seen, dispositions };
}

/** Settle the microtask queue so a late request would be observable. */
const tick = (): Promise<void> => Promise.resolve().then(() => undefined);

const bodyOf = (init: RequestInit): Record<string, unknown> =>
  JSON.parse(init.body as string) as Record<string, unknown>;

describe('P10-S13 Composer creation', () => {
  it('the composing state issues no request until the deliberate act, and empty or whitespace-only text cannot begin it', () => {
    const r = recording([created('a1')]);
    const { dispositions } = spies();

    // Merely composing requests nothing: no act has occurred.
    expect(nextRequest(composed('a letter'))).toBe('artifact');
    expect(r.calls).toHaveLength(0);

    for (const text of ['', '   ', '\n\t ']) {
      const start = startCreation(r.transport, ME, composed(text), dispositions);
      expect(start.kind, JSON.stringify(text)).toBe('not-started');
      expect(nextRequest(composed(text)), JSON.stringify(text)).toBeNull();
    }
    expect(r.calls).toHaveLength(0); // a declined act issues nothing
  });

  it('the creating act issues POST /artifacts first, and POST /placements only after an authoritative artifactId', async () => {
    const r = recording([created('artifact-1'), created('placement-1')]);
    const start = startCreation(r.transport, ME, composed('a letter'), spies().dispositions);
    expect(start.kind).toBe('started');
    const settled = await (start as { settlement: Promise<ComposerState> }).settlement;

    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]!.url).toContain(ARTIFACTS_PATH);
    expect(r.calls[0]!.init.method).toBe('POST');
    expect(bodyOf(r.calls[0]!.init)).toEqual({ text: 'a letter' });
    expect(r.calls[1]!.url).toContain(PLACEMENTS_PATH);
    // The second request carries exactly the authoritative id the first returned.
    expect(bodyOf(r.calls[1]!.init)).toEqual({ artifactId: 'artifact-1' });
    expect(settled).toEqual({ kind: 'created', artifactId: 'artifact-1', placementId: 'placement-1' });

    // A failing Artifact stage never reaches the Placement stage.
    const f = recording([{ status: 500 }]);
    await (
      startCreation(f.transport, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toContain(ARTIFACTS_PATH);
  });

  it('the slice issues no recipient request and no departure, cancellation, settlement, Vault, or Key request', async () => {
    const r = recording([created('artifact-1'), created('placement-1')]);
    await (
      startCreation(r.transport, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;

    const urls = r.calls.map((c) => c.url);
    for (const forbidden of ['/recipients', '/departure', '/cancellation', '/settlement', '/key-placements', '/keys']) {
      expect(urls.some((u) => u.includes(forbidden)), forbidden).toBe(false);
    }
    expect(urls).toEqual([`/api${ARTIFACTS_PATH}`, `/api${PLACEMENTS_PATH}`]);
    // And no such ROUTE PATH is named anywhere in the owned production source.
    // The patterns carry their leading slash deliberately: a bare-word check
    // matched `settlement` as the promise field name in create.ts, which is not
    // the /placements/:id/settlement route. Path form is what a request carries.
    for (const rel of ['composer/mutations.ts', 'composer/create.ts', 'composer/state.ts']) {
      const code = codeOf(rel);
      for (const path of ['/recipients', '/departure', '/cancellation', '/settlement', '/key-placements']) {
        expect(code.includes(path), `${rel} must not name ${path}`).toBe(false);
      }
    }
  });

  it('successful completion retains both authoritative ids, persists neither, and emits no presentation instruction merely because they exist', async () => {
    const r = recording([created('artifact-1'), created('placement-1')]);
    const settled = await (
      startCreation(r.transport, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;

    expect(settled).toEqual({ kind: 'created', artifactId: 'artifact-1', placementId: 'placement-1' });
    // Exactly three keys: two ids and the discriminant. No display, visibility,
    // navigation, or surface instruction rides along.
    expect(Object.keys(settled).sort()).toEqual(['artifactId', 'kind', 'placementId']);
    // Nothing persists: no storage API is named in any owned production path.
    for (const rel of ['composer/mutations.ts', 'composer/create.ts', 'composer/state.ts']) {
      const code = codeOf(rel);
      for (const api of ['sessionStorage', 'localStorage', 'document.cookie', 'indexedDB']) {
        expect(code.includes(api), `${rel} must not use ${api}`).toBe(false);
      }
    }
  });

  it('401 and 403 are classified for and invoke the injected authoritative session-expired and forbidden dispositions, abandon the local attempt, and are never classified as creation failures', async () => {
    for (const [status, expected] of [
      [401, 'session-expired'],
      [403, 'forbidden'],
    ] as const) {
      // At the Artifact stage.
      const atArtifact = spies();
      const a = recording([{ status }]);
      const settledA = await (
        startCreation(a.transport, ME, composed('a letter'), atArtifact.dispositions) as {
          settlement: Promise<ComposerState>;
        }
      ).settlement;
      expect(atArtifact.seen, `artifact ${status}`).toEqual([expected]);
      expect(settledA, `artifact ${status}`).toEqual(initialComposer); // the attempt is abandoned
      expect(settledA.kind, `artifact ${status}`).not.toBe('failed'); // never a creation failure
      expect(a.calls, `artifact ${status}`).toHaveLength(1);

      // And at the Placement stage, after an authoritative Artifact id exists.
      const atPlacement = spies();
      const p = recording([created('artifact-1'), { status }]);
      const settledP = await (
        startCreation(p.transport, ME, composed('a letter'), atPlacement.dispositions) as {
          settlement: Promise<ComposerState>;
        }
      ).settlement;
      expect(atPlacement.seen, `placement ${status}`).toEqual([expected]);
      expect(settledP, `placement ${status}`).toEqual(initialComposer);
      expect(settledP.kind, `placement ${status}`).not.toBe('failed');
    }
  });

  it('non-auth failure is one state recording the failed stage, preserving the composed text and any authoritative artifactId, and inventing no placementId', async () => {
    // Artifact stage: every non-auth outcome yields the same failure shape.
    for (const step of [
      { status: 400 },
      { status: 404 },
      { status: 409 },
      { status: 500 },
      { status: 201, body: { no: 'id' } }, // malformed success body
    ]) {
      const r = recording([step]);
      const settled = await (
        startCreation(r.transport, ME, composed('a letter'), spies().dispositions) as {
          settlement: Promise<ComposerState>;
        }
      ).settlement;
      expect(settled, JSON.stringify(step)).toEqual({
        kind: 'failed',
        text: 'a letter',
        stage: 'artifact',
        artifactId: null,
      });
    }
    // A transport throw is the same failure.
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    const thrown = await (
      startCreation(throwing, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(thrown).toEqual({ kind: 'failed', text: 'a letter', stage: 'artifact', artifactId: null });

    // Placement stage: the authoritative Artifact id is preserved and no
    // placementId is invented.
    const p = recording([created('artifact-1'), { status: 409 }]);
    const settled = await (
      startCreation(p.transport, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(settled).toEqual({ kind: 'failed', text: 'a letter', stage: 'placement', artifactId: 'artifact-1' });
    expect(JSON.stringify(settled)).not.toContain('placementId');
  });

  it('the first deliberate act synchronously returns the creating state and one settlement attempt; a second act against that produced pending state returns not-started, issues no request, and no automatic retry follows settlement', async () => {
    const r = recording([created('artifact-1'), created('placement-1')]);
    const { dispositions } = spies();

    // 1. the first act is accepted.
    const first = startCreation(r.transport, ME, composed('a letter'), dispositions);
    expect(first.kind).toBe('started');
    const started = first as { kind: 'started'; pendingState: ComposerState; settlement: Promise<ComposerState> };

    // 2. the pending state is `creating` BEFORE settlement is awaited.
    expect(started.pendingState.kind).toBe('creating');
    // 3. transport began only for that accepted start.
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toContain(ARTIFACTS_PATH);

    // 4. the second act is invoked with the EXACT object the first returned.
    const second = startCreation(r.transport, ME, started.pendingState, dispositions);
    // 5. it is declined.
    expect(second.kind).toBe('not-started');
    expect((second as { state: ComposerState }).state).toBe(started.pendingState); // identity, not a copy
    // 6. exactly one request exists at the point suppression is asserted.
    expect(r.calls).toHaveLength(1);
    // …and no second settlement attempt was produced.
    expect(Object.hasOwn(second, 'settlement')).toBe(false);

    // 7. the second act adds no request before or after the first settlement.
    const settled = await started.settlement;
    expect(settled.kind).toBe('created');
    expect(r.calls).toHaveLength(2); // the Artifact POST and the Placement POST, and no third

    // 8. no automatic retry follows settlement.
    await tick();
    await tick();
    expect(r.calls).toHaveLength(2);
    // A failed settlement likewise retries nothing on its own.
    const f = recording([{ status: 500 }]);
    const failed = await (
      startCreation(f.transport, ME, composed('a letter'), dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(failed.kind).toBe('failed');
    await tick();
    expect(f.calls).toHaveLength(1);
  });

  it('retry resumes from the last authoritative boundary and never creates a second Artifact after the first succeeded', async () => {
    // First act: the Artifact succeeds, the Placement fails.
    const first = recording([created('artifact-1'), { status: 500 }]);
    const failed = await (
      startCreation(first.transport, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(failed).toEqual({ kind: 'failed', text: 'a letter', stage: 'placement', artifactId: 'artifact-1' });
    expect(first.calls).toHaveLength(2);

    // A later deliberate act against that settled state retries the Placement
    // alone, reusing the authoritative id.
    expect(nextRequest(failed)).toBe('placement');
    const retry = recording([created('placement-1')]);
    const settled = await (
      startCreation(retry.transport, ME, failed, spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(retry.calls).toHaveLength(1);
    expect(retry.calls[0]!.url).toContain(PLACEMENTS_PATH);
    expect(retry.calls.some((c) => c.url.includes(ARTIFACTS_PATH))).toBe(false); // no second Artifact
    expect(bodyOf(retry.calls[0]!.init)).toEqual({ artifactId: 'artifact-1' });
    expect(settled).toEqual({ kind: 'created', artifactId: 'artifact-1', placementId: 'placement-1' });

    // Where the Artifact stage never succeeded, retry begins at the Artifact.
    const early = recording([{ status: 500 }]);
    const earlyFailed = await (
      startCreation(early.transport, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(nextRequest(earlyFailed)).toBe('artifact');
  });

  it('a completed draft issues no further creation request', async () => {
    const r = recording([created('artifact-1'), created('placement-1')]);
    const settled = await (
      startCreation(r.transport, ME, composed('a letter'), spies().dispositions) as {
        settlement: Promise<ComposerState>;
      }
    ).settlement;
    expect(settled.kind).toBe('created');
    expect(r.calls).toHaveLength(2);

    expect(nextRequest(settled)).toBeNull();
    const again = startCreation(r.transport, ME, settled, spies().dispositions);
    expect(again.kind).toBe('not-started');
    expect(r.calls).toHaveLength(2); // unchanged
    await tick();
    expect(r.calls).toHaveLength(2);
  });
});
