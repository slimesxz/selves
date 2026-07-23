import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actingCtx, makeAuthz, newAccount, newArtifact, newKeyGrant, newPlacement, newSelf,
  type AuthzHarness,
} from './helpers/authz.ts';

// P5-D — freshness / linearization (Gate 1 §3). Each request opens its own
// REPEATABLE READ transaction, so a change committed BEFORE the next request is
// observed by it. No allow persists: a prior allow never authorizes a later
// request after revocation, a different acting Self, or a state change.

let h: AuthzHarness;
beforeAll(() => {
  h = makeAuthz();
});
afterAll(() => h.end());

describe('freshness', () => {
  it('a Key revocation committed before the next request denies it', async () => {
    const acctA = await newAccount(h.su);
    const author = await newSelf(h.su, acctA, 1, 'author');
    const acctB = await newAccount(h.su);
    const grantee = await newSelf(h.su, acctB, 1, 'grantee');
    const art = await newArtifact(h.su, author);
    await newKeyGrant(h.su, { grantor: author, grantee, resource: art });

    expect((await h.service.readArtifact(actingCtx(grantee), art)).ok).toBe(true); // active
    await h.su.query('UPDATE public.key_grants SET revoked_at = now() WHERE grantee_self_id = $1 AND protected_resource_id = $2', [grantee, art]);
    expect((await h.service.readArtifact(actingCtx(grantee), art)).ok).toBe(false); // observed on next request
  });

  it('a placement state transition committed before the next request is observed', async () => {
    const acctA = await newAccount(h.su);
    const author = await newSelf(h.su, acctA, 1, 'author');
    const acctB = await newAccount(h.su);
    const rcpt = await newSelf(h.su, acctB, 1, 'rcpt');
    const art = await newArtifact(h.su, author);
    const placement = await newPlacement(h.su, { sender: author, artifact: art, state: 'departing', recipients: [rcpt] });

    expect((await h.service.readPlacement(actingCtx(rcpt), placement)).ok).toBe(false); // departing → denied
    await h.su.query("UPDATE public.placements SET state = 'settled', settled_at = now() WHERE id = $1", [placement]);
    expect((await h.service.readPlacement(actingCtx(rcpt), placement)).ok).toBe(true); // settled → allowed
  });

  it('a prior allow does not authorize a request under a different acting Self', async () => {
    const acctA = await newAccount(h.su);
    const author = await newSelf(h.su, acctA, 1, 'author');
    const acctB = await newAccount(h.su);
    const stranger = await newSelf(h.su, acctB, 1, 'stranger');
    const art = await newArtifact(h.su, author);

    expect((await h.service.readArtifact(actingCtx(author), art)).ok).toBe(true);   // author allowed
    expect((await h.service.readArtifact(actingCtx(stranger), art)).ok).toBe(false); // stranger still denied
  });

  it('artifact visibility ceases when its only ground (a Key) ceases (Ruling 4)', async () => {
    const acctA = await newAccount(h.su);
    const author = await newSelf(h.su, acctA, 1, 'author');
    const acctB = await newAccount(h.su);
    const grantee = await newSelf(h.su, acctB, 1, 'grantee');
    const art = await newArtifact(h.su, author);
    await newKeyGrant(h.su, { grantor: author, grantee, resource: art });
    expect((await h.service.readArtifact(actingCtx(grantee), art)).ok).toBe(true);
    await h.su.query('UPDATE public.key_grants SET revoked_at = now() WHERE grantee_self_id = $1 AND protected_resource_id = $2', [grantee, art]);
    // no residual entitlement survives after the ground is gone
    expect((await h.service.readArtifact(actingCtx(grantee), art)).ok).toBe(false);
  });
});
