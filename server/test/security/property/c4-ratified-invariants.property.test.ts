import '../../helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import {
  accountCtx, actingCtx, makeAuthz, newAccount, newArtifact, newSelf, type AuthzHarness,
} from '../../helpers/authz.ts';

// P11-C · C4 — property/stateful fuzz over RATIFIED INVARIANTS.
//
// These properties encode constitutional and decision-record invariants, not
// implementation behaviour. Each one names the invariant it defends. A property
// that merely restated what the code does would prove nothing.
//
// DETERMINISTIC REPLAY. Every property runs under an explicit fixed seed, so a
// run is reproducible by construction. On failure fast-check reports the seed
// and the shrink path; that reproduction data is what gets minimised into
// `../regression/` as a permanent case (see ../README.md). Raising numRuns until
// a failure stops appearing is expressly not a resolution.
//
// Run counts are deliberately modest: every generated step performs real work
// against real PostgreSQL through the real AuthorizationService. These are
// adversarial properties, not a micro-benchmark.

const SEED = 20260828;          // fixed; change only with a recorded reason
const RUNS = { lifecycle: 20, keys: 20, selves: 25, payload: 30, isolation: 25 };

let h: AuthzHarness;
beforeAll(() => { h = makeAuthz(); });
afterAll(() => h.end());

/** The SQLSTATE of a rejected mutation, or undefined when it succeeded. */
async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try { await fn(); return undefined; } catch (e) { return (e as { code?: string }).code ?? 'unknown'; }
}
const stateOf = async (id: string): Promise<string> =>
  (await h.su.query<{ state: string }>('SELECT state FROM public.placements WHERE id = $1', [id])).rows[0]!.state;
const recipientsOf = async (id: string): Promise<string[]> =>
  (await h.su.query<{ r: string }>(
    'SELECT recipient_self_id r FROM public.placement_recipients WHERE placement_id = $1', [id])).rows.map((x) => x.r).sort();
const rewind = (id: string): Promise<unknown> => h.su.query(
  "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1", [id]);

// ── P1 · placement lifecycle legality + recipient set law ────────────────────
// INVARIANTS: AGENTS.md §5 (Draft → Departing → Settled; settled/cancelled are
// terminal); 0006 (only the sender drives transitions; departure needs ≥1
// recipient); 0003 invariant 6 (recipients freeze from departing onward).
//
// The departure FLOOR is not the subject here — its timing is proven in
// mutations.test.ts — so the harness rewinds past the snapshotted floor before
// any settle attempt. Legality of the transition, not its clock, is under test.
type Cmd = { k: 'add' | 'remove'; who: number } | { k: 'depart' | 'cancel' | 'settle' };

