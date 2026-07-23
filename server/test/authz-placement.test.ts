import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  actingCtx, capturingSink, makeAuthz, newAccount, newArtifact, newKeyGrant, newPlacement, newSelf,
  type AuthzHarness,
} from './helpers/authz.ts';
import { PLACEMENT_STATES, type PlacementState } from '../src/domain/placement.ts';
import type { Outcome } from '../src/authz/reasons.ts';

// P5-C — readPlacement, driven table-wise over the EXACT Phase-3 state set, and
// listReadablePlacements. The state set is asserted here against the domain
// constant, which mirrors migrations/1784738615465_enums-and-identity.sql:13
//   CREATE TYPE placement_state AS ENUM ('draft','departing','settled','cancelled');

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

interface Scene {
  author: string;
  sibling: string;
  recipient: string;
  nonRecipient: string;
  keyHolder: string;
  placement: string;
  artifact: string;
}

async function scene(state: PlacementState): Promise<Scene> {
  const acctA = await newAccount(h.su);
  const author = await newSelf(h.su, acctA, 1, 'author');
  const sibling = await newSelf(h.su, acctA, 2, 'sibling');
  const acctB = await newAccount(h.su);
  const recipient = await newSelf(h.su, acctB, 1, 'recipient');
  const acctC = await newAccount(h.su);
  const nonRecipient = await newSelf(h.su, acctC, 1, 'non-recipient');
  const acctD = await newAccount(h.su);
  const keyHolder = await newSelf(h.su, acctD, 1, 'key-holder');

  const artifact = await newArtifact(h.su, author);
  const placement = await newPlacement(h.su, { sender: author, artifact, state, recipients: [recipient] });
  // A Key to the artifact — proves a Key is NOT a ground for placement reads.
  await newKeyGrant(h.su, { grantor: author, grantee: keyHolder, resource: artifact });
  return { author, sibling, recipient, nonRecipient, keyHolder, placement, artifact };
}

describe('readPlacement — Phase-3 state set', () => {
  it('the ratified state set is exactly draft, departing, settled, cancelled', () => {
    expect([...PLACEMENT_STATES]).toEqual(['draft', 'departing', 'settled', 'cancelled']);
  });

  for (const state of PLACEMENT_STATES) {
    describe(`state = ${state}`, () => {
      it('author reads in every state (allow AUTHOR)', async () => {
        const s = await scene(state);
        expect((await h.service.readPlacement(actingCtx(s.author), s.placement)).ok).toBe(true);
        expect(last()).toEqual({ kind: 'allow', ground: 'AUTHOR' });
      });

      it('explicit recipient reads only when settled', async () => {
        const s = await scene(state);
        const r = await h.service.readPlacement(actingCtx(s.recipient), s.placement);
        if (state === 'settled') {
          expect(r.ok).toBe(true);
          expect(last()).toEqual({ kind: 'allow', ground: 'RECIPIENT_SETTLED' });
        } else {
          expect(r.ok).toBe(false);
          expect(last()).toEqual({ kind: 'ordinary_deny', reason: 'RECIPIENT_NOT_SETTLED' });
        }
      });

      it('non-recipient, sibling, and Key-holder are all denied (unsupported)', async () => {
        const s = await scene(state);
        for (const who of [s.nonRecipient, s.sibling, s.keyHolder]) {
          const r = await h.service.readPlacement(actingCtx(who), s.placement);
          expect(r.ok).toBe(false);
          expect(last()).toEqual({ kind: 'unsupported' });
        }
      });
    });
  }

  it('a nonexistent placement is denied (absent)', async () => {
    const acct = await newAccount(h.su);
    const who = await newSelf(h.su, acct, 1);
    const r = await h.service.readPlacement(actingCtx(who), randomUUID());
    expect(r.ok).toBe(false);
    expect(last()).toEqual({ kind: 'absent' });
  });
});

describe('listReadablePlacements', () => {
  it('author sees own placements in every state; a recipient sees only settled ones addressed to it', async () => {
    const acctA = await newAccount(h.su);
    const author = await newSelf(h.su, acctA, 1, 'author');
    const acctB = await newAccount(h.su);
    const recipient = await newSelf(h.su, acctB, 1, 'recipient');
    const art = await newArtifact(h.su, author);

    const byState: Record<PlacementState, string> = {
      draft: await newPlacement(h.su, { sender: author, artifact: art, state: 'draft', recipients: [recipient] }),
      departing: await newPlacement(h.su, { sender: author, artifact: art, state: 'departing', recipients: [recipient] }),
      settled: await newPlacement(h.su, { sender: author, artifact: art, state: 'settled', recipients: [recipient] }),
      cancelled: await newPlacement(h.su, { sender: author, artifact: art, state: 'cancelled', recipients: [recipient] }),
    };

    const authorSees = (await h.service.listReadablePlacements(actingCtx(author))).map((p) => p.id).sort();
    expect(authorSees).toEqual(Object.values(byState).sort());

    const recipientSees = (await h.service.listReadablePlacements(actingCtx(recipient))).map((p) => p.id);
    expect(recipientSees).toEqual([byState.settled]); // only the settled one
  });

  it('an unrelated Self sees none of another author\'s placements', async () => {
    const acctA = await newAccount(h.su);
    const author = await newSelf(h.su, acctA, 1, 'author');
    const acctB = await newAccount(h.su);
    const stranger = await newSelf(h.su, acctB, 1, 'stranger');
    const art = await newArtifact(h.su, author);
    await newPlacement(h.su, { sender: author, artifact: art, state: 'settled', recipients: [] });
    expect(await h.service.listReadablePlacements(actingCtx(stranger))).toEqual([]);
  });
});
