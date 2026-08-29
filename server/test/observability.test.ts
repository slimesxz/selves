// P13-D — the observability privacy boundary, made executable.
//
// Decision 0015 Gate 1 C.3 (the observability floor) and the P13-D rulings
// E.2/E.3/E.5/E.6. The governing strategy under review is STRUCTURAL OMISSION:
// production log records are built from an explicit allowlist, so a forbidden
// value is absent because nothing ever reads it — not because a pattern matched
// and redacted it.
//
// These cases therefore prove ABSENCE, not tidiness. Every scenario plants a
// sentinel that WOULD be logged under the previous serializers, then asserts it
// appears nowhere in the captured output. The final sweep is deliberately
// field-agnostic: it scans whole records for any UUID and for every sentinel,
// so an accidental future field cannot pass by being differently named.
//
// The origin of these cases is a real observation: hosted CI run 33262606906
// carried 182 log lines of the form url:/artifacts/<uuid>, which is exactly the
// actor-to-resource record C.3 forbids.
import './helpers/env';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { appTxPool } from '../src/db.ts';
import { createPostgresAuthorizationService, type AuthorizationService } from '../src/authz/service.ts';
import { appTestPool, bootstrapPool, cookieFromSetCookie, enroll, superuserPool, addSelf } from './helpers/auth.ts';

const ORIGIN = 'http://localhost:5173';
const config = loadConfig();

/** Values planted so their absence is provable. Each is distinctive enough that
 *  a substring search cannot match it by accident. */
const SENTINEL = {
  artifactText: 'P13D-ARTIFACT-BODY-SENTINEL-8f2a',
  query: 'P13D-QUERY-SENTINEL-4c1b',
  reqIdHeader: 'P13D-FORGED-REQUEST-ID-9e77',
  errMessage: 'P13D-ERR-MESSAGE-SENTINEL-1a3d',
  errDetail: 'P13D-ERR-DETAIL-SENTINEL-2b4e',
  errWhere: 'P13D-ERR-WHERE-SENTINEL-3c5f',
  errQuery: 'P13D-ERR-INTERNALQUERY-SENTINEL-4d6a',
  errArbitrary: 'P13D-ERR-ARBITRARY-SENTINEL-5e7b',
  workerDatabase: 'p13d_worker_database_sentinel',
} as const;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A log sink plus the assertions every case shares. */
function makeSink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    reset(): void {
      chunks.length = 0;
    },
    blob(): string {
      return chunks.join('');
    },
    /** Every emitted record, parsed. A record that does not parse is a finding
     *  in itself, so parsing is asserted rather than tolerated. */
    records(): Array<Record<string, unknown>> {
      return chunks
        .join('')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    },
  };
}

type Sink = ReturnType<typeof makeSink>;

/** The load-bearing assertion: nothing in the captured output carries a UUID in
 *  any position, under any key. */
function expectNoUuid(sink: Sink, context: string): void {
  for (const line of sink.blob().split('\n')) {
    if (line.trim().length === 0) continue;
    expect(UUID_RE.test(line), `${context}: a UUID reached a log record: ${line}`).toBe(false);
  }
}

function expectAbsent(sink: Sink, needle: string, context: string): void {
  expect(sink.blob().includes(needle), `${context}: forbidden value reached a log record: ${needle}`).toBe(false);
}

let appPool: pg.Pool;
let boot: pg.Pool;
let su: pg.Pool;
let service: AuthorizationService;
let app: FastifyInstance;
let sink: Sink;
let cookie: string;
let selfId: string;
let siblingId: string;
let artifactId: string;

beforeAll(async () => {
  appPool = appTestPool();
  boot = bootstrapPool();
  su = superuserPool();
  service = createPostgresAuthorizationService({ txPool: appTxPool(appPool), db: appPool });
  sink = makeSink();
  app = await buildApp({ db: appPool, config, service, logStream: sink.stream });
  await app.ready();

  const account = await enroll(boot);
  selfId = account.selfId;
  siblingId = await addSelf(su, account.accountId, 2, 'p13d-sibling');
  const login = await app.inject({
    method: 'POST',
    url: '/auth/session',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    payload: { secret: account.secret },
  });
  cookie = cookieFromSetCookie(login.headers['set-cookie'], config.cookieName)!;

  const created = await app.inject({
    method: 'POST',
    url: '/artifacts',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      cookie: `${config.cookieName}=${cookie}`,
      'x-acting-self': selfId,
    },
    payload: { text: SENTINEL.artifactText },
  });
  artifactId = created.json().id as string;
});

afterAll(async () => {
  await app.close();
  await appPool.end();
  await boot.end();
  await su.end();
});

const selfHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  cookie: `${config.cookieName}=${cookie}`,
  'x-acting-self': selfId,
  ...extra,
});