describe('C4 P1 — placement lifecycle and recipient-set invariants', () => {
  it('an arbitrary command sequence never reaches an illegal state or an illegal recipient set', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ k: fc.constantFrom<'add' | 'remove'>('add', 'remove'), who: fc.integer({ min: 0, max: 2 }) }),
            fc.record({ k: fc.constantFrom<'depart' | 'cancel' | 'settle'>('depart', 'cancel', 'settle') }),
          ) as fc.Arbitrary<Cmd>,
          { minLength: 1, maxLength: 10 },
        ),
        async (cmds) => {
          const acct = await newAccount(h.su);
          const sender = await newSelf(h.su, acct, 1, 'p1-sender');
          const other = await newAccount(h.su);
          const pool = [
            await newSelf(h.su, other, 1, 'p1-r1'),
            await newSelf(h.su, other, 2, 'p1-r2'),
            await newSelf(h.su, other, 3, 'p1-r3'),
          ];
          const art = await newArtifact(h.su, sender, 'p1');
          const plc = await h.service.createPlacementDraft(actingCtx(sender), art);

          // The model: the ratified state machine, independent of the code.
          let state: 'draft' | 'departing' | 'settled' | 'cancelled' = 'draft';
          const set = new Set<string>();

          for (const c of cmds) {
            if (c.k === 'add' || c.k === 'remove') {
              const who = pool[c.who]!;
              const legal = state === 'draft';
              const err = await code(() => c.k === 'add'
                ? h.service.addRecipient(actingCtx(sender), plc, who)
                : h.service.removeRecipient(actingCtx(sender), plc, who));
              if (legal) {
                expect(err, `${c.k} while draft must succeed`).toBeUndefined();
                if (c.k === 'add') set.add(who); else set.delete(who);
              } else {
                expect(err, `${c.k} while ${state} must be refused`).toBe('PT409');
              }
            } else if (c.k === 'depart') {
              const legal = state === 'draft' && set.size > 0;
              const err = await code(() => h.service.beginDeparture(actingCtx(sender), plc));
              if (legal) { expect(err).toBeUndefined(); state = 'departing'; }
              else expect(err, 'illegal departure must be refused').toBe('PT409');
            } else if (c.k === 'cancel') {
              const legal = state === 'departing';
              const err = await code(() => h.service.cancelPlacement(actingCtx(sender), plc));
              if (legal) { expect(err).toBeUndefined(); state = 'cancelled'; }
              else if (state === 'cancelled') expect(err, 'cancel is idempotent').toBeUndefined();
              else expect(err, 'illegal cancel must be refused').toBe('PT409');
            } else {
              const legal = state === 'departing';
              if (state === 'departing') await rewind(plc);
              const err = await code(() => h.service.settlePlacement(actingCtx(sender), plc));
              if (legal) { expect(err).toBeUndefined(); state = 'settled'; }
              else if (state === 'settled') expect(err, 'settle is idempotent').toBeUndefined();
              else expect(err, 'illegal settle must be refused').toBe('PT409');
            }
            // INVARIANT, after every single step:
            expect(await stateOf(plc), 'authoritative state tracks the ratified model').toBe(state);
            expect(await recipientsOf(plc), 'recipient set tracks the model, deduplicated').toEqual([...set].sort());
          }
          // Terminal states are terminal, and a frozen set stays frozen.
          if (state === 'settled' || state === 'cancelled') {
            expect(await code(() => h.service.beginDeparture(actingCtx(sender), plc))).toBe('PT409');
            expect(await code(() => h.service.addRecipient(actingCtx(sender), plc, pool[0]!))).toBe('PT409');
            expect(await recipientsOf(plc)).toEqual([...set].sort());
          }
        },
      ),
      { seed: SEED, numRuns: RUNS.lifecycle },
    );
  });
});

