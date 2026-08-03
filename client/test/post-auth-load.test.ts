// P10-S12.3 — the six ratified cases for the authoritative account load.
//
// These prove the load's classification, its single-request discipline, its
// storage-freedom, and the selection consequence. They do not render, require a
// DOM, or inspect markup.
//
// What they therefore do NOT prove is named individually in the completion
// report: that App applies the loaded list before post-authentication rendering
// is a mounted-render binding, and it belongs to Segment 10.E.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Transport } from '../src/api/transport.ts';
import { loadSelves, presentsSelectionAfterLoad, SELVES_PATH, type LoadOutcome } from '../src/self/load.ts';
import { presentsSelection } from '../src/self/active.ts';
import type { SelfSummary } from '../src/self/selves.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, '../src', rel), 'utf8');
/** Comments describe the prohibitions; only code may be asserted against them. */
const codeOf = (rel: string): string =>
  read(rel)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const self = (id: string, name: string, slot: number): SelfSummary => ({ id, name, slot });

/** A transport that records every call it receives. */
function recording(status: number, body?: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      body === undefined ? new Response(null, { status }) : new Response(JSON.stringify(body), { status }),
    );
  };
  return { calls, transport };
}

describe('P10-S12.3 post-authentication account load', () => {
  it('a successful load yields the authoritative SelfSummary[] parsed from the response body', async () => {
    const listed = [self('s1', 'Ora', 1), self('s2', 'Wren', 2)];
    const outcome = await loadSelves(recording(200, listed).transport);

    expect(outcome.kind).toBe('listed');
    expect(outcome.kind === 'listed' && outcome.selves).toEqual(listed);
    // The list is the authoritative one from the response, not a fabrication:
    // a different body yields a different list, and an empty body yields none.
    const empty = await loadSelves(recording(200, []).transport);
    expect(empty).toEqual({ kind: 'listed', selves: [] });
  });

  it('a 401 load yields the unauthenticated outcome and no list, and is not a transport failure', async () => {
    const outcome = await loadSelves(recording(401).transport);

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(outcome.kind).not.toBe('listed');
    expect(outcome.kind).not.toBe('unavailable'); // 401 is not a data failure
    expect(JSON.stringify(outcome)).not.toContain('selves');
  });

  it('a non-auth failure yields no list and is not an authentication outcome', async () => {
    const throwing: Transport = () => Promise.reject(new Error('offline'));
    const malformed = recording(200, { not: 'an array' }).transport;
    for (const [label, transport] of [
      ['500', recording(500).transport],
      ['503', recording(503).transport],
      ['400', recording(400).transport],
      ['403', recording(403).transport],
      ['throw', throwing],
    ] as const) {
      const outcome = await loadSelves(transport);
      expect(outcome, label).toEqual({ kind: 'unavailable' });
      expect(outcome.kind, label).not.toBe('unauthenticated');
    }
    // A 2xx carrying a non-array body parses to no Selves rather than to an
    // authentication outcome.
    expect((await loadSelves(malformed)).kind).not.toBe('unauthenticated');
  });

  it('the load issues exactly one request and introduces no retry, interval, or automatic re-authentication', async () => {
    for (const status of [200, 401, 500]) {
      const r = recording(status, status === 200 ? [] : undefined);
      await loadSelves(r.transport);
      expect(r.calls.length, `status ${status}`).toBe(1); // one per call, failure included
      expect(r.calls[0]!.url, `status ${status}`).toContain(SELVES_PATH);
      expect(r.calls[0]!.init.method, `status ${status}`).toBe('GET');
    }
    // No retry or scheduling machinery exists in either changed production path.
    for (const rel of ['self/load.ts', 'App.tsx']) {
      const code = codeOf(rel);
      for (const construct of [
        'setInterval',
        'setTimeout',
        'addEventListener',
        'requestAnimationFrame',
        'while (',
        'authenticate(',
      ]) {
        expect(code.includes(construct), `${rel} must not use ${construct}`).toBe(false);
      }
    }
    // The post-authentication path calls the load exactly once.
    expect([...codeOf('App.tsx').matchAll(/loadSelves\(/g)]).toHaveLength(2); // mount + post-auth
  });

  it('the loader consults no persisted storage, so restore remains at one call site and the P10-S11 loop proof is untouched', async () => {
    // A storage global that throws if touched at all.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('sessionStorage touched');
      },
    });
    try {
      await expect(loadSelves(recording(200, [self('s1', 'Ora', 1)]).transport)).resolves.toEqual({
        kind: 'listed',
        selves: [self('s1', 'Ora', 1)],
      });
      await expect(loadSelves(recording(401).transport)).resolves.toEqual({ kind: 'unauthenticated' });
    } finally {
      if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
      else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    }
    // Source-level: the loader names no storage API, and restore keeps exactly
    // one call site — inside the one-time mount effect, whose key stays [].
    const loader = codeOf('self/load.ts');
    for (const api of ['sessionStorage', 'localStorage', 'restore(', 'remember(', 'forget(']) {
      expect(loader.includes(api), `load.ts must not use ${api}`).toBe(false);
    }
    expect([...codeOf('App.tsx').matchAll(/restore\(/g)]).toHaveLength(1);
    expect(codeOf('App.tsx')).toContain('}, []);');
  });

  it('an authoritative non-empty list with no active Self presents selection, and the empty shell is reached only on an empty list', async () => {
    const listed = await loadSelves(recording(200, [self('s1', 'Ora', 1)]).transport);
    expect(presentsSelectionAfterLoad(listed)).toBe(true);
    expect(presentsSelection(null)).toBe(true); // no active Self after authenticating

    // The shell falls through only where no authoritative list was obtained —
    // not merely because the one-time mount effect already ran.
    for (const outcome of [
      { kind: 'unavailable' },
      { kind: 'unauthenticated' },
      { kind: 'listed', selves: [] },
    ] as LoadOutcome[]) {
      expect(presentsSelectionAfterLoad(outcome), outcome.kind).toBe(false);
    }
  });
});
