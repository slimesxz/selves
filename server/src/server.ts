// Production entrypoint. Runs on Node 24.18.0 via native type stripping:
//   node --env-file=.env src/server.ts
// The test probes live only in test/ and are never imported here, so the
// production route graph contains no /__test__ route.
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { appPool } from './db.ts';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';

const app = await buildApp({ db: appPool(), config: loadConfig() });

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
