import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { addSelf, appTestPool, bootstrapPool, enroll, superuserPool, sha256, randomSecret } from './helpers/auth.ts';
import { listSelves, selfOwnedByAccount } from '../src/auth/queries.ts';
import { expectPgError } from './helpers/db.ts';

// P8 R7.2 + P8 K / 8-B b1 (decisions 0008 R7 / 0009 / 0008-C §4) — identity-read
// narrowing, now session-bound. Direct selves_app readability of public.selves is
// zero (R7.2); the two account-scoped identity reads flow through owner-run
// SECURITY DEFINER functions whose account authority derives from the AUTHENTICATED
// SESSION (b1), not a caller-supplied account UUID. These tests prove, at the DB
// boundary, that: the app role cannot read public.selves directly (42501); the
// switcher/ownership check work for the session's own account; a fabricated session
// yields nothing; and no foreign account can be aimed (there is no account argument).

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

/** Issue a real live session for an enrolled account; return the token hash. */
async function sessionTokenFor(secret: string): Promise<Buffer> {
  const th = sha256(randomSecret());
  await su.query('SELECT auth.issue_session($1, $2)', [sha256(secret), th]);
  return th;
}

describe('P8 R7.2 / K — session-bound identity-read narrowing', () => {
  it('selves_app cannot read public.selves directly (42501) — the sibling map is gone', async () => {
    await expectPgError(() => app.query('SELECT id, account_id, name, self_slot FROM public.selves'), '42501');
    await expectPgError(() => app.query('SELECT account_id FROM public.selves'), '42501');
    await expectPgError(() => app.query('SELECT * FROM public.selves'), '42501');
    await expectPgError(
      () => app.query('SELECT count(*) FROM public.selves WHERE account_id = gen_random_uuid()'),
      '42501',
    );
  });

  it('the switcher lists only the session account own Selves, ordered by slot', async () => {
    const a = await enroll(bootstrap, { name: 'r72-a1' });        // slot 1
    const a3 = await addSelf(su, a.accountId, 3, 'r72-a3');       // slot 3
    const a2 = await addSelf(su, a.accountId, 2, 'r72-a2');       // slot 2
    const b = await enroll(bootstrap, { name: 'r72-b1' });        // different account
    const aTok = await sessionTokenFor(a.secret);

    const selves = await listSelves(app, aTok);
    expect(selves.map((s) => s.slot)).toEqual([1, 2, 3]);        // deterministic slot order
    expect(selves.map((s) => s.id)).toEqual([a.selfId, a2, a3]);
    expect(selves.map((s) => s.name)).toEqual(['r72-a1', 'r72-a2', 'r72-a3']);
    expect(selves.some((s) => s.id === b.selfId)).toBe(false);   // never a sibling account's Self
  });

  it('the ownership check is session-account-scoped and grants no cross-account authority', async () => {
    const a = await enroll(bootstrap, { name: 'r72-own-a' });
    const b = await enroll(bootstrap, { name: 'r72-own-b' });
    const aTok = await sessionTokenFor(a.secret);
    const bTok = await sessionTokenFor(b.secret);

    expect(await selfOwnedByAccount(app, a.selfId, aTok)).toBe(true);
    // another account's Self is never owned by this session's account …
    expect(await selfOwnedByAccount(app, b.selfId, aTok)).toBe(false);
    // … and this account's Self is not owned by the other session.
    expect(await selfOwnedByAccount(app, a.selfId, bTok)).toBe(false);
    // an absent Self is simply not owned (uniform false, no oracle).
    expect(await selfOwnedByAccount(app, '11111111-1111-1111-1111-111111111111', aTok)).toBe(false);
  });

  it('b1: a fabricated session yields nothing (non-oracular); no account can be aimed', async () => {
    const a = await enroll(bootstrap, { name: 'r72-fab' });
    const fabricated = sha256(randomSecret()); // no session was issued for this
    expect(await selfOwnedByAccount(app, a.selfId, fabricated)).toBe(false);
    expect(await listSelves(app, fabricated)).toEqual([]);
    // there is no account parameter to supply — foreign enumeration is impossible by construction.
  });

  it('selves_app holds EXECUTE on the session-bound identity functions; PUBLIC does not', async () => {
    const rows = async (fn: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', ['selves_app', fn, 'EXECUTE'])).rows[0]!.ok;
    const pub = async (fn: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', ['public', fn, 'EXECUTE'])).rows[0]!.ok;

    expect(await rows('domain.self_owned_by_account(bytea, uuid)')).toBe(true);
    expect(await rows('domain.list_account_selves(bytea)')).toBe(true);
    expect(await pub('domain.self_owned_by_account(bytea, uuid)')).toBe(false);
    expect(await pub('domain.list_account_selves(bytea)')).toBe(false);
    // the old account-parameter signatures no longer exist
    expect(await su.query("SELECT to_regprocedure('domain.list_account_selves(uuid)') IS NULL AS gone")
      .then((r) => r.rows[0]!.gone)).toBe(true);
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
