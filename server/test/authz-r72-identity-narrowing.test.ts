import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { addSelf, appTestPool, bootstrapPool, enroll, superuserPool } from './helpers/auth.ts';
import { listSelves, selfOwnedByAccount } from '../src/auth/queries.ts';
import { expectPgError } from './helpers/db.ts';

// P8 R7.2 (decision 0008 R7 / 0009) — identity-read narrowing.
//
// The account→Self linkage (the sibling map) is removed from selves_app's direct
// visibility: both account-scoped identity reads now flow through owner-run
// SECURITY DEFINER functions, and every selves column grant is revoked. These
// tests prove, at the database boundary, that:
//   * the app role can no longer read public.selves directly (42501);
//   * the DEFINER-mediated ownership check and switcher still work, account-scoped;
//   * an account never sees, nor is credited ownership of, another account's Self.

let app: pg.Pool;
let bootstrap: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  app = appTestPool();
  bootstrap = bootstrapPool();
  su = superuserPool();
});
afterAll(async () => {
  await Promise.all([app.end(), bootstrap.end(), su.end()]);
});

describe('P8 R7.2 identity-read narrowing', () => {
  it('selves_app cannot read public.selves directly (42501) — the sibling map is gone', async () => {
    await expectPgError(() => app.query('SELECT id, account_id, name, self_slot FROM public.selves'), '42501');
    await expectPgError(() => app.query('SELECT account_id FROM public.selves'), '42501');
    await expectPgError(() => app.query('SELECT * FROM public.selves'), '42501');
    // No join/subquery escape either — any selves column reference denies.
    await expectPgError(
      () => app.query('SELECT count(*) FROM public.selves WHERE account_id = gen_random_uuid()'),
      '42501',
    );
  });

  it('DEFINER-mediated switcher lists only the account own Selves, ordered by slot', async () => {
    const a = await enroll(bootstrap, { name: 'r72-a1' });        // slot 1
    const a3 = await addSelf(su, a.accountId, 3, 'r72-a3');       // slot 3
    const a2 = await addSelf(su, a.accountId, 2, 'r72-a2');       // slot 2
    const b = await enroll(bootstrap, { name: 'r72-b1' });        // different account

    const selves = await listSelves(app, a.accountId);
    expect(selves.map((s) => s.slot)).toEqual([1, 2, 3]);        // deterministic slot order
    expect(selves.map((s) => s.id)).toEqual([a.selfId, a2, a3]);
    expect(selves.map((s) => s.name)).toEqual(['r72-a1', 'r72-a2', 'r72-a3']);
    expect(selves.some((s) => s.id === b.selfId)).toBe(false);   // never a sibling account's Self
  });

  it('DEFINER-mediated ownership check is account-scoped and grants no cross-account authority', async () => {
    const a = await enroll(bootstrap, { name: 'r72-own-a' });
    const b = await enroll(bootstrap, { name: 'r72-own-b' });

    expect(await selfOwnedByAccount(app, a.selfId, a.accountId)).toBe(true);
    // another account's Self is never owned by this account (sibling isolation) …
    expect(await selfOwnedByAccount(app, b.selfId, a.accountId)).toBe(false);
    // … and this account's Self is not owned by the other account.
    expect(await selfOwnedByAccount(app, a.selfId, b.accountId)).toBe(false);
    // an absent Self is simply not owned (uniform false, no oracle).
    expect(await selfOwnedByAccount(app, '11111111-1111-1111-1111-111111111111', a.accountId)).toBe(false);
  });

  it('selves_app holds EXECUTE on the identity DEFINER functions; PUBLIC does not', async () => {
    const rows = async (fn: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', ['selves_app', fn, 'EXECUTE'])).rows[0]!.ok;
    const pub = async (fn: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', ['public', fn, 'EXECUTE'])).rows[0]!.ok;

    expect(await rows('domain.self_owned_by_account(uuid, uuid)')).toBe(true);
    expect(await rows('domain.list_account_selves(uuid)')).toBe(true);
    expect(await pub('domain.self_owned_by_account(uuid, uuid)')).toBe(false);
    expect(await pub('domain.list_account_selves(uuid)')).toBe(false);
  });

  it('the identity functions are owner-owned SECURITY DEFINER with a hardened search_path', async () => {
    const { rows } = await su.query<{ proname: string; secdef: boolean; owner: string; cfg: string[] | null }>(
      `SELECT p.proname, p.prosecdef AS secdef, p.proowner::regrole::text AS owner, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'domain' AND p.proname IN ('self_owned_by_account', 'list_account_selves')
        ORDER BY p.proname`,
    );
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.secdef, `${r.proname} SECURITY DEFINER`).toBe(true);
      expect(r.owner, `${r.proname} owner`).toBe('selves_owner');
      expect((r.cfg ?? []).some((c) => c.startsWith('search_path=')), `${r.proname} search_path`).toBe(true);
    }
  });
});
