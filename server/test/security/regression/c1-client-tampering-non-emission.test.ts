import '../../helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { sendAccount, sendSelf } from '../../../../client/src/api/transport.ts';
import { authenticate } from '../../../../client/src/auth/gate.ts';
import { startRealSurface, type RealSurface } from '../../helpers/real-surface.ts';
import { superuserPool } from '../../helpers/auth.ts';

// P11-C · C1 — integrated client tampering AND forbidden-data non-emission.
//
// AUTHORIZATION. Executed as PHASE 11 evidence under the Q11 ruling recorded in
// 0013 §2. The apparatus was CONSTRUCTED in Phase 10 without evidentiary status;
// Phase 10 is not the source of these observations and they are not attributed
// to it. The distinction is temporal, and it is deliberate.
//
// BOUNDARY. production client request construction → real `fetch` → real
// loopback socket → production server → authoritative enforcement. No
// app.inject, no mocked fetch, no test-only production hook, no debug endpoint,
// no production instrumentation, and no Phase 10 mounted binding reopened.
//
// WHAT THIS APPARATUS STILL CANNOT REACH (unchanged, per Q11): browser cookie
// policy, `__Host-` enforcement by a browser, CORS enforcement by a browser,
// address-bar navigation, reload persistence, and browser-origin resolution.
// Nothing below claims any of them.
//
// THE TWO HALVES ARE PROVEN INDEPENDENTLY.
//   §1 tampered client material cannot MANUFACTURE AUTHORITY.
//   §2 an accepted response does not CONTAIN protected data that the client
//      would merely suppress cosmetically.
// §2 inspects the ACTUAL RESPONSE BYTES at the production boundary. It never
// infers non-emission from a rendered UI, and never from a parsed projection of
// the body — `await res.text()` is the raw material every assertion reads.

let s: RealSurface;
let su: pg.Pool;

/** Marker strings are unique per fixture, so a leak anywhere in a response body
 *  is unambiguous and cannot be satisfied by coincidence. */
const MARK = {
  unplaced: `MARKER-UNPLACED-${randomUUID()}`,
  settled: `MARKER-SETTLED-${randomUUID()}`,
  keyed: `MARKER-KEYED-${randomUUID()}`,
};

interface Ids { unplacedArtifact: string; settledArtifact: string; settledPlacement: string; protectedArtifact: string }
let ids: Ids;

const asA = async (): Promise<void> => { s.forgetSession(); await authenticate(s.transport, s.secretA); };
const asB = async (): Promise<void> => { s.forgetSession(); await authenticate(s.transport, s.secretB); };

const get = (self: string, path: string): Promise<Response> =>
  sendSelf(s.transport, { method: 'GET', path, actingSelf: self });
const post = (self: string, path: string, body?: unknown): Promise<Response> =>
  sendSelf(s.transport, { method: 'POST', path, actingSelf: self, ...(body === undefined ? {} : { body }) });

const idOf = async (res: Response): Promise<string> => ((await res.json()) as { id: string }).id;

/** Fixture support only: move a departing placement past its snapshotted floor.
 *  The real state machine still performs the transition through the production
 *  surface; this only backdates timestamps, exactly as the accepted P10-S4
 *  fixture does. It supplies no expected value and decides nothing. */
const rewindPastFloor = (placement: string): Promise<unknown> =>
  su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [placement],
  );