// ── P3 · Key grant / revocation / non-resurrection ──────────────────────────
// INVARIANTS: AGENTS.md §5 Key transmission (settlement irreversible, revocation
// prospective); 0007 R9 (a revoked grant never reactivates); 0003 invariant 8
// (at most one ACTIVE grant per grantor/grantee/resource).
describe('C4 P3 — Key capability invariants', () => {
  it('grant/revoke sequences never resurrect a capability and never exceed one active grant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom<'grant' | 'revoke' | 'read'>('grant', 'revoke', 'read'), { minLength: 1, maxLength: 8 }),
        async (cmds) => {
          const a = await newAccount(h.su);
          const grantor = await newSelf(h.su, a, 1, 'p3-grantor');
          const b = await newAccount(h.su);
          const grantee = await newSelf(h.su, b, 1, 'p3-grantee');
          const res = await newArtifact(h.su, grantor, 'p3 protected');

          // The ratified revocation contract (0007 R7/R8, and the DEFINER at
          // migration 1784930000010): revoking an ACTIVE grant succeeds;
          // revoking again as the RECORDED GRANTOR is an idempotent success,
          // because grant history for this grantor still exists; PT404 is
          // reserved for an actor with no grant history for the pair at all.
          // (An earlier draft of this property modelled the second revoke as
          //  PT404. The property found the disagreement at seed 20260828 path 0
          //  with ["grant","revoke","revoke"]. The MODEL was wrong, not the
          //  production code — key-lifecycle.test.ts already fixes idempotent
          //  success as the ratified behaviour. Recorded rather than silently
          //  reconciled.)
          let active = false;
          let everGranted = false;
          let grantsMade = 0;

          const settleKey = async (): Promise<void> => {
            const kp = await h.service.createKeyPlacementDraft(actingCtx(grantor), res);
            await h.service.addRecipient(actingCtx(grantor), kp, grantee);
            await h.service.beginDeparture(actingCtx(grantor), kp);
            await rewind(kp);
            await h.service.settlePlacement(actingCtx(grantor), kp);
          };

          for (const c of cmds) {
            if (c === 'grant') {
              const err = await code(settleKey);
              if (!active) {
                expect(err, 'a fresh grant settles').toBeUndefined();
                active = true; everGranted = true; grantsMade++;
              } else {
                expect(err, 'a second ACTIVE grant is refused').toBeDefined();
              }
            } else if (c === 'revoke') {
              const err = await code(() => h.service.revokeKey(actingCtx(grantor), grantee, res));
              if (active) { expect(err, 'revoking an active grant succeeds').toBeUndefined(); active = false; }
              else if (everGranted) expect(err, 'repeat revoke by the grantor is idempotent').toBeUndefined();
              else expect(err, 'no grant history for this grantor is PT404').toBe('PT404');
            } else {
              expect((await h.service.readArtifact(actingCtx(grantee), res)).ok,
                'read outcome equals capability state').toBe(active);
            }
            const n = (await h.su.query<{ n: number }>(
              'SELECT count(*)::int n FROM public.key_grants WHERE grantee_self_id=$1 AND protected_resource_id=$2 AND revoked_at IS NULL',
              [grantee, res])).rows[0]!.n;
            expect(n, 'at most one ACTIVE grant ever exists').toBeLessThanOrEqual(1);
            expect(n === 1, 'active-grant count agrees with the model').toBe(active);
          }

          // Revocation is prospective: history is never destroyed, and a
          // revoked row never returns to active.
          const total = (await h.su.query<{ n: number }>(
            'SELECT count(*)::int n FROM public.key_grants WHERE grantee_self_id=$1 AND protected_resource_id=$2',
            [grantee, res])).rows[0]!.n;
          expect(total, 'every grant ever settled is preserved as history').toBe(grantsMade);
        },
      ),
      { seed: SEED, numRuns: RUNS.keys },
    );
  });
});

// ── P4 · three-Self cardinality and slot uniqueness ─────────────────────────
// INVARIANT: AGENTS.md §3.1 "Maximum 3 Selves per user"; 0003 invariants 1–2.
describe('C4 P4 — Self cardinality invariants', () => {
  it('no sequence of slot claims ever yields a fourth Self or a duplicate slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -2, max: 6 }), { minLength: 1, maxLength: 10 }),
        async (slots) => {
          const acct = await newAccount(h.su);
          const taken = new Set<number>();
          for (const slot of slots) {
            const legal = slot >= 1 && slot <= 3 && !taken.has(slot);
            const err = await code(() => newSelf(h.su, acct, slot, `p4-${slot}`));
            if (legal) { expect(err, `slot ${slot} is legal`).toBeUndefined(); taken.add(slot); }
            else expect(err, `slot ${slot} must be refused`).toBeDefined();
            const n = (await h.su.query<{ n: number }>(
              'SELECT count(*)::int n FROM public.selves WHERE account_id = $1', [acct])).rows[0]!.n;
            expect(n, 'never more than three Selves').toBeLessThanOrEqual(3);
            expect(n).toBe(taken.size);
          }
        },
      ),
      { seed: SEED, numRuns: RUNS.selves },
    );
  });
});

