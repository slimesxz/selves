// P10-S4 — the actor/authority matrix over the accepted production surface.
// Twelve cases, one per ratified actor class (0005 test-class list; 0004 R2;
// 0006 A1/A4; 0007).
//
// Oracle discipline: every expectation is a ratified literal or a ratified
// authority/error class — never production's own output. A failure is a
// Matter-3 finding, not a test defect.
import './helpers/env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  RATIFIED,
  accountReq,
  selfReq,
  selfScopedTable,
  settledKey,
  settledPlacement,
  startProduction,
  type ProductionFixture,
} from './helpers/production-app.ts';

let f: ProductionFixture;
// A settled placement A→B, plus a draft and a departing one, for state work.
let settled: { artifact: string; placement: string };
let unsettled: string;

beforeAll(async () => {
  f = await startProduction();
  settled = await settledPlacement(f, f.cookieA, f.selfA, [f.selfB], 'matrix body');
  const art = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'matrix unsettled' })).json().id as string;
  unsettled = (await selfReq(f.prod, 'POST', '/placements', f.cookieA, f.selfA, { artifactId: art })).json().id as string;
  await selfReq(f.prod, 'POST', `/placements/${unsettled}/recipients`, f.cookieA, f.selfA, { recipientSelfId: f.selfB });
  await selfReq(f.prod, 'POST', `/placements/${unsettled}/departure`, f.cookieA, f.selfA); // departing, not settled
});
afterAll(async () => {
  await f.end();
});

const expectNotFound = (r: { statusCode: number; json: () => unknown }, label: string) => {
  expect(r.statusCode, label).toBe(RATIFIED.NOT_FOUND.status);
  expect(r.json(), label).toEqual(RATIFIED.NOT_FOUND.body);
};

