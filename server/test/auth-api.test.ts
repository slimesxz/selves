import './helpers/env';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { appTestPool, bootstrapPool, cookieFromSetCookie, enroll, sha256, superuserPool } from './helpers/auth.ts';

const ORIGIN = 'http://localhost:5173';
const BAD_ORIGIN = 'http://evil.example';

let app: FastifyInstance;
let appPool: pg.Pool;
let bootstrap: pg.Pool;
let su: pg.Pool;

beforeAll(async () => {
  appPool = appTestPool();
  bootstrap = bootstrapPool();
  su = superuserPool();
  app = await buildApp({ db: appPool, config: loadConfig() });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await bootstrap.end();
  await su.end();
});

describe('P4-C authentication API', () => {
  it('GET /health needs no auth and returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('login issues a hardened session cookie and carries no token in the body', async () => {
    const { secret } = await enroll(bootstrap);
    const res = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(/^selves_session=/);
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Strict');
    expect(sc).toContain('Path=/');
    expect(sc).toContain('Max-Age=604800');
    expect(sc).not.toContain('Domain='); // host-only
  });

  it('login + logout round trip revokes exactly that session and clears the cookie', async () => {
    const { secret } = await enroll(bootstrap);
    const login = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret } });
    const token = cookieFromSetCookie(login.headers['set-cookie'], 'selves_session')!;

    const before = await su.query('SELECT revoked_at FROM auth.sessions WHERE token_hash = $1', [sha256(token)]);
    expect(before.rows[0].revoked_at).toBeNull();

    const out = await app.inject({
      method: 'DELETE', url: '/auth/session',
      headers: { origin: ORIGIN, cookie: `selves_session=${token}` },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^selves_session=;/); // cleared
    const after = await su.query('SELECT revoked_at FROM auth.sessions WHERE token_hash = $1', [sha256(token)]);
    expect(after.rows[0].revoked_at).not.toBeNull();
  });

  it('login with a wrong secret is a generic 401 (no oracle)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret: 'never-enrolled-secret' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('login with missing or empty secret is 400', async () => {
    const a = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: {} });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret: '' } });
    expect(b.statusCode).toBe(400);
  });

  it('rejects state-changing requests with missing or disallowed Origin (before mutation)', async () => {
    const { secret } = await enroll(bootstrap);
    // valid secret but bad origin -> 403, and no session must be created
    const bad = await app.inject({ method: 'POST', url: '/auth/session', headers: { origin: BAD_ORIGIN }, payload: { secret } });
    expect(bad.statusCode).toBe(403);
    const none = await app.inject({ method: 'POST', url: '/auth/session', payload: { secret } });
    expect(none.statusCode).toBe(403);
    const { rows } = await su.query(
      `SELECT count(*)::int AS n FROM auth.account_credentials ac
       JOIN auth.sessions s ON s.account_id = ac.account_id WHERE ac.credential_hash = $1`,
      [sha256(secret)],
    );
    expect(rows[0].n).toBe(0);
  });

  it('CORS preflight is answered for allowed origins and denied for others', async () => {
    const ok = await app.inject({
      method: 'OPTIONS', url: '/auth/session',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect([200, 204]).toContain(ok.statusCode);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const denied = await app.inject({
      method: 'OPTIONS', url: '/auth/session',
      headers: { origin: BAD_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('logout with no cookie still returns 204', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/auth/session', headers: { origin: ORIGIN } });
    expect(res.statusCode).toBe(204);
  });

  it('secure environments use the __Host- cookie name with Secure', async () => {
    const secureApp = await buildApp({ db: appPool, config: loadConfig({ ...process.env, SELVES_COOKIE_SECURE: 'true' }) });
    try {
      const { secret } = await enroll(bootstrap);
      const res = await secureApp.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret } });
      const sc = String(res.headers['set-cookie']);
      expect(sc).toMatch(/^__Host-selves_session=/);
      expect(sc).toContain('Secure');
    } finally {
      await secureApp.close();
    }
  });

  it('never writes the enrollment secret or session token to logs', async () => {
    const logs: string[] = [];
    const stream = new Writable({ write(chunk, _enc, cb) { logs.push(chunk.toString()); cb(); } });
    const loggedApp = await buildApp({ db: appPool, config: loadConfig(), logStream: stream });
    try {
      const { secret } = await enroll(bootstrap);
      const res = await loggedApp.inject({ method: 'POST', url: '/auth/session', headers: { origin: ORIGIN }, payload: { secret } });
      const token = cookieFromSetCookie(res.headers['set-cookie'], 'selves_session')!;
      await loggedApp.inject({ method: 'DELETE', url: '/auth/session', headers: { origin: ORIGIN, cookie: `selves_session=${token}` } });
      const blob = logs.join('');
      expect(blob.length).toBeGreaterThan(0); // logging actually happened
      expect(blob).not.toContain(secret);
      expect(blob).not.toContain(token);
    } finally {
      await loggedApp.close();
    }
  });
});
