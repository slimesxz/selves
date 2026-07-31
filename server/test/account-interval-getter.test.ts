// P10-S2 — the account departure-interval getter (R4 item 4; 0012 §35 ruling 8;
// accepted S2 opening packet). Service/repository-level only: route wiring is
// P10-S3, so no HTTP status mapping is claimed or tested here. Failure
// semantics are the setter's established opaque PT404 at the DEFINER boundary.
import './helpers/env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { makeAuthz, accountCtx, newAccount, type AuthzHarness } from './helpers/authz.ts';

let h: AuthzHarness;
let acc: string;

beforeAll(async () => {
  h = makeAuthz();
  acc = await newAccount(h.su);
});

afterAll(async () => {
  await h.end();
});

describe('account-bound getter (no acting Self in the contract)', () => {
  it('a fresh account reads the default interval of 30', async () => {
    expect(await h.service.getDepartureInterval(accountCtx(acc))).toBe(30);
  });

  it('the setter changes the value to 60 and the getter returns 60', async () => {
    await h.service.setDepartureInterval(accountCtx(acc), 60);
    expect(await h.service.getDepartureInterval(accountCtx(acc))).toBe(60);
  });

  it('a fabricated session credential produces the established opaque PT404 failure', async () => {
    const fabricated = createHash('sha256').update(randomBytes(32)).digest();
    await expect(
      h.service.getDepartureInterval({ sessionToken: fabricated }),
    ).rejects.toMatchObject({ code: 'PT404' });
  });

  it('an absent credential produces the same opaque PT404 at the DEFINER boundary', async () => {
    // The legitimate absent-credential boundary is the DEFINER function itself
    // with a NULL bound parameter (the setter precedent in authz-l-mutation-c3):
    // auth.authenticate_session(NULL) resolves no account. No production type
    // is weakened to manufacture this state.
    const c = await h.appPool.connect();
    try {
      await expect(
        c.query('SELECT domain.get_departure_interval($1)', [null]),
      ).rejects.toMatchObject({ code: 'PT404' });
    } finally {
      c.release();
    }
  });

  it('selves_app still holds zero direct accounts privileges — the getter widened nothing', async () => {
    const { rows } = await h.su.query<{ t: boolean; c: boolean }>(
      `SELECT has_table_privilege('selves_app', 'public.accounts', 'SELECT') AS t,
              has_any_column_privilege('selves_app', 'public.accounts', 'SELECT') AS c`,
    );
    expect(rows[0]).toEqual({ t: false, c: false });
  });

  it('EXECUTE is granted to selves_app only: the worker is denied, so the PUBLIC grant is gone', async () => {
    const { rows } = await h.su.query<{ app: boolean; worker: boolean }>(
      `SELECT has_function_privilege('selves_app', 'domain.get_departure_interval(bytea)', 'EXECUTE') AS app,
              has_function_privilege('selves_worker', 'domain.get_departure_interval(bytea)', 'EXECUTE') AS worker`,
    );
    expect(rows[0]).toEqual({ app: true, worker: false });
  });
});
