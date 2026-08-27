// P10-BR2 — the real-browser apparatus. Support only: it declares ZERO cases.
//
// It prepares the database, starts the production server and the production
// client, and hands the spec a fixture. It observes nothing and asserts no
// constitutional proposition: every claim belongs to the spec, and every claim
// there is about what an actual browser did.
//
// FIXTURE PREPARATION IS NOT THE OBSERVED JOURNEY. Enrolment and artifact
// seeding below run through privileged test infrastructure straight to the
// database. They establish the world the browser then walks into; nothing they
// do is offered as evidence of production behaviour.
//
// The browser is the real user agent throughout. Nothing here answers a
// production request, replays a cookie, attaches an Origin, or intercepts a
// route: requests leave Chrome, cross the committed Vite `/api` proxy, and are
// answered by the production Fastify server against real PostgreSQL under RLS.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
// The committed server-test env loader, reused rather than reimplemented: it
// reads server/.env relative to its own location and never overwrites a value
// already present in the environment.
import '../../server/test/helpers/env.ts';
import serverGlobalSetup from '../../server/test/globalSetup.ts';
import { bootstrapPool, enroll } from '../../server/test/helpers/auth.ts';
// P10-BR3 — the Vitest-free fixture module. Importing `db.ts` here dragged
// `import { expect } from 'vitest'` into Playwright's plain-Node globalSetup
// context, which is the recorded P10-BR2 defect.
import { newTextArtifact, testPool } from '../../server/test/helpers/db-fixtures.ts';
import {
  CLIENT_ORIGIN,
  SECURE_ORIGIN,
  SECURE_SERVER_PORT,
  SELF_NAME,
  SEEDED_ARTIFACTS,
  SERVER_ORIGIN,
} from './origins.ts';
import { generateCertificate, startSecureVenue } from './tls.ts';

const here = resolve(fileURLToPath(import.meta.url), '..');
const SERVER_ROOT = resolve(here, '../../server');
const CLIENT_ROOT = resolve(here, '..');

// Re-exported so the committed P10-BR2 spec keeps importing exactly what it
// already imports. The values themselves now live in the zero-import leaf.
export {
  ALT_CLIENT_ORIGIN,
  CLIENT_ORIGIN,
  SECURE_ORIGIN,
  SECURE_SESSION_COOKIE,
  SEEDED_ARTIFACTS,
  SELF_NAME,
  SERVER_ORIGIN,
  SESSION_COOKIE,
} from './origins.ts';

export interface Fixture {
  readonly secret: string;
  readonly selfId: string;
  readonly selfName: string;
  readonly artifactCount: number;
}

const FIXTURE_FILE = join(tmpdir(), 'selves-p10-br2-fixture.json');

export const readFixture = (): Fixture =>
  JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;

/** §8 — the database-shadowing fence, reusing the P10-CB1 precedent exactly:
 *  ask the server it actually reached where it lives. A host-native PostgreSQL
 *  answers from a loopback address; the committed Docker service answers from
 *  its bridge address. Anything on 127.0.0.1 or ::1 is the shadowing condition
 *  P10-CB1 diagnosed, and it halts before anything else runs. */
async function proveDatabaseTarget(): Promise<string> {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined) throw new Error('TEST_DATABASE_URL is not set');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ addr: string | null; db: string }>(
      'SELECT inet_server_addr()::text AS addr, current_database() AS db',
    );
    const addr = rows[0]?.addr ?? null;
    const db = rows[0]?.db ?? '';
    if (addr === null || addr.startsWith('127.') || addr === '::1') {
      throw new Error(
        `DATABASE SHADOWING FENCE: the committed test target reached a server at ` +
          `${addr ?? 'a local socket'} (database ${db}). A host-native PostgreSQL is ` +
          `capturing the committed port, exactly as diagnosed under P10-CB1. Halting.`,
      );
    }
    return `${db} @ ${addr}`;
  } finally {
    await client.end();
  }
}

/** Poll a positive readiness condition. No blind sleeps: the loop ends only on
 *  an answer from the process it is waiting for. */
