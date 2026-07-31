// P10-S4 test support — shared production-app harness for the parity and
// matrix suites. Support only: it declares ZERO test cases.
//
// Oracle discipline (0012 §35 ruling 6; S4 authorization Matter 1): this
// module builds the REAL production app and supplies fixtures. It never
// supplies an expected value. Every constitutional expectation lives in the
// suites as a literal with recorded provenance; no expected byte is read at
// runtime from production or from the test-only adapter.
import '../helpers/env';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { addSelf, bootstrapPool, cookieFromSetCookie, enroll } from './auth.ts';
import { makeAuthz, type AuthzHarness } from './authz.ts';

export const config = loadConfig();

/** The ratified public failure bodies, recorded as literals with provenance.
 *  CLASS A  — directly ledger-quoted or directly chamber-pinned.
 *  CLASS A-i — incorporated accepted-artifact literal carried forward by
 *              0012 §35 ruling 2 ("Status and body conventions carry from the
 *              adapter unchanged"). A-i is NOT direct ledger quotation. */
export const RATIFIED = {
  /** CLASS A — decision 0005 §non-leakage, quoted verbatim: the identical
   *  public `404 {"error":"not_found"}`. */
  NOT_FOUND: { status: 404, body: { error: 'not_found' } },
  /** CLASS A-i — accepted artifact auth-api.test.ts (Phase-4 gate) fixes the
   *  literal; §35 ruling 2 carries the convention into production. */
  UNAUTHENTICATED: { status: 401, body: { error: 'unauthenticated' } },
  /** CLASS A-i — accepted artifact active-self.test.ts (Phase-4 gate). */
  FORBIDDEN: { status: 403, body: { error: 'forbidden' } },
  /** CLASS A-i — accepted artifact mutations-http.test.ts (Phase-6 gate). */
  SELF_CONTEXT_REQUIRED: { status: 400, body: { error: 'self_context_required' } },
  /** CLASS A — direct chamber pin, P10-S4 section-5a disposition §1. */
  BAD_REQUEST: { status: 400, body: { error: 'bad_request' } },
  /** CLASS A — 409 status from 0006 A4; body by direct chamber pin, §2. */
  CONFLICT: { status: 409, body: { error: 'conflict' } },
} as const;

export interface ProductionFixture {
  h: AuthzHarness;
  boot: pg.Pool;
  prod: FastifyInstance;
  /** account A: sender/author, with a sibling Self in the same account */
  cookieA: string;
  selfA: string;
  siblingA: string;
  accountA: string;
  /** account B: an unrelated account and Self */
  cookieB: string;
  selfB: string;
  accountB: string;
  end(): Promise<void>;
}

export async function startProduction(): Promise<ProductionFixture> {
  const h = makeAuthz();
  const boot = bootstrapPool();
  const prod = await buildApp({ db: h.appPool, config, service: h.service });
  await prod.ready();

  const login = async (secret: string): Promise<string> => {
    const r = await prod.inject({
      method: 'POST',
      url: '/auth/session',
      headers: { origin: config.corsOrigins[0]!, 'content-type': 'application/json' },
      payload: { secret },
    });
    return cookieFromSetCookie(r.headers['set-cookie'], config.cookieName)!;
  };

  const a = await enroll(boot);
  const cookieA = await login(a.secret);
  const siblingA = await addSelf(h.su, a.accountId, 2, 's4-sibling');
  const b = await enroll(boot);
  const cookieB = await login(b.secret);

  return {
    h,
    boot,
    prod,
    cookieA,
    selfA: a.selfId,
    siblingA,
    accountA: a.accountId,
    cookieB,
    selfB: b.selfId,
    accountB: b.accountId,
    async end() {
      await prod.close();
      await boot.end();
      await h.end();
    },
  };
}

export const cookieHeader = (c: string): string => `${config.cookieName}=${c}`;

