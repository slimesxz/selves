import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, bootstrapPool, superuserPool, enroll, addSelf, sha256, randomSecret } from './helpers/auth.ts';
import { newArtifact, newPlacement, newKeyGrant } from './helpers/authz.ts';
import { expectPgError } from './helpers/db.ts';

// P8 H — R3 cross-table policy helpers (decision 0008 R3 / 0009 §1). Owner-run
// SECURITY DEFINER STABLE boolean helpers: no policy predicate references a second
// table inline; each helper obtains the acting Self from the trusted context
// internally and reads the referenced table as owner (RLS/privilege-exempt), which
// is why the step-I policies hold under R5's revocation (F1).

const HELPERS = [
  'domain.artifact_has_settled_recipient(uuid)',
  'domain.artifact_has_active_key(uuid)',
  'domain.placement_has_recipient(uuid)',
  'domain.placement_authored_by_acting(uuid)',
];

let app: pg.Pool;
let su: pg.Pool;
let bootstrap: pg.Pool;

// Fixture identities/resources (built once).
let authorSelf: string, granteeSelf: string, strangerSelf: string;
let tokenA: Buffer, tokenB: Buffer;
let R: string, R2: string, settledP: string, draftP: string, Rdraft: string;

beforeAll(async () => {
  app = appTestPool();
  su = superuserPool();
  bootstrap = bootstrapPool();

  const secretA = randomSecret();
  const eA = await enroll(bootstrap, { secret: secretA, name: 'h-author' });
  authorSelf = eA.selfId;
  granteeSelf = await addSelf(su, eA.accountId, 2, 'h-grantee');
  tokenA = sha256(randomSecret());
  await su.query('SELECT auth.issue_session($1, $2)', [sha256(secretA), tokenA]);

  const secretB = randomSecret();
  const eB = await enroll(bootstrap, { secret: secretB, name: 'h-stranger' });
  strangerSelf = eB.selfId;
  tokenB = sha256(randomSecret());
  await su.query('SELECT auth.issue_session($1, $2)', [sha256(secretB), tokenB]);

  R = await newArtifact(su, authorSelf, 'secret');
  settledP = await newPlacement(su, { sender: authorSelf, artifact: R, state: 'settled', recipients: [granteeSelf] });
  await newKeyGrant(su, { grantor: authorSelf, grantee: granteeSelf, resource: R });

  R2 = await newArtifact(su, authorSelf, 'other');            // no key, no placement
  Rdraft = await newArtifact(su, authorSelf, 'draft-art');
  draftP = await newPlacement(su, { sender: authorSelf, artifact: Rdraft, state: 'draft', recipients: [granteeSelf] });
});
afterAll(async () => {
  await Promise.all([app.end(), su.end(), bootstrap.end()]);
});

/** Establish acting-Self context on a dedicated app connection and evaluate a
 *  helper within that same transaction (the only context in which it resolves). */
async function evalAs(token: Buffer, self: string, sql: string, params: unknown[] = []): Promise<boolean> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT domain.set_acting_self($1, $2)', [token, self]);
    const { rows } = await c.query<{ ok: boolean }>(sql, params);
    await c.query('ROLLBACK');
    return rows[0]!.ok;
  } finally {
    c.release();
  }
}

describe('P8 H — helper attributes (R3 constraints 1–4)', () => {
  it('all four are owner-owned SECURITY DEFINER STABLE, hardened search_path, boolean, single non-Self arg', async () => {
    const { rows } = await su.query<{
      proname: string; secdef: boolean; volatile: string; owner: string; ret: string; nargs: number; argtypes: string; cfg: string[] | null;
    }>(
      `SELECT p.proname, p.prosecdef AS secdef, p.provolatile AS volatile,
              p.proowner::regrole::text AS owner, pg_catalog.format_type(p.prorettype, NULL) AS ret,
              p.pronargs AS nargs, pg_catalog.pg_get_function_identity_arguments(p.oid) AS argtypes, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'domain'
          AND p.proname IN ('artifact_has_settled_recipient','artifact_has_active_key','placement_has_recipient','placement_authored_by_acting')
        ORDER BY p.proname`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.secdef, `${r.proname} SECURITY DEFINER`).toBe(true);
      expect(r.volatile, `${r.proname} STABLE`).toBe('s');
      expect(r.owner, `${r.proname} owner`).toBe('selves_owner');
      expect(r.ret, `${r.proname} returns boolean`).toBe('boolean');
      expect(r.nargs, `${r.proname} single arg`).toBe(1);
      // R3 constraint 1: the single argument is a RESOURCE id (uuid), never a Self —
      // the acting Self is obtained internally from the trusted context.
      expect(r.argtypes.trim(), `${r.proname} arg is a resource uuid, not a Self`).toMatch(/^p_(artifact|placement) uuid$/);
      expect(/self/i.test(r.argtypes), `${r.proname} arg is not a Self parameter`).toBe(false);
      expect((r.cfg ?? []).some((c) => c.startsWith('search_path=')), `${r.proname} search_path`).toBe(true);
    }
  });

  it('grant EXECUTE to selves_app but not to PUBLIC', async () => {
    const has = async (grantee: string, fn: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', [grantee, fn, 'EXECUTE'])).rows[0]!.ok;
    for (const fn of HELPERS) {
      expect(await has('selves_app', fn), `selves_app EXECUTE ${fn}`).toBe(true);
      expect(await has('public', fn), `PUBLIC EXECUTE ${fn}`).toBe(false);
    }
  });
});

