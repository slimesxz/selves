import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  actingCtx, capturingSink, makeAuthz, newAccount, newArtifact, newKeyGrant, newPlacement, newSelf,
  type AuthzHarness,
} from './helpers/authz.ts';
import type { Outcome } from '../src/authz/reasons.ts';

// P5-C — readArtifact and listOwnedArtifacts. Positive grounds, ordinary denials
// (incl. the KEY_WRONG_RESOURCE correction), unsupported, and absence.

let h: AuthzHarness;
let cap: ReturnType<typeof capturingSink>;

beforeAll(() => {
  cap = capturingSink();
  h = makeAuthz(cap.sink);
});
afterAll(() => h.end());

function last(): Outcome<string> {
  return cap.events[cap.events.length - 1]!.outcome;
}
async function freshSelf(name: string): Promise<string> {
  const acct = await newAccount(h.su);
  return newSelf(h.su, acct, 1, name);
}

describe('readArtifact', () => {
  it('author reads its own artifact that was never placed (allow AUTHOR)', async () => {
    const author = await freshSelf('author');
    const art = await newArtifact(h.su, author, 'unplaced');
    const r = await h.service.readArtifact(actingCtx(author), art);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.textBody).toBe('unplaced');
    expect(last()).toEqual({ kind: 'allow', ground: 'AUTHOR' });
  });

  it('explicit recipient of a settled placement reads the artifact (allow RECIPIENT_SETTLED)', async () => {
    const author = await freshSelf('author');
    const rcpt = await freshSelf('rcpt');
    const art = await newArtifact(h.su, author);
    await newPlacement(h.su, { sender: author, artifact: art, state: 'settled', recipients: [rcpt] });
    const r = await h.service.readArtifact(actingCtx(rcpt), art);
    expect(r.ok).toBe(true);
    expect(last()).toEqual({ kind: 'allow', ground: 'RECIPIENT_SETTLED' });
  });

  it('holder of a valid Key reads the artifact independently of any placement (allow KEY_VALID)', async () => {
    const author = await freshSelf('author');
    const grantee = await freshSelf('grantee');
    const art = await newArtifact(h.su, author);
    await newKeyGrant(h.su, { grantor: author, grantee, resource: art });
    const r = await h.service.readArtifact(actingCtx(grantee), art);
    expect(r.ok).toBe(true);
    expect(last()).toEqual({ kind: 'allow', ground: 'KEY_VALID' });
  });

  it('one artifact placed to two recipients is independently visible through each (Ruling 2)', async () => {
    const author = await freshSelf('author');
    const r1 = await freshSelf('r1');
    const r2 = await freshSelf('r2');
    const stranger = await freshSelf('stranger');
    const art = await newArtifact(h.su, author);
    await newPlacement(h.su, { sender: author, artifact: art, state: 'settled', recipients: [r1] });
    await newPlacement(h.su, { sender: author, artifact: art, state: 'settled', recipients: [r2] });
    expect((await h.service.readArtifact(actingCtx(r1), art)).ok).toBe(true);
    expect((await h.service.readArtifact(actingCtx(r2), art)).ok).toBe(true);
    expect((await h.service.readArtifact(actingCtx(stranger), art)).ok).toBe(false);
  });

  for (const state of ['draft', 'departing', 'cancelled'] as const) {
    it(`recipient of a ${state} placement is denied (ordinary RECIPIENT_NOT_SETTLED)`, async () => {
      const author = await freshSelf('author');
      const rcpt = await freshSelf('rcpt');
      const art = await newArtifact(h.su, author);
      await newPlacement(h.su, { sender: author, artifact: art, state, recipients: [rcpt] });
      const r = await h.service.readArtifact(actingCtx(rcpt), art);
      expect(r.ok).toBe(false);
      expect(last()).toEqual({ kind: 'ordinary_deny', reason: 'RECIPIENT_NOT_SETTLED' });
    });
  }

  it('a revoked Key to the requested artifact is denied (ordinary KEY_REVOKED)', async () => {
    const author = await freshSelf('author');
    const grantee = await freshSelf('grantee');
    const art = await newArtifact(h.su, author);
    await newKeyGrant(h.su, { grantor: author, grantee, resource: art, revoked: true });
    const r = await h.service.readArtifact(actingCtx(grantee), art);
    expect(r.ok).toBe(false);
    expect(last()).toEqual({ kind: 'ordinary_deny', reason: 'KEY_REVOKED' });
  });

  it('an active Key to a DIFFERENT artifact is denied (ordinary KEY_WRONG_RESOURCE, not unsupported)', async () => {
    const author = await freshSelf('author');
    const grantee = await freshSelf('grantee');
    const artX = await newArtifact(h.su, author, 'X');
    const artY = await newArtifact(h.su, author, 'Y');
    await newKeyGrant(h.su, { grantor: author, grantee, resource: artX });
    const r = await h.service.readArtifact(actingCtx(grantee), artY); // requesting Y, key is for X
    expect(r.ok).toBe(false);
    expect(last()).toEqual({ kind: 'ordinary_deny', reason: 'KEY_WRONG_RESOURCE' });
  });

  it('an unrelated Self is denied (unsupported)', async () => {
    const author = await freshSelf('author');
    const stranger = await freshSelf('stranger');
    const art = await newArtifact(h.su, author);
    const r = await h.service.readArtifact(actingCtx(stranger), art);
    expect(r.ok).toBe(false);
    expect(last()).toEqual({ kind: 'unsupported' });
  });

  it('a sibling Self of the author is denied (unsupported — shared account confers nothing)', async () => {
    const acct = await newAccount(h.su);
    const author = await newSelf(h.su, acct, 1, 'author');
    const sibling = await newSelf(h.su, acct, 2, 'sibling');
    const art = await newArtifact(h.su, author);
    const r = await h.service.readArtifact(actingCtx(sibling), art);
    expect(r.ok).toBe(false);
    expect(last()).toEqual({ kind: 'unsupported' });
  });

  it('a nonexistent artifact is denied (absent)', async () => {
    const who = await freshSelf('who');
    const r = await h.service.readArtifact(actingCtx(who), randomUUID());
    expect(r.ok).toBe(false);
    expect(last()).toEqual({ kind: 'absent' });
  });
});