async function waitForOk(url: string, what: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${what} did not become ready at ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const children: ChildProcess[] = [];
const closers: Array<() => void> = [];

function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  children.push(child);
  return child;
}

/** Playwright calls this once before the run. Returning a function registers
 *  it as the global teardown, so startup and shutdown stay in one place and no
 *  second module is required. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // 1 — the shadowing fence, before anything depends on the database.
  const reached = await proveDatabaseTarget();
  process.stdout.write(`[P10-BR2] database target proven: ${reached}\n`);

  // 2 — the committed bootstrap and migrate-from-zero path, reused unchanged.
  //     It resolves its own scripts relative to the server workspace.
  const previousCwd = process.cwd();
  process.chdir(SERVER_ROOT);
  try {
    await serverGlobalSetup();
  } finally {
    process.chdir(previousCwd);
  }

  // 3 — fixture preparation. Privileged, direct to the database, and expressly
  //     not part of the journey the spec observes.
  const boot = bootstrapPool();
  const su = testPool();
  try {
    const account = await enroll(boot, { name: SELF_NAME });
    for (let i = 0; i < SEEDED_ARTIFACTS; i += 1) {
      await newTextArtifact(su, account.selfId, `seeded ${i + 1}`);
    }
    writeFileSync(
      FIXTURE_FILE,
      JSON.stringify({
        secret: account.secret,
        selfId: account.selfId,
        selfName: SELF_NAME,
        artifactCount: SEEDED_ARTIFACTS,
      } satisfies Fixture),
    );
  } finally {
    await boot.end();
    await su.end();
  }

  // 4 — the production server, against the test database. The connection
  //     string is supplied to the child rather than written to any env file,
  //     and `--env-file` is deliberately not used so no override question
  //     arises: the committed loader above has already placed every value in
  //     this process's environment.
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DATABASE_URL: process.env.TEST_APP_DATABASE_URL,
    PORT: '8080',
    HOST: '127.0.0.1',
  };
  start(process.execPath, ['src/server.ts'], SERVER_ROOT, serverEnv);
  await waitForOk(`${SERVER_ORIGIN}/health`, 'the production server');

  // 5 — the production client, served by the committed Vite configuration, so
  //     the browser loads the real App and the committed `/api` proxy carries
  //     its requests to the server started above.
  start('npm', ['run', 'dev'], CLIENT_ROOT, { ...process.env });
  await waitForOk(CLIENT_ORIGIN, 'the Vite client');

  // 6 — P10-BR3: a SECOND production server process, identical code, configured
  //     through the committed environment path with the secure cookie flag set.
  //     `server/src/config.ts` reads `SELVES_COOKIE_SECURE` and answers with the
  //     `__Host-` cookie name and the Secure attribute; nothing here constructs
  //     a cookie, renames one, or edits the production cookie implementation.
  //     Its CORS allowlist is the https origin the browser will actually use,
  //     because the committed origin hook refuses state-changing requests from
  //     an origin outside the allowlist and the login act is one.
  const secureServerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    APP_DATABASE_URL: process.env.TEST_APP_DATABASE_URL,
    PORT: String(SECURE_SERVER_PORT),
    HOST: '127.0.0.1',
    SELVES_COOKIE_SECURE: 'true',
    SELVES_CORS_ORIGINS: SECURE_ORIGIN,
  };
  start(process.execPath, ['src/server.ts'], SERVER_ROOT, secureServerEnv);
  await waitForOk(`http://127.0.0.1:${SECURE_SERVER_PORT}/health`, 'the secure-cookie server');

  // 7 — P10-BR3: the TLS terminator, so the browser has a genuine secure origin
  //     to hold a `__Host-` cookie against. It forwards bytes and decides
  //     nothing.
  const secureVenue = startSecureVenue(generateCertificate());
  closers.push(() => secureVenue.close());

  // Teardown: nothing the apparatus started outlives the run.
  return async () => {
    for (const close of closers.splice(0, closers.length)) {
      close();
    }
    for (const child of children.splice(0, children.length)) {
      child.kill('SIGTERM');
    }
  };
}