describe('P8 H — exact boolean behavior (context-scoped)', () => {
  it('artifact_has_active_key: true for grantee+resource; false for wrong resource / non-grantee', async () => {
    expect(await evalAs(tokenA, granteeSelf, 'SELECT domain.artifact_has_active_key($1) AS ok', [R])).toBe(true);
    expect(await evalAs(tokenA, granteeSelf, 'SELECT domain.artifact_has_active_key($1) AS ok', [R2])).toBe(false); // no key to R2
    expect(await evalAs(tokenA, authorSelf, 'SELECT domain.artifact_has_active_key($1) AS ok', [R])).toBe(false);  // author holds no key
    expect(await evalAs(tokenB, strangerSelf, 'SELECT domain.artifact_has_active_key($1) AS ok', [R])).toBe(false);
  });

  it('artifact_has_active_key: revocation removes it (prospective)', async () => {
    const secret = randomSecret();
    const e = await enroll(bootstrap, { secret, name: 'h-rev-grantor' });
    const grantee = await addSelf(su, e.accountId, 2, 'h-rev-grantee');
    const tok = sha256(randomSecret());
    await su.query('SELECT auth.issue_session($1, $2)', [sha256(secret), tok]);
    const art = await newArtifact(su, e.selfId, 'rev');
    await newKeyGrant(su, { grantor: e.selfId, grantee, resource: art });

    expect(await evalAs(tok, grantee, 'SELECT domain.artifact_has_active_key($1) AS ok', [art])).toBe(true);
    await su.query('UPDATE public.key_grants SET revoked_at = now() WHERE grantee_self_id = $1 AND protected_resource_id = $2', [grantee, art]);
    expect(await evalAs(tok, grantee, 'SELECT domain.artifact_has_active_key($1) AS ok', [art])).toBe(false);
  });

  it('artifact_has_settled_recipient: true for recipient of a SETTLED placement; false for draft / sender / stranger', async () => {
    expect(await evalAs(tokenA, granteeSelf, 'SELECT domain.artifact_has_settled_recipient($1) AS ok', [R])).toBe(true);
    expect(await evalAs(tokenA, granteeSelf, 'SELECT domain.artifact_has_settled_recipient($1) AS ok', [Rdraft])).toBe(false); // draft, not settled
    expect(await evalAs(tokenA, authorSelf, 'SELECT domain.artifact_has_settled_recipient($1) AS ok', [R])).toBe(false);  // sender is not a recipient
    expect(await evalAs(tokenB, strangerSelf, 'SELECT domain.artifact_has_settled_recipient($1) AS ok', [R])).toBe(false);
  });

  it('placement_has_recipient: true for the recipient; false for sender / stranger', async () => {
    expect(await evalAs(tokenA, granteeSelf, 'SELECT domain.placement_has_recipient($1) AS ok', [settledP])).toBe(true);
    expect(await evalAs(tokenA, authorSelf, 'SELECT domain.placement_has_recipient($1) AS ok', [settledP])).toBe(false);
    expect(await evalAs(tokenB, strangerSelf, 'SELECT domain.placement_has_recipient($1) AS ok', [settledP])).toBe(false);
  });

  it('placement_authored_by_acting: true for the author; false for recipient / stranger', async () => {
    expect(await evalAs(tokenA, authorSelf, 'SELECT domain.placement_authored_by_acting($1) AS ok', [settledP])).toBe(true);
    expect(await evalAs(tokenA, granteeSelf, 'SELECT domain.placement_authored_by_acting($1) AS ok', [settledP])).toBe(false);
    expect(await evalAs(tokenB, strangerSelf, 'SELECT domain.placement_authored_by_acting($1) AS ok', [settledP])).toBe(false);
  });

  it('every helper denies (false) when no acting-Self context is established (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN'); // no set_acting_self
      for (const [fn, arg] of [
        ['domain.artifact_has_settled_recipient', R], ['domain.artifact_has_active_key', R],
        ['domain.placement_has_recipient', settledP], ['domain.placement_authored_by_acting', settledP],
      ] as const) {
        const { rows } = await c.query<{ ok: boolean }>(`SELECT ${fn}($1) AS ok`, [arg]);
        expect(rows[0]!.ok, `${fn} denies without context`).toBe(false);
      }
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

describe('P8 H — invoking-role / RLS independence (the F1 resolution)', () => {
  it('artifact_has_active_key returns true though selves_app cannot read key_grants at all', async () => {
    // selves_app has zero access to the capability register (R5) …
    await expectPgError(() => app.query('SELECT * FROM public.key_grants'), '42501');
    await expectPgError(() => app.query('SELECT grantee_self_id FROM public.key_grants'), '42501');
    // … yet the owner-run helper resolves the capability correctly for the grantee.
    expect(await evalAs(tokenA, granteeSelf, 'SELECT domain.artifact_has_active_key($1) AS ok', [R])).toBe(true);
  });
});