beforeAll(async () => {
  s = await startRealSurface();
  su = superuserPool();

  await asA();
  // (a) an artifact A never places — nobody else has any ground for it.
  const unplacedArtifact = await idOf(await post(s.selfA, '/artifacts', { text: MARK.unplaced }));
  // (b) an artifact A settles to B, addressed to B AND to A's sibling, so
  //     co-recipient disclosure is testable from B's side.
  const settledArtifact = await idOf(await post(s.selfA, '/artifacts', { text: MARK.settled }));
  const settledPlacement = await idOf(await post(s.selfA, '/placements', { artifactId: settledArtifact }));
  await post(s.selfA, `/placements/${settledPlacement}/recipients`, { recipientSelfId: s.selfB });
  await post(s.selfA, `/placements/${settledPlacement}/recipients`, { recipientSelfId: s.siblingA });
  await post(s.selfA, `/placements/${settledPlacement}/departure`);
  await rewindPastFloor(settledPlacement);
  await post(s.selfA, `/placements/${settledPlacement}/settlement`);
  // (c) a protected artifact reached only by a Key, granted to B.
  const protectedArtifact = await idOf(await post(s.selfA, '/artifacts', { text: MARK.keyed }));
  const keyPlacement = await idOf(await post(s.selfA, '/key-placements', { protectedResourceId: protectedArtifact }));
  await post(s.selfA, `/placements/${keyPlacement}/recipients`, { recipientSelfId: s.selfB });
  await post(s.selfA, `/placements/${keyPlacement}/departure`);
  await rewindPastFloor(keyPlacement);
  await post(s.selfA, `/placements/${keyPlacement}/settlement`);

  ids = { unplacedArtifact, settledArtifact, settledPlacement, protectedArtifact };
});

afterAll(async () => {
  await s.end();
  await su.end();
});

// ════ §1 · tampered client material cannot manufacture authority ════════════
describe('C1 §1 — tampering across every client-controlled authority surface', () => {
  it('acting-Self substitution: asserting another account\'s Self is refused', async () => {
    await asB();
    const r = await get(s.selfA, '/artifacts');
    expect(r.status).toBe(403);
  });

  it('acting-Self fabrication: an invented identifier is refused and nothing is substituted', async () => {
    await asB();
    const forged = await get(randomUUID(), '/artifacts');
    expect([400, 403]).toContain(forged.status);
    const malformed = await get('not-a-uuid', '/artifacts');
    expect(malformed.status).toBe(400);
  });

  it('PATH identifier tampering: a known-but-unauthorized id yields no access', async () => {
    await asB();
    expect((await get(s.selfB, `/artifacts/${ids.unplacedArtifact}`)).status).toBe(404);
    expect((await get(s.selfB, `/placements/${ids.settledPlacement}/recipients`)).status).toBe(200); // frozen []
    // a guessed id is indistinguishable from the known-but-unauthorized one
    expect((await get(s.selfB, `/artifacts/${randomUUID()}`)).status).toBe(404);
  });

  it('BODY identifier tampering: another Self\'s artifact cannot be placed by the tamperer', async () => {
    await asB();
    const r = await post(s.selfB, '/placements', { artifactId: ids.unplacedArtifact });
    expect(r.status).toBe(404); // non-leaking: not 403, not 201
  });

  it('BODY tampering on another Self\'s placement: recipients cannot be added', async () => {
    await asB();
    const r = await post(s.selfB, `/placements/${ids.settledPlacement}/recipients`, { recipientSelfId: s.selfB });
    expect(r.status).toBe(404);
  });

  it('capability tampering: the grantee cannot revoke, and cannot re-grant itself', async () => {
    await asB();
    const revoke = await post(s.selfB, '/keys/revocation', {
      granteeSelfId: s.selfB, protectedResourceId: ids.protectedArtifact,
    });
    expect(revoke.status).toBe(404);
    const regrant = await post(s.selfB, '/key-placements', { protectedResourceId: ids.protectedArtifact });
    expect(regrant.status).toBe(404);
  });

  it('STALE client-held Self state: a Self id retained across a session change confers nothing', async () => {
    await asA();
    expect((await get(s.selfA, '/artifacts')).status).toBe(200); // valid under A
    await asB(); // the client keeps the same Self id it held a moment ago
    expect((await get(s.selfA, '/artifacts')).status).toBe(403);
  });

  it('account-scoped tampering: caller-supplied ids in the body reach no other account', async () => {
    const interval = async (): Promise<number> => {
      const r = await sendAccount(s.transport, { method: 'GET', path: '/account/departure-interval' });
      return ((await r.json()) as { seconds: number }).seconds;
    };
    await asB();
    const bBefore = await interval();

    // A writes its OWN interval while naming B's account and Self in the body.
    await asA();
    const put = await sendAccount(s.transport, {
      method: 'PUT', path: '/account/departure-interval',
      body: { seconds: 60, accountId: randomUUID(), selfId: s.selfB },
    });
    expect(put.status).toBe(204);
    expect(await interval(), 'A\'s own session account changed').toBe(60);

    await asB();
    expect(await interval(), 'B is untouched by A\'s caller-supplied identifiers').toBe(bBefore);
  });

  it('a discarded session manufactures nothing: the next Self-scoped read is 401', async () => {
    await asA();
    expect((await get(s.selfA, '/artifacts')).status).toBe(200);
    s.forgetSession();
    expect((await get(s.selfA, '/artifacts')).status).toBe(401);
  });
});

