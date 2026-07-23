import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  actingCtx, capturingSink, makeAuthz, newAccount, newArtifact, newPlacement, newSelf,
  type AuthzHarness,
} from './helpers/authz.ts';

// P5-C — listRecipientsOfAuthoredPlacement (Gate 1 §8; clarifying ruling).
// The author may list its placement's complete recipient set. Every non-author
// class — a recipient (its own row), a co-recipient, a non-recipient, a sibling —
// and a nonexistent placement receive an EMPTY array, indistinguishably. There
// is no recipient-facing row-read surface and no OWN_RECIPIENT_ROW allow.

let h: AuthzHarness;
let cap: ReturnType<typeof capturingSink>;

beforeAll(() => {
  cap = capturingSink();
  h = makeAuthz(cap.sink);
});
afterAll(() => h.end());

describe('listRecipientsOfAuthoredPlacement', () => {
  it('the author lists the complete authoritative recipient set of its placement', async () => {
    const acctA = await newAccount(h.su);
    const author = await newSelf(h.su, acctA, 1, 'author');
    const sibling = await newSelf(h.su, acctA, 2, 'sibling');
    const acctB = await newAccount(h.su);
    const r1 = await newSelf(h.su, acctB, 1, 'r1');
    const acctC = await newAccount(h.su);
    const r2 = await newSelf(h.su, acctC, 1, 'r2');
    const acctD = await newAccount(h.su);
    const stranger = await newSelf(h.su, acctD, 1, 'stranger');

    const art = await newArtifact(h.su, author);
    const placement = await newPlacement(h.su, {
      sender: author, artifact: art, state: 'settled', recipients: [r1, r2],
    });

    // Author: full set, with the row columns.
    const rows = await h.service.listRecipientsOfAuthoredPlacement(actingCtx(author), placement);
    expect(rows.map((r) => r.recipientSelfId).sort()).toEqual([r1, r2].sort());
    for (const row of rows) {
      expect(row.placementId).toBe(placement);
      expect(row.addedAt).toBeInstanceOf(Date);
    }
    expect(cap.events.at(-1)!.outcome).toEqual({ kind: 'allow', ground: 'AUTHOR_RECIPIENT_LIST' });

    // Every non-author class: empty, indistinguishably.
    for (const who of [r1, r2, sibling, stranger]) {
      expect(await h.service.listRecipientsOfAuthoredPlacement(actingCtx(who), placement)).toEqual([]);
    }

    // Nonexistent placement: also empty.
    expect(await h.service.listRecipientsOfAuthoredPlacement(actingCtx(author), randomUUID())).toEqual([]);
  });
});