/** A Self-scoped production request: session cookie + acting-Self header. */
export function selfReq(
  prod: FastifyInstance,
  method: string,
  url: string,
  cookie: string | undefined,
  actingSelf: string | undefined,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  const opts: InjectOptions = {
    method: method as 'GET',
    url,
    headers: {
      ...(cookie ? { cookie: cookieHeader(cookie) } : {}),
      ...(actingSelf ? { 'x-acting-self': actingSelf } : {}),
      ...(method !== 'GET' ? { origin: config.corsOrigins[0]! } : {}),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  };
  return prod.inject(opts);
}

/** An account-scoped production request: session cookie only. Extra headers
 *  may be supplied to prove they confer nothing. */
export function accountReq(
  prod: FastifyInstance,
  method: string,
  cookie: string | undefined,
  payload?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const opts: InjectOptions = {
    method: method as 'GET',
    url: '/account/departure-interval',
    headers: {
      ...(cookie ? { cookie: cookieHeader(cookie) } : {}),
      ...(method !== 'GET' ? { origin: config.corsOrigins[0]! } : {}),
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  };
  return prod.inject(opts);
}

/** Move a departing placement past its snapshotted floor (fixture support;
 *  the real state machine still performs the transition). */
export function rewindPastFloor(f: ProductionFixture, placementId: string): Promise<unknown> {
  return f.h.su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [placementId],
  );
}

/** Author a settled text placement from `self` to `recipients`, through the
 *  production surface only. Returns the artifact and placement ids. */
export async function settledPlacement(
  f: ProductionFixture,
  cookie: string,
  self: string,
  recipients: string[],
  text = 's4 body',
): Promise<{ artifact: string; placement: string }> {
  const artifact = (await selfReq(f.prod, 'POST', '/artifacts', cookie, self, { text })).json().id as string;
  const placement = (await selfReq(f.prod, 'POST', '/placements', cookie, self, { artifactId: artifact })).json().id as string;
  for (const r of recipients) {
    await selfReq(f.prod, 'POST', `/placements/${placement}/recipients`, cookie, self, { recipientSelfId: r });
  }
  await selfReq(f.prod, 'POST', `/placements/${placement}/departure`, cookie, self);
  await rewindPastFloor(f, placement);
  await selfReq(f.prod, 'POST', `/placements/${placement}/settlement`, cookie, self);
  return { artifact, placement };
}

/** A settled Key placement granting `grantee` access to a protected artifact. */
export async function settledKey(
  f: ProductionFixture,
  cookie: string,
  self: string,
  grantee: string,
): Promise<{ resource: string; keyPlacement: string }> {
  const resource = (await selfReq(f.prod, 'POST', '/artifacts', cookie, self, { text: 's4 protected' })).json().id as string;
  const keyPlacement = (await selfReq(f.prod, 'POST', '/key-placements', cookie, self, { protectedResourceId: resource })).json().id as string;
  await selfReq(f.prod, 'POST', `/placements/${keyPlacement}/recipients`, cookie, self, { recipientSelfId: grantee });
  await selfReq(f.prod, 'POST', `/placements/${keyPlacement}/departure`, cookie, self);
  await rewindPastFloor(f, keyPlacement);
  await selfReq(f.prod, 'POST', `/placements/${keyPlacement}/settlement`, cookie, self);
  return { resource, keyPlacement };
}

/** The fourteen Self-scoped routes, as request templates over a placeholder
 *  id — used by the matrix suite to sweep an actor across the whole surface. */
export function selfScopedTable(uid: string): Array<[string, string, unknown?]> {
  return [
    ['GET', '/artifacts'],
    ['POST', '/artifacts', { text: 'x' }],
    ['GET', `/artifacts/${uid}`],
    ['GET', '/placements'],
    ['POST', '/placements', { artifactId: uid }],
    ['GET', `/placements/${uid}`],
    ['GET', `/placements/${uid}/recipients`],
    ['POST', `/placements/${uid}/recipients`, { recipientSelfId: uid }],
    ['DELETE', `/placements/${uid}/recipients/${uid}`],
    ['POST', `/placements/${uid}/departure`],
    ['POST', `/placements/${uid}/cancellation`],
    ['POST', `/placements/${uid}/settlement`],
    ['POST', '/key-placements', { protectedResourceId: uid }],
    ['POST', '/keys/revocation', { granteeSelfId: uid, protectedResourceId: uid }],
  ];
}
