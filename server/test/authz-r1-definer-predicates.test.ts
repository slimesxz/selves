import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, superuserPool } from './helpers/auth.ts';
import { newAccount, newSelf, newArtifact, withEstablishedContext } from './helpers/authz.ts';

// P8 R1 (0008 R1 / 0009) + P8 J (0008-C §3) — the Stage-1 fact reads are computed
// by owner-run SECURITY DEFINER functions, RLS-exempt by ownership (R1). P8 J
// removed the caller-supplied acting-Self argument: the functions derive the acting
// Self from the trusted C3 context and FAIL CLOSED without it (no existence,
// authorship, sender, state, recipient, or Key fact leaks). The full reason
// taxonomy remains proven, byte-unamended, by authz-artifact/placement/ordering.

let app: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  app = appTestPool();
  su = superuserPool();
});
afterAll(async () => {
  await Promise.all([app.end(), su.end()]);
});

describe('P8 J Stage-1 DEFINER predicate functions (C3-bound)', () => {
  it('are owner-owned SECURITY DEFINER with a hardened search_path and a single resource arg', async () => {
    const { rows } = await su.query<{ proname: string; secdef: boolean; owner: string; cfg: string[] | null; args: string }>(
      `SELECT p.proname, p.prosecdef AS secdef, p.proowner::regrole::text AS owner, p.proconfig AS cfg,
              pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'domain' AND p.proname IN ('artifact_facts', 'placement_facts')
        ORDER BY p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['artifact_facts', 'placement_facts']);
    for (const r of rows) {
      expect(r.secdef, `${r.proname} SECURITY DEFINER`).toBe(true);
      expect(r.owner, `${r.proname} owner`).toBe('selves_owner');
      expect((r.cfg ?? []).some((c) => c.startsWith('search_path=')), `${r.proname} search_path`).toBe(true);
      // P8 J: no acting-Self authority argument; only a resource id remains
      expect(/^p_(artifact|placement)_id uuid$/.test(r.args.trim()), `${r.proname} single resource arg`).toBe(true);
      expect(/self/i.test(r.args), `${r.proname} takes no acting-Self arg`).toBe(false);
    }
  });

  it('grant EXECUTE to selves_app but not to PUBLIC (single-arg signatures)', async () => {
    const has = async (grantee: string, fn: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', [grantee, fn, 'EXECUTE'])).rows[0]!.ok;
    for (const fn of ['domain.artifact_facts(uuid)', 'domain.placement_facts(uuid)']) {
      expect(await has('selves_app', fn), `selves_app EXECUTE ${fn}`).toBe(true);
      expect(await has('public', fn), `PUBLIC EXECUTE ${fn}`).toBe(false);
    }
  });

  it('FAIL CLOSED: with no established context, no fact is exposed (the oracle is closed)', async () => {
    const account = await newAccount(su);
    const author = await newSelf(su, account, 1, 'author');
    const R = await newArtifact(su, author, 'secret');
    const c = await app.connect();
    try {
      await c.query('BEGIN'); // deliberately NO set_acting_self
      const af = (await c.query<{ present: boolean; author_self_id: string | null }>(
        'SELECT * FROM domain.artifact_facts($1)', [R])).rows[0]!;
      expect(af.present, 'no existence leak without context').toBe(false);
      expect(af.author_self_id, 'no authorship leak without context').toBeNull();
      // and it cannot be aimed at another Self — there is no acting-Self argument
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('artifact_facts returns the exact fact shape under context (author present; absent → not present)', async () => {
    const account = await newAccount(su);
    const author = await newSelf(su, account, 1, 'author');
    const R = await newArtifact(su, author, 'body');

    const present = (await withEstablishedContext(app, author, (c) => c.query<{
      present: boolean; author_self_id: string | null; any_settled_recipient: boolean;
      any_recipient: boolean; has_active_for_target: boolean; has_revoked_for_target: boolean; has_active_elsewhere: boolean;
    }>('SELECT * FROM domain.artifact_facts($1)', [R]))).rows[0]!;
    expect(present.present).toBe(true);
    expect(present.author_self_id).toBe(author);
    expect(present.any_settled_recipient).toBe(false);
    expect(present.any_recipient).toBe(false);
    expect(present.has_active_for_target).toBe(false);

    const absent = (await withEstablishedContext(app, author, (c) => c.query<{ present: boolean; author_self_id: string | null }>(
      'SELECT * FROM domain.artifact_facts($1)', ['11111111-1111-1111-1111-111111111111']))).rows[0]!;
    expect(absent.present).toBe(false);
    expect(absent.author_self_id).toBeNull();
  });

  it('placement_facts returns the exact fact shape under context (present sender/state; absent → not present)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const recipient = await newSelf(su, account, 2, 'recipient');
    const R = await newArtifact(su, sender, 'body');
    const { rows: pr } = await su.query<{ id: string }>(
      'INSERT INTO public.placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id', [sender, R]);
    const pid = pr[0]!.id;
    await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [pid, recipient]);

    const asRecipient = (await withEstablishedContext(app, recipient, (c) => c.query<{ present: boolean; sender_self_id: string; state: string; recipient_row: boolean }>(
      'SELECT * FROM domain.placement_facts($1)', [pid]))).rows[0]!;
    expect(asRecipient.present).toBe(true);
    expect(asRecipient.sender_self_id).toBe(sender);
    expect(asRecipient.state).toBe('draft');
    expect(asRecipient.recipient_row).toBe(true);

    const asSender = (await withEstablishedContext(app, sender, (c) => c.query<{ recipient_row: boolean }>(
      'SELECT * FROM domain.placement_facts($1)', [pid]))).rows[0]!;
    expect(asSender.recipient_row).toBe(false); // sender is not a recipient row
  });
});
