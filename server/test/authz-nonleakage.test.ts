import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { appTxPool } from '../src/db.ts';
import { createAuthorizationService } from '../src/authz/service.ts';
import { createPredicatesRepo } from '../src/authz/predicates.repo.ts';
import { createDomainRepo } from '../src/authz/domain.repo.ts';
import { appTestPool, bootstrapPool, cookieFromSetCookie, enroll, superuserPool } from './helpers/auth.ts';
import { newAccount, newArtifact, newSelf } from './helpers/authz.ts';
import { buildAuthzAdapter } from './helpers/authz-adapter.ts';

// P5-D — external non-leakage (Gate 1 §13) via the test-only HTTP adapter.
// Unauthorized-existing and nonexistent single-resource reads produce an
// identical public response (status, body schema, headers, error code). The
// adapter is proven absent from the production route inventory.

const config = loadConfig();
let appPool: pg.Pool;
let su: pg.Pool;
let boot: pg.Pool;
let adapter: FastifyInstance;
let prod: FastifyInstance;
let cookie: string;
let actingSelf: string;

beforeAll(async () => {
  appPool = appTestPool();
  su = superuserPool();
  boot = bootstrapPool();
  const service = createAuthorizationService({
    txPool: appTxPool(appPool),
    predicates: createPredicatesRepo(),
    domain: createDomainRepo(),
  });
  adapter = await buildAuthzAdapter({ db: appPool, config, service });
  prod = await buildApp({ db: appPool, config });
  await adapter.ready();
  await prod.ready();

  // An authenticated account with its enrolled slot-1 Self as the acting Self.
  const e = await enroll(boot);
  actingSelf = e.selfId;
  const login = await prod.inject({
    method: 'POST',
    url: '/auth/session',
    headers: { origin: config.corsOrigins[0]!, 'content-type': 'application/json' },
    payload: { secret: e.secret },
  });
  cookie = cookieFromSetCookie(login.headers['set-cookie'], config.cookieName)!;
});

afterAll(async () => {
  await adapter.close();
  await prod.close();
  await Promise.all([appPool.end(), su.end(), boot.end()]);
});

function get(url: string) {
  return adapter.inject({ method: 'GET', url, headers: { cookie: `${config.cookieName}=${cookie}`, 'x-acting-self': actingSelf } });
}

describe('external non-leakage', () => {
  it('artifact: unauthorized-existing and nonexistent are byte-identical', async () => {
    const otherAcct = await newAccount(su);
    const otherSelf = await newSelf(su, otherAcct, 1, 'other');
    const existing = await newArtifact(su, otherSelf, 'secret'); // exists, acting Self unauthorized

    const a = await get(`/__authz__/artifact/${existing}`);
    const b = await get(`/__authz__/artifact/${randomUUID()}`); // nonexistent

    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(a.statusCode);
    expect(a.json()).toEqual({ error: 'not_found' });
    expect(b.json()).toEqual(a.json());
    expect(a.headers['content-type']).toBe(b.headers['content-type']);
    // no distinguishing header betrays existence
    expect(Object.keys(a.headers).sort()).toEqual(Object.keys(b.headers).sort());
  });

  it('placement: unauthorized-existing and nonexistent are byte-identical', async () => {
    const otherAcct = await newAccount(su);
    const otherSelf = await newSelf(su, otherAcct, 1, 'other');
    const art = await newArtifact(su, otherSelf);
    const { rows } = await su.query<{ id: string }>(
      'INSERT INTO public.placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id',
      [otherSelf, art],
    );
    const existing = rows[0]!.id;

    const a = await get(`/__authz__/placement/${existing}`);
    const b = await get(`/__authz__/placement/${randomUUID()}`);

    expect(a.statusCode).toBe(404);
    expect(b.statusCode).toBe(404);
    expect(a.json()).toEqual({ error: 'not_found' });
    expect(b.json()).toEqual(a.json());
    expect(a.headers['content-type']).toBe(b.headers['content-type']);
  });

  it('the acting Self can read its OWN artifact (the adapter is not trivially always-404)', async () => {
    const mine = await newArtifact(su, actingSelf, 'mine');
    const r = await get(`/__authz__/artifact/${mine}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: mine, textBody: 'mine' });
  });

  it('the adapter routes are absent from the production route inventory', () => {
    const routes = prod.printRoutes();
    expect(routes).not.toContain('__authz__');
    expect(routes).toContain('health'); // sanity: printRoutes reflects the real tree
  });
});
