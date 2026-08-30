// P13-F — bounded authentication-resource defense (decision 0015 Gate 1 C.7/C.8;
// P13-F rulings I.1–I.6; DB1).
//
// The property under proof is narrow and deliberately so: the two routes an
// UNAUTHENTICATED caller can drive database work through are bounded, and
// nothing else is. A limit on an authenticated route would be an engagement
// control, which T7 forbids; a limit on /health would impair liveness checking.
//
// The limiter creates NO durable state: no attempt counter, no account lockout,
// no per-person history. Account lockout was explicitly rejected on
// constitutional grounds (I.5) — persistent per-account failure state is exactly
// the person-level history C.3 excludes. What is bounded here is resource
// consumption at the network surface, not a person.
//
// Each test builds its OWN app so it gets a fresh limiter store. The plugin's
// store is process-local and in-memory, so a shared app would leak budget
// between cases and make the counts meaningless.
import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { appTxPool } from '../src/db.ts';
import { createPostgresAuthorizationService, type AuthorizationService } from '../src/authz/service.ts';
import { appTestPool, bootstrapPool, cookieFromSetCookie, enroll, superuserPool } from './helpers/auth.ts';

const ORIGIN = 'http://localhost:5173';
const config = loadConfig();

// The ratified bounds (I.2). Restated here as literals rather than imported
// from production, so a change to the production constant fails this proof
// instead of silently redefining it.
const LOGIN_MAX = 30;
const LOGOUT_MAX = 30;

let appPool: pg.Pool;
let boot: pg.Pool;
let su: pg.Pool;
let service: AuthorizationService;

/** A fresh app, and therefore a fresh limiter store. */
async function freshApp(): Promise<FastifyInstance> {
  const app = await buildApp({ db: appPool, config, service });
  await app.ready();
  return app;
}

const login = (app: FastifyInstance, secret: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/auth/session',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    payload: { secret },
  });

const logout = (app: FastifyInstance, headers: Record<string, string> = {}) =>
  app.inject({ method: 'DELETE', url: '/auth/session', headers: { origin: ORIGIN, ...headers } });

beforeAll(async () => {
  appPool = appTestPool();
  boot = bootstrapPool();
  su = superuserPool();
  service = createPostgresAuthorizationService({ txPool: appTxPool(appPool), db: appPool });
});

afterAll(async () => {
  await Promise.all([appPool.end(), boot.end(), su.end()]);
});

describe('P13-F login surface is bounded (I.2)', () => {
  it('the first 30 login requests reach normal route behavior; the 31st is refused', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      for (let i = 1; i <= LOGIN_MAX; i += 1) {
        const res = await login(app, secret);
        // Normal route behavior: a real login succeeds. The limiter is not
        // interfering with the authentication contract below its bound.
        expect(res.statusCode, `request ${i} must reach the route`).toBe(204);
      }
      const limited = await login(app, secret);
      expect(limited.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('the refusal body is exactly the ratified transport response, with no limiter prose', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      for (let i = 0; i < LOGIN_MAX; i += 1) await login(app, secret);
      const res = await login(app, secret);
      expect(res.statusCode).toBe(429);
      // Exactly this object — no message, no statusCode field, no plugin text.
      expect(res.json()).toEqual({ error: 'rate_limited' });
      expect(res.body).not.toContain('Rate limit exceeded');
      expect(res.body).not.toContain('retry in');
    } finally {
      await app.close();
    }
  });

  it('no remaining-budget headers are disclosed, below or at the bound; Retry-After is present on refusal', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      const under = await login(app, secret);
      for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
        expect(under.headers[h], `budget header leaked below the bound: ${h}`).toBeUndefined();
      }
      for (let i = 1; i < LOGIN_MAX; i += 1) await login(app, secret);
      const refused = await login(app, secret);
      expect(refused.statusCode).toBe(429);
      for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
        expect(refused.headers[h], `budget header leaked on refusal: ${h}`).toBeUndefined();
      }
      // The one header that makes the refusal actionable without disclosing the counter.
      expect(refused.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('a refused request performs no authentication work: a VALID credential is still refused while limited', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      const before = await sessionCount();
      for (let i = 0; i < LOGIN_MAX; i += 1) await login(app, secret);
      const midway = await sessionCount();
      expect(midway - before, 'each permitted login issued a session').toBe(LOGIN_MAX);

      // The credential is valid. It is refused anyway, and — the load-bearing
      // half — auth.issue_session is never reached, so no session row appears.
      const refused = await login(app, secret);
      expect(refused.statusCode).toBe(429);
      expect(refused.headers['set-cookie'], 'a limited request must mint no cookie').toBeUndefined();
      expect(await sessionCount(), 'a limited request must not reach issue_session').toBe(midway);
    } finally {
      await app.close();
    }
  });

  async function sessionCount(): Promise<number> {
    const { rows } = await su.query<{ n: string }>('SELECT count(*)::text AS n FROM auth.sessions');
    return Number(rows[0]!.n);
  }
});

