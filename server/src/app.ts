// Selves authentication server (Fastify). Hook order:
//   1. @fastify/cors      — CORS + OPTIONS preflight (short-circuits before auth)
//   2. originGuard        — reject state-changing requests with missing/disallowed Origin
//   3. authenticate       — per-route preHandler (session cookie -> account); P4-D routes
//   4. verifyActingSelf   — per-route preHandler (P4-D)
// Logout (DELETE /auth/session) is authentication-maintenance: CORS + Origin
// enforced, but exempt from authenticate; it always returns 204.
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Writable } from 'node:stream';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { AppConfig } from './config.ts';
import type { Queryable } from './db.ts';
import { sha256, newSessionToken } from './crypto.ts';
import { authenticateSession, issueSession, revokeSession } from './auth/queries.ts';

declare module 'fastify' {
  interface FastifyRequest {
    account: string | null;
    actingSelf: string | null;
  }
}

export interface BuildOptions {
  db: Queryable;
  config: AppConfig;
  /** Capture log output (tests); redaction is always applied. */
  logStream?: Writable;
}

const DEFAULT_REDACT = {
  paths: [
    'req.headers.cookie',
    'req.headers["x-acting-self"]',
    'res.headers["set-cookie"]',
  ],
  censor: '[redacted]',
};

function sessionCookieOptions(config: AppConfig) {
  // HttpOnly, host-only (no Domain), Path=/, SameSite=Strict, Secure in secure envs,
  // Max-Age = the exact session lifetime.
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: config.sessionTtlSeconds,
  };
}

function clearCookieOptions(config: AppConfig) {
  // Must match the issued variant (name/Path/Secure/SameSite/host-only).
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict' as const, path: '/' };
}

/** Per-route preHandler enforcing a valid authenticated account. Exported so
 *  P4-D Self-scoped routes can compose it before the active-Self check. */
export function makeAuthenticate(db: Queryable, config: AppConfig) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies[config.cookieName];
    if (!token) {
      await reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    const account = await authenticateSession(db, sha256(token));
    if (!account) {
      await reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    req.account = account;
  };
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { db, config } = opts;
  const app = Fastify({
    // Request bodies are never logged (Fastify default), so login secrets never
    // reach the logs; redaction covers cookies and the acting-Self header.
    logger: {
      level: 'info',
      redact: DEFAULT_REDACT,
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
  });

  app.decorateRequest('account', null);
  app.decorateRequest('actingSelf', null);

  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-acting-self'],
  });

  // Origin enforcement for state-changing requests (runs after CORS/preflight).
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const m = req.method;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !config.corsOrigins.includes(origin)) {
      await reply.code(403).send({ error: 'forbidden' });
    }
  });

  // Generic error/not-found semantics — never leak internals or existence.
  app.setErrorHandler(async (err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    req.log.error({ err }, 'request error');
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;
    await reply.code(status).send({ error: status === 500 ? 'internal_error' : 'bad_request' });
  });
  app.setNotFoundHandler(async (_req, reply) => {
    await reply.code(404).send({ error: 'not_found' });
  });

  // ── routes ─────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok' }));

  // Login (the exempt "login surface"): verify the enrollment secret, mint a
  // session, set the cookie. The response body never carries the token.
  app.post('/auth/session', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { secret?: unknown } | undefined;
    const secret = body?.secret;
    if (typeof secret !== 'string' || secret.length === 0) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    const token = newSessionToken();
    const sessionId = await issueSession(db, sha256(secret), sha256(token));
    if (!sessionId) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    reply.setCookie(config.cookieName, token, sessionCookieOptions(config));
    return reply.code(204).send();
  });

  // Logout: authentication-maintenance. If a cookie is present, revoke that one
  // session. Always clear the exact issued cookie variant. Always 204.
  app.delete('/auth/session', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[config.cookieName];
    if (token) {
      await revokeSession(db, sha256(token));
    }
    reply.clearCookie(config.cookieName, clearCookieOptions(config));
    return reply.code(204).send();
  });

  return app;
}
