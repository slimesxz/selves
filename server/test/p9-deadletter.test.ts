import './helpers/env';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { newAccount, newSelf, newArtifact, newPlacement } from './helpers/authz.ts';
import { superuserPool, workerPool } from './helpers/auth.ts';
import { resetTables, expectPgError, PG } from './helpers/db.ts';

// P9-F — dead-lettering, revival, and the terminal-exclusion CHECK (decision
// 0011 B.3, B.5, C4).
//
// A failing event accumulates attempts and dead-letters at the owner-side
// threshold: failed_at set, last_error recorded, processed_at NULL, excluded
// from claiming, never deleted. The queue proceeds past a poison event. Tests
// drive events to terminal state BEHAVIORALLY and assert attempts equals the
// observed number of failing passes — the threshold literal appears nowhere
// here (B.5). Revival is owner-run SQL under SET ROLE, the same posture as
// rebuild; a revived event applies correctly.

let su: pg.Pool;
let wk: pg.Pool;

beforeAll(() => {
  su = superuserPool();
  wk = workerPool();
});
afterAll(async () => {
  await Promise.all([su.end(), wk.end()]);
});

beforeEach(async () => {
  await resetTables(su);
  await su.query('TRUNCATE proj.graph_edges');
});

interface EventRow {
  processed_at: Date | null;
  failed_at: Date | null;
  attempts: number;
  last_error: string | null;
}

async function eventRow(id: number): Promise<EventRow> {
  const { rows } = await su.query<EventRow>(
    'SELECT processed_at, failed_at, attempts, last_error FROM public.outbox_events WHERE id = $1',
    [id],
  );
  return rows[0]!;
}

async function onePass(): Promise<{ processed: number; failed: number }> {
  const { rows } = await wk.query<{ processed: number; failed: number }>(
    'SELECT processed, failed FROM proj.process_outbox($1)',
    [100],
  );
  return { processed: Number(rows[0]!.processed), failed: Number(rows[0]!.failed) };
}

/** Run single passes until the event reaches terminal state; return how many
 *  passes failed it. Deliberately does NOT know the threshold (B.5). */
async function driveToTerminal(id: number): Promise<number> {
  for (let passes = 0; passes < 20; passes++) {
    if ((await eventRow(id)).failed_at !== null) return passes;
    const pass = await onePass();
    expect(pass.failed).toBeGreaterThan(0); // the poison event failed this pass
  }
  throw new Error('event did not reach terminal state within 20 passes');
}

async function insertPoison(payload = '{}'): Promise<number> {
  const { rows } = await su.query<{ id: string }>(
    "INSERT INTO public.outbox_events (event_type, payload) VALUES ('placement_settled', $1::jsonb) RETURNING id",
    [payload],
  );
  return Number(rows[0]!.id);
}

describe('P9 dead-lettering (B.3)', () => {
  it('a poison event dead-letters after the threshold: failed_at set, last_error recorded, processed_at NULL, attempts = observed failing passes', async () => {
    const ev = await insertPoison(); // payload missing placement_id
    const failingPasses = await driveToTerminal(ev);

    const row = await eventRow(ev);
    expect(row.failed_at).not.toBeNull();
    expect(row.processed_at).toBeNull();
    expect(row.last_error).toMatch(/placement_id/);
    // attempts counts failed application attempts — exactly the passes we drove.
    expect(row.attempts).toBe(failingPasses);
    expect(failingPasses).toBeGreaterThan(1); // retried before terminal, never dead-lettered on sight
  });

  it('a terminal event is excluded from claiming: further passes touch nothing', async () => {
    const ev = await insertPoison();
    await driveToTerminal(ev);
    const before = await eventRow(ev);
    expect(await onePass()).toEqual({ processed: 0, failed: 0 });
    expect(await eventRow(ev)).toEqual(before); // attempts stopped growing
  });

  it('an unknown event type is default-denied and dead-letters (Q13 mechanical enforcement)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const art = await newArtifact(su, sender);
    const plc = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [sender] });
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO public.outbox_events (event_type, payload)
       VALUES ('unratified_type', jsonb_build_object('placement_id', $1::uuid)) RETURNING id`,
      [plc],
    );
    const ev = Number(rows[0]!.id);
    await driveToTerminal(ev);
    const row = await eventRow(ev);
    expect(row.failed_at).not.toBeNull();
    expect(row.last_error).toMatch(/unknown event type/);
    // Nothing was derived from the unratified type.
    const { rows: e } = await su.query('SELECT 1 FROM proj.graph_edges');
    expect(e).toHaveLength(0);
  });

  it('the queue proceeds past a poison event — no head-of-line blocking', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const art = await newArtifact(su, sender);
    const plc = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });

    const poison = await insertPoison(); // LOWER id
    const { rows } = await su.query<{ id: string }>(
      `INSERT INTO public.outbox_events (event_type, payload)
       VALUES ('placement_settled', jsonb_build_object('placement_id', $1::uuid)) RETURNING id`,
      [plc],
    );
    const valid = Number(rows[0]!.id); // HIGHER id
    expect(valid).toBeGreaterThan(poison);

    // ONE pass: the poison fails, the valid event behind it still applies.
    expect(await onePass()).toEqual({ processed: 1, failed: 1 });
    expect((await eventRow(valid)).processed_at).not.toBeNull();
    const { rows: e } = await su.query('SELECT sender_self_id AS s, recipient_self_id AS r FROM proj.graph_edges');
    expect(e).toEqual([{ s: sender, r: r1 }]);
  });

  it('revival is owner-run SQL; a revived event applies correctly (B.3)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const r1 = await newSelf(su, account, 2, 'r1');
    const art = await newArtifact(su, sender);
    const plc = await newPlacement(su, { sender, artifact: art, state: 'settled', recipients: [r1] });

    const ev = await insertPoison();
    await driveToTerminal(ev);

    // Owner-run revival under SET ROLE (the ruled posture — no login role holds
    // this path). The payload repair is the harness's stand-in for a RESOLVED
    // transient cause (C4): revival itself is exactly clearing failed_at and
    // resetting attempts.
    const c = await su.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE selves_owner');
      await c.query(
        `UPDATE public.outbox_events
            SET failed_at = NULL, attempts = 0, last_error = NULL,
                payload = jsonb_build_object('placement_id', $2::uuid)
          WHERE id = $1`,
        [ev, plc],
      );
      await c.query('COMMIT');
    } finally {
      c.release();
    }

    // The claim predicate re-includes it; the next pass applies it.
    expect(await onePass()).toEqual({ processed: 1, failed: 0 });
    const row = await eventRow(ev);
    expect(row.processed_at).not.toBeNull();
    expect(row.failed_at).toBeNull();
    const { rows: e } = await su.query('SELECT sender_self_id AS s, recipient_self_id AS r FROM proj.graph_edges');
    expect(e).toEqual([{ s: sender, r: r1 }]);
  });

  it('the terminal-exclusion CHECK: an event can never be both delivered and dead (23514)', async () => {
    const ev = await insertPoison();
    await expectPgError(
      () => su.query('UPDATE public.outbox_events SET processed_at = now(), failed_at = now() WHERE id = $1', [ev]),
      PG.check,
    );
  });
});
