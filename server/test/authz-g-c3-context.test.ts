import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, bootstrapPool, superuserPool, enroll, sha256, randomSecret } from './helpers/auth.ts';
import { expectPgError } from './helpers/db.ts';

// P8 G — C3 acting-Self context mechanism (decision 0009 §§2–3 / 0008 R4-B).
// Establishment is an owner-run SECURITY DEFINER setter gated on the auth.sessions
// fact; the acting Self is written to an owner-owned store selves_app cannot touch,
// bound to (backend_pid, xid8); policies read it through an owner-run STABLE helper.
// These proofs are at the database boundary (rows / SQLSTATE), as required.

let app: pg.Pool;
let su: pg.Pool;
let bootstrap: pg.Pool;

// Build a valid live session for a fresh account; return its token hash + ids.
async function freshSession(): Promise<{ accountId: string; selfId: string; tokenHash: Buffer }> {
  const secret = randomSecret();
  const e = await enroll(bootstrap, { secret });
  const tokenHash = sha256(randomSecret());
  await su.query('SELECT auth.issue_session($1, $2)', [sha256(secret), tokenHash]);
  return { accountId: e.accountId, selfId: e.selfId, tokenHash };
}

beforeAll(() => {
  app = appTestPool();
  su = superuserPool();
  bootstrap = bootstrapPool();
});
afterAll(async () => {
  await Promise.all([app.end(), su.end(), bootstrap.end()]);
});

describe('P8 G — happy path establishes context bound to (backend, xid)', () => {
  it('setter + helper in one transaction yields the exact acting Self', async () => {
    const s = await freshSession();
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]);
      const { rows } = await c.query<{ self: string | null }>('SELECT domain.current_acting_self() AS self');
      expect(rows[0]!.self).toBe(s.selfId);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});

describe('P8 G — write-once and cross-transaction replacement (0009 §3.1)', () => {
  it('a second set in the same (backend, xid) transaction RAISES, never silently succeeds', async () => {
    const s = await freshSession();
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]);
      // second establishment in the same transaction → PT409, not a no-op, not overwrite
      await expectPgError(() => c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]), 'PT409');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('re-pointing to a DIFFERENT Self in the same transaction RAISES and the original context stands', async () => {
    // two Selves in one account so both are legitimately selectable
    const secret = randomSecret();
    const e = await enroll(bootstrap, { secret, name: 'g-a1' });
    const other = (await su.query<{ id: string }>(
      'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, 2, $2) RETURNING id', [e.accountId, 'g-a2'])).rows[0]!.id;
    const tokenHash = sha256(randomSecret());
    await su.query('SELECT auth.issue_session($1, $2)', [sha256(secret), tokenHash]);

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, e.selfId]);
      await c.query('SAVEPOINT sp');
      // injected re-pointing to the sibling Self → refused
      await expectPgError(() => c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, other]), 'PT409');
      await c.query('ROLLBACK TO SAVEPOINT sp');
      // the original context is intact — re-pointing did not overwrite it
      const { rows } = await c.query<{ self: string }>('SELECT domain.current_acting_self() AS self');
      expect(rows[0]!.self).toBe(e.selfId);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('replacement is permitted across transactions (stored xid differs)', async () => {
    const secret = randomSecret();
    const e = await enroll(bootstrap, { secret, name: 'g-repl-1' });
    const other = (await su.query<{ id: string }>(
      'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, 2, $2) RETURNING id', [e.accountId, 'g-repl-2'])).rows[0]!.id;
    const tokenHash = sha256(randomSecret());
    await su.query('SELECT auth.issue_session($1, $2)', [sha256(secret), tokenHash]);

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, e.selfId]);
      expect((await c.query<{ self: string }>('SELECT domain.current_acting_self() AS self')).rows[0]!.self).toBe(e.selfId);
      await c.query('COMMIT');

      // a NEW transaction on the same backend replaces in place (different xid)
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, other]);
      expect((await c.query<{ self: string }>('SELECT domain.current_acting_self() AS self')).rows[0]!.self).toBe(other);
      await c.query('COMMIT');

      // still exactly one row for this backend — replaced in place, no history
      const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const n = (await su.query<{ n: number }>(
        'SELECT count(*)::int n FROM domain.acting_self_context WHERE backend_pid = $1', [pid])).rows[0]!.n;
      expect(n).toBe(1);
    } finally {
      c.release();
    }
  });
});

