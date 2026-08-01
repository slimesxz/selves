// P10-S5 — operator-side additional-Self provisioning (P10-N3 ruling; 0012
// §39). Exercises the real auth.add_self boundary through the real command
// layer over the bootstrap role, exactly as the operator CLI does. Seven cases.
//
// Validity is schema-owned: this suite OBSERVES the database's own rejection of
// an out-of-range slot and a blank name rather than asserting an
// application-level range or presence contract.
import './helpers/env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { addSelf } from '../src/operator/commands.ts';
import { appTestPool, bootstrapPool, enroll, sha256, superuserPool } from './helpers/auth.ts';
import { connect, race } from './helpers/race.ts';

let boot: pg.Pool;
let su: pg.Pool;
let app: pg.Pool;

beforeAll(() => {
  boot = bootstrapPool();
  su = superuserPool();
  app = appTestPool();
});
afterAll(async () => {
  await Promise.all([boot.end(), su.end(), app.end()]);
});

const slotsOf = async (account: string): Promise<Array<{ self_slot: number; id: string; name: string }>> =>
  (
    await su.query<{ self_slot: number; id: string; name: string }>(
      'SELECT self_slot, id, name FROM public.selves WHERE account_id = $1 ORDER BY self_slot',
      [account],
    )
  ).rows;

