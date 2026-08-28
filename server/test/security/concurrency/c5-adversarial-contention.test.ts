import '../../helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { appTxPool } from '../../../src/db.ts';
import { createAuthorizationService, type AuthorizationService } from '../../../src/authz/service.ts';
import { createPredicatesRepo } from '../../../src/authz/predicates.repo.ts';
import { createDomainRepo } from '../../../src/authz/domain.repo.ts';
import { createMutationsRepo } from '../../../src/authz/mutations.repo.ts';
import { actingCtx, makeAuthz, newAccount, newArtifact, newSelf, type AuthzHarness } from '../../helpers/authz.ts';
import { workerPool } from '../../helpers/auth.ts';

// P11-C · C5 — adversarial contention harness. DEPENDENCY-FREE: no k6, no
// Artillery, no autocannon. It is built on the existing real PostgreSQL role
// pools, the real AuthorizationService composed exactly as production composes
// it, and the real worker role.
//
// THIS IS NOT A BENCHMARK. No throughput, RPS, or latency threshold appears
// anywhere below, and none is an acceptance criterion. Wall-clock is recorded
// only as run metadata. The question is whether SECURITY AND LIFECYCLE
// SEMANTICS survive contention — a run that is fast and crash-free proves
// nothing on its own, so every operation carries its expected outcome and every
// postcondition is asserted against authoritative state afterwards.
//
// It exceeds the estate's previous two-operation ceiling: CONCURRENCY parallel
// workers over a deliberately SMALLER connection pool, so pooled connections are
// reused across different accounts and different acting Selves while authorized
// reads, denied reads, lifecycle transitions, capability changes and worker
// passes overlap. If acting-Self context could leak across a pooled connection,
// this is the shape that would expose it.
//
// DETERMINISTIC INPUTS. The operation mix comes from a seeded PRNG (mulberry32,
// hand-rolled — no dependency), so the workload is reproducible from SEED. True
// interleaving is scheduler-dependent by nature; that is why nothing here infers
// a conclusion FROM an interleaving. Every assertion is either a per-operation
// expectation fixed before the operation ran, or a postcondition over
// authoritative state.

const SEED = 20260828;
const CONCURRENCY = 16;      // parallel in-flight workers
const OPS = 400;             // total operations
const POOL_MAX = 6;          // < CONCURRENCY, so connections are REUSED

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let h: AuthzHarness;
let pool: pg.Pool;
let svc: AuthorizationService;
let wk: pg.Pool;

interface Actor { self: string; account: string }
interface Fixture {
  accounts: { account: string; selves: string[] }[];
  authored: { artifact: string; author: Actor; recipient: Actor; placement: string }[];
  keyed: { artifact: string; grantor: Actor; grantee: Actor }[];
  all: Actor[];
}
let f: Fixture;

const rewind = (id: string): Promise<unknown> => h.su.query(
  "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1", [id]);

async function drain(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const { rows } = await wk.query<{ processed: number; failed: number }>(
      'SELECT processed, failed FROM proj.process_outbox($1)', [100]);
    if (Number(rows[0]!.processed) === 0 && Number(rows[0]!.failed) === 0) return;
  }
  throw new Error('worker did not drain');
}

