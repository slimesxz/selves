import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, superuserPool, sha256, randomSecret } from './helpers/auth.ts';

// P8 I — acting-Self-dependent SELECT policies + RLS on artifacts/placements/
// placement_recipients (decision 0008 §4.2 / 0009). Proven at the database
// boundary: policy catalog shape (F2 explicit PERMISSIVE union), single-ground
// visibility, fail-closed without context (F4), and co-recipient non-disclosure (F5).

let app: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  app = appTestPool();
  su = superuserPool();
});
afterAll(async () => {
  await Promise.all([app.end(), su.end()]);
});

// Seed an account + Self with a real live session; return ids + token hash.
async function seedSelf(slot = 1, name = 'i-self'): Promise<{ account: string; self: string; tokenHash: Buffer }> {
  const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
  const self = (await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, $2, $3) RETURNING id', [account, slot, name])).rows[0]!.id;
  const tokenHash = sha256(randomSecret());
  await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [account, tokenHash]);
  return { account, self, tokenHash };
}
async function addSelfWithSession(account: string, slot: number, name: string): Promise<string> {
  return (await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, $2, $3) RETURNING id', [account, slot, name])).rows[0]!.id;
}
async function artifact(author: string, body = 'x'): Promise<string> {
  return (await su.query<{ id: string }>(
    "INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'text', $2) RETURNING id", [author, body])).rows[0]!.id;
}
async function settledPlacementTo(sender: string, art: string, recipients: string[]): Promise<string> {
  const id = (await su.query<{ id: string }>(
    'INSERT INTO public.placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id', [sender, art])).rows[0]!.id;
  for (const r of recipients) await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [id, r]);
  await su.query("UPDATE public.placements SET state='settled', departing_at=now(), settled_at=now() WHERE id=$1", [id]);
  return id;
}

/** Run a read as selves_app with established acting-Self context (one tx). */
async function readAs<T = unknown>(tokenHash: Buffer, self: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, self]);
    const { rows } = await c.query<T extends Record<string, unknown> ? T : Record<string, unknown>>(sql, params);
    await c.query('ROLLBACK');
    return rows as T[];
  } finally {
    c.release();
  }
}

