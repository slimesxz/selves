import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildApp, makeAuthenticate, makeVerifyActingSelf, type BuildOptions } from '../../src/app.ts';

// Test-only probe. It is registered ONLY here, in test code, and is never
// imported by src/server.ts — so the production route graph contains no
// /__test__ route. It exercises the authenticate + verifyActingSelf chain and
// echoes the resolved context.
//
// `recorder`, when supplied, records which stages executed, so tests can prove
// ordering (not infer it): on auth failure neither the verifier nor the handler
// run; on ownership failure the handler does not run.
export interface Recorder {
  handlerRan: boolean;
}

export async function buildAppWithProbe(opts: BuildOptions & { recorder?: Recorder }): Promise<FastifyInstance> {
  const app = await buildApp(opts);
  const authenticate = makeAuthenticate(opts.db, opts.config);
  const verifyActingSelf = makeVerifyActingSelf(opts.db);
  app.get(
    '/__test__/whoami',
    { preHandler: [authenticate, verifyActingSelf] },
    async (req: FastifyRequest) => {
      if (opts.recorder) opts.recorder.handlerRan = true;
      return { accountId: req.account, actingSelfId: req.actingSelf };
    },
  );
  return app;
}
