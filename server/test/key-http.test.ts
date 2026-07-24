import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { addSelf, bootstrapPool, cookieFromSetCookie, enroll, superuserPool } from './helpers/auth.ts';
import { makeAuthz } from './helpers/authz.ts';
import { buildAuthzAdapter } from './helpers/authz-adapter.ts';

// P7-E — the Key lifecycle public contract, driven through the test-only adapter
// (the real Phase-4 middleware, the real AuthorizationService, the real mappers).
// Proves R13's split (404/409/400) and R10 (settlement collision → 409) end to
// end, plus the KEY_VALID read effect and prospective revocation over HTTP.

const config = loadConfig();
let h: ReturnType<typeof makeAuthz>;
let su: pg.Pool;
let boot: pg.Pool;
let adapter: FastifyInstance;
let prod: FastifyInstance;

let cookieA: string, grantor: string, grantee: string, accountA: string;
let cookieB: string, stranger: string;

async function login(secret: string): Promise<string> {
  const r = await prod.inject({
    method: 'POST', url: '/auth/session',
    headers: { origin: config.corsOrigins[0]!, 'content-type': 'application/json' },
    payload: { secret },
  });
  return cookieFromSetCookie(r.headers['set-cookie'], config.cookieName)!;
}
const cookieHeader = (c: string) => `${config.cookieName}=${c}`;
function selfReq(method: string, url: string, cookie: string, actingSelf: string, payload?: unknown) {
  return adapter.inject({
    method: method as 'GET', url,
    headers: {
      cookie: cookieHeader(cookie), 'x-acting-self': actingSelf,
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}
function acctReq(method: string, url: string, cookie: string, payload: unknown) {
  return adapter.inject({
    method: method as 'PUT', url,
    headers: { cookie: cookieHeader(cookie), 'content-type': 'application/json' },
    payload: payload as object,
  });
}
async function backdatePastFloor(placementId: string): Promise<void> {
  await su.query("UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1", [placementId]);
}

/** A fresh protected Artifact authored by the grantor. */
async function freshResource(): Promise<string> {
  return (await selfReq('POST', '/__authz__/artifact', cookieA, grantor, { text: 'secret' })).json().id as string;
}
/** Drive a Key transmission to Settled for (grantor → grantee over resource). */
async function settleKeyOverHttp(resource: string): Promise<string> {
  const kp = (await selfReq('POST', '/__authz__/key-placement', cookieA, grantor, { protectedResourceId: resource })).json().id as string;
  expect((await selfReq('POST', `/__authz__/placement/${kp}/recipient`, cookieA, grantor, { recipientSelfId: grantee })).statusCode).toBe(204);
  expect((await acctReq('PUT', '/__authz__/account/departure-interval', cookieA, { seconds: 5 })).statusCode).toBe(204);
  expect((await selfReq('POST', `/__authz__/placement/${kp}/departure`, cookieA, grantor)).statusCode).toBe(204);
  await backdatePastFloor(kp);
  expect((await selfReq('POST', `/__authz__/placement/${kp}/settlement`, cookieA, grantor)).statusCode).toBe(204);
  return kp;
}

beforeAll(async () => {
  h = makeAuthz();
  su = h.su;
  boot = bootstrapPool();
  adapter = await buildAuthzAdapter({ db: h.appPool, config, service: h.service });
  prod = await buildApp({ db: h.appPool, config });
  await adapter.ready();
  await prod.ready();

  const a = await enroll(boot, { name: 'grantor' });
  accountA = a.accountId;
  grantor = a.selfId;
  cookieA = await login(a.secret);
  grantee = await addSelf(su, accountA, 2, 'grantee');

  const b = await enroll(boot, { name: 'stranger' });
  stranger = b.selfId;
  cookieB = await login(b.secret);
});
afterAll(async () => {
  await Promise.all([adapter.close(), prod.close(), boot.end(), h.end()]);
});

describe('happy path — open, address, depart, settle, read via KEY_VALID', () => {
  it('the grantee reads the protected Artifact; a stranger cannot (404)', async () => {
    const R = await freshResource();
    await settleKeyOverHttp(R);
    expect((await selfReq('GET', `/__authz__/artifact/${R}`, cookieA, grantee)).statusCode).toBe(200);
    expect((await selfReq('GET', `/__authz__/artifact/${R}`, cookieB, stranger)).statusCode).toBe(404);
  });
});

describe('R13 mappings and R10 collision over HTTP', () => {
  it('non-author opening a Key Placement over another Self\'s artifact -> 404', async () => {
    const R = await freshResource();
    const r = await selfReq('POST', '/__authz__/key-placement', cookieB, stranger, { protectedResourceId: R });
    expect(r.statusCode).toBe(404);
  });
  it('self-as-Key-recipient -> 400', async () => {
    const R = await freshResource();
    const kp = (await selfReq('POST', '/__authz__/key-placement', cookieA, grantor, { protectedResourceId: R })).json().id as string;
    const r = await selfReq('POST', `/__authz__/placement/${kp}/recipient`, cookieA, grantor, { recipientSelfId: grantor });
    expect(r.statusCode).toBe(400);
  });
  it('settlement collision with an active grant -> 409, and the loser stays departing', async () => {
    const R = await freshResource();
    await settleKeyOverHttp(R); // first grant active
    const kp2 = (await selfReq('POST', '/__authz__/key-placement', cookieA, grantor, { protectedResourceId: R })).json().id as string;
    await selfReq('POST', `/__authz__/placement/${kp2}/recipient`, cookieA, grantor, { recipientSelfId: grantee });
    await selfReq('POST', `/__authz__/placement/${kp2}/departure`, cookieA, grantor);
    await backdatePastFloor(kp2);
    expect((await selfReq('POST', `/__authz__/placement/${kp2}/settlement`, cookieA, grantor)).statusCode).toBe(409);
    expect((await selfReq('GET', `/__authz__/placement/${kp2}`, cookieA, grantor)).json().state).toBe('departing');
  });
});

describe('revocation over HTTP — prospective, idempotent, grantor-only', () => {
  it('revoke denies future reads; repeat revoke is 204; a foreign revoke is 404', async () => {
    const R = await freshResource();
    await settleKeyOverHttp(R);
    expect((await selfReq('GET', `/__authz__/artifact/${R}`, cookieA, grantee)).statusCode).toBe(200);
    // grantor revokes, addressed by (grantee, resource)
    expect((await selfReq('POST', '/__authz__/key/revocation', cookieA, grantor, { granteeSelfId: grantee, protectedResourceId: R })).statusCode).toBe(204);
    expect((await selfReq('GET', `/__authz__/artifact/${R}`, cookieA, grantee)).statusCode).toBe(404); // future denied
    // idempotent
    expect((await selfReq('POST', '/__authz__/key/revocation', cookieA, grantor, { granteeSelfId: grantee, protectedResourceId: R })).statusCode).toBe(204);
    // a foreign actor probing the real (grantee, resource) pair -> 404
    const R2 = await freshResource();
    await settleKeyOverHttp(R2);
    const foreign = await selfReq('POST', '/__authz__/key/revocation', cookieB, stranger, { granteeSelfId: grantee, protectedResourceId: R2 });
    expect(foreign.statusCode).toBe(404);
    expect((await selfReq('GET', `/__authz__/artifact/${R2}`, cookieA, grantee)).statusCode).toBe(200); // still active
  });
});