describe('P8 I — policy catalog shape (F2: explicit PERMISSIVE union)', () => {
  it('defines exactly the six ratified SELECT policies, all PERMISSIVE, for selves_app', async () => {
    const { rows } = await su.query<{ tablename: string; policyname: string; permissive: string; cmd: string; roles: string }>(
      `SELECT tablename, policyname, permissive, cmd, roles::text
         FROM pg_policies WHERE schemaname='public'
          AND tablename IN ('artifacts','placements','placement_recipients')
        ORDER BY tablename, policyname`,
    );
    expect(rows.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([
      'artifacts.artifacts_read_author',
      'artifacts.artifacts_read_key_valid',
      'artifacts.artifacts_read_settled_recipient',
      'placements.placements_read_author',
      'placements.placements_read_settled_recipient',
      'placement_recipients.precipients_read_author',
    ].sort());
    for (const r of rows) {
      expect(r.permissive, `${r.policyname} PERMISSIVE`).toBe('PERMISSIVE');
      expect(r.cmd, `${r.policyname} SELECT`).toBe('SELECT');
      expect(r.roles, `${r.policyname} role`).toBe('{selves_app}');
    }
  });

  it('the three tables have RLS enabled and unforced (R8)', async () => {
    for (const t of ['artifacts', 'placements', 'placement_recipients']) {
      const { rows } = await su.query<{ rls: boolean; force: boolean }>(
        'SELECT relrowsecurity rls, relforcerowsecurity force FROM pg_class WHERE oid=$1::regclass', [`public.${t}`]);
      expect(rows[0]!.rls, `${t} RLS`).toBe(true);
      expect(rows[0]!.force, `${t} not forced`).toBe(false);
    }
  });
});

describe('P8 I — single-ground visibility (each PERMISSIVE ground admits on its own)', () => {
  it('AUTHOR ground alone', async () => {
    const a = await seedSelf(1, 'author');
    const art = await artifact(a.self, 'authored');
    const rows = await readAs<{ id: string }>(a.tokenHash, a.self, 'SELECT id FROM public.artifacts WHERE id=$1', [art]);
    expect(rows.map((r) => r.id)).toEqual([art]);
  });

  it('SETTLED-RECIPIENT ground alone (not author, no key)', async () => {
    const author = await seedSelf(1, 'auth');
    const rcpt = await seedSelf(1, 'rcpt');
    const art = await artifact(author.self);
    await settledPlacementTo(author.self, art, [rcpt.self]);
    const rows = await readAs<{ id: string }>(rcpt.tokenHash, rcpt.self, 'SELECT id FROM public.artifacts WHERE id=$1', [art]);
    expect(rows.map((r) => r.id)).toEqual([art]); // visible via settled-recipient policy only
  });

  it('VALID-KEY ground alone (not author, no placement)', async () => {
    const author = await seedSelf(1, 'auth');
    const grantee = await seedSelf(1, 'grantee');
    const art = await artifact(author.self);
    await su.query('INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES ($1,$2,$3)', [author.self, grantee.self, art]);
    const rows = await readAs<{ id: string }>(grantee.tokenHash, grantee.self, 'SELECT id FROM public.artifacts WHERE id=$1', [art]);
    expect(rows.map((r) => r.id)).toEqual([art]); // visible via key policy only
  });

  it('a stranger with no ground sees nothing', async () => {
    const author = await seedSelf(1, 'auth');
    const stranger = await seedSelf(1, 'stranger');
    const art = await artifact(author.self);
    const rows = await readAs<{ id: string }>(stranger.tokenHash, stranger.self, 'SELECT id FROM public.artifacts WHERE id=$1', [art]);
    expect(rows).toEqual([]);
  });
});

describe('P8 I — F4 fail-closed: no context, no rows', () => {
  it('a direct selves_app read WITHOUT established context returns zero rows', async () => {
    const a = await seedSelf(1, 'author');
    const art = await artifact(a.self, 'secret');
    const c = await app.connect();
    try {
      await c.query('BEGIN'); // deliberately NO set_acting_self
      const arts = await c.query('SELECT * FROM public.artifacts WHERE id=$1', [art]);
      expect(arts.rows.length, 'artifacts invisible without context').toBe(0);
      const ctx = await c.query<{ self: string | null }>('SELECT domain.current_acting_self() AS self');
      expect(ctx.rows[0]!.self, 'no acting self without context').toBeNull();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

describe('P8 I — F5 co-recipient non-disclosure', () => {
  it('a recipient cannot read placement_recipients rows; only the author can', async () => {
    const author = await seedSelf(1, 'auth');
    const b = await seedSelf(1, 'rcptB');
    const c = await addSelfWithSession(author.account, 2, 'siblingC'); // another self, irrelevant recipient
    const art = await artifact(author.self);
    const pid = await settledPlacementTo(author.self, art, [b.self, c]);

    // the author sees the full recipient list of its own placement
    const authorSees = await readAs<{ recipient_self_id: string }>(
      author.tokenHash, author.self, 'SELECT recipient_self_id FROM public.placement_recipients WHERE placement_id=$1', [pid]);
    expect(authorSees.map((r) => r.recipient_self_id).sort()).toEqual([b.self, c].sort());

    // a recipient (non-author) sees NO recipient rows — not even its own (F5)
    const recipientSees = await readAs<{ recipient_self_id: string }>(
      b.tokenHash, b.self, 'SELECT recipient_self_id FROM public.placement_recipients WHERE placement_id=$1', [pid]);
    expect(recipientSees, 'co-recipient non-disclosure').toEqual([]);
  });
});
