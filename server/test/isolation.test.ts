import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { addSelf, appTestPool, bootstrapPool, cookieFromSetCookie, enroll, superuserPool } from './helpers/auth.ts';
import { buildAppWithProbe } from './helpers/probe.ts';

const ORIGIN = 'http://localhost:5173';

let app: FastifyInstance;
let probeApp: FastifyInstance;
let appPool: pg.Pool, bootstrap: pg.Pool, su: pg.Pool;

beforeAll(async () => {
  appPool = appTestPool(); bootstrap = bootstrapPool(); su = superuserPool();
  const config = loadConfig();
  app = await buildApp({ db: appPool, config });
  probeApp = await buildAppWithProbe({ db: appPool, config });
  await app.ready(); await probeApp.ready();
});
afterAll(async () => {
  await app.close(); await probeApp.close();
  await appPool.end(); await bootstrap.end(); await su.end();
});

describe('P4-F concurrent-context isolation', () => {
  it('two concurrent requests for the same account with different owned Selves keep separate contexts', async () => {
    const a = await enroll(bootstrap);
    const a2 = await addSelf(su, a.accountId, 2, 's2');
    const login = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret: a.secret } });
    const cookie = cookieFromSetCookie(login.headers['set-cookie'], 'selves_session')!;

    const [r1, r2] = await Promise.all([
      probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': a.selfId } }),
      probeApp.inject({ method: 'GET', url: '/__test__/whoami', headers: { cookie: `selves_session=${cookie}`, 'x-acting-self': a2 } }),
    ]);
    expect(r1.json()).toEqual({ accountId: a.accountId, actingSelfId: a.selfId });
    expect(r2.json()).toEqual({ accountId: a.accountId, actingSelfId: a2 }); // no bleed between in-flight requests
  });
});
