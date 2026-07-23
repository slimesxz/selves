import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { addSelf, bootstrapPool, cookieFromSetCookie, enroll, superuserPool } from './helpers/auth.ts';
import { makeAuthz } from './helpers/authz.ts';
import { buildAuthzAdapter } from './helpers/authz-adapter.ts';

// P6-E — HTTP surface for the domain mutations, driven through the test-only
// adapter (the Phase-5 pattern): the real Phase-4 middleware, the real
// AuthorizationService, and the real public mappers. Proves (1) the ratified
// 404/409/400 split, and (2) the authorization-domain split — the seven
// Artifact/Placement routes require the verified acting Self, while the
// departure-interval route is account-scoped: it needs no acting-Self header,
// takes the account from the authenticated session, and never from the body.

const config = loadConfig();
let h: ReturnType<typeof makeAuthz>;
let su: pg.Pool;
let boot: pg.Pool;
let adapter: FastifyInstance;
let prod: FastifyInstance;

// account A (sender + a recipient sibling), account B (a stranger)
let cookieA: string, senderA: string, recipientA: string, accountA: string;
let cookieB: string, senderB: string;

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

/** A Self-scoped request: session cookie + X-Acting-Self header. */
function selfReq(method: string, url: string, cookie: string, actingSelf: string, payload?: unknown) {
  return adapter.inject({
    method: method as 'GET',
    url,
    headers: {
      cookie: cookieHeader(cookie),
      'x-acting-self': actingSelf,
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}
/** An account-scoped request: session cookie only, NO acting-Self header. */
function accountReq(method: string, url: string, cookie: string | undefined, payload?: unknown, actingSelf?: string) {
  return adapter.inject({
    method: method as 'PUT',
    url,
    headers: {
      ...(cookie ? { cookie: cookieHeader(cookie) } : {}),
      ...(actingSelf ? { 'x-acting-self': actingSelf } : {}),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}
async function intervalOf(account: string): Promise<number> {
  return (await su.query<{ d: number }>('SELECT departure_interval_seconds d FROM public.accounts WHERE id = $1', [account])).rows[0]!.d;
}

beforeAll(async () => {
  h = makeAuthz();
  su = h.su;
  boot = bootstrapPool();
  adapter = await buildAuthzAdapter({ db: h.appPool, config, service: h.service });
  prod = await buildApp({ db: h.appPool, config });
  await adapter.ready();
  await prod.ready();

  const a = await enroll(boot, { name: 'senderA' });
  accountA = a.accountId;
  senderA = a.selfId;
  cookieA = await login(a.secret);
  recipientA = await addSelf(su, accountA, 2, 'recipientA');

  const b = await enroll(boot, { name: 'senderB' });
  senderB = b.selfId;
  cookieB = await login(b.secret);
});
afterAll(async () => {
  await Promise.all([adapter.close(), prod.close(), boot.end(), h.end()]);
});

describe('happy path through HTTP (create -> place -> address -> depart -> settle -> read)', () => {
  it('completes the slice and the sender can read the settled placement', async () => {
    const art = await selfReq('POST', '/__authz__/artifact', cookieA, senderA, { text: 'a letter' });
    expect(art.statusCode).toBe(201);
    const artifactId = art.json().id as string;

    const plc = await selfReq('POST', '/__authz__/placement', cookieA, senderA, { artifactId });
    expect(plc.statusCode).toBe(201);
    const placementId = plc.json().id as string;

    expect((await selfReq('POST', `/__authz__/placement/${placementId}/recipient`, cookieA, senderA, { recipientSelfId: recipientA })).statusCode).toBe(204);
    expect((await accountReq('PUT', '/__authz__/account/departure-interval', cookieA, { seconds: 5 })).statusCode).toBe(204);
    expect((await selfReq('POST', `/__authz__/placement/${placementId}/departure`, cookieA, senderA)).statusCode).toBe(204);

    // premature settle -> 409, then backdate past the floor and settle -> 204
    expect((await selfReq('POST', `/__authz__/placement/${placementId}/settlement`, cookieA, senderA)).statusCode).toBe(409);
    await su.query("UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1", [placementId]);
    expect((await selfReq('POST', `/__authz__/placement/${placementId}/settlement`, cookieA, senderA)).statusCode).toBe(204);

    const read = await selfReq('GET', `/__authz__/placement/${placementId}`, cookieA, senderA);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ id: placementId, state: 'settled', senderSelfId: senderA });
  });
});

describe('ratified 404 / 409 / 400 mapping', () => {
  async function freshDraft(): Promise<string> {
    const art = (await selfReq('POST', '/__authz__/artifact', cookieA, senderA, { text: 'x' })).json().id as string;
    return (await selfReq('POST', '/__authz__/placement', cookieA, senderA, { artifactId: art })).json().id as string;
  }

  it('authorized author + wrong state -> 409 (settle a draft)', async () => {
    const plc = await freshDraft();
    expect((await selfReq('POST', `/__authz__/placement/${plc}/settlement`, cookieA, senderA)).statusCode).toBe(409);
  });
  it('authorized author + precondition unmet -> 409 (depart with zero recipients)', async () => {
    const plc = await freshDraft();
    expect((await selfReq('POST', `/__authz__/placement/${plc}/departure`, cookieA, senderA)).statusCode).toBe(409);
  });
  it('absent placement -> 404', async () => {
    expect((await selfReq('POST', `/__authz__/placement/${randomUUID()}/settlement`, cookieA, senderA)).statusCode).toBe(404);
  });
  it('a stranger acting on another Self\'s placement -> 404 (non-leakage, not 403)', async () => {
    const plc = await freshDraft();
    const r = await selfReq('POST', `/__authz__/placement/${plc}/cancellation`, cookieB, senderB);
    expect(r.statusCode).toBe(404);
  });
  it('malformed body -> 400 (missing text)', async () => {
    expect((await selfReq('POST', '/__authz__/artifact', cookieA, senderA, {})).statusCode).toBe(400);
  });
  it('out-of-list interval -> 400', async () => {
    expect((await accountReq('PUT', '/__authz__/account/departure-interval', cookieA, { seconds: 7 })).statusCode).toBe(400);
  });
});

describe('authorization-domain split (account vs acting Self)', () => {
  it('the departure-interval route works with NO acting-Self header (account-scoped)', async () => {
    const r = await accountReq('PUT', '/__authz__/account/departure-interval', cookieA, { seconds: 10 });
    expect(r.statusCode).toBe(204);
    expect(await intervalOf(accountA)).toBe(10);
  });
  it('the account comes from the session, never the body (a body account is ignored)', async () => {
    const otherAccount = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
    const before = await intervalOf(otherAccount);
    const r = await accountReq('PUT', '/__authz__/account/departure-interval', cookieA, { seconds: 30, account: otherAccount, accountId: otherAccount });
    expect(r.statusCode).toBe(204);
    expect(await intervalOf(accountA)).toBe(30); // the AUTHENTICATED account moved
    expect(await intervalOf(otherAccount)).toBe(before); // the body-supplied account did not
  });
  it('an acting-Self header on the account route is ignored (still succeeds, still account-scoped)', async () => {
    const r = await accountReq('PUT', '/__authz__/account/departure-interval', cookieA, { seconds: 60 }, senderB /* not even owned by A */);
    expect(r.statusCode).toBe(204);
    expect(await intervalOf(accountA)).toBe(60);
  });
  it('a Self-scoped route REQUIRES the acting-Self header (400 without it)', async () => {
    const r = await accountReq('POST', '/__authz__/artifact', cookieA, { text: 'x' }); // no header
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'self_context_required' });
  });
  it('a forged (unowned) acting-Self on a Self route -> 403', async () => {
    const r = await selfReq('POST', '/__authz__/artifact', cookieA, senderB /* owned by B, not A */, { text: 'x' });
    expect(r.statusCode).toBe(403);
  });
});

describe('authentication is required for every mutation route', () => {
  it('unauthenticated Self route -> 401', async () => {
    const r = await adapter.inject({ method: 'POST', url: '/__authz__/artifact', headers: { 'x-acting-self': senderA, 'content-type': 'application/json' }, payload: { text: 'x' } });
    expect(r.statusCode).toBe(401);
  });
  it('unauthenticated account route -> 401', async () => {
    const r = await accountReq('PUT', '/__authz__/account/departure-interval', undefined, { seconds: 30 });
    expect(r.statusCode).toBe(401);
  });
});
