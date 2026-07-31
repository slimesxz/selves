import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { appTestPool, superuserPool, sha256, randomSecret } from './helpers/auth.ts';
import { expectPgError } from './helpers/db.ts';

// P8 I — the complete 0008 §6 acceptance proof, plus the 4A runtime-concurrent
// same-(backend,xid) proof and the 3A real-path rejection proof, plus the
// application-side credential-propagation leak audit. All security-critical
// results are proven by database rows / SQLSTATE, never by HTTP.

let app: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  app = appTestPool();
  su = superuserPool();
});
afterAll(async () => {
  await Promise.all([app.end(), su.end()]);
});

interface Seeded { account: string; self: string; tokenHash: Buffer; art: string }
async function seed(name: string): Promise<Seeded> {
  const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
  const self = (await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, 1, $2) RETURNING id', [account, name])).rows[0]!.id;
  const tokenHash = sha256(randomSecret());
  await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [account, tokenHash]);
  const art = (await su.query<{ id: string }>(
    "INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'text', $2) RETURNING id", [self, `${name}-secret`])).rows[0]!.id;
  return { account, self, tokenHash, art };
}

// ── 6.1 write forgery ─────────────────────────────────────────────────────────
describe('P8 I §6.1 — write forgery: the contained role cannot write the trusted fact', () => {
  it('selves_app cannot INSERT/UPDATE/DELETE the context store (42501)', async () => {
    await expectPgError(() => app.query("INSERT INTO domain.acting_self_context(backend_pid,txid,acting_self) VALUES (1,'1'::xid8,gen_random_uuid())"), '42501');
    await expectPgError(() => app.query('UPDATE domain.acting_self_context SET acting_self = gen_random_uuid()'), '42501');
    await expectPgError(() => app.query('DELETE FROM domain.acting_self_context'), '42501');
    await expectPgError(() => app.query('SELECT * FROM domain.acting_self_context'), '42501');
  });
});

// ── 6.2 / 4A stale inheritance + runtime concurrency ──────────────────────────
describe('P8 I §6.2 / 4A — concurrent reads bind to their own (backend,xid); no exchange; reuse re-denies', () => {
  it('two concurrent reads for different Selves do not inherit or exchange context', async () => {
    const A = await seed('conc-A');
    const B = await seed('conc-B');
    // a deliberately small pool forces reuse/contention
    const pool = new pg.Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 2 });
    try {
      async function protectedRead(tokenHash: Buffer, self: string, ownArt: string, otherArt: string) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, self]);
          const setterPid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          const row = (await c.query<{ read_pid: number; ctx: string | null; own: number; other: number }>(
            `SELECT pg_backend_pid() AS read_pid,
                    domain.current_acting_self() AS ctx,
                    (SELECT count(*)::int FROM public.artifacts WHERE id=$1) AS own,
                    (SELECT count(*)::int FROM public.artifacts WHERE id=$2) AS other`,
            [ownArt, otherArt])).rows[0]!;
          await c.query('COMMIT');
          return { setterPid, ...row };
        } finally {
          c.release();
        }
      }
      const [ra, rb] = await Promise.all([
        protectedRead(A.tokenHash, A.self, A.art, B.art),
        protectedRead(B.tokenHash, B.self, B.art, A.art),
      ]);
      // setter PID == protected-read PID for each request (one pinned backend/tx)
      expect(ra.setterPid).toBe(ra.read_pid);
      expect(rb.setterPid).toBe(rb.read_pid);
      // each observes its own acting Self …
      expect(ra.ctx).toBe(A.self);
      expect(rb.ctx).toBe(B.self);
      // … sees its own artifact, and NOT the other's — no context exchange
      expect(ra.own).toBe(1); expect(ra.other).toBe(0);
      expect(rb.own).toBe(1); expect(rb.other).toBe(0);

      // backend reuse: a later context-less transaction on a reused backend denies
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const ctx = (await c.query<{ self: string | null }>('SELECT domain.current_acting_self() AS self')).rows[0]!.self;
        const seen = (await c.query<{ n: number }>('SELECT count(*)::int n FROM public.artifacts')).rows[0]!.n;
        expect(ctx, 'no inherited context on reused backend').toBeNull();
        expect(seen, 'no rows without establishing context').toBe(0);
        await c.query('COMMIT');
      } finally {
        c.release();
      }
    } finally {
      await pool.end();
    }
  });
});

