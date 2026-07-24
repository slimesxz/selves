import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makeAuthz, actingCtx, accountCtx, newAccount, newSelf, newKeyGrant } from './helpers/authz.ts';
import { mapMutationError, CONFLICT } from '../src/authz/reasons.ts';
import type { AuthorizationService } from '../src/authz/service.ts';

// P7-E — the Key capability lifecycle proven through the REAL AuthorizationService
// over a selves_app connection (the SECURITY DEFINER write boundary). A Key is a
// capability payload carried by a Placement (decision 0007, Q1 Alt A): the grant
// is produced by settlement, revocation is prospective, and the sole revocable
// read path is KEY_VALID. Fixtures use a superuser pool only to create
// authoritative rows for setup; every mutation runs the real state machine.

let h: ReturnType<typeof makeAuthz>;
let su: pg.Pool;
let service: AuthorizationService;

beforeAll(() => {
  h = makeAuthz();
  su = h.su;
  service = h.service;
});
afterAll(() => h.end());

/** SQLSTATE of a rejected service call, or undefined if it resolved. */
async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

interface Scene {
  account: string;
  grantor: string; // slot 1, authors the protected artifact
  grantee: string; // slot 2, sibling of grantor — a valid Key recipient (R6)
  third: string; // slot 3, another sibling — must gain nothing from a grant to grantee
  other: string;
  stranger: string; // a Self on a different account
}

async function scene(): Promise<Scene> {
  const account = await newAccount(su);
  const grantor = await newSelf(su, account, 1, 'grantor');
  const grantee = await newSelf(su, account, 2, 'grantee');
  const third = await newSelf(su, account, 3, 'third');
  const other = await newAccount(su);
  const stranger = await newSelf(su, other, 1, 'stranger');
  return { account, grantor, grantee, third, other, stranger };
}

async function stateOf(placementId: string): Promise<string> {
  return (await su.query<{ state: string }>('SELECT state FROM public.placements WHERE id = $1', [placementId])).rows[0]!.state;
}
async function payloadOf(placementId: string): Promise<{ payload: string; artifact: string | null; protected: string | null }> {
  const { rows } = await su.query<{ payload_type: string; artifact_id: string | null; protected_resource_id: string | null }>(
    'SELECT payload_type, artifact_id, protected_resource_id FROM public.placements WHERE id = $1',
    [placementId],
  );
  return { payload: rows[0]!.payload_type, artifact: rows[0]!.artifact_id, protected: rows[0]!.protected_resource_id };
}
/** count of key_grants for a triple; `active` restricts to unrevoked. */
async function grantCount(grantor: string, grantee: string, resource: string, active = false): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    `SELECT count(*)::int n FROM public.key_grants
      WHERE grantor_self_id = $1 AND grantee_self_id = $2 AND protected_resource_id = $3
        ${active ? 'AND revoked_at IS NULL' : ''}`,
    [grantor, grantee, resource],
  );
  return rows[0]!.n;
}
async function elapseFloor(placementId: string): Promise<void> {
  await su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [placementId],
  );
}

/** Drive a full Key transmission to Settled, returning the key placement id. */
async function settleKey(s: Scene, grantee: string, resource: string, interval = 5): Promise<string> {
  await service.setDepartureInterval(accountCtx(s.account), interval);
  const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), resource);
  await service.addRecipient(actingCtx(s.grantor), kp, grantee);
  await service.beginDeparture(actingCtx(s.grantor), kp);
  await elapseFloor(kp);
  await service.settlePlacement(actingCtx(s.grantor), kp);
  return kp;
}

describe('issuance authority — author only (R4)', () => {
  it('a non-author or an absent protected resource is PT404 (non-leaking)', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    expect(await code(() => service.createKeyPlacementDraft(actingCtx(s.stranger), R))).toBe('PT404');
    expect(await code(() => service.createKeyPlacementDraft(actingCtx(s.grantee), R))).toBe('PT404'); // sibling ≠ author
    expect(await code(() => service.createKeyPlacementDraft(actingCtx(s.grantor), '00000000-0000-0000-0000-000000000000'))).toBe('PT404');
  });
  it('the author opens a Key Placement: payload key, artifact_id null, protected set', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    expect(await stateOf(kp)).toBe('draft');
    expect(await payloadOf(kp)).toEqual({ payload: 'key', artifact: null, protected: R });
  });
});

