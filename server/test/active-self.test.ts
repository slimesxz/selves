import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import {
  addSelf, appTestPool, bootstrapPool, cookieFromSetCookie, enroll,
  newEmptyAccount, reassignSelf, superuserPool,
} from './helpers/auth.ts';
import { buildAppWithProbe, type Recorder } from './helpers/probe.ts';

const ORIGIN = 'http://localhost:5173';

let app: FastifyInstance;         // production app (no probe)
let probeApp: FastifyInstance;    // production app + test probe
let recorder: Recorder;
let appPool: pg.Pool;
let bootstrap: pg.Pool;
let su: pg.Pool;

beforeAll(async () => {
  appPool = appTestPool();
  bootstrap = bootstrapPool();
  su = superuserPool();
  const config = loadConfig();
  app = await buildApp({ db: appPool, config });
  recorder = { handlerRan: false };
  probeApp = await buildAppWithProbe({ db: appPool, config, recorder });
  await app.ready();
  await probeApp.ready();
});

afterAll(async () => {
  await app.close();
  await probeApp.close();
  await appPool.end();
  await bootstrap.end();
  await su.end();
});

async function login(secret: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret } });
  return cookieFromSetCookie(res.headers['set-cookie'], 'selves_session')!;
}

describe('P4-D active-Self middleware and /auth/selves', () => {
  it('lists only the caller account Selves, ordered by slot', async () => {
    const a = await enroll(bootstrap, { name: 'a-slot1' });      // slot 1
    const a3 = await addSelf(su, a.accountId, 3, 'a-slot3');     // slot 3
    const b = await enroll(bootstrap, { name: 'b-slot1' });      // different account
    const cookie = await login(a.secret);

    const res = await app.inject({ method: 'GET', url: '/auth/selves', headers: { cookie: `selves_session=${cookie}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; slot: number }[];
    expect(body.map((s) => s.slot)).toEqual([1, 3]);           // deterministic slot order
    expect(body.map((s) => s.id)).toEqual([a.selfId, a3]);
    expect(body.some((s) => s.id === b.selfId)).toBe(false);   // caller-only
  });

  it('/auth/selves requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/selves' });
    expect(res.statusCode).toBe(401);
  });

  it('acts through an owned Self and switches without reauthentication', async () => {
    const a = await enroll(bootstrap, { name: 's1' });
    const a2 = await addSelf(su, a.accountId, 2, 's2');
    const cookie = await login(a.secret);

    const r1 = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': a.selfId } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ accountId: a.accountId, actingSelfId: a.selfId });

    // Same cookie, different owned Self — no re-login.
    const r2 = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': a2 } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual({ accountId: a.accountId, actingSelfId: a2 });
  });

  it('rejects asserting a Self owned by another account (403)', async () => {
    const a = await enroll(bootstrap);
    const b = await enroll(bootstrap);
    const cookie = await login(a.secret);
    const res = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': b.selfId } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it('rejects missing, malformed, empty, and duplicate acting-Self headers (400, no substitution)', async () => {
    const a = await enroll(bootstrap);
    const a2 = await addSelf(su, a.accountId, 2, 's2');
    const cookie = await login(a.secret);
    const base = { cookie: `selves_session=${cookie}` };

    const missing = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: base });
    expect(missing.statusCode).toBe(400);
    const malformed = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { ...base, 'x-acting-self': 'not-a-uuid' } });
    expect(malformed.statusCode).toBe(400);
    const empty = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { ...base, 'x-acting-self': '' } });
    expect(empty.statusCode).toBe(400);
    // Duplicate header arrives comma-joined; must be rejected, never first/last picked.
    const dup = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { ...base, 'x-acting-self': [a.selfId, a2] } });
    expect(dup.statusCode).toBe(400);
  });

  it('on auth failure, the verifier and handler do not run (ordering, proven)', async () => {
    recorder.handlerRan = false;
    const res = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { 'x-acting-self': '11111111-1111-1111-1111-111111111111' } });
    expect(res.statusCode).toBe(401);
    expect(recorder.handlerRan).toBe(false);
  });

  it('on ownership failure, the handler does not run (ordering, proven)', async () => {
    const a = await enroll(bootstrap);
    const b = await enroll(bootstrap);
    const cookie = await login(a.secret);
    recorder.handlerRan = false;
    const res = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': b.selfId } });
    expect(res.statusCode).toBe(403);
    expect(recorder.handlerRan).toBe(false);
  });

  it('ownership revocation takes effect on the next protected request', async () => {
    const a = await enroll(bootstrap);
    const cookie = await login(a.secret);
    const ok = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': a.selfId } });
    expect(ok.statusCode).toBe(200);

    // Constraint-legal ownership change: move the Self to a fresh empty account.
    const other = await newEmptyAccount(su);
    await reassignSelf(su, a.selfId, other);

    const after = await probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': a.selfId } });
    expect(after.statusCode).toBe(403); // prior success is not standing authorization
  });

  it('the production route graph contains no /__test__ route', async () => {
    expect(app.printRoutes()).not.toContain('__test__');
    const res = await app.inject({ method: 'GET', url: '/__test__/whoami' });
    expect(res.statusCode).toBe(404);
  });
});
