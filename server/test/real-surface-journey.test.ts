// P10-CB1 — the minimum real-surface Class B observation. CONSTRUCTION ONLY.
//
// Nothing here is evidence. A constructed test is not evidence, a discoverable
// test is not evidence, and a type-correct test is not evidence. Only a
// separately authorized execution produces an observation, and only a separate
// classification act may say what that observation disposes. No case below
// asserts that a Playbook acceptance criterion is met, that a 0012 §62.E
// closure item is met, that a Class B binding is disposed, or that any open
// mounted binding is closed.
//
// WHAT IT OBSERVES
//
// One coherent production journey across the real HTTP boundary: production
// client code constructs every request, real `fetch` carries it over a real
// socket, and the production server decides every outcome. The journey is the
// smallest one that reaches more than one governing requirement — authenticated
// entry, an acting Self, a Self-scoped authoritative read, a sibling-Self
// transition, the authorization consequence of that transition, a rejected
// acting-Self assertion, and authoritative state observed after a permitted
// write. It is not an end-to-end framework and sweeps no surface.
//
// WHAT IT DOES NOT OBSERVE
//
// `App.tsx` never mounts here. Its `browserTransport` is a module-level
// constant and `App` takes no props, so no origin can reach it without editing
// production source, replacing global `fetch`, or running a real browser — all
// outside this gate. Nothing below speaks to any proposition whose object is
// "App supplies …", and the apparatus is not capable of reaching one.
//
// Browser-agent semantics — reload persistence, address-bar navigation, cookie
// policy, `__Host-` attributes, CORS enforcement — are emulated by the harness
// rather than exercised, and remain the real-browser venue's object.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendSelf } from '../../client/src/api/transport.ts';
import { authenticate } from '../../client/src/auth/gate.ts';
import { fetchArtifactCount } from '../../client/src/prism/count.ts';
import { loadSelves, presentsSelectionAfterLoad } from '../../client/src/self/load.ts';
import { startRealSurface, type RealSurface } from './helpers/real-surface.ts';

describe('P10-CB1 real-surface Class B apparatus — production client over a real socket', () => {
  let s: RealSurface;

  beforeAll(async () => {
    s = await startRealSurface();
  });

  afterAll(async () => {
    await s.end();
  });

  it('before authentication the account read is the 401 transition, not a data failure', async () => {
    s.forgetSession();
    const outcome = await loadSelves(s.transport);
    expect(outcome.kind).toBe('unauthenticated');
  });

  it('authenticated entry: the production login act succeeds over the real boundary', async () => {
    s.forgetSession();
    const result = await authenticate(s.transport, s.secretA);
    expect(result).toBe('authenticated');
  });

  it('a wrong secret is the single undifferentiated failure, and establishes no session', async () => {
    s.forgetSession();
    expect(await authenticate(s.transport, 'not-the-enrolled-secret')).toBe('failed');
    expect((await loadSelves(s.transport)).kind).toBe('unauthenticated');
  });

  it('acting-Self establishment: the authoritative Self list arrives from the server', async () => {
    s.forgetSession();
    await authenticate(s.transport, s.secretA);

    const outcome = await loadSelves(s.transport);
    expect(outcome.kind).toBe('listed');
    if (outcome.kind !== 'listed') return;

    expect(presentsSelectionAfterLoad(outcome)).toBe(true);
    const ids = outcome.selves.map((self) => self.id).sort();
    expect(ids).toStrictEqual([s.selfA, s.siblingA].sort());
    expect(ids).not.toContain(s.selfB);
  });

  it('a Self-scoped read is answered authoritatively for the acting Self', async () => {
    s.forgetSession();
    await authenticate(s.transport, s.secretA);

    const outcome = await fetchArtifactCount(s.transport, s.selfA);
    expect(outcome.kind).toBe('count');
    if (outcome.kind === 'count') expect(outcome.count).toBeGreaterThanOrEqual(0);
  });

  it('switching to a sibling Self yields that Self\'s own scope, not the first Self\'s', async () => {
    s.forgetSession();
    await authenticate(s.transport, s.secretA);

    const before = await fetchArtifactCount(s.transport, s.selfA);
    const created = await sendSelf(s.transport, {
      method: 'POST',
      path: '/artifacts',
      actingSelf: s.selfA,
      body: { text: 'cb1 journey body' },
    });
    expect(created.status).toBe(201);

    const after = await fetchArtifactCount(s.transport, s.selfA);
    const sibling = await fetchArtifactCount(s.transport, s.siblingA);

    expect(before.kind).toBe('count');
    expect(after.kind).toBe('count');
    expect(sibling.kind).toBe('count');
    if (before.kind !== 'count' || after.kind !== 'count' || sibling.kind !== 'count') return;

    // Authoritative state, observed after a permitted write, under each scope.
    expect(after.count).toBe(before.count + 1);
    expect(sibling.count).toBe(0);
  });

  it('asserting a Self the session does not own is refused by the server', async () => {
    s.forgetSession();
    await authenticate(s.transport, s.secretA);

    const outcome = await fetchArtifactCount(s.transport, s.selfB);
    expect(outcome.kind).toBe('forbidden');
  });

  it('a fabricated acting-Self identifier is refused and nothing is substituted for it', async () => {
    s.forgetSession();
    await authenticate(s.transport, s.secretA);

    const forged = await sendSelf(s.transport, {
      method: 'GET',
      path: '/artifacts',
      actingSelf: '00000000-0000-4000-8000-000000000000',
    });
    expect(forged.ok).toBe(false);
    expect([400, 403]).toContain(forged.status);
  });

  it('a discarded session does not survive: the next Self-scoped read is the 401 transition', async () => {
    s.forgetSession();
    await authenticate(s.transport, s.secretA);
    expect((await fetchArtifactCount(s.transport, s.selfA)).kind).toBe('count');

    s.forgetSession();
    expect((await fetchArtifactCount(s.transport, s.selfA)).kind).toBe('session-expired');
  });
});
