import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, superuserPool, sha256, randomSecret } from './helpers/auth.ts';
import { makeAuthz, actingCtx, newAccount, newSelf, newArtifact, newPlacement } from './helpers/authz.ts';
import type { AuthorizationService } from '../src/authz/service.ts';
import { expectPgError } from './helpers/db.ts';

// P8 closure (0008-C §10.2) — listReadablePlacements: the pre-RLS authorized set
// (the removed application WHERE: author ∪ (settled ∧ explicit recipient)) is
// EQUIVALENT to the RLS-produced set (what selves_app sees under established C3
// context), across author, settled-recipient, non-recipient, sibling Self, absent
// context, and revoked/invalid context.

let app: pg.Pool;
let su: pg.Pool;
let h: ReturnType<typeof makeAuthz>;
let service: AuthorizationService;

beforeAll(() => {
  app = appTestPool();
  su = superuserPool();
  h = makeAuthz();
  service = h.service;
});
afterAll(async () => {
  await Promise.all([app.end(), su.end(), h.end()]);
});

/** The OLD authorized set for `self`, computed as the superuser (RLS-exempt) with
 *  the exact predicate the application WHERE used before RLS. */
async function oldAuthorizedSet(self: string): Promise<string[]> {
  const { rows } = await su.query<{ id: string }>(
    `SELECT p.id FROM public.placements p
      WHERE p.sender_self_id = $1
         OR ( p.state = 'settled'
              AND EXISTS (SELECT 1 FROM public.placement_recipients r
                           WHERE r.placement_id = p.id AND r.recipient_self_id = $1) )
      ORDER BY p.created_at, p.id`,
    [self],
  );
  return rows.map((r) => r.id);
}

/** The RLS-produced set for `self` — through the service (establishes C3 context, then
 *  reads placements under RLS). */
async function rlsSet(self: string): Promise<string[]> {
  return (await service.listReadablePlacements(actingCtx(self))).map((p) => p.id);
}

describe('P8 closure — listReadablePlacements old-set ≡ RLS-set', () => {
  it('author, settled-recipient, non-recipient, and sibling all coincide', async () => {
    const account = await newAccount(su);
    const author = await newSelf(su, account, 1, 'lr-author');
    const sibling = await newSelf(su, account, 2, 'lr-sibling');
    const recipAcct = await newAccount(su);
    const recipient = await newSelf(su, recipAcct, 1, 'lr-recip');
    const strangerAcct = await newAccount(su);
    const stranger = await newSelf(su, strangerAcct, 1, 'lr-stranger');

    // the author's placements to `recipient` in every state
    const art = await newArtifact(su, author);
    await newPlacement(su, { sender: author, artifact: art, state: 'draft', recipients: [recipient] });
    await newPlacement(su, { sender: author, artifact: art, state: 'departing', recipients: [recipient] });
    await newPlacement(su, { sender: author, artifact: art, state: 'settled', recipients: [recipient] });
    await newPlacement(su, { sender: author, artifact: art, state: 'cancelled', recipients: [recipient] });

    for (const self of [author, recipient, stranger, sibling]) {
      const oldSet = (await oldAuthorizedSet(self)).sort();
      const rls = (await rlsSet(self)).sort();
      expect(rls, `equivalence for ${self}`).toEqual(oldSet);
    }

    // spot-check the actual contents match intent
    expect((await rlsSet(author)).length, 'author sees all four own placements').toBe(4);
    const recipSet = await rlsSet(recipient);
    expect(recipSet.length, 'recipient sees only the settled one').toBe(1);
    expect(await rlsSet(stranger)).toEqual([]); // non-recipient
    expect(await rlsSet(sibling)).toEqual([]);  // sibling of the author, shared account confers nothing
  });

  it('absent context ≡ the empty authorized set (RLS returns zero rows)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN'); // no set_acting_self
      const { rows } = await c.query('SELECT id FROM public.placements');
      expect(rows, 'no rows without established context').toEqual([]);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('revoked/invalid context ≡ the empty authorized set (context cannot be established → zero rows)', async () => {
    const account = await newAccount(su);
    const self = await newSelf(su, account, 1, 'lr-revoked');
    const art = await newArtifact(su, self);
    await newPlacement(su, { sender: self, artifact: art, state: 'settled', recipients: [self] });
    // a revoked session cannot establish context …
    const revokedTok = sha256(randomSecret());
    await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [account, revokedTok]);
    await su.query('SELECT auth.revoke_session($1)', [revokedTok]);

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await expectPgError(() => c.query('SELECT domain.set_acting_self($1, $2)', [revokedTok, self]), '28000');
      await c.query('ROLLBACK');
      // … and with no context established, the read set is empty (matches the old
      // authorized set under an unauthenticated actor: nothing).
      await c.query('BEGIN');
      const { rows } = await c.query('SELECT id FROM public.placements');
      expect(rows).toEqual([]);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