describe('P10-S4 matrix — ratified actor classes over production', () => {
  it('matrix: sender — ratified success class on every applicable route', async () => {
    // 0006: only the sender Self drives every transition; the author reads
    // its own records. Success statuses per the frozen contract.
    expect((await selfReq(f.prod, 'GET', '/artifacts', f.cookieA, f.selfA)).statusCode).toBe(200);
    expect((await selfReq(f.prod, 'GET', '/placements', f.cookieA, f.selfA)).statusCode).toBe(200);
    expect((await selfReq(f.prod, 'GET', `/artifacts/${settled.artifact}`, f.cookieA, f.selfA)).statusCode).toBe(200);
    expect((await selfReq(f.prod, 'GET', `/placements/${settled.placement}`, f.cookieA, f.selfA)).statusCode).toBe(200);
    expect((await selfReq(f.prod, 'GET', `/placements/${settled.placement}/recipients`, f.cookieA, f.selfA)).statusCode).toBe(200);
    const art = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'sender ok' }));
    expect(art.statusCode).toBe(201);
    const plc = await selfReq(f.prod, 'POST', '/placements', f.cookieA, f.selfA, { artifactId: (art.json() as { id: string }).id });
    expect(plc.statusCode).toBe(201);
    const plcId = (plc.json() as { id: string }).id;
    expect((await selfReq(f.prod, 'POST', `/placements/${plcId}/recipients`, f.cookieA, f.selfA, { recipientSelfId: f.siblingA })).statusCode).toBe(204);
    expect((await selfReq(f.prod, 'DELETE', `/placements/${plcId}/recipients/${f.siblingA}`, f.cookieA, f.selfA)).statusCode).toBe(204);
  });

  it('matrix: settled recipient — reads per predicate; every mutation 404', async () => {
    // 0005: recipient of a SETTLED placement may read it and its artifact.
    // 0006: recipients drive nothing — every mutation target is unauthorized.
    expect((await selfReq(f.prod, 'GET', `/placements/${settled.placement}`, f.cookieB, f.selfB)).statusCode).toBe(200);
    expect((await selfReq(f.prod, 'GET', `/artifacts/${settled.artifact}`, f.cookieB, f.selfB)).statusCode).toBe(200);
    // Recipient rows are author-only: the frozen [] (0005).
    const rows = await selfReq(f.prod, 'GET', `/placements/${settled.placement}/recipients`, f.cookieB, f.selfB);
    expect(rows.statusCode).toBe(200);
    expect(rows.json()).toEqual([]);
    for (const [method, url, payload] of [
      ['POST', `/placements/${settled.placement}/recipients`, { recipientSelfId: f.selfB }],
      ['DELETE', `/placements/${settled.placement}/recipients/${f.selfB}`, undefined],
      ['POST', `/placements/${settled.placement}/departure`, undefined],
      ['POST', `/placements/${settled.placement}/cancellation`, undefined],
      ['POST', `/placements/${settled.placement}/settlement`, undefined],
    ] as Array<[string, string, unknown]>) {
      expectNotFound(await selfReq(f.prod, method, url, f.cookieB, f.selfB, payload), `${method} ${url}`);
    }
  });

  it('matrix: recipient before settlement — uniform denial', async () => {
    // 0005: a recipient may read only when state = settled; RECIPIENT_NOT_SETTLED
    // is an ordinary deny and surfaces as the uniform 404.
    expectNotFound(await selfReq(f.prod, 'GET', `/placements/${unsettled}`, f.cookieB, f.selfB), 'unsettled placement read');
    const list = await selfReq(f.prod, 'GET', '/placements', f.cookieB, f.selfB);
    expect((list.json() as Array<{ id: string }>).map((p) => p.id)).not.toContain(unsettled);
  });

  it('matrix: sibling Self — nothing inherited anywhere', async () => {
    // 0004 R2 / 0008 R7: shared account confers nothing. The sibling is a
    // legitimate acting Self of account A but has no relation to the records.
    expectNotFound(await selfReq(f.prod, 'GET', `/artifacts/${settled.artifact}`, f.cookieA, f.siblingA), 'sibling artifact');
    expectNotFound(await selfReq(f.prod, 'GET', `/placements/${settled.placement}`, f.cookieA, f.siblingA), 'sibling placement');
    expect((await selfReq(f.prod, 'GET', '/artifacts', f.cookieA, f.siblingA)).json()).toEqual([]);
    expect((await selfReq(f.prod, 'GET', '/placements', f.cookieA, f.siblingA)).json()).toEqual([]);
    expectNotFound(await selfReq(f.prod, 'POST', `/placements/${settled.placement}/cancellation`, f.cookieA, f.siblingA), 'sibling mutation');
  });

  it('matrix: unrelated Self — uniform denial everywhere', async () => {
    // 0005: an unrelated actor's every single-resource read and mutation
    // target is the uniform 404; containment lists are empty.
    const other = await settledPlacement(f, f.cookieA, f.selfA, [f.siblingA], 'not for B');
    expectNotFound(await selfReq(f.prod, 'GET', `/artifacts/${other.artifact}`, f.cookieB, f.selfB), 'unrelated artifact');
    expectNotFound(await selfReq(f.prod, 'GET', `/placements/${other.placement}`, f.cookieB, f.selfB), 'unrelated placement');
    expect((await selfReq(f.prod, 'GET', `/placements/${other.placement}/recipients`, f.cookieB, f.selfB)).json()).toEqual([]);
  });

  it('matrix: unauthenticated — 401 across all sixteen', async () => {
    // 0006 A1 status class; A-i literal (auth-api.test.ts) carried by §35.
    for (const [method, url, payload] of selfScopedTable(randomUUID())) {
      const r = await selfReq(f.prod, method, url, undefined, f.selfA, payload);
      expect(r.statusCode, `${method} ${url}`).toBe(RATIFIED.UNAUTHENTICATED.status);
      expect(r.json(), `${method} ${url}`).toEqual(RATIFIED.UNAUTHENTICATED.body);
    }
    for (const [method, payload] of [['GET', undefined], ['PUT', { seconds: 30 }]] as Array<[string, unknown]>) {
      const r = await accountReq(f.prod, method, undefined, payload);
      expect(r.statusCode, `${method} /account/departure-interval`).toBe(RATIFIED.UNAUTHENTICATED.status);
      expect(r.json()).toEqual(RATIFIED.UNAUTHENTICATED.body);
    }
  });

  it('matrix: forged acting Self — 400 malformed / 403 unowned across the fourteen', async () => {
    // 0006 A4: an invalid acting-Self/account binding is an upstream identity
    // failure → 403; a malformed assertion is structural → 400. A-i literals.
    for (const [method, url, payload] of selfScopedTable(randomUUID())) {
      const malformed = await selfReq(f.prod, method, url, f.cookieA, 'not-a-uuid', payload);
      expect(malformed.statusCode, `${method} ${url} malformed`).toBe(RATIFIED.SELF_CONTEXT_REQUIRED.status);
      expect(malformed.json()).toEqual(RATIFIED.SELF_CONTEXT_REQUIRED.body);
      const unowned = await selfReq(f.prod, method, url, f.cookieA, f.selfB, payload);
      expect(unowned.statusCode, `${method} ${url} unowned`).toBe(RATIFIED.FORBIDDEN.status);
      expect(unowned.json()).toEqual(RATIFIED.FORBIDDEN.body);
    }
  });

  it('matrix: active key holder — exactly the protected artifact, nothing else', async () => {
    // 0007 R18 / 0005: a Key grants readArtifact of the EXACT protected
    // resource and nothing more — no placement visibility, no recipient rows,
    // no mutation.
    const { resource, keyPlacement } = await settledKey(f, f.cookieA, f.selfA, f.selfB);
    expect((await selfReq(f.prod, 'GET', `/artifacts/${resource}`, f.cookieB, f.selfB)).statusCode).toBe(200);
    const otherArtifact = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'not keyed' })).json().id as string;
    expectNotFound(await selfReq(f.prod, 'GET', `/artifacts/${otherArtifact}`, f.cookieB, f.selfB), 'unkeyed artifact');
    expect((await selfReq(f.prod, 'GET', `/placements/${keyPlacement}/recipients`, f.cookieB, f.selfB)).json()).toEqual([]);
    expectNotFound(await selfReq(f.prod, 'POST', `/placements/${keyPlacement}/cancellation`, f.cookieB, f.selfB), 'grantee mutation');
  });

  it('matrix: revoked key holder — uniform 404 on the protected artifact', async () => {
    // 0007: revocation is prospective; future access is denied through the
    // ordinary uniform 404 (0005). Liveness: no residual entitlement.
    const { resource } = await settledKey(f, f.cookieA, f.selfA, f.selfB);
    expect((await selfReq(f.prod, 'GET', `/artifacts/${resource}`, f.cookieB, f.selfB)).statusCode).toBe(200);
    await selfReq(f.prod, 'POST', '/keys/revocation', f.cookieA, f.selfA, {
      granteeSelfId: f.selfB,
      protectedResourceId: resource,
    });
    expectNotFound(await selfReq(f.prod, 'GET', `/artifacts/${resource}`, f.cookieB, f.selfB), 'revoked grantee');
  });

  it('matrix: guessed identifiers indistinguishable from denial', async () => {
    // 0005: a guessed identifier yields the identical 404 — knowing an id
    // authorizes nothing and reveals nothing.
    const guessedArtifact = await selfReq(f.prod, 'GET', `/artifacts/${randomUUID()}`, f.cookieB, f.selfB);
    const realButUnauthorized = await selfReq(f.prod, 'GET', `/artifacts/${settled.artifact}`, f.cookieA, f.siblingA);
    expectNotFound(guessedArtifact, 'guessed artifact');
    expect(guessedArtifact.body).toBe(realButUnauthorized.body);
    const guessedPlacement = await selfReq(f.prod, 'GET', `/placements/${randomUUID()}`, f.cookieB, f.selfB);
    expectNotFound(guessedPlacement, 'guessed placement');
  });

  it('matrix: state conflicts — 409 for the authorized sender only', async () => {
    // 0006 A4 status class; body by chamber pin. The SAME wrong-state action
    // is 409 for the authorized sender and the uniform 404 for everyone else.
    const art = (await selfReq(f.prod, 'POST', '/artifacts', f.cookieA, f.selfA, { text: 'conflict' })).json().id as string;
    const draft = (await selfReq(f.prod, 'POST', '/placements', f.cookieA, f.selfA, { artifactId: art })).json().id as string;
    const senderConflict = await selfReq(f.prod, 'POST', `/placements/${draft}/settlement`, f.cookieA, f.selfA);
    expect(senderConflict.statusCode).toBe(RATIFIED.CONFLICT.status);
    expect(senderConflict.json()).toEqual(RATIFIED.CONFLICT.body);
    expectNotFound(await selfReq(f.prod, 'POST', `/placements/${draft}/settlement`, f.cookieB, f.selfB), 'stranger same action');
    // A settled placement cannot be cancelled — authorized sender, wrong state.
    const late = await selfReq(f.prod, 'POST', `/placements/${settled.placement}/cancellation`, f.cookieA, f.selfA);
    expect(late.statusCode).toBe(RATIFIED.CONFLICT.status);
    expect(late.json()).toEqual(RATIFIED.CONFLICT.body);
  });

  it('matrix: account routes across every actor class — extras confer nothing', async () => {
    // R4 item 4 / 0006 A1 / chamber pin: authority is the session alone. An
    // acting-Self header, a Self id, or an account id in the payload changes
    // nothing and never reaches another account.
    const beforeB = (await accountReq(f.prod, 'GET', f.cookieB)).json() as { seconds: number };
    const put = await accountReq(
      f.prod,
      'PUT',
      f.cookieA,
      { seconds: 60, accountId: f.accountB, selfId: f.selfB },
      { 'x-acting-self': f.selfB },
    );
    expect(put.statusCode).toBe(204);
    const afterB = (await accountReq(f.prod, 'GET', f.cookieB)).json() as { seconds: number };
    expect(afterB).toEqual(beforeB); // B untouched by A's caller-supplied ids
    const afterA = await accountReq(f.prod, 'GET', f.cookieA, undefined, { 'x-acting-self': f.selfB });
    expect(afterA.statusCode).toBe(200);
    expect(afterA.json()).toEqual({ seconds: 60 }); // A's own session account
    // A malformed body is the structural 400 (chamber-pinned body).
    const bad = await accountReq(f.prod, 'PUT', f.cookieA, { seconds: 'thirty' });
    expect(bad.statusCode).toBe(RATIFIED.BAD_REQUEST.status);
    expect(bad.json()).toEqual(RATIFIED.BAD_REQUEST.body);
  });
});