describe('P10-S5 operator add-self provisioning', () => {
  it('provisions slot 2 and slot 3 for an enrolled account, returning the new Self ids', async () => {
    const e = await enroll(boot);
    const two = await addSelf(boot, { account: e.accountId, slot: 2, name: 'second' });
    const three = await addSelf(boot, { account: e.accountId, slot: 3, name: 'third' });
    expect(two.status).toBe('added');
    expect(three.status).toBe('added');
    if (two.status === 'added' && three.status === 'added') {
      expect(two.selfId).toMatch(/^[0-9a-f-]{36}$/);
      expect(three.selfId).not.toBe(two.selfId);
      const rows = await slotsOf(e.accountId);
      expect(rows.map((r) => r.self_slot)).toEqual([1, 2, 3]);
      expect(rows.map((r) => r.id)).toEqual([e.selfId, two.selfId, three.selfId]);
    }
  });

  it('the authoritative account-Self listing observes the provisioned Selves in slot order', async () => {
    // domain.list_account_selves is the substrate GET /auth/selves reads: the
    // switcher sees provisioned Selves with no further change (0012 §39).
    const e = await enroll(boot);
    await addSelf(boot, { account: e.accountId, slot: 2, name: 'listed-two' });
    const th = await su.query<{ token_hash: Buffer }>(
      'INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2) RETURNING token_hash',
      [e.accountId, sha256(randomUUID())],
    );
    const { rows } = await app.query<{ id: string; name: string; self_slot: number }>(
      'SELECT id, name, self_slot FROM domain.list_account_selves($1)',
      [th.rows[0]!.token_hash],
    );
    expect(rows.map((r) => r.self_slot)).toEqual([1, 2]);
    expect(rows.map((r) => r.name)).toEqual(['test-self', 'listed-two']);
  });

  it('a nonexistent account raises PT404 and creates nothing', async () => {
    const ghost = randomUUID();
    const r = await addSelf(boot, { account: ghost, slot: 2, name: 'orphan' });
    expect(r.status).toBe('not_found');
    const { rows } = await su.query('SELECT 1 FROM public.accounts WHERE id = $1', [ghost]);
    expect(rows).toHaveLength(0); // no implicit account creation
    expect(await slotsOf(ghost)).toEqual([]);
  });

  it('an occupied slot raises PT409 and leaves the incumbent Self byte-identical (including slot 1)', async () => {
    const e = await enroll(boot);
    const before1 = (await slotsOf(e.accountId))[0]!;
    const onSlotOne = await addSelf(boot, { account: e.accountId, slot: 1, name: 'usurper' });
    expect(onSlotOne.status).toBe('slot_occupied'); // no separate slot-1 rule: it is simply occupied
    await addSelf(boot, { account: e.accountId, slot: 2, name: 'incumbent-two' });
    const before2 = (await slotsOf(e.accountId))[1]!;
    const onSlotTwo = await addSelf(boot, { account: e.accountId, slot: 2, name: 'replacement' });
    expect(onSlotTwo.status).toBe('slot_occupied');
    const after = await slotsOf(e.accountId);
    expect(after[0]).toEqual(before1); // no overwrite, rename, or mutation
    expect(after[1]).toEqual(before2);
    expect(after).toHaveLength(2); // and no duplicate row
  });

  it('duplicate names on one account remain permitted', async () => {
    const e = await enroll(boot, { name: 'twin' });
    const r = await addSelf(boot, { account: e.accountId, slot: 2, name: 'twin' });
    expect(r.status).toBe('added');
    const rows = await slotsOf(e.accountId);
    expect(rows.map((x) => x.name)).toEqual(['twin', 'twin']);
  });

  it('EXECUTE is granted to selves_bootstrap only: selves_app is denied and holds no INSERT on public.selves', async () => {
    const { rows } = await su.query<{ b: boolean; a: boolean; pub: boolean; ins: boolean }>(
      `SELECT has_function_privilege('selves_bootstrap', 'auth.add_self(uuid,smallint,text)', 'EXECUTE') AS b,
              has_function_privilege('selves_app', 'auth.add_self(uuid,smallint,text)', 'EXECUTE') AS a,
              has_function_privilege('public', 'auth.add_self(uuid,smallint,text)', 'EXECUTE') AS pub,
              has_table_privilege('selves_app', 'public.selves', 'INSERT') AS ins`,
    );
    expect(rows[0]).toEqual({ b: true, a: false, pub: false, ins: false });
    // and the app role cannot reach the function at runtime either
    await expect(
      app.query('SELECT auth.add_self($1, $2, $3)', [randomUUID(), 2, 'x']),
    ).rejects.toMatchObject({ code: '42501' });
  });

  // P10-S6 (0012 §40): the executed concurrent proof. The settled-state case
  // above proves the occupied contract; this proves the RACE — two callers
  // competing for the same previously free coordinate. race() holds the first
  // INSERT uncommitted and does not release it until the second is OBSERVED
  // waiting on a Lock, so contention is established, not inferred: no sleep,
  // no timing threshold, and no sampled wait-event string is asserted here.
  it('two concurrent add_self calls for the same free slot: one wins with its id and name, the other receives PT409, and exactly one row survives', async () => {
    const e = await enroll(boot); // slot 1 occupied by enrollment; slot 2 free
    expect((await slotsOf(e.accountId)).map((r) => r.self_slot)).toEqual([1]);
    const holder = await connect(process.env.TEST_BOOTSTRAP_DATABASE_URL);
    const racer = await connect(process.env.TEST_BOOTSTRAP_DATABASE_URL);
    const probe = await connect(process.env.TEST_DATABASE_URL);
    try {
      const out = await race(
        { client: holder, sql: 'SELECT auth.add_self($1, $2, $3) AS id', params: [e.accountId, 2, 'holder'] },
        { client: racer, sql: 'SELECT auth.add_self($1, $2, $3) AS id', params: [e.accountId, 2, 'racer'] },
        probe,
      );
      const winnerId = (out.holdRows[0] as { id: string }).id;
      expect(winnerId).toMatch(/^[0-9a-f-]{36}$/); // the holder succeeded with an id
      expect(out.racer.errCode).toBe('PT409'); // the racer lost the coordinate
      expect(out.racer.ok).toBeUndefined();
      const rows = await slotsOf(e.accountId);
      const atSlotTwo = rows.filter((r) => r.self_slot === 2);
      expect(atSlotTwo).toHaveLength(1); // exactly one row occupies the slot
      expect(atSlotTwo[0]!.id).toBe(winnerId); // it is the holder's row
      expect(atSlotTwo[0]!.name).toBe('holder'); // unmodified by the loser
      expect(rows.map((r) => r.self_slot)).toEqual([1, 2]); // no duplicate coordinate
    } finally {
      await Promise.all([holder.end(), racer.end(), probe.end()]);
    }
  });

  it('schema constraints own validity: out-of-range slot and blank name fail at the database, and three occupied slots leave no fourth legal coordinate', async () => {
    const e = await enroll(boot);
    // Out-of-range: rejected by selves_slot_range, not by CLI/TypeScript policy.
    const low = await addSelf(boot, { account: e.accountId, slot: 0, name: 'zero' });
    const high = await addSelf(boot, { account: e.accountId, slot: 4, name: 'four' });
    for (const r of [low, high]) {
      expect(r.status).toBe('error');
      if (r.status === 'error') expect(r.sqlstate).toBe('23514'); // check_violation
    }
    // Blank name: rejected by selves_name_present.
    const blank = await addSelf(boot, { account: e.accountId, slot: 2, name: '   ' });
    expect(blank.status).toBe('error');
    if (blank.status === 'error') expect(blank.sqlstate).toBe('23514');
    // Fill the legal coordinates, then show no fourth exists: every slot is
    // either occupied (PT409) or out of range (23514). No count rule needed.
    expect((await addSelf(boot, { account: e.accountId, slot: 2, name: 'two' })).status).toBe('added');
    expect((await addSelf(boot, { account: e.accountId, slot: 3, name: 'three' })).status).toBe('added');
    for (const slot of [1, 2, 3]) {
      expect((await addSelf(boot, { account: e.accountId, slot, name: 'x' })).status).toBe('slot_occupied');
    }
    const overflow = await addSelf(boot, { account: e.accountId, slot: 4, name: 'x' });
    expect(overflow.status).toBe('error');
    expect((await slotsOf(e.accountId)).map((r) => r.self_slot)).toEqual([1, 2, 3]);
  });
});
