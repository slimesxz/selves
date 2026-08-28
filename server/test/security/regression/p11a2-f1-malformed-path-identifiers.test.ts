import '../../helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  RATIFIED,
  selfReq,
  settledPlacement,
  startProduction,
  type ProductionFixture,
} from '../../helpers/production-app.ts';

// P11-C · C7 — permanent regression for defect P11A2-F1 (0013 §5).
//
// DEFECT. The three protected READ routes passed an unvalidated path identifier
// to the AuthorizationService with no error mapping, unlike every mutation
// route, which wraps its call and maps PostgreSQL 22P02 to the ratified
// 400 {"error":"bad_request"}. A malformed path identifier therefore escaped to
// the generic error handler as 500 {"error":"internal_error"}.
//
// VIOLATED CONTRACT. The ratified bad-request semantics of 0006 A4 / the
// P10-S4 chamber pin: a structurally malformed request is 400 with the frozen
// body. Nothing in the ratified contract admits 500 for caller-supplied
// malformed input. This is a fail-closed malformed-request obligation of
// Phase 11; it is NOT an existence oracle, because the distinguishing input
// class is malformed-versus-well-formed, not unauthorized-existing-versus-
// nonexistent (that pair remains byte-identical, and §4 below re-proves it).
//
// BOUNDARY. The real production app over the real route graph, real middleware
// chain, real AuthorizationService, and real PostgreSQL. Expectations are the
// ratified literals from production-app.ts; none is read from production output.

let f: ProductionFixture;
let settled: { artifact: string; placement: string };

// Malformed identifiers an authenticated caller can put in a path position.
// Each is syntactically incapable of being a uuid, so none can collide with a
// real resource; the route must classify them structurally.
const MALFORMED = ['not-a-uuid', '1', 'null', '%20', "'; DROP TABLE public.artifacts; --"];

beforeAll(async () => {
  f = await startProduction();
  settled = await settledPlacement(f, f.cookieA, f.selfA, [f.selfB], 'c7 body');
});
afterAll(async () => {
  await f.end();
});

const expectBadRequest = (r: { statusCode: number; json: () => unknown }, label: string): void => {
  expect(r.statusCode, label).toBe(RATIFIED.BAD_REQUEST.status);
  expect(r.json(), label).toEqual(RATIFIED.BAD_REQUEST.body);
};

// ── 1 · the reference contract, taken from already-ratified behaviour ────────
// The mutation routes already classify a malformed path identifier as the
// ratified 400. That established behaviour — not a newly invented taxonomy — is
// the contract the read routes must meet.
describe('C7 §1 — the ratified malformed-identifier contract (mutation routes, reference)', () => {
  it('every mutation route with a uuid-bearing path position answers the frozen 400', async () => {
    for (const bad of MALFORMED) {
      const enc = encodeURIComponent(bad);
      for (const [method, url, payload] of [
        ['POST', `/placements/${enc}/recipients`, { recipientSelfId: f.selfB }],
        ['DELETE', `/placements/${enc}/recipients/${f.selfB}`, undefined],
        ['POST', `/placements/${enc}/departure`, undefined],
        ['POST', `/placements/${enc}/cancellation`, undefined],
        ['POST', `/placements/${enc}/settlement`, undefined],
      ] as Array<[string, string, unknown]>) {
        expectBadRequest(
          await selfReq(f.prod, method, url, f.cookieA, f.selfA, payload),
          `${method} ${url}`,
        );
      }
    }
  });

  it('the SECOND uuid-bearing position of a two-identifier route is classified too', async () => {
    // :rid, not :id — a fix that validated only the first path parameter would
    // leave this adjacent position defective.
    for (const bad of MALFORMED) {
      expectBadRequest(
        await selfReq(
          f.prod,
          'DELETE',
          `/placements/${settled.placement}/recipients/${encodeURIComponent(bad)}`,
          f.cookieA,
          f.selfA,
        ),
        `DELETE :rid = ${bad}`,
      );
    }
  });
});

