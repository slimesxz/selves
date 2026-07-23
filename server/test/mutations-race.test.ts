import './helpers/env';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { superuserPool } from './helpers/auth.ts';
import { connect, race } from './helpers/race.ts';

// P6-E — deterministic two-connection races on the placement state machine (no
// timing sleeps). Each domain.* mutation serializes on SELECT ... FOR UPDATE of
// the STABLE placement row; the harness holds one call mid-transaction (holding
// that row lock), fires the racer (which blocks on it), waits until the racer is
// OBSERVED waiting on a Lock, commits the holder, then reads the racer's outcome.
// This proves the one-winner / idempotency contract for both orderings.

let su: pg.Pool;
let appA: pg.Client, appB: pg.Client, probe: pg.Client;
const U = process.env;

beforeAll(() => {
  su = superuserPool();
});
afterAll(() => su.end());

beforeEach(async () => {
  appA = await connect(U.TEST_APP_DATABASE_URL);
  appB = await connect(U.TEST_APP_DATABASE_URL);
  probe = await connect(U.TEST_DATABASE_URL);
});
afterEach(async () => {
  for (const c of [appA, appB, probe]) {
    try {
      await c.end();
    } catch {
      /* already closed */
    }
  }
});

const CANCEL = 'SELECT domain.cancel_placement($1, $2)';
const SETTLE = 'SELECT domain.settle_placement($1, $2)';
const BEGIN = 'SELECT domain.begin_departure($1, $2)';
const ADDREC = 'SELECT domain.add_recipient($1, $2, $3)';

interface Fixture {
  sender: string;
  recipient: string;
  sibling: string;
  placement: string;
}

/** Create a sender/recipient/sibling + one placement (superuser), left in the
 *  requested state via the real state machine. A 'departing' fixture snapshots a
 *  5s interval and (when floorElapsed) backdates timestamps past the floor while
 *  keeping the time-order CHECK valid. */
async function fixture(opts: { state: 'draft' | 'departing'; floorElapsed?: boolean }): Promise<Fixture> {
  const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
  const mk = async (slot: number, name: string) =>
    (
      await su.query<{ id: string }>(
        'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, $2, $3) RETURNING id',
        [account, slot, name],
      )
    ).rows[0]!.id;
  const sender = await mk(1, 'sender');
  const recipient = await mk(2, 'recipient');
  const sibling = await mk(3, 'sibling');
  const artifact = (
    await su.query<{ id: string }>(
      "INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'text', 'x') RETURNING id",
      [sender],
    )
  ).rows[0]!.id;
  const placement = (
    await su.query<{ id: string }>(
      'INSERT INTO public.placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id',
      [sender, artifact],
    )
  ).rows[0]!.id;
  await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [
    placement,
    recipient,
  ]);
  if (opts.state === 'departing') {
    // draft -> departing with the interval snapshot set once (guard permits the
    // NULL->value write during this transition), timestamps backdated if needed.
    const times = opts.floorElapsed
      ? "created_at = now() - interval '2 min', departing_at = now() - interval '90 sec'"
      : 'departing_at = now()';
    await su.query(
      `UPDATE public.placements SET state = 'departing', ${times}, departure_interval_seconds = 5 WHERE id = $1`,
      [placement],
    );
  }
  return { sender, recipient, sibling, placement };
}

async function stateOf(placementId: string): Promise<string> {
  return (await su.query<{ state: string }>('SELECT state FROM public.placements WHERE id = $1', [placementId])).rows[0]!.state;
}

describe('P6-E cancel-vs-settle — exactly one winner (both orderings)', () => {
  it('settle commits first -> the racing cancel sees settled and fails PT409', async () => {
    const f = await fixture({ state: 'departing', floorElapsed: true });
    const out = await race(
      { client: appA, sql: SETTLE, params: [f.sender, f.placement] },
      { client: appB, sql: CANCEL, params: [f.sender, f.placement] },
      probe,
    );
    expect(out.racer.errCode).toBe('PT409');
    expect(await stateOf(f.placement)).toBe('settled');
  });
  it('cancel commits first -> the racing settle sees cancelled and fails PT409', async () => {
    const f = await fixture({ state: 'departing', floorElapsed: true });
    const out = await race(
      { client: appA, sql: CANCEL, params: [f.sender, f.placement] },
      { client: appB, sql: SETTLE, params: [f.sender, f.placement] },
      probe,
    );
    expect(out.racer.errCode).toBe('PT409');
    expect(await stateOf(f.placement)).toBe('cancelled');
  });
});

describe('P6-E settle-vs-settle — idempotent, no duplicate effect', () => {
  it('the second settle is a no-op success; settled_at is the winner\'s and does not move', async () => {
    const f = await fixture({ state: 'departing', floorElapsed: true });
    const out = await race(
      { client: appA, sql: SETTLE, params: [f.sender, f.placement] },
      { client: appB, sql: SETTLE, params: [f.sender, f.placement] },
      probe,
    );
    expect(out.racer.errCode).toBeUndefined(); // idempotent
    expect(await stateOf(f.placement)).toBe('settled');
    const settledAt = (await su.query('SELECT settled_at FROM public.placements WHERE id = $1', [f.placement])).rows[0].settled_at;
    expect(settledAt).not.toBeNull();
  });
});

describe('P6-E begin-vs-cancel — begin is rejected on a non-draft placement', () => {
  it('cancel commits first -> the racing begin_departure sees cancelled and fails PT409', async () => {
    const f = await fixture({ state: 'departing' });
    const out = await race(
      { client: appA, sql: CANCEL, params: [f.sender, f.placement] },
      { client: appB, sql: BEGIN, params: [f.sender, f.placement] },
      probe,
    );
    expect(out.racer.errCode).toBe('PT409');
    expect(await stateOf(f.placement)).toBe('cancelled');
  });
});

describe('P6-E addRecipient-vs-beginDeparture — the freeze boundary holds under concurrency', () => {
  it('begin_departure commits first -> the racing addRecipient sees departing and fails PT409', async () => {
    const f = await fixture({ state: 'draft' });
    const out = await race(
      { client: appA, sql: BEGIN, params: [f.sender, f.placement] },
      { client: appB, sql: ADDREC, params: [f.sender, f.placement, f.sibling] },
      probe,
    );
    expect(out.racer.errCode).toBe('PT409');
    expect(await stateOf(f.placement)).toBe('departing');
    const n = (await su.query('SELECT count(*)::int n FROM public.placement_recipients WHERE placement_id = $1', [f.placement])).rows[0].n;
    expect(n).toBe(1); // the frozen recipient set was not grown
  });
});