describe('P8 G — the store is inaccessible to selves_app', () => {
  it('selves_app has no direct SELECT/INSERT/UPDATE/DELETE on the context store (42501)', async () => {
    await expectPgError(() => app.query('SELECT * FROM domain.acting_self_context'), '42501');
    await expectPgError(() => app.query('SELECT acting_self FROM domain.acting_self_context'), '42501');
    await expectPgError(() => app.query("INSERT INTO domain.acting_self_context (backend_pid, txid, acting_self) VALUES (1, '1'::xid8, gen_random_uuid())"), '42501');
    await expectPgError(() => app.query("UPDATE domain.acting_self_context SET acting_self = gen_random_uuid()"), '42501');
    await expectPgError(() => app.query('DELETE FROM domain.acting_self_context'), '42501');
  });

  it('the store has no table-privilege grant to selves_app at all', async () => {
    for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const ok = (await su.query<{ ok: boolean }>(
        'SELECT has_table_privilege($1, $2, $3) AS ok', ['selves_app', 'domain.acting_self_context', p])).rows[0]!.ok;
      expect(ok, `selves_app ${p} on context store`).toBe(false);
    }
  });
});

describe('P8 G — fail-closed: absent, stale, no-xid, post-rollback all deny', () => {
  it('a transaction that never established context reads NULL (fail-closed)', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query<{ self: string | null }>('SELECT domain.current_acting_self() AS self');
      expect(rows[0]!.self).toBeNull();
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('a stale row from a prior transaction does not authenticate a later context-less transaction', async () => {
    const s = await freshSession();
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]);
      await c.query('COMMIT'); // leaves a committed row for this backend

      // a later transaction that does NOT establish context must read NULL, even
      // though a row for this backend exists (its xid no longer matches).
      await c.query('BEGIN');
      const { rows } = await c.query<{ self: string | null }>('SELECT domain.current_acting_self() AS self');
      expect(rows[0]!.self).toBeNull();
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('rollback leaves no context usable by a later transaction', async () => {
    const s = await freshSession();
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]);
      await c.query('ROLLBACK'); // the context row insert is rolled back

      await c.query('BEGIN');
      const { rows } = await c.query<{ self: string | null }>('SELECT domain.current_acting_self() AS self');
      expect(rows[0]!.self).toBeNull();
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
});

describe('P8 G — the setter validates session → account → Self with no credential oracle', () => {
  it('a fabricated session token fails opaquely (28000)', async () => {
    const s = await freshSession();
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await expectPgError(() => c.query('SELECT domain.set_acting_self($1, $2)', [sha256('not-a-real-token'), s.selfId]), '28000');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('a revoked session fails opaquely (28000)', async () => {
    const s = await freshSession();
    await su.query('SELECT auth.revoke_session($1)', [s.tokenHash]);
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await expectPgError(() => c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]), '28000');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('a valid session paired with a Self in ANOTHER account fails with the SAME opaque contract (no oracle)', async () => {
    const victim = await freshSession();      // account A, valid token
    const other = await freshSession();       // account B, its own Self
    const c = await app.connect();
    try {
      // (i) invalid credential
      await c.query('BEGIN');
      let invalidErr: { code?: string; message?: string } = {};
      try { await c.query('SELECT domain.set_acting_self($1, $2)', [sha256('bogus'), victim.selfId]); }
      catch (e) { invalidErr = e as { code?: string; message?: string }; }
      await c.query('ROLLBACK');

      // (ii) valid credential + Self belonging to a different account
      await c.query('BEGIN');
      let wrongSelfErr: { code?: string; message?: string } = {};
      try { await c.query('SELECT domain.set_acting_self($1, $2)', [victim.tokenHash, other.selfId]); }
      catch (e) { wrongSelfErr = e as { code?: string; message?: string }; }
      await c.query('ROLLBACK');

      // identical externally-observable failure contract — no credential oracle
      expect(invalidErr.code).toBe('28000');
      expect(wrongSelfErr.code).toBe('28000');
      expect(wrongSelfErr.message).toBe(invalidErr.message);
    } finally {
      c.release();
    }
  });
});

describe('P8 G — one operational row per backend, no history anywhere', () => {
  it('the store has exactly the three operational columns and no audit/history column', async () => {
    const { rows } = await su.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'domain' AND table_name = 'acting_self_context' ORDER BY ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(['backend_pid', 'txid', 'acting_self']);
    // no set_at / created_at / history column
    expect(rows.some((r) => /_at$|history|log|audit/i.test(r.column_name))).toBe(false);
  });

  it('has no trigger writing an establishment record elsewhere', async () => {
    const { rows } = await su.query<{ n: number }>(
      `SELECT count(*)::int n FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'domain' AND c.relname = 'acting_self_context' AND NOT t.tgisinternal`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('backend_pid is the primary key (one row per backend, replaced in place)', async () => {
    const { rows } = await su.query<{ col: string }>(
      `SELECT a.attname AS col
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'domain.acting_self_context'::regclass AND i.indisprimary`,
    );
    expect(rows.map((r) => r.col)).toEqual(['backend_pid']);
  });
});

describe('P8 G — physical tuning present and measured (0009 §3.3)', () => {
  it('the store carries an explicitly lowered fillfactor and aggressive autovacuum', async () => {
    const { rows } = await su.query<{ reloptions: string[] | null }>(
      "SELECT reloptions FROM pg_class WHERE oid = 'domain.acting_self_context'::regclass",
    );
    const opts = rows[0]!.reloptions ?? [];
    expect(opts).toContain('fillfactor=70');
    expect(opts.some((o) => o.startsWith('autovacuum_vacuum_scale_factor=')), 'autovacuum_vacuum_scale_factor set').toBe(true);
    expect(opts.some((o) => o.startsWith('autovacuum_vacuum_threshold=')), 'autovacuum_vacuum_threshold set').toBe(true);
  });

  it('repeated establishment on one backend produces HOT updates (measured)', async () => {
    const s = await freshSession();
    const c = await app.connect();
    try {
      const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const stat = async () => (await su.query<{ upd: number; hot: number }>(
        `SELECT n_tup_upd::int AS upd, n_tup_hot_upd::int AS hot
           FROM pg_stat_user_tables WHERE schemaname='domain' AND relname='acting_self_context'`,
      )).rows[0] ?? { upd: 0, hot: 0 };

      const before = await stat();
      // 200 autocommit establishments on the SAME backend → 1 insert + 199 in-place updates
      for (let i = 0; i < 200; i++) {
        await c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]);
      }
      // PG15+ throttles a backend's cumulative-stats flush (<1s pending); force it,
      // then poll the shared stats (each read is a round-trip; no fixed sleep).
      await c.query('SELECT pg_stat_force_next_flush()');
      let after = before;
      for (let i = 0; i < 40; i++) {
        await su.query('SELECT pg_stat_clear_snapshot()');
        after = await stat();
        if (after.upd - before.upd >= 150) break;
        await c.query('SELECT pg_stat_force_next_flush()');
      }

      const dUpd = after.upd - before.upd;
      const dHot = after.hot - before.hot;
      // sanity: our updates registered, and a strong majority were HOT (in-place)
      expect(dUpd, 'updates registered').toBeGreaterThanOrEqual(150);
      expect(dHot, 'HOT updates occurred').toBeGreaterThan(0);
      expect(dHot / Math.max(dUpd, 1), 'HOT ratio is high').toBeGreaterThan(0.5);
      // report the exact numbers for the checkpoint
      // eslint-disable-next-line no-console
      console.log(`[G measure] pid=${pid} Δupd=${dUpd} Δhot=${dHot} ratio=${(dHot / Math.max(dUpd, 1)).toFixed(3)}`);
    } finally {
      c.release();
    }
  });
});

describe('P8 G — the session credential never appears in statement text (0009 §3.4)', () => {
  it('pg_stat_activity shows only the parameterized setter call, not the token', async () => {
    const s = await freshSession();
    const tokenHex = s.tokenHash.toString('hex');
    const c = await app.connect();
    try {
      const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      // establish context, then leave the transaction open so the setter call is the
      // last (now idle-in-transaction) statement recorded for this backend.
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.selfId]);

      // observe from the superuser (the most-privileged possible observer)
      const { rows } = await su.query<{ query: string; state: string }>(
        'SELECT query, state FROM pg_stat_activity WHERE pid = $1', [pid],
      );
      const seen = rows[0]!.query;
      expect(seen, 'the setter call is what is recorded').toContain('domain.set_acting_self($1, $2)');
      expect(seen.includes(tokenHex), 'token hash hex must not appear in statement text').toBe(false);
      expect(seen.includes('\\x'), 'no bytea literal in statement text').toBe(false);

      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
