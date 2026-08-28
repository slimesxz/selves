// P10-S3 — the frozen production domain surface (0012 §35 ruling 2): exactly
// sixteen registrations, fourteen Self-scoped and two account-scoped. Wired
// unconditionally from buildApp (registration-by-construction: no configured
// app exists without this surface). Handlers carry the test-adapter's proven
// shapes; every failure maps through the accepted reasons.ts mappers,
// unchanged. Authority never derives from a payload: Self-scoped routes read
// the CURRENT request's verified acting Self (0004 R2); account-scoped routes
// construct only AccountContext — structurally incapable of carrying a Self.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { AppConfig } from '../config.ts';
import type { AuthorizationService, ActingContext, AccountContext } from '../authz/service.ts';
import type { SelfId } from '@selves/domain';
import { mapDenied, mapMutationError } from '../authz/reasons.ts';
import { sha256 } from '../crypto.ts';

export interface DomainRouteDeps {
  config: AppConfig;
  service: AuthorizationService;
  /** The existing production middleware, created by buildApp (passed in to
   *  avoid a routes→app import cycle; never a second implementation). */
  authenticate: preHandlerHookHandler;
  verifyActingSelf: preHandlerHookHandler;
}

export function registerDomainRoutes(app: FastifyInstance, deps: DomainRouteDeps): void {
  const { config, service, authenticate, verifyActingSelf } = deps;
  const selfScoped = { preHandler: [authenticate, verifyActingSelf] };
  const accountScoped = { preHandler: [authenticate] };

  const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;
  // Acting context from CURRENT verified request state + the authenticated
  // cookie (the ratified derivation; P8 C3 carries the real session).
  const actor = (req: FastifyRequest): ActingContext => ({
    actingSelf: req.actingSelf as SelfId,
    sessionToken: sha256(req.cookies[config.cookieName] as string),
  });
  // Account context: the session credential is the SOLE authority input.
  const account = (req: FastifyRequest): AccountContext => ({
    sessionToken: sha256(req.cookies[config.cookieName] as string),
  });

  const deny = (reply: FastifyReply): FastifyReply => {
    const e = mapDenied();
    return reply.code(e.status).send(e.body);
  };
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
  // P11-C C7 (defect P11A2-F1): the read routes carry the SAME failure mapping
  // the mutation routes already carry. A structurally malformed path identifier
  // reaches PostgreSQL as 22P02, which reasons.mapMutationError already maps to
  // the ratified 400 bad_request; without this wrapper it escaped to the generic
  // 500 handler. No new error class and no new envelope is introduced — an
  // unrecognized SQLSTATE is still rethrown and still yields a generic 500.
  const runRead = async <T>(
    reply: FastifyReply,
    op: () => Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }>,
  ): Promise<FastifyReply> => {
    try {
      const r = await op();
      return r.ok ? reply.code(200).send(r.value) : deny(reply);
    } catch (err) {
      return mapErr(reply, err);
    }
  };
  const runList = async <T>(reply: FastifyReply, op: () => Promise<T[]>): Promise<FastifyReply> => {
    try {
      return reply.code(200).send(await op());
    } catch (err) {
      return mapErr(reply, err);
    }
  };

  // ── artifacts ───────────────────────────────────────────────────────────
  app.get('/artifacts', selfScoped, async (req) => service.listOwnedArtifacts(actor(req)));
  app.post('/artifacts', selfScoped, async (req, reply) => {
    const b = req.body as { text?: unknown } | undefined;
    if (typeof b?.text !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runId(reply, () => service.createArtifact(actor(req), b.text as string));
  });
  app.get('/artifacts/:id', selfScoped, (req, reply) =>
    runRead(reply, () => service.readArtifact(actor(req), idOf(req))),
  );

  // ── placements ──────────────────────────────────────────────────────────
  app.get('/placements', selfScoped, async (req) => service.listReadablePlacements(actor(req)));
  app.post('/placements', selfScoped, async (req, reply) => {
    const b = req.body as { artifactId?: unknown } | undefined;
    if (typeof b?.artifactId !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runId(reply, () => service.createPlacementDraft(actor(req), b.artifactId as string));
  });
  app.get('/placements/:id', selfScoped, (req, reply) =>
    runRead(reply, () => service.readPlacement(actor(req), idOf(req))),
  );

  // ── recipients (frozen empty-array contract for the non-author) ─────────
  app.get('/placements/:id/recipients', selfScoped, (req, reply) =>
    runList(reply, () => service.listRecipientsOfAuthoredPlacement(actor(req), idOf(req))),
  );
  app.post('/placements/:id/recipients', selfScoped, async (req, reply) => {
    const b = req.body as { recipientSelfId?: unknown } | undefined;
    if (typeof b?.recipientSelfId !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runVoid(reply, () => service.addRecipient(actor(req), idOf(req), b.recipientSelfId as string));
  });
  app.delete('/placements/:id/recipients/:rid', selfScoped, async (req, reply) => {
    const p = req.params as { id: string; rid: string };
    return runVoid(reply, () => service.removeRecipient(actor(req), p.id, p.rid));
  });

  // ── state transitions (singular, per the frozen contract) ───────────────
  app.post('/placements/:id/departure', selfScoped, (req, reply) =>
    runVoid(reply, () => service.beginDeparture(actor(req), idOf(req))),
  );
  app.post('/placements/:id/cancellation', selfScoped, (req, reply) =>
    runVoid(reply, () => service.cancelPlacement(actor(req), idOf(req))),
  );
  app.post('/placements/:id/settlement', selfScoped, (req, reply) =>
    runVoid(reply, () => service.settlePlacement(actor(req), idOf(req))),
  );

  // ── keys ─────────────────────────────────────────────────────────────────
  app.post('/key-placements', selfScoped, async (req, reply) => {
    const b = req.body as { protectedResourceId?: unknown } | undefined;
    if (typeof b?.protectedResourceId !== 'string') return reply.code(400).send({ error: 'bad_request' });
    return runId(reply, () => service.createKeyPlacementDraft(actor(req), b.protectedResourceId as string));
  });
  app.post('/keys/revocation', selfScoped, async (req, reply) => {
    const b = req.body as { granteeSelfId?: unknown; protectedResourceId?: unknown } | undefined;
    if (typeof b?.granteeSelfId !== 'string' || typeof b?.protectedResourceId !== 'string') {
      return reply.code(400).send({ error: 'bad_request' });
    }
    return runVoid(reply, () =>
      service.revokeKey(actor(req), b.granteeSelfId as string, b.protectedResourceId as string),
    );
  });

  // ── account-scoped pair: authenticate ONLY; AccountContext only ──────────
  app.get('/account/departure-interval', accountScoped, async (req, reply) => {
    try {
      const seconds = await service.getDepartureInterval(account(req));
      return reply.code(200).send({ seconds });
    } catch (err) {
      // Race-window PT404 (session died after authenticate) maps through the
      // accepted mutation mapper — reuse, not a new policy.
      return mapErr(reply, err);
    }
  });
  app.put('/account/departure-interval', accountScoped, async (req, reply) => {
    const b = req.body as { seconds?: unknown } | undefined;
    if (typeof b?.seconds !== 'number' || !Number.isInteger(b.seconds)) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    return runVoid(reply, () => service.setDepartureInterval(account(req), b.seconds as number));
  });
}