// ── 2 · the defect: the three protected read routes ──────────────────────────
describe('C7 §2 — P11A2-F1: the protected read routes must meet the same contract', () => {
  it('GET /artifacts/:id classifies a malformed identifier as the frozen 400, never 500', async () => {
    for (const bad of MALFORMED) {
      const r = await selfReq(f.prod, 'GET', `/artifacts/${encodeURIComponent(bad)}`, f.cookieA, f.selfA);
      expect(r.statusCode, `no internal_error for ${bad}`).not.toBe(500);
      expectBadRequest(r, `GET /artifacts/${bad}`);
    }
  });

  it('GET /placements/:id classifies a malformed identifier as the frozen 400, never 500', async () => {
    for (const bad of MALFORMED) {
      const r = await selfReq(f.prod, 'GET', `/placements/${encodeURIComponent(bad)}`, f.cookieA, f.selfA);
      expect(r.statusCode, `no internal_error for ${bad}`).not.toBe(500);
      expectBadRequest(r, `GET /placements/${bad}`);
    }
  });

  it('GET /placements/:id/recipients classifies a malformed identifier as the frozen 400, never 500', async () => {
    for (const bad of MALFORMED) {
      const r = await selfReq(
        f.prod, 'GET', `/placements/${encodeURIComponent(bad)}/recipients`, f.cookieA, f.selfA,
      );
      expect(r.statusCode, `no internal_error for ${bad}`).not.toBe(500);
      expectBadRequest(r, `GET /placements/${bad}/recipients`);
    }
  });
});

// ── 3 · the contract holds for every actor class, not just the authorized one ─
describe('C7 §3 — malformed classification does not depend on the actor', () => {
  it('an unrelated Self and a sibling Self receive the same structural 400', async () => {
    for (const [cookie, self, label] of [
      [f.cookieB, f.selfB, 'unrelated'],
      [f.cookieA, f.siblingA, 'sibling'],
    ] as Array<[string, string, string]>) {
      expectBadRequest(
        await selfReq(f.prod, 'GET', '/artifacts/not-a-uuid', cookie, self),
        `${label} artifact`,
      );
      expectBadRequest(
        await selfReq(f.prod, 'GET', '/placements/not-a-uuid', cookie, self),
        `${label} placement`,
      );
    }
  });

  it('authentication and acting-Self verification still precede structural classification', async () => {
    // A malformed identifier must not become a way to skip the middleware
    // chain: unauthenticated stays 401, unowned acting Self stays 403.
    const unauth = await selfReq(f.prod, 'GET', '/artifacts/not-a-uuid', undefined, f.selfA);
    expect(unauth.statusCode).toBe(RATIFIED.UNAUTHENTICATED.status);
    expect(unauth.json()).toEqual(RATIFIED.UNAUTHENTICATED.body);

    const unowned = await selfReq(f.prod, 'GET', '/artifacts/not-a-uuid', f.cookieA, f.selfB);
    expect(unowned.statusCode).toBe(RATIFIED.FORBIDDEN.status);
    expect(unowned.json()).toEqual(RATIFIED.FORBIDDEN.body);
  });
});

// ── 4 · the fix must not disturb the ratified denial uniformity ──────────────
describe('C7 §4 — well-formed denial uniformity is unchanged by the correction', () => {
  it('unauthorized-existing and nonexistent remain byte-identical 404s', async () => {
    const existing = await selfReq(f.prod, 'GET', `/artifacts/${settled.artifact}`, f.cookieA, f.siblingA);
    const absent = await selfReq(f.prod, 'GET', `/artifacts/${randomUUID()}`, f.cookieA, f.siblingA);
    expect(existing.statusCode).toBe(RATIFIED.NOT_FOUND.status);
    expect(absent.statusCode).toBe(RATIFIED.NOT_FOUND.status);
    expect(existing.body).toBe(absent.body);
  });

  it('a well-formed authorized read still succeeds', async () => {
    const ok = await selfReq(f.prod, 'GET', `/artifacts/${settled.artifact}`, f.cookieA, f.selfA);
    expect(ok.statusCode).toBe(200);
  });
});
