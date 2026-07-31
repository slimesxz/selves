// Production entrypoint. Runs on Node 24.18.0 via native type stripping:
//   node --env-file=.env src/server.ts
// The test probes live only in test/ and are never imported here, so the
// production route graph contains no /__test__ route.
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { appPool, appTxPool } from './db.ts';
import { createPostgresAuthorizationService } from './authz/service.ts';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';

const pool = appPool();
const app = await buildApp({
  db: pool,
  config: loadConfig(),
  service: createPostgresAuthorizationService({ txPool: appTxPool(pool), db: pool }),
});

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
