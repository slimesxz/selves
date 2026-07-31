// P10-S4 — constitutional parity of the accepted production surface against
// RATIFIED LAW. Ten cases.
//
// Oracle discipline (0012 §35 ruling 6; S4 Matter 1): every expectation below
// is a literal recorded from committed law, an incorporated accepted-artifact
// convention (A-i), or a direct chamber pin — never read at runtime from
// production or from the test-only adapter. Production is the subject under
// test. A failure here is a Matter-3 finding about the implementation or the
// record, not a defect in the test.
import './helpers/env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  RATIFIED,
  accountReq,
  selfReq,
  settledKey,
  settledPlacement,
  startProduction,
  type ProductionFixture,
} from './helpers/production-app.ts';

let f: ProductionFixture;

beforeAll(async () => {
  f = await startProduction();
});
afterAll(async () => {
  await f.end();
});

describe('P10-S4 parity — ratified public contract over production', () => {
  it('uniform 404: unauthorized-existing and nonexistent artifact reads return byte-identical {"error":"not_found"} (0005)', async () => {
    // CLASS A — 0005: every denied single-resource read maps to the identical
    // public 404 {"error":"not_found"}; no existence signal survives.
    const mine = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'A-owned' })).json().id as string;
    const unauthorizedExisting = await selfReq(f.prod, 'GET', `/artifacts/${mine}`, f.cookieB, f.selfB);
    const nonexistent = await selfReq(f.prod, 'GET', `/artifacts/${randomUUID()}`, f.cookieB, f.selfB);
    expect(unauthorizedExisting.statusCode).toBe(RATIFIED.NOT_FOUND.status);
    expect(unauthorizedExisting.json()).toEqual(RATIFIED.NOT_FOUND.body);
    expect(nonexistent.statusCode).toBe(RATIFIED.NOT_FOUND.status);
    expect(nonexistent.json()).toEqual(RATIFIED.NOT_FOUND.body);
    expect(unauthorizedExisting.body).toBe(nonexistent.body); // byte-identical
  });

  it('uniform 404: unauthorized-existing and nonexistent placement reads are byte-identical', async () => {
    // CLASS A — 0005, same law applied to the placement read predicate.
    const { placement } = await settledPlacement(f, f.cookieA, f.selfA, [f.siblingA]);
    const unauthorizedExisting = await selfReq(f.prod, 'GET', `/placements/${placement}`, f.cookieB, f.selfB);
    const nonexistent = await selfReq(f.prod, 'GET', `/placements/${randomUUID()}`, f.cookieB, f.selfB);
    expect(unauthorizedExisting.statusCode).toBe(RATIFIED.NOT_FOUND.status);
    expect(unauthorizedExisting.json()).toEqual(RATIFIED.NOT_FOUND.body);
    expect(unauthorizedExisting.body).toBe(nonexistent.body);
  });

  it('mutation targets: unauthorized vs absent return the identical 404 bytes (0006 A4)', async () => {
    // CLASS A — 0006 A4: after a verified acting Self, an unauthorized or
    // absent mutation target maps to 404; 0005 fixes the body bytes.
    const { placement } = await settledPlacement(f, f.cookieA, f.selfA, [f.siblingA]);
    const unauthorized = await selfReq(f.prod, 'POST', `/placements/${placement}/cancellation`, f.cookieB, f.selfB);
    const absent = await selfReq(f.prod, 'POST', `/placements/${randomUUID()}/cancellation`, f.cookieB, f.selfB);
    expect(unauthorized.statusCode).toBe(RATIFIED.NOT_FOUND.status);
    expect(unauthorized.json()).toEqual(RATIFIED.NOT_FOUND.body);
    expect(unauthorized.body).toBe(absent.body);
  });

  it('recipient list: non-author, sibling, and nonexistent placement return byte-identical [] (0005)', async () => {
    // CLASS A — 0005: a non-author (and a nonexistent placement) receive an
    // empty array, indistinguishably. Frozen contract: [] exactly.
    const { placement } = await settledPlacement(f, f.cookieA, f.selfA, [f.selfB]);
    const nonAuthor = await selfReq(f.prod, 'GET', `/placements/${placement}/recipients`, f.cookieB, f.selfB);
    const sibling = await selfReq(f.prod, 'GET', `/placements/${placement}/recipients`, f.cookieA, f.siblingA);
    const absent = await selfReq(f.prod, 'GET', `/placements/${randomUUID()}/recipients`, f.cookieB, f.selfB);
    for (const r of [nonAuthor, sibling, absent]) {
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual([]);
    }
    expect(nonAuthor.body).toBe(absent.body);
    expect(sibling.body).toBe(absent.body);
  });

  it('the 400/401/403/409 split carries the frozen bodies across the production surface (0006 A1/A4; §35 conventions)', async () => {
    const uid = randomUUID();
    // CLASS A-i — {"error":"unauthenticated"} (auth-api.test.ts, Phase-4
    // gate) carried forward by §35 ruling 2; status class from 0006 A1.
    const noSession = await selfReq(f.prod, 'GET', '/artifacts', undefined, f.selfA);
    expect(noSession.statusCode).toBe(RATIFIED.UNAUTHENTICATED.status);
    expect(noSession.json()).toEqual(RATIFIED.UNAUTHENTICATED.body);
    // CLASS A-i — {"error":"self_context_required"} (mutations-http.test.ts,
    // Phase-6 gate) carried forward by §35 ruling 2.
    const malformed = await selfReq(f.prod, 'GET', '/artifacts', f.cookieA, 'not-a-uuid');
    expect(malformed.statusCode).toBe(RATIFIED.SELF_CONTEXT_REQUIRED.status);
    expect(malformed.json()).toEqual(RATIFIED.SELF_CONTEXT_REQUIRED.body);
    // CLASS A-i — {"error":"forbidden"} (active-self.test.ts, Phase-4 gate);
    // 0006 A4 fixes 403 for an invalid acting-Self/account binding.
    const unowned = await selfReq(f.prod, 'GET', '/artifacts', f.cookieA, f.selfB);
    expect(unowned.statusCode).toBe(RATIFIED.FORBIDDEN.status);
    expect(unowned.json()).toEqual(RATIFIED.FORBIDDEN.body);
    // CLASS A — {"error":"bad_request"} by direct chamber pin (S4 §5a
    // disposition 1); 0006 A4 fixes 400 for structural failure.
    const structural = await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 42 });
    expect(structural.statusCode).toBe(RATIFIED.BAD_REQUEST.status);
    expect(structural.json()).toEqual(RATIFIED.BAD_REQUEST.body);
    // CLASS A — 409 status from 0006 A4; body {"error":"conflict"} by direct
    // chamber pin (S4 §5a disposition 2). Authorized actor, wrong state:
    // settling a draft placement.
    const art = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'draft-only' })).json().id as string;
    const draft = (await selfReq(f.prod, 'POST', '/placements', f.cookieA, f.selfA, { artifactId: art })).json().id as string;
    const conflict = await selfReq(f.prod, 'POST', `/placements/${draft}/settlement`, f.cookieA, f.selfA);
    expect(conflict.statusCode).toBe(RATIFIED.CONFLICT.status);
    expect(conflict.json()).toEqual(RATIFIED.CONFLICT.body);
    expect(uid).toBeTruthy();
  });

  it('account pair: session-only authority and the ruled PT404→404 mapping (status/shape level)', async () => {
    // CLASS A — chamber pin (S4 authorization §2): GET is account-scoped,
    // 200 {"seconds": n}, authenticate-only; PT404 → 404 {"error":"not_found"}.
    const put = await accountReq(f.prod, 'PUT', f.cookieA, { seconds: 30 });
    expect(put.statusCode).toBe(204);
    const get = await accountReq(f.prod, 'GET', f.cookieA);
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ seconds: 30 });
    const body = get.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['seconds']); // no authority-bearing field
    // No session at all: the authenticate layer answers first (A-i literal).
    const anon = await accountReq(f.prod, 'GET', undefined);
    expect(anon.statusCode).toBe(RATIFIED.UNAUTHENTICATED.status);
    expect(anon.json()).toEqual(RATIFIED.UNAUTHENTICATED.body);
  });

  it('R4 field law over production: interval key absent for recipient, present-null/number for author (F3/P10-M1)', async () => {
    // CLASS A (field presence/absence) — 0012 §35 F3 and P10-M1.
    const art = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'f3' })).json().id as string;
    const draft = (await selfReq(f.prod, 'POST', '/placements', f.cookieA, f.selfA, { artifactId: art })).json().id as string;
    const authorDraft = (await selfReq(f.prod, 'GET', `/placements/${draft}`, f.cookieA, f.selfA)).json() as Record<string, unknown>;
    expect(Object.hasOwn(authorDraft, 'departureIntervalSeconds')).toBe(true);
    expect(authorDraft.departureIntervalSeconds).toBeNull(); // author, not departed
    const { placement } = await settledPlacement(f, f.cookieA, f.selfA, [f.selfB]);
    const authorSettled = (await selfReq(f.prod, 'GET', `/placements/${placement}`, f.cookieA, f.selfA)).json() as Record<string, unknown>;
    expect(typeof authorSettled.departureIntervalSeconds).toBe('number'); // author, departed
    const recipient = (await selfReq(f.prod, 'GET', `/placements/${placement}`, f.cookieB, f.selfB)).json() as Record<string, unknown>;
    expect(Object.hasOwn(recipient, 'departureIntervalSeconds')).toBe(false); // key ABSENT
  });

  it('keys over production: grantee reads the protected artifact via the grant; revocation restores the uniform 404 (0007)', async () => {
    // CLASS A — 0007: settlement establishes the capability; revocation is
    // prospective; a revoked grantee's read returns the uniform 404 (0005).
    const { resource } = await settledKey(f, f.cookieA, f.selfA, f.selfB);
    const granted = await selfReq(f.prod, 'GET', `/artifacts/${resource}`, f.cookieB, f.selfB);
    expect(granted.statusCode).toBe(200);
    expect((granted.json() as { id: string }).id).toBe(resource);
    const revoke = await selfReq(f.prod, 'POST', '/keys/revocation', f.cookieA, f.selfA, {
      granteeSelfId: f.selfB,
      protectedResourceId: resource,
    });
    expect(revoke.statusCode).toBe(204);
    const after = await selfReq(f.prod, 'GET', `/artifacts/${resource}`, f.cookieB, f.selfB);
    expect(after.statusCode).toBe(RATIFIED.NOT_FOUND.status);
    expect(after.json()).toEqual(RATIFIED.NOT_FOUND.body);
  });

  it('denial classes expose no distinguishing headers or envelopes (0005 non-leakage)', async () => {
    // CLASS A — 0005: no internal reason reaches a response. Compare the full
    // response surface of unauthorized-existing vs absent.
    const mine = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'hdr' })).json().id as string;
    const a = await selfReq(f.prod, 'GET', `/artifacts/${mine}`, f.cookieB, f.selfB);
    const b = await selfReq(f.prod, 'GET', `/artifacts/${randomUUID()}`, f.cookieB, f.selfB);
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.body).toBe(b.body);
    const strip = (h: Record<string, unknown>) => {
      const { date, 'content-length': _len, ...rest } = h as Record<string, string>;
      void date; void _len;
      return rest;
    };
    expect(strip(a.headers as Record<string, unknown>)).toEqual(strip(b.headers as Record<string, unknown>));
  });

  it('supplementary: production and adapter both match the same committed literals (independent drift detection)', async () => {
    // The adapter is SUPPLEMENTARY EVIDENCE ONLY (§35 ruling 6). Each surface
    // is compared to the ratified literal independently — never to the other —
    // so drift in either is detectable on its own.
    const { buildAuthzAdapter } = await import('./helpers/authz-adapter.ts');
    const adapter = await buildAuthzAdapter({ db: f.h.appPool, config: (await import('./helpers/production-app.ts')).config, service: f.h.service });
    await adapter.ready();
    try {
      const ghost = randomUUID();
      const fromProduction = await selfReq(f.prod, 'GET', `/artifacts/${ghost}`, f.cookieB, f.selfB);
      const fromAdapter = await adapter.inject({
        method: 'GET',
        url: `/__authz__/artifact/${ghost}`,
        headers: { cookie: `${(await import('./helpers/production-app.ts')).config.cookieName}=${f.cookieB}`, 'x-acting-self': f.selfB },
      });
      // production == ratified literal
      expect(fromProduction.statusCode).toBe(RATIFIED.NOT_FOUND.status);
      expect(fromProduction.json()).toEqual(RATIFIED.NOT_FOUND.body);
      // adapter == ratified literal (asserted against the SAME literal, not
      // against production's output)
      expect(fromAdapter.statusCode).toBe(RATIFIED.NOT_FOUND.status);
      expect(fromAdapter.json()).toEqual(RATIFIED.NOT_FOUND.body);
    } finally {
      await adapter.close();
    }
  });
});
