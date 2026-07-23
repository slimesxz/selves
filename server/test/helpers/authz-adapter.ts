import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { makeAuthenticate, makeVerifyActingSelf } from '../../src/app.ts';
import type { AppConfig } from '../../src/config.ts';
import type { Queryable } from '../../src/db.ts';
import type { AuthorizationService } from '../../src/authz/service.ts';
import { mapDenied } from '../../src/authz/reasons.ts';
import { actingCtx } from './authz.ts';

// TEST-ONLY external adapter. It exists ONLY here in test code, is never imported
// by a production module, appears in no production route inventory or build, and
// exposes no domain mutation. It exercises the real Phase-4 middleware chain, the
// real AuthorizationService, and the real public error mapper, so tests can prove
// the external non-leakage contract (identical public status/body/headers/error
// code for unauthorized-existing vs nonexistent). Service-level predicate tests
// remain primary; this proves only the HTTP mapping.
export async function buildAuthzAdapter(opts: {
  db: Queryable;
  config: AppConfig;
  service: AuthorizationService;
}): Promise<FastifyInstance> {
  const { db, config, service } = opts;
  const app = Fastify();
  await app.register(cookie);
  app.decorateRequest('account', null);
  app.decorateRequest('actingSelf', null);

  const authenticate = makeAuthenticate(db, config);
  const verify = makeVerifyActingSelf(db);
  const pre = { preHandler: [authenticate, verify] };

  const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;
  const deny = (reply: FastifyReply): FastifyReply => {
    const e = mapDenied();
    return reply.code(e.status).send(e.body);
  };

  app.get('/__authz__/artifact/:id', pre, async (req, reply) => {
    const r = await service.readArtifact(actingCtx(req.actingSelf as string), idOf(req));
    return r.ok ? reply.code(200).send(r.value) : deny(reply);
  });
  app.get('/__authz__/placement/:id', pre, async (req, reply) => {
    const r = await service.readPlacement(actingCtx(req.actingSelf as string), idOf(req));
    return r.ok ? reply.code(200).send(r.value) : deny(reply);
  });

  return app;
}