beforeAll(async () => {
  h = makeAuthz();
  wk = workerPool();
  // The production composition, over a deliberately constrained pool.
  pool = new pg.Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: POOL_MAX });
  svc = createAuthorizationService({
    txPool: appTxPool(pool), db: pool,
    predicates: createPredicatesRepo(), domain: createDomainRepo(), mutations: createMutationsRepo(),
  });

  const accounts: Fixture['accounts'] = [];
  const all: Actor[] = [];
  for (let i = 0; i < 6; i++) {
    const account = await newAccount(h.su);
    const selves: string[] = [];
    for (let slot = 1; slot <= 3; slot++) {
      const s = await newSelf(h.su, account, slot, `c5-a${i}s${slot}`);
      selves.push(s);
      all.push({ self: s, account });
    }
    accounts.push({ account, selves });
  }
  const authored: Fixture['authored'] = [];
  const keyed: Fixture['keyed'] = [];
  for (let i = 0; i < 6; i++) {
    const author: Actor = { self: accounts[i]!.selves[0]!, account: accounts[i]!.account };
    const recipient: Actor = { self: accounts[(i + 1) % 6]!.selves[0]!, account: accounts[(i + 1) % 6]!.account };
    const artifact = await newArtifact(h.su, author.self, `c5 body ${i}`);
    const placement = await svc.createPlacementDraft(actingCtx(author.self), artifact);
    await svc.addRecipient(actingCtx(author.self), placement, recipient.self);
    await svc.beginDeparture(actingCtx(author.self), placement);
    await rewind(placement);
    await svc.settlePlacement(actingCtx(author.self), placement);
    authored.push({ artifact, author, recipient, placement });

    // a protected artifact reached only by a settled Key
    const protectedArtifact = await newArtifact(h.su, author.self, `c5 protected ${i}`);
    const kp = await svc.createKeyPlacementDraft(actingCtx(author.self), protectedArtifact);
    await svc.addRecipient(actingCtx(author.self), kp, recipient.self);
    await svc.beginDeparture(actingCtx(author.self), kp);
    await rewind(kp);
    await svc.settlePlacement(actingCtx(author.self), kp);
    keyed.push({ artifact: protectedArtifact, grantor: author, grantee: recipient });
  }
  f = { accounts, authored, keyed, all };
});

afterAll(async () => {
  await pool.end();
  await wk.end();
  await h.end();
});

interface Violation { op: string; detail: string }

