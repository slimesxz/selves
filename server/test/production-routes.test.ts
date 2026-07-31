// P10-S3 — production registration, reachability, middleware, and success-shape
// smoke over the REAL production app (buildApp with the required service —
// candidate A: registration-by-construction). The exhaustive constitutional
// parity matrix remains P10-S4. Exactly seventeen test cases (binding 398).
import './helpers/env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { addSelf, bootstrapPool, cookieFromSetCookie, enroll } from './helpers/auth.ts';
import { makeAuthz, type AuthzHarness } from './helpers/authz.ts';

const config = loadConfig();
let h: AuthzHarness;
let boot: pg.Pool;
let prod: FastifyInstance;

let cookieA: string, selfA: string, siblingA: string, accountA: string;
let cookieB: string, selfB: string, accountB: string;

async function login(secret: string): Promise<string> {
  const r = await prod.inject({
    method: 'POST',
    url: '/auth/session',
    headers: { origin: config.corsOrigins[0]!, 'content-type': 'application/json' },
    payload: { secret },
  });
  return cookieFromSetCookie(r.headers['set-cookie'], config.cookieName)!;
}
const cookieHeader = (c: string) => `${config.cookieName}=${c}`;

function selfReq(method: string, url: string, cookie: string | undefined, actingSelf: string | undefined, payload?: unknown) {
  return prod.inject({
    method: method as 'GET',
    url,
    headers: {
      ...(cookie ? { cookie: cookieHeader(cookie) } : {}),
      ...(actingSelf ? { 'x-acting-self': actingSelf } : {}),
      ...(method !== 'GET' ? { origin: config.corsOrigins[0]! } : {}),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

const rewind = (id: string) =>
  h.su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [id],
  );

beforeAll(async () => {
  h = makeAuthz();
  boot = bootstrapPool();
  prod = await buildApp({ db: h.appPool, config, service: h.service });
  await prod.ready();

  const a = await enroll(boot);
  accountA = a.accountId;
  selfA = a.selfId;
  cookieA = await login(a.secret);
  siblingA = await addSelf(h.su, accountA, 2, 'sibling-a');

  const b = await enroll(boot);
  accountB = b.accountId;
  selfB = b.selfId;
  cookieB = await login(b.secret);
});

afterAll(async () => {
  await prod.close();
  await boot.end();
  await h.end();
});

// The sixteen frozen registrations (0012 §35 ruling 2).
const FROZEN: Array<[string, string]> = [
  ['GET', '/artifacts'],
  ['POST', '/artifacts'],
  ['GET', '/artifacts/:id'],
  ['GET', '/placements'],
  ['POST', '/placements'],
  ['GET', '/placements/:id'],
  ['GET', '/placements/:id/recipients'],
  ['POST', '/placements/:id/recipients'],
  ['DELETE', '/placements/:id/recipients/:rid'],
  ['POST', '/placements/:id/departure'],
  ['POST', '/placements/:id/cancellation'],
  ['POST', '/placements/:id/settlement'],
  ['POST', '/key-placements'],
  ['POST', '/keys/revocation'],
  ['GET', '/account/departure-interval'],
  ['PUT', '/account/departure-interval'],
];

describe('P10-S3 — production registration, middleware, and success shapes', () => {
  it('the production app registers exactly the sixteen frozen domain routes and no others', () => {
    for (const [method, url] of FROZEN) {
      expect(prod.hasRoute({ method: method as 'GET', url }), `${method} ${url}`).toBe(true);
    }
    // No unrelated exposure: the retired singular adapter shapes, the test
    // probe, and any unratified surface must not exist in production.
    for (const [method, url] of [
      ['GET', '/artifact/:id'],
      ['GET', '/placement/:id'],
      ['POST', '/key-placement'],
      ['POST', '/key/revocation'],
      ['GET', '/__test__/whoami'],
      ['GET', '/graph'],
      ['GET', '/selves'],
    ] as Array<[string, string]>) {
      expect(prod.hasRoute({ method: method as 'GET', url }), `${method} ${url} must not exist`).toBe(false);
    }
    // The route tree carries no test probe and no adapter prefix at all.
    const tree = prod.printRoutes({ commonPrefix: false });
    expect(tree.includes('__test__')).toBe(false);
    expect(tree.includes('__authz__')).toBe(false);
  });

  it('GET /artifacts returns the owned-artifact array in contract order', async () => {
    const a1 = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'first' })).json().id as string;
    const a2 = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'second' })).json().id as string;
    const r = await selfReq('GET', '/artifacts', cookieA, selfA);
    expect(r.statusCode).toBe(200);
    const list = r.json() as Array<{ id: string; createdAt: string }>;
    expect(list.map((x) => x.id)).toEqual(expect.arrayContaining([a1, a2]));
    const sorted = [...list].sort(
      (x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.id < y.id ? -1 : 1),
    );
    expect(list.map((x) => x.id)).toEqual(sorted.map((x) => x.id)); // (created_at, id)
  });

  it('GET /placements returns the readable-placement array in contract order with R4 ground semantics', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'p-list' })).json().id as string;
    const draft = (await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art })).json().id as string;
    const r = await selfReq('GET', '/placements', cookieA, selfA);
    expect(r.statusCode).toBe(200);
    const list = r.json() as Array<Record<string, unknown>>;
    const mine = list.find((p) => p.id === draft)!;
    // Authored row: the author column list — key present, null before departure.
    expect(Object.hasOwn(mine, 'departureIntervalSeconds')).toBe(true);
    expect(mine.departureIntervalSeconds).toBeNull();
    expect(mine.payloadType).toBe('text');
    const sorted = [...list].sort(
      (x, y) =>
        Date.parse(x.createdAt as string) - Date.parse(y.createdAt as string) ||
        ((x.id as string) < (y.id as string) ? -1 : 1),
    );
    expect(list.map((p) => p.id)).toEqual(sorted.map((p) => p.id));
  });

  it('GET /placements/:id/recipients returns the recipient rows for the author', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'r-rows' })).json().id as string;
    const plc = (await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art })).json().id as string;
    expect((await selfReq('POST', `/placements/${plc}/recipients`, cookieA, selfA, { recipientSelfId: siblingA })).statusCode).toBe(204);
    const r = await selfReq('GET', `/placements/${plc}/recipients`, cookieA, selfA);
    expect(r.statusCode).toBe(200);
    const rows = r.json() as Array<{ placementId: string; recipientSelfId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ placementId: plc, recipientSelfId: siblingA });
  });

  it('GET /placements/:id/recipients returns the frozen empty array — never null or absence', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'r-empty' })).json().id as string;
    const plc = (await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art })).json().id as string;
    const empty = await selfReq('GET', `/placements/${plc}/recipients`, cookieA, selfA);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]); // exactly [], not null/absence/envelope
    // Non-author (stranger): the indistinguishable frozen [] as well.
    const stranger = await selfReq('GET', `/placements/${plc}/recipients`, cookieB, selfB);
    expect(stranger.statusCode).toBe(200);
    expect(stranger.json()).toEqual([]);
  });

  it('GET /artifacts/:id returns the artifact record (200)', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'single' })).json().id as string;
    const r = await selfReq('GET', `/artifacts/${art}`, cookieA, selfA);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: art, textBody: 'single', payloadType: 'text' });
  });

  it('GET /placements/:id returns the ground-conditional placement (200)', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'single-p' })).json().id as string;
    const plc = (await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art })).json().id as string;
    const r = await selfReq('GET', `/placements/${plc}`, cookieA, selfA);
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.id).toBe(plc);
    expect(Object.hasOwn(body, 'departureIntervalSeconds')).toBe(true); // author ground
  });

  it('POST /artifacts creates (201 {id})', async () => {
    const r = await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'created' });
    expect(r.statusCode).toBe(201);
    expect(typeof (r.json() as { id: string }).id).toBe('string');
  });

  it('POST /placements creates the draft (201 {id})', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'draft-src' })).json().id as string;
    const r = await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art });
    expect(r.statusCode).toBe(201);
    expect(typeof (r.json() as { id: string }).id).toBe('string');
  });

  it('recipient add and remove return 204 through the production chain', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'ar' })).json().id as string;
    const plc = (await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art })).json().id as string;
    expect((await selfReq('POST', `/placements/${plc}/recipients`, cookieA, selfA, { recipientSelfId: siblingA })).statusCode).toBe(204);
    expect((await selfReq('DELETE', `/placements/${plc}/recipients/${siblingA}`, cookieA, selfA)).statusCode).toBe(204);
  });

  it('departure and cancellation return 204', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'dc' })).json().id as string;
    const plc = (await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art })).json().id as string;
    await selfReq('POST', `/placements/${plc}/recipients`, cookieA, selfA, { recipientSelfId: siblingA });
    expect((await selfReq('POST', `/placements/${plc}/departure`, cookieA, selfA)).statusCode).toBe(204);
    expect((await selfReq('POST', `/placements/${plc}/cancellation`, cookieA, selfA)).statusCode).toBe(204);
  });

  it('settlement returns 204 after the floor (idempotent repeat 204)', async () => {
    const art = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'st' })).json().id as string;
    const plc = (await selfReq('POST', '/placements', cookieA, selfA, { artifactId: art })).json().id as string;
    await selfReq('POST', `/placements/${plc}/recipients`, cookieA, selfA, { recipientSelfId: siblingA });
    await selfReq('POST', `/placements/${plc}/departure`, cookieA, selfA);
    await rewind(plc);
    expect((await selfReq('POST', `/placements/${plc}/settlement`, cookieA, selfA)).statusCode).toBe(204);
    expect((await selfReq('POST', `/placements/${plc}/settlement`, cookieA, selfA)).statusCode).toBe(204);
  });

  it('key placement and revocation land through production routes (201/204)', async () => {
    const res = (await selfReq('POST', '/artifacts', cookieA, selfA, { text: 'protected' })).json().id as string;
    const kp = await selfReq('POST', '/key-placements', cookieA, selfA, { protectedResourceId: res });
    expect(kp.statusCode).toBe(201);
    const kpId = (kp.json() as { id: string }).id;
    await selfReq('POST', `/placements/${kpId}/recipients`, cookieA, selfA, { recipientSelfId: selfB });
    await selfReq('POST', `/placements/${kpId}/departure`, cookieA, selfA);
    await rewind(kpId);
    expect((await selfReq('POST', `/placements/${kpId}/settlement`, cookieA, selfA)).statusCode).toBe(204);
    expect((await selfReq('POST', '/keys/revocation', cookieA, selfA, { granteeSelfId: selfB, protectedResourceId: res })).statusCode).toBe(204);
  });

  it('PUT then GET /account/departure-interval round-trips ({seconds})', async () => {
    const put = await prod.inject({
      method: 'PUT',
      url: '/account/departure-interval',
      headers: { cookie: cookieHeader(cookieA), origin: config.corsOrigins[0]!, 'content-type': 'application/json' },
      payload: { seconds: 10 },
    });
    expect(put.statusCode).toBe(204);
    const get = await prod.inject({
      method: 'GET',
      url: '/account/departure-interval',
      headers: { cookie: cookieHeader(cookieA) },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ seconds: 10 });
  });

  it('every Self-scoped route is 401 without a session cookie', async () => {
    const uid = randomUUID();
    const table: Array<[string, string, unknown?]> = [
      ['GET', '/artifacts'],
      ['POST', '/artifacts', { text: 'x' }],
      ['GET', `/artifacts/${uid}`],
      ['GET', '/placements'],
      ['POST', '/placements', { artifactId: uid }],
      ['GET', `/placements/${uid}`],
      ['GET', `/placements/${uid}/recipients`],
      ['POST', `/placements/${uid}/recipients`, { recipientSelfId: uid }],
      ['DELETE', `/placements/${uid}/recipients/${uid}`],
      ['POST', `/placements/${uid}/departure`],
      ['POST', `/placements/${uid}/cancellation`],
      ['POST', `/placements/${uid}/settlement`],
      ['POST', '/key-placements', { protectedResourceId: uid }],
      ['POST', '/keys/revocation', { granteeSelfId: uid, protectedResourceId: uid }],
    ];
    for (const [method, url, payload] of table) {
      const r = await selfReq(method, url, undefined, selfA, payload);
      expect(r.statusCode, `${method} ${url}`).toBe(401);
      expect(r.json()).toEqual({ error: 'unauthenticated' });
    }
  });

  it('every Self-scoped route requires the verified acting Self: malformed header 400, unowned Self 403', async () => {
    const uid = randomUUID();
    const table: Array<[string, string, unknown?]> = [
      ['GET', '/artifacts'],
      ['POST', '/artifacts', { text: 'x' }],
      ['GET', `/artifacts/${uid}`],
      ['GET', '/placements'],
      ['POST', '/placements', { artifactId: uid }],
      ['GET', `/placements/${uid}`],
      ['GET', `/placements/${uid}/recipients`],
      ['POST', `/placements/${uid}/recipients`, { recipientSelfId: uid }],
      ['DELETE', `/placements/${uid}/recipients/${uid}`],
      ['POST', `/placements/${uid}/departure`],
      ['POST', `/placements/${uid}/cancellation`],
      ['POST', `/placements/${uid}/settlement`],
      ['POST', '/key-placements', { protectedResourceId: uid }],
      ['POST', '/keys/revocation', { granteeSelfId: uid, protectedResourceId: uid }],
    ];
    for (const [method, url, payload] of table) {
      const malformed = await selfReq(method, url, cookieA, 'not-a-uuid', payload);
      expect(malformed.statusCode, `${method} ${url} malformed`).toBe(400);
      expect(malformed.json()).toEqual({ error: 'self_context_required' });
      const unowned = await selfReq(method, url, cookieA, selfB, payload);
      expect(unowned.statusCode, `${method} ${url} unowned`).toBe(403);
      expect(unowned.json()).toEqual({ error: 'forbidden' });
    }
  });

  it('verifyActingSelf runs per request — ownership valid on request one, Self deleted before request two → 403 (no standing authorization); account routes need no X-Acting-Self and ignore caller-supplied Self/account identifiers', async () => {
    const doomed = await addSelf(h.su, accountB, 2, 'doomed');
    const first = await selfReq('GET', '/artifacts', cookieB, doomed);
    expect(first.statusCode).toBe(200);
    await h.su.query('DELETE FROM public.selves WHERE id = $1', [doomed]);
    const second = await selfReq('GET', '/artifacts', cookieB, doomed);
    expect(second.statusCode).toBe(403); // re-verified on THIS request

    // Account half: no acting Self required; supplied identifiers confer and
    // change nothing — authority is the session alone.
    const before = (await h.su.query<{ d: number }>(
      'SELECT departure_interval_seconds d FROM public.accounts WHERE id = $1', [accountB],
    )).rows[0]!.d;
    const put = await prod.inject({
      method: 'PUT',
      url: '/account/departure-interval',
      headers: {
        cookie: cookieHeader(cookieA),
        origin: config.corsOrigins[0]!,
        'x-acting-self': selfB, // ignored: not an authority input here
        'content-type': 'application/json',
      },
      payload: { seconds: 5, accountId: accountB, selfId: selfB }, // extras ignored
    });
    expect(put.statusCode).toBe(204);
    const after = (await h.su.query<{ d: number }>(
      'SELECT departure_interval_seconds d FROM public.accounts WHERE id = $1', [accountB],
    )).rows[0]!.d;
    expect(after).toBe(before); // B untouched — only the SESSION account changed
    const ownGet = await prod.inject({
      method: 'GET',
      url: '/account/departure-interval',
      headers: { cookie: cookieHeader(cookieA) },
    });
    expect(ownGet.json()).toEqual({ seconds: 5 });
  });
});