describe('listOwnedArtifacts', () => {
  it('returns only the acting Self\'s authored artifacts, ordered', async () => {
    const author = await freshSelf('author');
    const a1 = await newArtifact(h.su, author, 'one');
    const a2 = await newArtifact(h.su, author, 'two');
    const rows = await h.service.listOwnedArtifacts(actingCtx(author));
    const ids = rows.map((a) => a.id).sort();
    expect(ids).toEqual([a1, a2].sort());
  });

  it('does not include an artifact the actor can only read via a placement or Key', async () => {
    const author = await freshSelf('author');
    const rcpt = await freshSelf('rcpt');
    const grantee = await freshSelf('grantee');
    const placed = await newArtifact(h.su, author, 'placed');
    const keyed = await newArtifact(h.su, author, 'keyed');
    await newPlacement(h.su, { sender: author, artifact: placed, state: 'settled', recipients: [rcpt] });
    await newKeyGrant(h.su, { grantor: author, grantee, resource: keyed });
    // The recipient can READ `placed` but does not OWN it.
    expect((await h.service.readArtifact(actingCtx(rcpt), placed)).ok).toBe(true);
    expect(await h.service.listOwnedArtifacts(actingCtx(rcpt))).toEqual([]);
    expect((await h.service.readArtifact(actingCtx(grantee), keyed)).ok).toBe(true);
    expect(await h.service.listOwnedArtifacts(actingCtx(grantee))).toEqual([]);
  });
});