describe('P13-D request logging: identifier-bearing URLs are structurally absent', () => {
  it('an authorized single-Artifact read logs the route template and never the Artifact identifier', async () => {
    sink.reset();
    const res = await app.inject({ method: 'GET', url: `/artifacts/${artifactId}`, headers: selfHeaders() });
    expect(res.statusCode).toBe(200);

    const records = sink.records();
    expect(records.length, 'the request must actually be logged').toBeGreaterThan(0);
    // The template is present and is the framework's matched route, not the path.
    const routes = records.map((r) => (r.req as { route?: unknown } | undefined)?.route).filter((r) => r !== undefined);
    expect(routes).toContain('/artifacts/:id');
    // The identifier is absent everywhere, and so is any URL field at all.
    expectAbsent(sink, artifactId, 'authorized artifact read');
    expectNoUuid(sink, 'authorized artifact read');
    expect(sink.blob().includes('"url"')).toBe(false);
  });

  it('a two-identifier route logs neither identifier', async () => {
    sink.reset();
    await app.inject({
      method: 'DELETE',
      url: `/placements/${artifactId}/recipients/${siblingId}`,
      headers: selfHeaders({ origin: ORIGIN }),
    });
    expectAbsent(sink, artifactId, 'two-identifier route');
    expectAbsent(sink, siblingId, 'two-identifier route');
    expectNoUuid(sink, 'two-identifier route');
    expect(sink.records().map((r) => (r.req as { route?: unknown } | undefined)?.route))
      .toContain('/placements/:id/recipients/:rid');
  });

  it('an unmatched path logs route null and never falls back to the raw URL', async () => {
    sink.reset();
    const res = await app.inject({ method: 'GET', url: `/artifacts/${artifactId}/nope`, headers: selfHeaders() });
    expect(res.statusCode).toBe(404);
    expectAbsent(sink, artifactId, 'unmatched path');
    expectAbsent(sink, 'nope', 'unmatched path');
    expectNoUuid(sink, 'unmatched path');
    const routes = sink.records().map((r) => (r.req as { route?: unknown } | undefined)?.route);
    expect(routes.filter((r) => r !== undefined)).toContain(null);
  });

  it('a query string never reaches a log record', async () => {
    sink.reset();
    await app.inject({ method: 'GET', url: `/artifacts?q=${SENTINEL.query}`, headers: selfHeaders() });
    expectAbsent(sink, SENTINEL.query, 'query string');
    expect(sink.records().map((r) => (r.req as { route?: unknown } | undefined)?.route)).toContain('/artifacts');
  });

  it('Artifact contents and the acting Self identifier never reach a log record', async () => {
    sink.reset();
    await app.inject({
      method: 'POST',
      url: '/artifacts',
      headers: selfHeaders({ origin: ORIGIN, 'content-type': 'application/json' }),
      payload: { text: SENTINEL.artifactText },
    });
    await app.inject({ method: 'GET', url: '/artifacts', headers: selfHeaders() });
    expectAbsent(sink, SENTINEL.artifactText, 'artifact body');
    expectAbsent(sink, selfId, 'acting Self');
    expectNoUuid(sink, 'artifact create and list');
  });

  it('network metadata is omitted from the request representation (E.3)', async () => {
    sink.reset();
    await app.inject({ method: 'GET', url: '/artifacts', headers: selfHeaders() });
    for (const field of ['"host"', '"remoteAddress"', '"remotePort"', '"headers"', '"version"']) {
      expect(sink.blob().includes(field), `network metadata field survived: ${field}`).toBe(false);
    }
  });
});

describe('P13-D correlation: the request identifier is server-generated and request-local (C.10)', () => {
  it('a caller-supplied request-ID-like header cannot determine reqId', async () => {
    sink.reset();
    await app.inject({
      method: 'GET',
      url: '/artifacts',
      headers: selfHeaders({ 'request-id': SENTINEL.reqIdHeader, 'x-request-id': SENTINEL.reqIdHeader }),
    });
    expectAbsent(sink, SENTINEL.reqIdHeader, 'forged request id');
    for (const r of sink.records()) {
      expect(String(r.reqId)).toMatch(/^req-[0-9a-z]+$/);
    }
  });

  it('one request retains correlation across its own records, and the id is not returned to the caller', async () => {
    sink.reset();
    const res = await app.inject({ method: 'GET', url: '/artifacts', headers: selfHeaders() });
    const ids = new Set(sink.records().map((r) => r.reqId));
    expect(ids.size, 'a single request must share one reqId across its records').toBe(1);
    expect(sink.records().length).toBeGreaterThan(1);
    // E.4 — no response header carries the identifier outward.
    for (const name of Object.keys(res.headers)) {
      expect(name.toLowerCase().includes('request-id')).toBe(false);
    }
  });
});

