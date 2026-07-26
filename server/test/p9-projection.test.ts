import './helpers/env';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makeAuthz, actingCtx, newAccount, newSelf, newArtifact, newPlacement, newKeyGrant } from './helpers/authz.ts';
import { workerPool } from './helpers/auth.ts';
import { resetTables } from './helpers/db.ts';
import type { AuthorizationService } from '../src/authz/service.ts';

// P9-F — projection derivation, replay, rebuild, ordering, poisoning, and
// revocation independence (decision 0011 Q4–Q7, B.1, B.2; charter law 1).
//
// The worker derives existence-only author-side edges from AUTHORITATIVE rows
// (the event is a pointer). Apply is idempotent and order-insensitive; claiming
// is by predicate, never stored position; rebuild recomputes from authoritative
// records and touches no outbox column; and no projection row is ever an
// authorization input — a poisoned edge changes no outcome and is healed by
// rebuild.

let h: ReturnType<typeof makeAuthz>;
let su: pg.Pool;
let wk: pg.Pool;
let service: AuthorizationService;

beforeAll(() => {
  h = makeAuthz();
  su = h.su;
  wk = workerPool();
  service = h.service;
});
afterAll(async () => {
  await h.end();
  await wk.end();
});

beforeEach(async () => {
  await resetTables(su);
  await su.query('TRUNCATE proj.graph_edges');
});

/** Run worker passes until a pass claims nothing (processed=0 AND failed=0). */
async function processAll(): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < 30; i++) {
    const { rows } = await wk.query<{ processed: number; failed: number }>(
      'SELECT processed, failed FROM proj.process_outbox($1)',
      [100],
    );
    const p = Number(rows[0]!.processed);
    const f = Number(rows[0]!.failed);
    processed += p;
    failed += f;
    if (p === 0 && f === 0) return { processed, failed };
  }
  throw new Error('processAll did not drain in 30 passes');
}

function sortEdges(rows: { s: string; r: string }[]): { s: string; r: string }[] {
  return [...rows].sort((a, b) => (a.s + a.r).localeCompare(b.s + b.r));
}

async function edges(): Promise<{ s: string; r: string }[]> {
  const { rows } = await su.query<{ s: string; r: string }>(
    'SELECT sender_self_id AS s, recipient_self_id AS r FROM proj.graph_edges',
  );
  return sortEdges(rows);
}

