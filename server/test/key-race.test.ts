import './helpers/env';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { superuserPool } from './helpers/auth.ts';
import { connect, race } from './helpers/race.ts';

// P7-E — deterministic two-connection races on the Key lifecycle (no timing
// sleeps), reusing the P6-E harness. One call is held mid-transaction; the racer
// blocks on it; once the racer is OBSERVED waiting on a Lock the holder commits
// and the racer's outcome is read. Proves R10 (settlement collision → exactly one
// grant) and the revoke idempotency/one-winner contract under concurrency.

let su: pg.Pool;
let appA: pg.Client, appB: pg.Client, probe: pg.Client;
const U = process.env;

beforeAll(() => { su = superuserPool(); });
afterAll(() => su.end());

beforeEach(async () => {
  appA = await connect(U.TEST_APP_DATABASE_URL);
  appB = await connect(U.TEST_APP_DATABASE_URL);
  probe = await connect(U.TEST_DATABASE_URL);
});
afterEach(async () => {
  for (const c of [appA, appB, probe]) {
    try { await c.end(); } catch { /* already closed */ }
  }
});

const SETTLE = 'SELECT domain.settle_placement($1, $2)';
const REVOKE = 'SELECT domain.revoke_key($1, $2, $3)';

async function mkTriple(): Promise<{ grantor: string; grantee: string; resource: string }> {
  const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
  const mk = async (slot: number, name: string) =>
    (await su.query<{ id: string }>('INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1,$2,$3) RETURNING id', [account, slot, name])).rows[0]!.id;
  const grantor = await mk(1, 'grantor');
  const grantee = await mk(2, 'grantee');
  const resource = (await su.query<{ id: string }>("INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1,'text','x') RETURNING id", [grantor])).rows[0]!.id;
  return { grantor, grantee, resource };
}

/** A departing Key Placement for (grantor→grantee over resource), floor elapsed. */
async function departingKeyPlacement(grantor: string, grantee: string, resource: string): Promise<string> {
  const kp = (await su.query<{ id: string }>(
    'INSERT INTO public.placements (sender_self_id, payload_type, artifact_id, protected_resource_id) VALUES ($1,$2,$3,$4) RETURNING id',
    [grantor, 'key', null, resource],
  )).rows[0]!.id;
  await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1,$2)', [kp, grantee]);
  await su.query(
    "UPDATE public.placements SET state='departing', created_at = now() - interval '2 min', departing_at = now() - interval '90 sec', departure_interval_seconds = 5 WHERE id = $1",
    [kp],
  );
  return kp;
}

async function activeGrantCount(grantor: string, grantee: string, resource: string): Promise<number> {
  return (await su.query<{ n: number }>('SELECT count(*)::int n FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3 AND revoked_at IS NULL', [grantor, grantee, resource])).rows[0]!.n;
}
async function stateOf(id: string): Promise<string> {
  return (await su.query<{ state: string }>('SELECT state FROM public.placements WHERE id = $1', [id])).rows[0]!.state;
}

describe('P7-E settlement collision — two Key Placements, exactly one grant (R10)', () => {
  it('the first settle grants; the racing settle sees the active-unique conflict (23505) and does not settle', async () => {
    const t = await mkTriple();
    const kp1 = await departingKeyPlacement(t.grantor, t.grantee, t.resource);
    const kp2 = await departingKeyPlacement(t.grantor, t.grantee, t.resource);
    const out = await race(
      { client: appA, sql: SETTLE, params: [t.grantor, kp1] },
      { client: appB, sql: SETTLE, params: [t.grantor, kp2] },
      probe,
    );
    expect(out.racer.errCode).toBe('23505'); // maps to 409 (proven in key-lifecycle)
    expect(await stateOf(kp1)).toBe('settled');
    expect(await stateOf(kp2)).toBe('departing'); // the loser did not settle
    expect(await activeGrantCount(t.grantor, t.grantee, t.resource)).toBe(1); // exactly one capability
  });
});

describe('P7-E revoke vs revoke — idempotent, one-winner (audit point 5)', () => {
  it('the second revoke is a no-op success; exactly one revoked grant remains, none active', async () => {
    const t = await mkTriple();
    await su.query('INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES ($1,$2,$3)', [t.grantor, t.grantee, t.resource]);
    const out = await race(
      { client: appA, sql: REVOKE, params: [t.grantor, t.grantee, t.resource] },
      { client: appB, sql: REVOKE, params: [t.grantor, t.grantee, t.resource] },
      probe,
    );
    expect(out.racer.errCode).toBeUndefined(); // idempotent success, not an error
    expect(await activeGrantCount(t.grantor, t.grantee, t.resource)).toBe(0);
    const total = (await su.query<{ n: number }>('SELECT count(*)::int n FROM public.key_grants WHERE grantor_self_id=$1 AND grantee_self_id=$2 AND protected_resource_id=$3', [t.grantor, t.grantee, t.resource])).rows[0]!.n;
    expect(total).toBe(1); // one row, revoked once — no duplicate, no resurrection
  });
});