describe('composition — exactly one recipient, never the sender (R5/R6)', () => {
  it('self-as-Key-recipient is rejected during composition with PT400', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    expect(await code(() => service.addRecipient(actingCtx(s.grantor), kp, s.grantor))).toBe('PT400');
  });
  it('a second, different Key recipient is PT409; re-adding the same grantee is idempotent', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    await service.addRecipient(actingCtx(s.grantor), kp, s.grantee);
    await service.addRecipient(actingCtx(s.grantor), kp, s.grantee); // idempotent
    expect(await code(() => service.addRecipient(actingCtx(s.grantor), kp, s.third))).toBe('PT409');
    const { rows } = await su.query<{ n: number }>('SELECT count(*)::int n FROM public.placement_recipients WHERE placement_id = $1', [kp]);
    expect(rows[0]!.n).toBe(1);
  });
  it('a sibling Self is a valid Key recipient (R6)', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    await service.addRecipient(actingCtx(s.grantor), kp, s.grantee); // grantee is grantor's sibling
    expect(await code(() => service.beginDeparture(actingCtx(s.grantor), kp))).toBeUndefined();
    expect(await stateOf(kp)).toBe('departing');
  });
  it('a Key Placement departs only with exactly one recipient (R5)', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    expect(await code(() => service.beginDeparture(actingCtx(s.grantor), kp))).toBe('PT409'); // zero
  });
});

describe('grant establishment and the KEY_VALID read (R3 effect)', () => {
  it('settlement creates the capability; the grantee reads, siblings and strangers do not', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await settleKey(s, s.grantee, R);
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(1);
    // grantee reads via KEY_VALID
    expect((await service.readArtifact(actingCtx(s.grantee), R)).ok).toBe(true);
    // sibling isolation: another sibling and a stranger gain nothing
    expect((await service.readArtifact(actingCtx(s.third), R)).ok).toBe(false);
    expect((await service.readArtifact(actingCtx(s.stranger), R)).ok).toBe(false);
  });
});

describe('cancellation before settlement — the capability never existed (Corollary 1)', () => {
  it('cancelling a departing Key Placement writes no key_grants row', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await service.setDepartureInterval(accountCtx(s.account), 5);
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    await service.addRecipient(actingCtx(s.grantor), kp, s.grantee);
    await service.beginDeparture(actingCtx(s.grantor), kp);
    await service.cancelPlacement(actingCtx(s.grantor), kp);
    expect(await stateOf(kp)).toBe('cancelled');
    expect(await grantCount(s.grantor, s.grantee, R)).toBe(0);
    expect((await service.readArtifact(actingCtx(s.grantee), R)).ok).toBe(false);
  });
});

describe('revocation — prospective, historical record preserved (R7/R8)', () => {
  it('revoke denies future reads and leaves the settled placement + grant history intact', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    const kp = await settleKey(s, s.grantee, R);
    expect((await service.readArtifact(actingCtx(s.grantee), R)).ok).toBe(true);
    await service.revokeKey(actingCtx(s.grantor), s.grantee, R);
    // future read denied
    expect((await service.readArtifact(actingCtx(s.grantee), R)).ok).toBe(false);
    // the settled placement is untouched; the grant row persists as revoked history
    expect(await stateOf(kp)).toBe('settled');
    expect(await grantCount(s.grantor, s.grantee, R)).toBe(1);
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(0);
  });
  it('revocation is idempotent and mutates nothing on repeat', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await settleKey(s, s.grantee, R);
    await service.revokeKey(actingCtx(s.grantor), s.grantee, R);
    const t1 = (await su.query('SELECT revoked_at FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3', [s.grantor, s.grantee, R])).rows[0].revoked_at;
    expect(await code(() => service.revokeKey(actingCtx(s.grantor), s.grantee, R))).toBeUndefined(); // idempotent success
    const t2 = (await su.query('SELECT revoked_at FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3', [s.grantor, s.grantee, R])).rows[0].revoked_at;
    expect(t2).toEqual(t1); // nothing moved
  });
});

describe('re-grant — a new Key Placement, a new row; a revoked grant never reactivates (R9)', () => {
  it('after revocation a fresh Key Placement re-grants; the old revoked row is untouched', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await settleKey(s, s.grantee, R);
    await service.revokeKey(actingCtx(s.grantor), s.grantee, R);
    const revokedAt = (await su.query('SELECT revoked_at FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3 AND revoked_at IS NOT NULL', [s.grantor, s.grantee, R])).rows[0].revoked_at;
    // a brand-new Key Placement produces a NEW active grant row
    await settleKey(s, s.grantee, R);
    expect(await grantCount(s.grantor, s.grantee, R)).toBe(2); // one revoked + one active
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(1);
    expect((await service.readArtifact(actingCtx(s.grantee), R)).ok).toBe(true);
    // the historical revoked row was never resurrected or mutated
    const stillRevoked = (await su.query('SELECT revoked_at FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3 AND revoked_at IS NOT NULL', [s.grantor, s.grantee, R])).rows;
    expect(stillRevoked.length).toBe(1);
    expect(stillRevoked[0].revoked_at).toEqual(revokedAt);
  });
});