// ── 6.3 / 3A induction of the trusted writer ──────────────────────────────────
describe('P8 I §6.3 / 3A — inducing the setter fails; the real path rejects as well as accepts', () => {
  async function tryEstablish(tokenHash: Buffer, self: string): Promise<{ code?: string; message?: string }> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      try { await c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, self]); return {}; }
      catch (e) { return e as { code?: string; message?: string }; }
      finally { await c.query('ROLLBACK'); }
    } finally { c.release(); }
  }

  it('acceptance: a harness-created valid session traverses session→account→Self', async () => {
    const s = await seed('accept');
    expect(await tryEstablish(s.tokenHash, s.self)).toEqual({}); // success, no error
  });

  it('rejection: fabricated / expired / revoked session all fail opaquely (28000), no context', async () => {
    const s = await seed('reject');

    // fabricated
    const fabricated = await tryEstablish(sha256(randomSecret()), s.self);

    // expired: a session whose lifetime elapsed (backdated created_at → expires_at in the past)
    const expiredTok = sha256(randomSecret());
    await su.query("INSERT INTO auth.sessions (account_id, token_hash, created_at) VALUES ($1,$2, now() - interval '604801 seconds')", [s.account, expiredTok]);
    const expired = await tryEstablish(expiredTok, s.self);

    // revoked
    const revokedTok = sha256(randomSecret());
    await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1,$2)', [s.account, revokedTok]);
    await su.query('SELECT auth.revoke_session($1)', [revokedTok]);
    const revoked = await tryEstablish(revokedTok, s.self);

    for (const [label, e] of [['fabricated', fabricated], ['expired', expired], ['revoked', revoked]] as const) {
      expect(e.code, `${label} → 28000`).toBe('28000');
    }
  });

  it('rejection: a valid session paired with a Self in another account fails with the SAME opaque contract', async () => {
    const victim = await seed('victimAcct'); // valid token for account X
    const other = await seed('otherAcct');   // Self in account Y
    const wrongSelf = await tryEstablish(victim.tokenHash, other.self);
    const fabricated = await tryEstablish(sha256(randomSecret()), victim.self);
    expect(wrongSelf.code).toBe('28000');
    expect(fabricated.code).toBe('28000');
    expect(wrongSelf.message, 'no credential oracle: identical failure contract').toBe(fabricated.message);
  });

  it('rejection: a second setter call in the same transaction is refused (PT409)', async () => {
    const s = await seed('writeonce');
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.self]);
      await expectPgError(() => c.query('SELECT domain.set_acting_self($1, $2)', [s.tokenHash, s.self]), 'PT409');
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });
});

// ── sibling isolation (0008 R4-B mandatory composition test) ──────────────────
describe('P8 I — sibling isolation: switching acting Self changes visibility, not authentication', () => {
  it('the same session over two sibling Selves yields different visibility; neither inherits the other', async () => {
    const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
    const a1 = (await su.query<{ id: string }>('INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1,1,$2) RETURNING id', [account, 'sib-1'])).rows[0]!.id;
    const a2 = (await su.query<{ id: string }>('INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1,2,$2) RETURNING id', [account, 'sib-2'])).rows[0]!.id;
    const tokenHash = sha256(randomSecret());
    await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1,$2)', [account, tokenHash]); // ONE session, ONE authentication
    const art1 = (await su.query<{ id: string }>("INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1,'text','a1-secret') RETURNING id", [a1])).rows[0]!.id;

    const visibleAs = async (self: string): Promise<number> => {
      const c = await app.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT domain.set_acting_self($1, $2)', [tokenHash, self]); // SAME token, different Self
        const n = (await c.query<{ n: number }>('SELECT count(*)::int n FROM public.artifacts WHERE id=$1', [art1])).rows[0]!.n;
        await c.query('ROLLBACK');
        return n;
      } finally { c.release(); }
    };

    expect(await visibleAs(a1), 'author self sees its artifact').toBe(1);
    expect(await visibleAs(a2), 'sibling self sees nothing — shared account confers no cross-Self read').toBe(0);
  });
});