async function insertEvent(placementId: string): Promise<number> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO public.outbox_events (event_type, payload)
     VALUES ('placement_settled', jsonb_build_object('placement_id', $1::uuid)) RETURNING id`,
    [placementId],
  );
  return Number(rows[0]!.id); // bigint arrives as a string
}

/** Invoke the owner-only rebuild exactly as the ruled operator path does. */
async function rebuild(): Promise<void> {
  const c = await su.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE selves_owner');
    await c.query('SELECT proj.rebuild_graph()');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** A settled key-shaped Placement created through su fixtures (R2 shape). */
async function settledKeyPlacement(sender: string, grantee: string, resource: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "INSERT INTO public.placements (sender_self_id, payload_type, artifact_id, protected_resource_id) VALUES ($1, 'key', NULL, $2) RETURNING id",
    [sender, resource],
  );
  const id = rows[0]!.id;
  await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [id, grantee]);
  await su.query("UPDATE public.placements SET state = 'departing', departing_at = now() WHERE id = $1", [id]);
  await su.query("UPDATE public.placements SET state = 'settled', settled_at = now() WHERE id = $1", [id]);
  return id;
}

describe('P9 projection — derivation from authoritative rows', () => {
  it('a settled text Placement yields one existence edge per recipient, including the reflexive self-address', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const art = await newArtifact(su, sender);
    const plc = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1, sender] });
    await insertEvent(plc);

    const pass = await processAll();
    expect(pass).toEqual({ processed: 1, failed: 0 });
    expect(await edges()).toEqual(
      sortEdges([
        { s: sender, r: r1 },
        { s: sender, r: sender },
      ]),
    );
  });

  it('duplicate delivery and full replay are idempotent (recompute, not dedup bookkeeping)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const art = await newArtifact(su, sender);
    const plc = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });
    const ev = await insertEvent(plc);
    await processAll();
    const snapshot = await edges();

    // Duplicate delivery: re-open the same event and re-apply.
    await su.query('UPDATE public.outbox_events SET processed_at = NULL WHERE id = $1', [ev]);
    await processAll();
    expect(await edges()).toEqual(snapshot);

    // Full replay of the log.
    await su.query('UPDATE public.outbox_events SET processed_at = NULL WHERE failed_at IS NULL');
    await processAll();
    expect(await edges()).toEqual(snapshot);
  });

  it('a forged event naming a Key Placement is consumed WITHOUT deriving an edge (Q2 structural at application)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const grantee = await newSelf(su, account, 2, 'grantee');
    const art = await newArtifact(su, sender);
    const keyPlc = await settledKeyPlacement(sender, grantee, art);
    await insertEvent(keyPlc); // forged: the real settle emits nothing for keys

    const pass = await processAll();
    expect(pass).toEqual({ processed: 1, failed: 0 }); // consumed…
    expect(await edges()).toEqual([]); // …with zero projection effect
  });

  it('an event naming a nonexistent or unsettled Placement derives nothing', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const art = await newArtifact(su, sender);
    const draft = await newPlacement(su, { sender, artifact: art, state: 'draft', recipients: [r1] });
    await insertEvent(draft);
    await insertEvent('00000000-0000-0000-0000-000000000000');
    const pass = await processAll();
    expect(pass).toEqual({ processed: 2, failed: 0 });
    expect(await edges()).toEqual([]);
  });
});

describe('P9 projection — rebuild (B.1)', () => {
  it('rebuilt state equals incrementally applied state over a mixed lifecycle', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const other = await newAccount(su);
    const r2 = await newSelf(su, other, 1, 'r2');
    const art = await newArtifact(su, sender);

    const p1 = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });
    const p2 = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1, r2] });
    await newPlacement(su, { sender, artifact: art, state: 'cancelled', recipients: [r1] }); // no event, no edge
    const keyPlc = await settledKeyPlacement(sender, r1, art); // no edge ever
    await insertEvent(p1);
    await insertEvent(p2);
    await insertEvent(keyPlc); // forged key event: consumed, no effect
    await su.query(`INSERT INTO public.outbox_events (event_type, payload) VALUES ('placement_settled', '{}'::jsonb)`); // poison

    const pass = await processAll(); // drains, dead-letters the poison
    expect(pass.processed).toBe(3);
    expect(pass.failed).toBeGreaterThan(0);
    const incremental = await edges();
    expect(incremental).toHaveLength(2); // (sender,r1), (sender,r2)

    await rebuild();
    expect(await edges()).toEqual(incremental);
  });

  it('rebuild touches NO outbox column and composes with process in either order (the B.1 invariant)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const art = await newArtifact(su, sender);
    const p1 = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });
    await insertEvent(p1);

    const outboxBefore = (
      await su.query('SELECT id, event_type, payload::text AS payload, occurred_at, processed_at, attempts, last_error, failed_at FROM public.outbox_events ORDER BY id')
    ).rows;

    // Rebuild FIRST: edges materialize from authoritative records…
    await rebuild();
    const rebuilt = await edges();
    expect(rebuilt).toEqual([{ s: sender, r: r1 }]);
    // …and the outbox is byte-identical: unprocessed events REMAIN unprocessed.
    const outboxAfter = (
      await su.query('SELECT id, event_type, payload::text AS payload, occurred_at, processed_at, attempts, last_error, failed_at FROM public.outbox_events ORDER BY id')
    ).rows;
    expect(outboxAfter).toEqual(outboxBefore);

    // Processing afterwards consumes the events and converges to identical state.
    const pass = await processAll();
    expect(pass).toEqual({ processed: 1, failed: 0 });
    expect(await edges()).toEqual(rebuilt);
  });
});

describe('P9 projection — no ordering dependence (B.2)', () => {
  it('out-of-order application (via lock-skipped claims) converges to the same state as in-order', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const r2 = await newSelf(su, account, 3, 'r2');
    const art = await newArtifact(su, sender);
    const p1 = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });
    const p2 = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r2] });
    const e1 = await insertEvent(p1);
    await insertEvent(p2);

    // Hold locks on the EARLIER event; the pass (SKIP LOCKED) applies the later
    // one first — out-of-order by construction.
    const locker = await su.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM public.outbox_events WHERE id = $1 FOR UPDATE', [e1]);
      const first = await wk.query('SELECT processed, failed FROM proj.process_outbox($1)', [100]);
      expect(Number(first.rows[0]!.processed)).toBe(1); // only e2
      expect(await edges()).toEqual([{ s: sender, r: r2 }]);
      await locker.query('ROLLBACK');
    } finally {
      locker.release();
    }

    // Nothing advanced past e1: the predicate re-includes it on the next pass.
    await processAll();
    const finalEdges = await edges();
    expect(finalEdges).toHaveLength(2);
    await rebuild();
    expect(await edges()).toEqual(finalEdges);
  });

  it('a lower id committing AFTER a higher id is still claimed and applied (predicate, not position)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const r2 = await newSelf(su, account, 3, 'r2');
    const art = await newArtifact(su, sender);
    const p1 = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });
    const p2 = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r2] });

    // Connection A allocates the LOWER id but does not commit yet.
    const late = await su.connect();
    try {
      await late.query('BEGIN');
      const { rows } = await late.query<{ id: string }>(
        `INSERT INTO public.outbox_events (event_type, payload)
         VALUES ('placement_settled', jsonb_build_object('placement_id', $1::uuid)) RETURNING id`,
        [p1],
      );
      const lowId = Number(rows[0]!.id);
      const highId = await insertEvent(p2); // committed, higher id
      expect(highId).toBeGreaterThan(lowId);

      await processAll(); // sees only the committed higher id
      expect(await edges()).toEqual([{ s: sender, r: r2 }]);

      await late.query('COMMIT'); // the lower id becomes visible AFTER the higher was processed
    } finally {
      late.release();
    }

    const pass = await processAll(); // predicate re-evaluation claims the late lower id
    expect(pass).toEqual({ processed: 1, failed: 0 });
    expect(await edges()).toHaveLength(2);
  });
});

describe('P9 projection — never an authorization input (charter law 1)', () => {
  it('a poisoned edge changes no authorization outcome and is healed by rebuild', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const other = await newAccount(su);
    const stranger = await newSelf(su, other, 1, 'stranger');
    const art = await newArtifact(su, sender);
    await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });

    // Baseline: the stranger cannot read the Artifact.
    expect((await service.readArtifact(actingCtx(stranger), art)).ok).toBe(false);

    // Poison the projection with a fabricated stranger↔sender relationship.
    await su.query('INSERT INTO proj.graph_edges (sender_self_id, recipient_self_id) VALUES ($1, $2), ($2, $1)', [
      stranger,
      sender,
    ]);

    // No authorization outcome changes: the read path never touches the mirror.
    expect((await service.readArtifact(actingCtx(stranger), art)).ok).toBe(false);
    expect((await service.readArtifact(actingCtx(r1), art)).ok).toBe(true);
    expect((await service.readArtifact(actingCtx(sender), art)).ok).toBe(true);

    // Destroy-and-rebuild heals the poisoning: only derived rows survive.
    await rebuild();
    expect(await edges()).toEqual([{ s: sender, r: r1 }]);
  });

  it('revocation composes with worker activity: no pass resurrects revoked access and no edge reflects Keys', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const grantee = await newSelf(su, account, 2, 'grantee');
    const art = await newArtifact(su, sender);
    await newKeyGrant(su, { grantor: sender, grantee, resource: art });

    expect((await service.readArtifact(actingCtx(grantee), art)).ok).toBe(true);
    await processAll();
    expect(await edges()).toEqual([]); // Keys never project

    // Revoke while the worker keeps running.
    await su.query('UPDATE public.key_grants SET revoked_at = now() WHERE grantor_self_id = $1 AND grantee_self_id = $2', [
      sender,
      grantee,
    ]);
    await processAll();
    expect((await service.readArtifact(actingCtx(grantee), art)).ok).toBe(false);
    expect(await edges()).toEqual([]);
  });
});