describe('C5 — security semantics under sustained contention', () => {
  it(`survives ${OPS} overlapping operations at concurrency ${CONCURRENCY} over a pool of ${POOL_MAX}`, async () => {
    const rand = mulberry32(SEED);
    const violations: Violation[] = [];
    const note = (op: string, detail: string): number => violations.push({ op, detail });

    // Build the deterministic operation list up front, so the workload is a
    // property of SEED and not of the scheduler.
    const plan = Array.from({ length: OPS }, () => ({
      kind: rand(),
      a: Math.floor(rand() * f.authored.length),
      k: Math.floor(rand() * f.keyed.length),
      actor: Math.floor(rand() * f.all.length),
    }));

    // Revocations are applied to a disjoint slice of the keyed fixtures, so the
    // expected outcome of a capability read is never ambiguous mid-run.
    const revokedIdx = new Set([1, 4]);
    for (const i of revokedIdx) {
      const k = f.keyed[i]!;
      await svc.revokeKey(actingCtx(k.grantor.self), k.grantee.self, k.artifact);
    }

    const runOne = async (p: typeof plan[number]): Promise<void> => {
      const au = f.authored[p.a]!;
      const ky = f.keyed[p.k]!;
      const actor = f.all[p.actor]!;

      if (p.kind < 0.25) {
        // authorized read by the author
        const r = await svc.readArtifact(actingCtx(au.author.self), au.artifact);
        if (!r.ok) note('author-read', `author denied its own artifact ${au.artifact}`);
        else if (!r.value.textBody?.includes('c5 body')) note('author-read', 'unexpected payload');
      } else if (p.kind < 0.45) {
        // authorized read by the settled recipient
        const r = await svc.readPlacement(actingCtx(au.recipient.self), au.placement);
        if (!r.ok) note('recipient-read', `settled recipient denied ${au.placement}`);
      } else if (p.kind < 0.70) {
        // DENIED read by an arbitrary actor with no ground (incl. siblings and
        // other accounts). The expectation is fixed before the call.
        const isAuthor = actor.self === au.author.self;
        const isRecipient = actor.self === au.recipient.self;
        const r = await svc.readArtifact(actingCtx(actor.self), au.artifact);
        const shouldSee = isAuthor || isRecipient;
        if (r.ok !== shouldSee) {
          note('ground-read', `actor ${actor.self} on ${au.artifact}: got ${r.ok}, model ${shouldSee}` +
            (actor.account === au.author.account && !isAuthor ? ' [SIBLING LEAK]' : '') +
            (actor.account !== au.author.account && !isRecipient ? ' [CROSS-ACCOUNT LEAK]' : ''));
        }
      } else if (p.kind < 0.82) {
        // capability read: outcome is fixed by whether this fixture is revoked
        const expected = !revokedIdx.has(p.k);
        const r = await svc.readArtifact(actingCtx(ky.grantee.self), ky.artifact);
        if (r.ok !== expected) {
          note('key-read', `keyed[${p.k}] revoked=${revokedIdx.has(p.k)}: got ${r.ok}, model ${expected}` +
            (r.ok ? ' [REVOKED CAPABILITY RESURRECTED]' : ''));
        }
      } else if (p.kind < 0.94) {
        // a full lifecycle under contention, by a legitimate sender
        const art = await svc.createArtifact(actingCtx(actor.self), `c5 churn ${p.a}`);
        const plc = await svc.createPlacementDraft(actingCtx(actor.self), art);
        const target = f.all[(p.actor + 1) % f.all.length]!;
        await svc.addRecipient(actingCtx(actor.self), plc, target.self);
        await svc.beginDeparture(actingCtx(actor.self), plc);
        await rewind(plc);
        await svc.settlePlacement(actingCtx(actor.self), plc);
        await svc.settlePlacement(actingCtx(actor.self), plc); // duplicate: must be idempotent
        const st = (await h.su.query<{ s: string }>('SELECT state s FROM public.placements WHERE id=$1', [plc])).rows[0]!.s;
        if (st !== 'settled') note('lifecycle', `expected settled, got ${st}`);
        const ev = (await h.su.query<{ n: number }>(
          "SELECT count(*)::int n FROM public.outbox_events WHERE payload->>'placement_id' = $1", [plc])).rows[0]!.n;
        if (ev !== 1) note('lifecycle', `duplicate settle produced ${ev} outbox events for ${plc}`);
      } else {
        // worker/projection interaction concurrent with everything above
        await drain();
      }
    };

    // Fixed-size worker pool over the plan: CONCURRENCY chains stay in flight.
    const started = Date.now();
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= plan.length) return;
        await runOne(plan[i]!);
      }
    }));
    const elapsedMs = Date.now() - started;

    // Metadata only — never an acceptance criterion.
    // eslint-disable-next-line no-console
    console.log(`[C5] seed=${SEED} ops=${OPS} concurrency=${CONCURRENCY} poolMax=${POOL_MAX} elapsedMs=${elapsedMs}`);

    expect(violations, `contention violations:\n${violations.map((v) => `${v.op}: ${v.detail}`).join('\n')}`).toEqual([]);
  });

  it('postconditions: authoritative invariants survive the contention', async () => {
    await drain();
    const q = async (sql: string, params: unknown[] = []): Promise<number> =>
      Number((await h.su.query<{ n: number }>(sql, params)).rows[0]!.n);

    // 1 · lifecycle legality: no illegal state/timestamp combination exists
    expect(await q(`SELECT count(*)::int n FROM public.placements
      WHERE (state='settled' AND settled_at IS NULL) OR (state='cancelled' AND cancelled_at IS NULL)
         OR (state='draft' AND departing_at IS NOT NULL) OR (settled_at IS NOT NULL AND cancelled_at IS NOT NULL)`),
    ).toBe(0);

    // 2 · no duplicated authority-bearing effect: one settlement event each
    expect(await q(`SELECT coalesce(max(c),0)::int n FROM (
        SELECT count(*) c FROM public.outbox_events GROUP BY payload->>'placement_id') t`)).toBeLessThanOrEqual(1);

    // 3 · no revoked capability resurrected, and never two active grants
    expect(await q(`SELECT coalesce(max(c),0)::int n FROM (
        SELECT count(*) c FROM public.key_grants WHERE revoked_at IS NULL
        GROUP BY grantor_self_id, grantee_self_id, protected_resource_id) t`)).toBeLessThanOrEqual(1);
    for (const i of [1, 4]) {
      const k = f.keyed[i]!;
      expect((await svc.readArtifact(actingCtx(k.grantee.self), k.artifact)).ok,
        'a revoked capability stays revoked after contention').toBe(false);
    }

    // 4 · three-Self cardinality intact
    expect(await q('SELECT coalesce(max(c),0)::int n FROM (SELECT count(*) c FROM public.selves GROUP BY account_id) t'))
      .toBeLessThanOrEqual(3);

    // 5 · recipient freeze intact, checked BEHAVIOURALLY.
    //     A timestamp comparison (added_at > departing_at) would be meaningless
    //     here: the fixture's rewind() deliberately BACKDATES departing_at to
    //     move a placement past its settlement floor, so every fixture row trips
    //     such a query for a reason that has nothing to do with the freeze. The
    //     invariant under test is that a non-draft placement REFUSES a recipient
    //     change, so that is what is exercised.
    for (const a of f.authored) {
      const target = f.all.find((x) => x.self !== a.author.self && x.self !== a.recipient.self)!;
      const before = await q('SELECT count(*)::int n FROM public.placement_recipients WHERE placement_id=$1', [a.placement]);
      let refused: string | undefined;
      try { await svc.addRecipient(actingCtx(a.author.self), a.placement, target.self); }
      catch (e) { refused = (e as { code?: string }).code; }
      expect(refused, 'a settled placement refuses a recipient change').toBe('PT409');
      expect(await q('SELECT count(*)::int n FROM public.placement_recipients WHERE placement_id=$1', [a.placement]),
        'the frozen recipient set did not grow').toBe(before);
    }

    // 6 · projection grants no authority, and replay manufactures nothing
    const before = await q('SELECT count(*)::int n FROM proj.graph_edges');
    await drain();                       // duplicate/replay work
    expect(await q('SELECT count(*)::int n FROM proj.graph_edges')).toBe(before);
    const au = f.authored[0]!;
    const stranger = f.all.find((a) => a.account !== au.author.account && a.self !== au.recipient.self)!;
    await h.su.query('INSERT INTO proj.graph_edges (sender_self_id, recipient_self_id) VALUES ($1,$2),($2,$1)',
      [stranger.self, au.author.self]);   // poison DERIVED state only
    expect((await svc.readArtifact(actingCtx(stranger.self), au.artifact)).ok,
      'a poisoned edge grants nothing even after contention').toBe(false);
    await h.su.query('DELETE FROM proj.graph_edges WHERE sender_self_id=$1 OR recipient_self_id=$1', [stranger.self]);

    // 7 · connections return to a FAIL-CLOSED state: a pooled connection reused
    //     after all that traffic, with no context established, sees nothing.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const ctx = (await c.query<{ s: string | null }>('SELECT domain.current_acting_self() AS s')).rows[0]!.s;
      const seen = (await c.query<{ n: number }>('SELECT count(*)::int n FROM public.artifacts')).rows[0]!.n;
      expect(ctx, 'no acting-Self context survives on a reused connection').toBeNull();
      expect(seen, 'no rows are visible without established context').toBe(0);
      await c.query('COMMIT');
    } finally { c.release(); }

    // 8 · authority isolation still holds for a fresh read after contention
    for (const a of f.authored) {
      expect((await svc.readArtifact(actingCtx(a.author.self), a.artifact)).ok).toBe(true);
      expect((await svc.readPlacement(actingCtx(a.recipient.self), a.placement)).ok).toBe(true);
      const sibling = f.accounts.find((x) => x.account === a.author.account)!.selves[1]!;
      expect((await svc.readArtifact(actingCtx(sibling), a.artifact)).ok,
        'no sibling leakage survives contention').toBe(false);
    }
  });
});