// ── 6.4 final T2 containment ──────────────────────────────────────────────────
describe('P8 I §6.4 — final T2 containment (selves_app credential, no valid live session)', () => {
  it('an attacker with selves_app privileges but no session cannot read Self B rows, by any exposed path', async () => {
    const A = await seed('t2-A');
    const B = await seed('t2-B'); // the target; attacker knows B.self and B.art

    // legitimate context for A works (baseline)
    {
      const c = await app.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT domain.set_acting_self($1, $2)', [A.tokenHash, A.self]);
        expect((await c.query<{ n: number }>('SELECT count(*)::int n FROM public.artifacts WHERE id=$1', [A.art])).rows[0]!.n).toBe(1);
        await c.query('ROLLBACK');
      } finally { c.release(); }
    }

    // attacker: full selves_app privileges, WITHOUT a valid live session credential
    const atk = await app.connect();
    try {
      // (1) direct read of B's artifact with no context → zero rows
      await atk.query('BEGIN');
      expect((await atk.query('SELECT * FROM public.artifacts WHERE id=$1', [B.art])).rows.length).toBe(0);
      // (2) try to substitute B via a fabricated session → 28000, no context
      await expectPgError(() => atk.query('SELECT domain.set_acting_self($1, $2)', [sha256(randomSecret()), B.self]), '28000');
      await atk.query('ROLLBACK');
      // (3) try to write the context store directly → 42501
      await expectPgError(() => atk.query("INSERT INTO domain.acting_self_context(backend_pid,txid,acting_self) VALUES (pg_backend_pid(), pg_current_xact_id(), $1)", [B.self]), '42501');
      // (4) after every attempt, B's row authorized only to B remains unreadable
      await atk.query('BEGIN');
      expect((await atk.query('SELECT * FROM public.artifacts WHERE id=$1', [B.art])).rows.length, 'target row remains invisible').toBe(0);
      await atk.query('ROLLBACK');
    } finally {
      atk.release();
    }
  });
});

// ── credential-propagation leak audit (application side) ───────────────────────
describe('P8 I — credential-propagation leak audit', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const SRC = resolve(here, '../src');
  const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

  it('service.ts carries sessionToken ONLY as bind parameters (no interpolation)', () => {
    const src = read('authz/service.ts');
    // establishContext passes it as a bind parameter to the C3 setter (reads +
    // the nine acting-Self mutations) …
    expect(src).toContain("tx.query('SELECT domain.set_acting_self($1, $2)', [ctx.sessionToken, ctx.actingSelf])");
    // … and set_departure_interval passes it as a bind parameter to the account mutation.
    expect(src).toContain('mutations.setDepartureInterval(db, ctx.sessionToken, seconds)');
    // … and get_departure_interval (P10-S2) passes it identically to the account getter.
    expect(src).toContain('mutations.getDepartureInterval(db, ctx.sessionToken)');
    // All three value-uses of ctx.sessionToken are those bind-parameter passes — never interpolated.
    const valueUses = [...src.matchAll(/ctx\.sessionToken\b/g)].length;
    expect(valueUses, 'ctx.sessionToken used only at the three bind-parameter sites').toBe(3);
    expect(/\$\{[^}]*sessionToken[^}]*\}/.test(src), 'sessionToken never interpolated into a template').toBe(false);
  });

  it('no logger/error/serialization path in the read or mutation pipeline references the credential field', () => {
    for (const rel of ['authz/service.ts', 'db.ts', 'authz/domain.repo.ts', 'authz/mutations.repo.ts']) {
      const src = read(rel);
      expect(/log\.[a-z]+\([^)]*sessionToken/i.test(src), `${rel}: sessionToken never logged`).toBe(false);
      expect(/JSON\.stringify\([^)]*sessionToken/i.test(src), `${rel}: sessionToken never serialized`).toBe(false);
      expect(/\$\{[^}]*(sessionToken|Token)[^}]*\}/.test(src), `${rel}: no token interpolation`).toBe(false);
    }
  });

  it('a read result (domain record) exposes no credential field', async () => {
    const A = await seed('leak');
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [A.tokenHash, A.self]);
      const row = (await c.query('SELECT * FROM public.artifacts WHERE id=$1', [A.art])).rows[0]!;
      await c.query('ROLLBACK');
      expect(Object.keys(row as object).some((k) => /token|session|credential|secret/i.test(k))).toBe(false);
    } finally { c.release(); }
  });

  it('a setter failure error carries no token material', async () => {
    const A = await seed('leak2');
    const badTok = sha256(randomSecret());
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      let err: { message?: string } = {};
      try { await c.query('SELECT domain.set_acting_self($1, $2)', [badTok, A.self]); }
      catch (e) { err = e as { message?: string }; }
      await c.query('ROLLBACK');
      expect(err.message).toBe('context establishment failed');       // opaque
      expect(err.message!.includes(badTok.toString('hex'))).toBe(false); // no token hex
    } finally { c.release(); }
  });
});
