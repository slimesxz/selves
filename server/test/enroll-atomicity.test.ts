import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { bootstrapPool, superuserPool } from './helpers/auth.ts';
import { expectPgError } from './helpers/db';

// P4-F — enrollment atomicity proven through a GENUINE schema constraint (no
// test-only hook): a 31-byte credential hash fails account_credentials_hash_len
// on the third insert, so account + Self + credential roll back together.

let boot: pg.Pool;
let su: pg.Pool;
beforeAll(() => { boot = bootstrapPool(); su = superuserPool(); });
afterAll(async () => { await boot.end(); await su.end(); });

async function counts(ref: string): Promise<{ a: number; s: number; c: number }> {
  const { rows } = await su.query<{ a: number; s: number; c: number }>(
    `SELECT (SELECT count(*) FROM public.accounts WHERE id=$1)::int AS a,
            (SELECT count(*) FROM public.selves WHERE account_id=$1)::int AS s,
            (SELECT count(*) FROM auth.account_credentials WHERE account_id=$1)::int AS c`,
    [ref]);
  return rows[0]!;
}

describe('P4-F enrollment atomicity', () => {
  it('a 31-byte credential hash rolls account + Self + credential back together (23514)', async () => {
    const ref = randomUUID();
    await expectPgError(
      () => boot.query('SELECT * FROM auth.enroll_account($1, $2, $3)', [ref, 'valid-name', Buffer.alloc(31)]),
      '23514');
    expect(await counts(ref)).toEqual({ a: 0, s: 0, c: 0 });
  });

  it('an empty Self name rolls the whole enrollment back (23514, middle insert)', async () => {
    const ref = randomUUID();
    await expectPgError(
      () => boot.query('SELECT * FROM auth.enroll_account($1, $2, $3)', [ref, '   ', Buffer.alloc(32)]),
      '23514');
    expect(await counts(ref)).toEqual({ a: 0, s: 0, c: 0 });
  });
});
