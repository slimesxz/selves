// P10-S9 — the five ratified authentication-gate cases (0012 §43).
//
// These test the constitutionally stable layer: request shape, response
// classification, gate presentation, failure/resubmission transitions, and
// non-persistence. They deliberately do NOT render, require a DOM, or inspect
// markup, layout, styling, copy, or composition — §43 records that pinning
// those is a defect, not coverage, because they evolve through 10.D and 10.E.
//
// This is possible only because the constitutional logic lives in pure modules
// and the rendered gate is a projection over them. If that ever inverts, these
// cases become unprovable without a DOM dependency nobody has authorized.
import { describe, expect, it } from 'vitest';
import { buildAccountRequest, buildSelfRequest, type Transport } from '../src/api/transport.ts';
import * as gate from '../src/auth/gate.ts';
import { outcomeOf, presentsGate } from '../src/auth/session.ts';

/** A transport that records what it was asked to send and answers with a fixed
 *  status. It fabricates no authoritative data — it observes construction. */
function recording(status: number): { transport: Transport; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    transport: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(null, { status }));
    },
  };
}

describe('P10-S9 bootstrap authentication gate', () => {
  it('the authentication request posts /api/auth/session with the secret as its only body field', async () => {
    const { transport, calls } = recording(204);
    await gate.authenticate(transport, 'the-secret');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('/api/auth/session');
    expect(call.init.method).toBe('POST');

    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['secret']); // exactly one field
    expect(body.secret).toBe('the-secret');
    expect(Object.hasOwn(body, 'accountId')).toBe(false); // the server has no parameter for one

    // Account-scoped: structurally incapable of carrying a Self.
    const headers = call.init.headers as Record<string, string>;
    expect(Object.hasOwn(headers, 'x-acting-self')).toBe(false);
    // …while a Self-scoped request does carry it, so absence above is a
    // property of account scope rather than of the builder.
    const selfScoped = buildSelfRequest({ method: 'GET', path: '/artifacts', actingSelf: 'a-self-id' });
    expect((selfScoped.init.headers as Record<string, string>)['x-acting-self']).toBe('a-self-id');
    expect(buildAccountRequest({ method: 'GET', path: '/auth/selves' }).url).toBe('/api/auth/selves');
  });

  it('a 204 response authenticates and every other status yields one undifferentiated failure', async () => {
    expect(gate.classifyAttempt(204)).toBe('authenticated');
    for (const status of [400, 401, 403, 418]) {
      expect(gate.classifyAttempt(status), `status ${status}`).toBe('failed');
    }
    // …end to end, and indistinguishably: every failure is the same value.
    const results = await Promise.all(
      [400, 401, 403, 418].map((s) => gate.authenticate(recording(s).transport, 's')),
    );
    expect(new Set(results).size).toBe(1);
    expect(results.every((r) => r === 'failed')).toBe(true);
    expect(await gate.authenticate(recording(204).transport, 's')).toBe('authenticated');
    // A transport failure is that same single failure, not a further case.
    const throwing: Transport = () => Promise.reject(new Error('network down'));
    expect(await gate.authenticate(throwing, 's')).toBe('failed');
  });

  it('the gate presents on 401 and on no other condition', () => {
    expect(presentsGate(outcomeOf(401))).toBe(true);
    for (const status of [200, 204, 400, 403, 409, 500]) {
      expect(presentsGate(outcomeOf(status)), `status ${status}`).toBe(false);
    }
    // 403 is a valid session asserting an unowned Self: R3's re-verification
    // path (P10-S10), never the gate (P10-M6).
    expect(outcomeOf(403).kind).toBe('forbidden');
    expect(presentsGate({ kind: 'transport-failure' })).toBe(false);
    expect(presentsGate({ kind: 'ok' })).toBe(false);
  });

  it('a failed attempt retains the secret and a new submission clears the failure', () => {
    const typed = gate.withSecret(gate.initialGate, 'typed-secret');
    const failed = gate.onFailure(typed);
    expect(failed.failed).toBe(true);
    expect(failed.secret).toBe('typed-secret'); // retained, not cleared

    const resubmitting = gate.onSubmit(failed);
    expect(resubmitting.failed).toBe(false); // the new attempt clears the failure
    expect(resubmitting.secret).toBe('typed-secret'); // and still keeps the secret

    // No separate retry affordance exists: submitting again IS the retry.
    expect(Object.keys(gate).some((name) => /retry/i.test(name))).toBe(false);
  });

  it('the authentication path persists nothing through any storage API', async () => {
    const trap = (name: string): Storage =>
      new Proxy({} as Storage, {
        get() {
          throw new Error(`${name} was touched`);
        },
        set() {
          throw new Error(`${name} was written`);
        },
      });
    const g = globalThis as Record<string, unknown>;
    const had = { local: 'localStorage' in g, session: 'sessionStorage' in g };
    const prior = { local: g.localStorage, session: g.sessionStorage };
    Object.defineProperty(g, 'localStorage', { value: trap('localStorage'), configurable: true });
    Object.defineProperty(g, 'sessionStorage', { value: trap('sessionStorage'), configurable: true });
    try {
      expect(await gate.authenticate(recording(204).transport, 's')).toBe('authenticated');
      expect(await gate.authenticate(recording(401).transport, 's')).toBe('failed');
      gate.onFailure(gate.withSecret(gate.initialGate, 's'));
      presentsGate(outcomeOf(401));
    } finally {
      if (had.local) Object.defineProperty(g, 'localStorage', { value: prior.local, configurable: true });
      else delete g.localStorage;
      if (had.session) Object.defineProperty(g, 'sessionStorage', { value: prior.session, configurable: true });
      else delete g.sessionStorage;
    }
  });
});