describe('P13-F the bound is per key and per route', () => {
  it('a second address has an independent login budget', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      for (let i = 0; i < LOGIN_MAX; i += 1) await login(app, secret);
      expect((await login(app, secret)).statusCode).toBe(429);
      // inject() lets the peer address be set, which is what the plugin keys on.
      const other = await app.inject({
        method: 'POST',
        url: '/auth/session',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        payload: { secret },
        remoteAddress: '203.0.113.7',
      });
      expect(other.statusCode).not.toBe(429);
    } finally {
      await app.close();
    }
  });

  it('exhausting login does not consume the logout budget', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      for (let i = 0; i < LOGIN_MAX; i += 1) await login(app, secret);
      expect((await login(app, secret)).statusCode).toBe(429);
      // Independent bucket: logout is untouched by the login exhaustion.
      expect((await logout(app)).statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('logout preserves its 204 contract to the bound, then refuses', async () => {
    const app = await freshApp();
    try {
      for (let i = 1; i <= LOGOUT_MAX; i += 1) {
        expect((await logout(app)).statusCode, `logout ${i}`).toBe(204);
      }
      const limited = await logout(app);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: 'rate_limited' });
    } finally {
      await app.close();
    }
  });
});

describe('P13-F nothing else is limited', () => {
  it('GET /health is unlimited past both bounds, so liveness checking is unimpaired', async () => {
    const app = await freshApp();
    try {
      for (let i = 0; i < LOGOUT_MAX + LOGIN_MAX + 5; i += 1) {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });

  it('an authenticated route is outside the limiter: it answers identically past the login bound', async () => {
    const app = await freshApp();
    try {
      const account = await enroll(boot);
      const res = await login(app, account.secret);
      const cookie = cookieFromSetCookie(res.headers['set-cookie'], config.cookieName)!;
      // Well past either bound. A limited authenticated surface would be an
      // engagement control; T7 permits resource defense only.
      for (let i = 0; i < LOGOUT_MAX + 5; i += 1) {
        const r = await app.inject({
          method: 'GET',
          url: '/auth/selves',
          headers: { cookie: `${config.cookieName}=${cookie}` },
        });
        expect(r.statusCode, `authenticated request ${i + 1}`).toBe(200);
      }
    } finally {
      await app.close();
    }
  });
});

describe('P13-F the key cannot be forged, and carries no governed value (I.3, keying contract)', () => {
  it('a forged X-Forwarded-For does not mint a fresh key under the present trust model', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      for (let i = 0; i < LOGIN_MAX; i += 1) await login(app, secret);
      expect((await login(app, secret)).statusCode).toBe(429);
      // trustProxy is deliberately not enabled and no forwarded header is
      // consumed, so these are inert: the caller stays in its own bucket.
      for (const forged of ['198.51.100.23', '203.0.113.99, 198.51.100.1', 'not-an-address']) {
        const res = await login(app, secret, { 'x-forwarded-for': forged });
        expect(res.statusCode, `forged X-Forwarded-For minted a key: ${forged}`).toBe(429);
      }
      const forgedReal = await login(app, secret, { 'x-real-ip': '198.51.100.77' });
      expect(forgedReal.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('the limiter is keyed on no credential, account, Self, session, or cookie value', async () => {
    const app = await freshApp();
    try {
      const a = await enroll(boot);
      const b = await enroll(boot);
      // Two DIFFERENT accounts from one address share one bucket. If the key
      // were credential- or account-derived they would not, and the estate
      // would be accumulating per-account failure history — the thing I.5
      // rejected.
      for (let i = 0; i < LOGIN_MAX; i += 1) await login(app, a.secret);
      expect((await login(app, b.secret)).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('no limiter state is written to the database', async () => {
    const app = await freshApp();
    try {
      const { secret } = await enroll(boot);
      const before = await tableCount();
      for (let i = 0; i < LOGIN_MAX + 3; i += 1) await login(app, secret);
      // Sessions legitimately grow from the permitted logins; nothing else does,
      // and no new relation appears anywhere.
      expect(await tableCount()).toBe(before);
      const { rows } = await su.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND (c.relname ILIKE '%rate%' OR c.relname ILIKE '%limit%' OR c.relname ILIKE '%attempt%')`,
      );
      expect(Number(rows[0]!.n), 'a rate-limit table was created').toBe(0);
    } finally {
      await app.close();
    }
  });

  async function tableCount(): Promise<number> {
    const { rows } = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname IN ('public','auth','domain','proj')`,
    );
    return Number(rows[0]!.n);
  }
});

describe('P13-F limiter state is process-local and expiry-bounded', () => {
  it('a new process-equivalent store restores access, proving the bucket is neither shared nor durable', async () => {
    const first = await freshApp();
    try {
      const { secret } = await enroll(boot);
      for (let i = 0; i < LOGIN_MAX; i += 1) await login(first, secret);
      expect((await login(first, secret)).statusCode).toBe(429);

      // A separate app instance is a separate in-memory store. Access is
      // restored immediately, which is the same property a restart has: the
      // bound is ephemeral by construction, with nothing persisted to recover.
      //
      // The 60-second window's own expiry is NOT simulated here: doing so would
      // require either a real one-minute wait or a production clock abstraction,
      // and P13-F forbids introducing the latter merely to make a test
      // practical. What is proven is the state's locality and non-durability.
      const second = await freshApp();
      try {
        const { secret: s2 } = await enroll(boot);
        expect((await login(second, s2)).statusCode).toBe(204);
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
    }
  });
});