describe('settlement collision — atomic; neither transition nor grant persists (R10, audit point 2)', () => {
  it('a fault at the capability insert (23505) rolls back the settlement UPDATE with it', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    // a pre-existing ACTIVE grant for the triple — the injected fault
    await newKeyGrant(su, { grantor: s.grantor, grantee: s.grantee, resource: R });
    // a departing Key Placement for the SAME triple, floor elapsed
    await service.setDepartureInterval(accountCtx(s.account), 5);
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    await service.addRecipient(actingCtx(s.grantor), kp, s.grantee);
    await service.beginDeparture(actingCtx(s.grantor), kp);
    await elapseFloor(kp);
    // settle: the key_grants INSERT hits key_grants_one_active (23505)
    expect(await code(() => service.settlePlacement(actingCtx(s.grantor), kp))).toBe('23505');
    // NEITHER persisted: the state transition rolled back AND no second grant exists
    expect(await stateOf(kp)).toBe('departing');
    expect(await grantCount(s.grantor, s.grantee, R)).toBe(1); // only the pre-existing one
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(1);
    // the public contract for that raw SQLSTATE is 409 (R10)
    expect(mapMutationError('23505')).toEqual(CONFLICT);
  });
  it('once the earlier grant is revoked, the departing Placement settles as a legitimate re-grant', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await newKeyGrant(su, { grantor: s.grantor, grantee: s.grantee, resource: R });
    await service.setDepartureInterval(accountCtx(s.account), 5);
    const kp = await service.createKeyPlacementDraft(actingCtx(s.grantor), R);
    await service.addRecipient(actingCtx(s.grantor), kp, s.grantee);
    await service.beginDeparture(actingCtx(s.grantor), kp);
    await elapseFloor(kp);
    expect(await code(() => service.settlePlacement(actingCtx(s.grantor), kp))).toBe('23505'); // collision
    await service.revokeKey(actingCtx(s.grantor), s.grantee, R); // clear the active grant
    await service.settlePlacement(actingCtx(s.grantor), kp); // now a legitimate new grant
    expect(await stateOf(kp)).toBe('settled');
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(1);
  });
});

describe('revocation lookup correctness (R7 addendum, audit point 5)', () => {
  it('active-over-history: with a revoked row plus a later active re-grant, revoke targets only the active row', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await newKeyGrant(su, { grantor: s.grantor, grantee: s.grantee, resource: R, revoked: true }); // history
    await newKeyGrant(su, { grantor: s.grantor, grantee: s.grantee, resource: R }); // active re-grant
    const historicalBefore = (await su.query('SELECT revoked_at FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3 AND granted_at < now() - interval \'30 min\'', [s.grantor, s.grantee, R])).rows[0].revoked_at;
    await service.revokeKey(actingCtx(s.grantor), s.grantee, R);
    // now zero active, two revoked; the pre-existing historical row's timestamp is unchanged
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(0);
    expect(await grantCount(s.grantor, s.grantee, R)).toBe(2);
    const historicalAfter = (await su.query('SELECT revoked_at FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3 AND granted_at < now() - interval \'30 min\'', [s.grantor, s.grantee, R])).rows[0].revoked_at;
    expect(historicalAfter).toEqual(historicalBefore); // history untouched
  });
  it('a foreign actor probing a real (grantee, resource) pair receives PT404, never idempotent success', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await settleKey(s, s.grantee, R); // a real active grant owned by grantor
    // the stranger is not the recorded grantor of any grant for this pair
    expect(await code(() => service.revokeKey(actingCtx(s.stranger), s.grantee, R))).toBe('PT404');
    // and the third sibling likewise
    expect(await code(() => service.revokeKey(actingCtx(s.third), s.grantee, R))).toBe('PT404');
    // the real grant is untouched by the foreign probe
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(1);
  });
  it('authority is the recorded grantor, never current Artifact authorship', async () => {
    const s = await scene();
    // R is authored by grantor; but the grant is recorded with a DIFFERENT grantor (third).
    // (A direct insert; the create path would forbid this — that is exactly why it isolates
    //  recorded grantorship from current authorship.)
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await newKeyGrant(su, { grantor: s.third, grantee: s.grantee, resource: R });
    // the CURRENT AUTHOR (grantor) cannot revoke — they are not the recorded grantor
    expect(await code(() => service.revokeKey(actingCtx(s.grantor), s.grantee, R))).toBe('PT404');
    expect(await grantCount(s.third, s.grantee, R, true)).toBe(1); // untouched
    // the RECORDED GRANTOR (third), though not the artifact's author, can revoke
    expect(await code(() => service.revokeKey(actingCtx(s.third), s.grantee, R))).toBeUndefined();
    expect(await grantCount(s.third, s.grantee, R, true)).toBe(0);
  });
  it('revocation is addressed solely by (grantee, protected resource) — no capability id is used', async () => {
    const s = await scene();
    const R = await service.createArtifact(actingCtx(s.grantor), 'secret');
    await settleKey(s, s.grantee, R);
    // the service surface accepts only (grantee, resource); success without any id
    await service.revokeKey(actingCtx(s.grantor), s.grantee, R);
    expect(await grantCount(s.grantor, s.grantee, R, true)).toBe(0);
  });
});
