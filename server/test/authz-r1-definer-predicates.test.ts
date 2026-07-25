import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, superuserPool } from './helpers/auth.ts';
import { newAccount, newSelf, newArtifact } from './helpers/authz.ts';

// P8 R1 (decision 0008 R1 / 0009) — the Stage-1 predicate fact reads are computed
// by owner-run SECURITY DEFINER functions (domain.artifact_facts /
// domain.placement_facts), RLS-exempt by ownership, so the decider never reads
// through the RLS mirror. These focused proofs lock the security posture of those
// functions and their fact-shape at the database boundary; the full reason
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

describe('P8 R1 Stage-1 DEFINER predicate functions', () => {
  it('are owner-owned SECURITY DEFINER with a hardened search_path', async () => {
    const { rows } = await su.query<{ proname: string; secdef: boolean; owner: string; cfg: string[] | null }>(
      `SELECT p.proname, p.prosecdef AS secdef, p.proowner::regrole::text AS owner, p.proconfig AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'domain' AND p.proname IN ('artifact_facts', 'placement_facts')
        ORDER BY p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['artifact_facts', 'placement_facts']);
    for (const r of rows) {
      expect(r.secdef, `${r.proname} SECURITY DEFINER`).toBe(true);
      expect(r.owner, `${r.proname} owner`).toBe('selves_owner');
      expect((r.cfg ?? []).some((c) => c.startsWith('search_path=')), `${r.proname} search_path`).toBe(true);
    }
  });

  it('grant EXECUTE to selves_app but not to PUBLIC', async () => {
    const has = async (grantee: string, fn: string) =>
      (await su.query<{ ok: boolean }>('SELECT has_function_privilege($1, $2, $3) AS ok', [grantee, fn, 'EXECUTE'])).rows[0]!.ok;
    for (const fn of ['domain.artifact_facts(uuid, uuid)', 'domain.placement_facts(uuid, uuid)']) {
      expect(await has('selves_app', fn), `selves_app EXECUTE ${fn}`).toBe(true);
      expect(await has('public', fn), `PUBLIC EXECUTE ${fn}`).toBe(false);
    }
  });

  it('artifact_facts returns the exact fact shape (author present; absent → not present)', async () => {
    const account = await newAccount(su);
    const author = await newSelf(su, account, 1, 'author');
    const R = await newArtifact(su, author, 'body');

    const present = (await app.query<{
      present: boolean; author_self_id: string | null; any_settled_recipient: boolean;
      any_recipient: boolean; has_active_for_target: boolean; has_revoked_for_target: boolean; has_active_elsewhere: boolean;
    }>('SELECT * FROM domain.artifact_facts($1, $2)', [author, R])).rows[0]!;
    expect(present.present).toBe(true);
    expect(present.author_self_id).toBe(author);
    expect(present.any_settled_recipient).toBe(false);
    expect(present.any_recipient).toBe(false);
    expect(present.has_active_for_target).toBe(false);

    const absent = (await app.query<{ present: boolean; author_self_id: string | null }>(
      'SELECT * FROM domain.artifact_facts($1, $2)', [author, '11111111-1111-1111-1111-111111111111'])).rows[0]!;
    expect(absent.present).toBe(false);
    expect(absent.author_self_id).toBeNull();
  });

  it('placement_facts returns the exact fact shape (present sender/state; absent → not present)', async () => {
    const account = await newAccount(su);
    const sender = await newSelf(su, account, 1, 'sender');
    const recipient = await newSelf(su, account, 2, 'recipient');
    const R = await newArtifact(su, sender, 'body');
    const { rows: pr } = await su.query<{ id: string }>(
      'INSERT INTO public.placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id', [sender, R]);
    const pid = pr[0]!.id;
    await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [pid, recipient]);

    const asRecipient = (await app.query<{ present: boolean; sender_self_id: string; state: string; recipient_row: boolean }>(
      'SELECT * FROM domain.placement_facts($1, $2)', [recipient, pid])).rows[0]!;
    expect(asRecipient.present).toBe(true);
    expect(asRecipient.sender_self_id).toBe(sender);
    expect(asRecipient.state).toBe('draft');
    expect(asRecipient.recipient_row).toBe(true);

    const asSender = (await app.query<{ recipient_row: boolean }>(
      'SELECT * FROM domain.placement_facts($1, $2)', [sender, pid])).rows[0]!;
    expect(asSender.recipient_row).toBe(false); // sender is not a recipient row
  });
});
