import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { makeAuthenticate, makeVerifyActingSelf } from '../../src/app.ts';
import type { AppConfig } from '../../src/config.ts';
import type { Queryable } from '../../src/db.ts';
import type { AuthorizationService } from '../../src/authz/service.ts';
import { mapDenied, mapMutationError } from '../../src/authz/reasons.ts';
import { accountCtx, actingCtx } from './authz.ts';

// TEST-ONLY external adapter, mounted ONLY from the test composition root (the
// Phase-5 pattern, decision 0005). It is never imported by a production module,
// appears in no production route inventory or build, and drives the REAL Phase-4
// middleware chain, the REAL AuthorizationService, and the REAL public error
// mappers. Production HTTP wiring of these operations is Phase 10.
//
// Phase 6 adds the eight domain MUTATIONS. The authorization-domain split is
// preserved end to end:
//   * the seven Artifact/Placement routes run [authenticate, verifyActingSelf]
//     and pass the VERIFIED acting Self (req.actingSelf);
//   * the departure-interval route runs [authenticate] ONLY and passes the
//     AUTHENTICATED account (req.account). It does not require, inspect, or
//     resolve the X-Acting-Self header, and never reads an account from the body.
// Failures map by the ratified split (reasons.mapMutationError): PT404->404,
// PT409->409, PT400/23xxx->400; an unrecognized code falls through to 500.
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
  const selfScoped = { preHandler: [authenticate, verify] };
  const accountScoped = { preHandler: [authenticate] };

  const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;
  const actor = (req: FastifyRequest) => actingCtx(req.actingSelf as string);
  const deny = (reply: FastifyReply): FastifyReply => {
    const e = mapDenied();
    return reply.code(e.status).send(e.body);
  };
  // Map a mutation's DEFINER-function SQLSTATE to the ratified public response.
  // An unmapped code is rethrown so the error handler yields a generic 500.
  const mapErr = (reply: FastifyReply, err: unknown): FastifyReply => {
    const pe = mapMutationError((err as { code?: string }).code);
    if (!pe) throw err;
    return reply.code(pe.status).send(pe.body);
  };
  const runVoid = async (reply: FastifyReply, op: () => Promise<void>): Promise<FastifyReply> => {
    try {
      await op();
      return reply.code(204).send();
    } catch (err) {
      return mapErr(reply, err);
    }
  };
  const runId = async (reply: FastifyReply, op: () => Promise<string>): Promise<FastifyReply> => {
    try {
      const id = await op();
      return reply.code(201).send({ id });
    } catch (err) {
      return mapErr(reply, err);
    }
  };

  // ── Phase-5 reads (unchanged) ─────────────────────────────────────────────
  app.get('/__authz__/artifact/:id', selfScoped, async (req, reply) => {
    const r = await service.readArtifact(actor(req), idOf(req));
    return r.ok ? reply.code(200).send(r.value) : deny(reply);
  });
  app.get('/__authz__/placement/:id', selfScoped, async (req, reply) => {
    const r = await service.readPlacement(actor(req), idOf(req));
    return r.ok ? reply.code(200).send(r.value) : deny(reply);
  });

  // ── Phase-6 mutations: seven acting-Self-bound ────────────────────────────
  app.post('/__authz__/artifact', selfScoped, async (req, reply) => {
    const b = req.body as { text?: unknown } | undefined;
    if (typeof b?.text !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runId(reply, () => service.createArtifact(actor(req), b.text as string));
  });
  app.post('/__authz__/placement', selfScoped, async (req, reply) => {
    const b = req.body as { artifactId?: unknown } | undefined;
    if (typeof b?.artifactId !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runId(reply, () => service.createPlacementDraft(actor(req), b.artifactId as string));
  });
  app.post('/__authz__/placement/:id/recipient', selfScoped, async (req, reply) => {
    const b = req.body as { recipientSelfId?: unknown } | undefined;
    if (typeof b?.recipientSelfId !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runVoid(reply, () => service.addRecipient(actor(req), idOf(req), b.recipientSelfId as string));
  });
  app.delete('/__authz__/placement/:id/recipient/:rid', selfScoped, async (req, reply) => {
    const p = req.params as { id: string; rid: string };
    return runVoid(reply, () => service.removeRecipient(actor(req), p.id, p.rid));
  });
  app.post('/__authz__/placement/:id/departure', selfScoped, (req, reply) =>
    runVoid(reply, () => service.beginDeparture(actor(req), idOf(req))),
  );
  app.post('/__authz__/placement/:id/cancellation', selfScoped, (req, reply) =>
    runVoid(reply, () => service.cancelPlacement(actor(req), idOf(req))),
  );
  app.post('/__authz__/placement/:id/settlement', selfScoped, (req, reply) =>
    runVoid(reply, () => service.settlePlacement(actor(req), idOf(req))),
  );

  // ── Phase-7 Key lifecycle: self-scoped (acting grantor) ───────────────────
  // Opening a Key transmission (a draft Placement over a protected Artifact) and
  // revoking a capability. add_recipient / departure / settlement reuse the
  // existing placement routes above — they are Key-aware in the DEFINER functions.
  app.post('/__authz__/key-placement', selfScoped, async (req, reply) => {
    const b = req.body as { protectedResourceId?: unknown } | undefined;
    if (typeof b?.protectedResourceId !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runId(reply, () => service.createKeyPlacementDraft(actor(req), b.protectedResourceId as string));
  });
  app.post('/__authz__/key/revocation', selfScoped, async (req, reply) => {
    const b = req.body as { granteeSelfId?: unknown; protectedResourceId?: unknown } | undefined;
    if (typeof b?.granteeSelfId !== 'string' || typeof b?.protectedResourceId !== 'string') {
      return reply.code(400).send({ error: 'bad_request' });
    }
    return runVoid(reply, () =>
      service.revokeKey(actor(req), b.granteeSelfId as string, b.protectedResourceId as string),
    );
  });

  // ── Phase-6 mutation: one account-bound (authenticate only) ───────────────
  // Authority is the authenticated account (req.account). No acting Self is
  // required, inspected, or resolved; the account is never taken from the body.
  app.put('/__authz__/account/departure-interval', accountScoped, async (req, reply) => {
    const b = req.body as { seconds?: unknown } | undefined;
    if (typeof b?.seconds !== 'number' || !Number.isInteger(b.seconds)) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    return runVoid(reply, () => service.setDepartureInterval(accountCtx(req.account as string), b.seconds as number));
  });

  return app;
}