// ════ §2 · forbidden-data NON-EMISSION, read from the raw response bytes ════
describe('C1 §2 — accepted responses do not emit protected data', () => {
  it('an unrelated Self: no response body anywhere carries the unplaced artifact text', async () => {
    await asB();
    for (const path of ['/artifacts', '/placements', `/artifacts/${ids.unplacedArtifact}`, `/placements/${ids.settledPlacement}`]) {
      const body = await (await get(s.selfB, path)).text();
      expect(body, `${path} must not emit the unplaced body`).not.toContain(MARK.unplaced);
    }
  });

  it('a sibling Self: no response body carries the author\'s artifact text', async () => {
    await asA(); // sibling belongs to account A, so the session is A's
    for (const path of ['/artifacts', '/placements', `/artifacts/${ids.unplacedArtifact}`]) {
      const body = await (await get(s.siblingA, path)).text();
      expect(body, `${path} must not emit to the sibling`).not.toContain(MARK.unplaced);
    }
  });

  it('the settled recipient receives the text it IS entitled to — the control against a vacuous pass', async () => {
    await asB();
    const body = await (await get(s.selfB, `/artifacts/${ids.settledArtifact}`)).text();
    expect(body).toContain(MARK.settled); // the marker mechanism genuinely detects presence
  });

  it('the settled recipient is NOT emitted the departure-interval snapshot (R4/P10-M1 field law)', async () => {
    await asB();
    const single = await (await get(s.selfB, `/placements/${ids.settledPlacement}`)).text();
    expect(single).not.toContain('departureInterval');
    const list = await (await get(s.selfB, '/placements')).text();
    expect(list).not.toContain('departureInterval');
    // the field is genuinely present for the AUTHOR, so its absence above is a
    // suppression of emission and not merely an absent feature
    await asA();
    const authorView = await (await get(s.selfA, `/placements/${ids.settledPlacement}`)).text();
    expect(authorView).toContain('departureInterval');
  });

  it('co-recipient identities are not emitted to a recipient', async () => {
    await asB();
    const rows = await get(s.selfB, `/placements/${ids.settledPlacement}/recipients`);
    expect(rows.status).toBe(200);
    const body = await rows.text();
    expect(body).toBe('[]');                    // the frozen empty array, byte-exact
    expect(body).not.toContain(s.siblingA);     // the co-recipient is not disclosed
    expect(body).not.toContain(s.selfB);        // not even the recipient's own row
  });

  it('a REVOKED Key holder is emitted nothing of the protected artifact', async () => {
    await asB();
    const before = await (await get(s.selfB, `/artifacts/${ids.protectedArtifact}`)).text();
    expect(before).toContain(MARK.keyed); // active capability: entitled

    await asA();
    const revoked = await post(s.selfA, '/keys/revocation', {
      granteeSelfId: s.selfB, protectedResourceId: ids.protectedArtifact,
    });
    expect(revoked.status).toBe(204);

    await asB();
    for (const path of [`/artifacts/${ids.protectedArtifact}`, '/artifacts', '/placements']) {
      const body = await (await get(s.selfB, path)).text();
      expect(body, `${path} must not emit after revocation`).not.toContain(MARK.keyed);
    }
  });

  it('no denial response body carries any marker or internal reason', async () => {
    await asB();
    const denied = await get(s.selfB, `/artifacts/${ids.unplacedArtifact}`);
    const body = await denied.text();
    expect(body).toBe(JSON.stringify({ error: 'not_found' }));
    for (const m of Object.values(MARK)) expect(body).not.toContain(m);
  });
});