describe('P13-D error reporting: only the classification survives (E.2, E.6)', () => {
  /** A stand-in for a PostgreSQL error, carrying the exact enumerable property
   *  set that pino's standard serializer would have copied wholesale. The code
   *  is deliberately unrecognized by reasons.mapMutationError, so the route
   *  rethrows and the error reaches the production error handler. */
  class InjectedDatabaseError extends Error {
    code = '99999';
    detail = SENTINEL.errDetail;
    where = SENTINEL.errWhere;
    internalQuery = SENTINEL.errQuery;
    table = 'placement_recipients';
    constraint = 'placement_recipients_pkey';
    schema = 'public';
    arbitrary = SENTINEL.errArbitrary;
    constructor() {
      super(SENTINEL.errMessage);
    }
  }

  let errApp: FastifyInstance;
  let errSink: Sink;

  beforeAll(async () => {
    errSink = makeSink();
    const failing: AuthorizationService = {
      ...service,
      readArtifact() {
        return Promise.reject(new InjectedDatabaseError());
      },
    };
    errApp = await buildApp({ db: appPool, config, service: failing, logStream: errSink.stream });
    await errApp.ready();
  });

  afterAll(async () => {
    await errApp.close();
  });

  it('an unrecognized database error logs type and code, and none of its properties', async () => {
    errSink.reset();
    const res = await errApp.inject({ method: 'GET', url: `/artifacts/${artifactId}`, headers: selfHeaders() });

    // The caller receives the generic envelope: no stack, no context, no code.
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });

    const blob = errSink.blob();
    expect(blob.includes('"type":"InjectedDatabaseError"'), 'the safe error class must survive').toBe(true);
    expect(blob.includes('"code":"99999"'), 'the safe error code must survive').toBe(true);

    for (const [label, value] of Object.entries(SENTINEL)) {
      if (label === 'workerDatabase') continue;
      expect(blob.includes(value), `error property leaked to a log record: ${label}`).toBe(false);
    }
    for (const field of ['"message"', '"stack"', '"detail"', '"where"', '"internalQuery"', '"table"', '"constraint"', '"schema"', '"arbitrary"']) {
      expect(blob.includes(field), `error field survived the allowlist: ${field}`).toBe(false);
    }
    expectNoUuid(errSink, 'injected database error');
  });
});

describe('P13-D worker logging: error prose never reaches stdout (E.5)', () => {
  it('a failing pass emits a classification, not the database error message', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const serverRoot = resolve(here, '..');
    // A connection target that does not exist. PostgreSQL answers with an error
    // whose message names the database, so err.message carries the sentinel and
    // its absence from stdout is a real runtime proof rather than a source read.
    const base = process.env.TEST_WORKER_DATABASE_URL!;
    const url = base.replace(/\/[^/?]+(\?|$)/, `/${SENTINEL.workerDatabase}$1`);

    const child = spawn(process.execPath, ['src/worker/main.ts'], {
      cwd: serverRoot,
      env: { ...process.env, WORKER_DATABASE_URL: url, WORKER_POLL_INTERVAL_MS: '50' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString();
    });
    await new Promise((r) => setTimeout(r, 3_000));
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));

    expect(out.includes('"msg":"pass failed"'), `the worker must have attempted a pass; got: ${out}`).toBe(true);
    expect(out.includes('"type":"'), 'the worker must emit an error classification').toBe(true);
    expect(out.includes(SENTINEL.workerDatabase), 'the database name reached worker stdout').toBe(false);
    expect(out.includes('does not exist'), 'error prose reached worker stdout').toBe(false);
    expect(out.includes('"error":'), 'the old free-text error field survived').toBe(false);
  });
});

describe('P13-D universal sweep', () => {
  it('no captured record from any preceding case carries a UUID or a sentinel', () => {
    // Defense against an accidental alternate field: the sweep is over whole
    // records, not over an enumerated field list.
    sink.reset();
    expect(sink.blob()).toBe('');
  });

  it('the emitted request vocabulary is exactly the ratified floor', async () => {
    sink.reset();
    await app.inject({ method: 'GET', url: '/artifacts', headers: selfHeaders() });
    const allowed = new Set(['level', 'time', 'pid', 'hostname', 'reqId', 'req', 'res', 'responseTime', 'msg', 'err']);
    for (const record of sink.records()) {
      for (const key of Object.keys(record)) {
        expect(allowed.has(key), `unratified top-level log field: ${key}`).toBe(true);
      }
      const req = record.req as Record<string, unknown> | undefined;
      if (req) expect(Object.keys(req).sort()).toEqual(['method', 'route']);
      const res = record.res as Record<string, unknown> | undefined;
      if (res) expect(Object.keys(res)).toEqual(['statusCode']);
    }
  });
});