// ── P5 · artifact payload-type boundary ─────────────────────────────────────
// INVARIANTS: AGENTS.md §3.9 frozen payload enum; 0003 invariants 11–12 (a Key
// is a capability, never content; the slice implements only text).
describe('C4 P5 — payload-type boundary', () => {
  it('only text is accepted as artifact content; every other enum member and every non-member is refused', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constantFrom('text', 'photo', 'poll', 'gift', 'key'),
          fc.string({ minLength: 1, maxLength: 12 }),
        ),
        fc.string({ maxLength: 40 }),
        async (payloadType, body) => {
          const acct = await newAccount(h.su);
          const self = await newSelf(h.su, acct, 1, 'p5');
          const err = await code(() => h.su.query(
            'INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1, $2::payload_type, $3)',
            [self, payloadType, body]));
          if (payloadType === 'text' && body.trim().length > 0) {
            expect(err, 'a non-empty text artifact is accepted').toBeUndefined();
          } else {
            expect(err, `payload_type=${JSON.stringify(payloadType)} body=${JSON.stringify(body)} must be refused`).toBeDefined();
          }
        },
      ),
      { seed: SEED, numRuns: RUNS.payload },
    );
  });
});

// ── P6 · cross-account and sibling-Self authority isolation ─────────────────
// INVARIANTS: 0004 R2 / 0008 R7 (a shared account confers nothing); 0005
// (recipient reads only when settled; a Key reaches exactly its resource).
describe('C4 P6 — authority isolation', () => {
  it('read outcomes equal the ratified ground model for every generated actor/resource pairing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'author' | 'sibling' | 'recipient' | 'stranger'>('author', 'sibling', 'recipient', 'stranger'),
        fc.constantFrom<'draft' | 'departing' | 'settled' | 'cancelled'>('draft', 'departing', 'settled', 'cancelled'),
        async (who, state) => {
          const a = await newAccount(h.su);
          const author = await newSelf(h.su, a, 1, 'p6-author');
          const sibling = await newSelf(h.su, a, 2, 'p6-sibling');
          const b = await newAccount(h.su);
          const recipient = await newSelf(h.su, b, 1, 'p6-recipient');
          const c = await newAccount(h.su);
          const stranger = await newSelf(h.su, c, 1, 'p6-stranger');
          const art = await newArtifact(h.su, author, 'p6 body');

          const plc = await h.service.createPlacementDraft(actingCtx(author), art);
          await h.service.addRecipient(actingCtx(author), plc, recipient);
          if (state !== 'draft') {
            await h.service.beginDeparture(actingCtx(author), plc);
            if (state === 'settled') { await rewind(plc); await h.service.settlePlacement(actingCtx(author), plc); }
            if (state === 'cancelled') await h.service.cancelPlacement(actingCtx(author), plc);
          }

          const actor = { author, sibling, recipient, stranger }[who];
          // The ratified model: author always; recipient only when settled;
          // sibling and stranger never — a shared account is not a ground.
          const expectedArtifact = who === 'author' || (who === 'recipient' && state === 'settled');
          const expectedPlacement = expectedArtifact;

          expect((await h.service.readArtifact(actingCtx(actor), art)).ok,
            `artifact: ${who} on ${state}`).toBe(expectedArtifact);
          expect((await h.service.readPlacement(actingCtx(actor), plc)).ok,
            `placement: ${who} on ${state}`).toBe(expectedPlacement);
          // Containment lists never exceed the single-read authority.
          const listed = (await h.service.listReadablePlacements(actingCtx(actor))).map((p) => String(p.id));
          expect(listed.includes(plc), `list agrees with single read for ${who}/${state}`)
            .toBe(who === 'author' || (who === 'recipient' && state === 'settled'));
          // A nonexistent resource is denied for every actor, identically.
          expect((await h.service.readArtifact(actingCtx(actor), randomUUID())).ok).toBe(false);
        },
      ),
      { seed: SEED, numRuns: RUNS.isolation },
    );
  });
});
