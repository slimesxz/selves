import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { appTestPool, superuserPool, sha256, randomSecret } from './helpers/auth.ts';
import { expectPgError } from './helpers/db.ts';
import { makeAuthz, actingCtx, accountCtx, newAccount, newSelf, newArtifact } from './helpers/authz.ts';
import type { AuthorizationService } from '../src/authz/service.ts';

// P8 L (Scope B / 0008-C §5) — mutation authority is bound to the C3 acting Self
// established in the SAME transaction; no mutation trusts a caller-supplied acting
// identity. Proven at the database boundary: a T2 adversary (selves_app credential,
// NO valid live session) cannot exercise any mutation authority as another Self;
// the acting identity/read PID coincide on one backend/transaction; concurrent
// mutations do not exchange context; and each mutation still succeeds for its
// legitimate authenticated acting Self.

let app: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  app = appTestPool();
  su = superuserPool();
});
afterAll(async () => {
  await Promise.all([app.end(), su.end()]);
});

interface Victim { account: string; self: string; token: Buffer; artifact: string; departing: string }
async function seedVictim(): Promise<Victim> {
  const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
  const self = (await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, 1, $2) RETURNING id', [account, 'victim'])).rows[0]!.id;
  const rcpt = (await su.query<{ id: string }>(
    'INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1, 2, $2) RETURNING id', [account, 'v-rcpt'])).rows[0]!.id;
  const token = sha256(randomSecret());
  await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [account, token]);
  const artifact = (await su.query<{ id: string }>(
    "INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'text', 'v') RETURNING id", [self])).rows[0]!.id;
  const departing = (await su.query<{ id: string }>(
    'INSERT INTO public.placements (sender_self_id, artifact_id) VALUES ($1, $2) RETURNING id', [self, artifact])).rows[0]!.id;
  await su.query('INSERT INTO public.placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [departing, rcpt]);
  await su.query("UPDATE public.placements SET state='departing', created_at=now()-interval '2 min', departing_at=now()-interval '90 sec', departure_interval_seconds=5 WHERE id=$1", [departing]);
  return { account, self, token, artifact, departing };
}

async function stateOf(id: string): Promise<string> {
  return (await su.query<{ state: string }>('SELECT state FROM public.placements WHERE id=$1', [id])).rows[0]!.state;
}

describe('P8 L §7 — mutation T2 adversary (selves_app, NO valid live session) cannot act as another Self', () => {
  it('every mutation fails without established context, and the victim state is unchanged', async () => {
    const v = await seedVictim();
    // No context anywhere: the adversary has no valid live session. Each call is
    // autocommit (independent), so current_acting_self() is NULL → PT404 in each,
    // and a raise cannot poison a shared transaction.
    await expectPgError(() => app.query("SELECT domain.create_artifact('forged-by-adversary')"), 'PT404');
    await expectPgError(() => app.query('SELECT domain.create_placement_draft($1)', [v.artifact]), 'PT404');
    await expectPgError(() => app.query('SELECT domain.add_recipient($1, $2)', [v.departing, v.self]), 'PT404');
    await expectPgError(() => app.query('SELECT domain.remove_recipient($1, $2)', [v.departing, v.self]), 'PT404');
    await expectPgError(() => app.query('SELECT domain.begin_departure($1)', [v.departing]), 'PT404');
    await expectPgError(() => app.query('SELECT domain.cancel_placement($1)', [v.departing]), 'PT404');
    await expectPgError(() => app.query('SELECT domain.settle_placement($1)', [v.departing]), 'PT404');
    await expectPgError(() => app.query('SELECT domain.create_key_placement_draft($1)', [v.artifact]), 'PT404');
    await expectPgError(() => app.query('SELECT domain.revoke_key($1, $2)', [v.self, v.artifact]), 'PT404');
    // set_departure_interval with a fabricated session → PT404 (no account resolved)
    await expectPgError(() => app.query('SELECT domain.set_departure_interval($1, $2)', [sha256(randomSecret()), 60]), 'PT404');
    // nothing was forged/settled/cancelled: no adversary artifact; the departing
    // placement never settled; the interval is still the default.
    const arts = (await su.query<{ n: number }>('SELECT count(*)::int n FROM public.artifacts WHERE author_self_id=$1 AND text_body=$2', [v.self, 'forged-by-adversary'])).rows[0]!.n;
    expect(arts, 'no forged artifact authored as the victim').toBe(0);
    expect(await stateOf(v.departing), 'the victim placement was not settled/cancelled').toBe('departing');
    expect((await su.query<{ d: number }>('SELECT departure_interval_seconds d FROM public.accounts WHERE id=$1', [v.account])).rows[0]!.d).toBe(30);
  });

  it('the mutation DEFINER functions take no acting-Self authority argument', async () => {
    const { rows } = await su.query<{ proname: string; args: string }>(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='domain' AND p.proname IN
          ('create_artifact','create_placement_draft','add_recipient','remove_recipient',
           'begin_departure','cancel_placement','settle_placement','create_key_placement_draft',
           'revoke_key','set_departure_interval')
        ORDER BY p.proname`,
    );
    for (const r of rows) {
      // The forbidden anchors are authority selectors (p_acting_self / p_account);
      // resource/target ids like p_recipient_self and p_grantee remain permitted.
      expect(/\bp_acting_self\b|\bp_account\b/i.test(r.args), `${r.proname} has no acting-Self/account authority arg`).toBe(false);
      if (r.proname === 'set_departure_interval') {
        expect(r.args, 'set_departure_interval is session-bound, not account-parameter').toBe('p_session_token bytea, p_seconds integer');
      }
    }
  });

  it('an adversary holding a session for account X can only author as X — never as the victim', async () => {
    const v = await seedVictim();
    // attacker's own account/self + session
    const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
    const attacker = (await su.query<{ id: string }>('INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1,1,$2) RETURNING id', [account, 'attacker'])).rows[0]!.id;
    const atkTok = sha256(randomSecret());
    await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1,$2)', [account, atkTok]);

    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT domain.set_acting_self($1, $2)', [atkTok, attacker]); // the attacker's OWN self
      const id = (await c.query<{ id: string }>("SELECT domain.create_artifact('mine') AS id")).rows[0]!.id;
      // read within the same transaction (RLS admits it: attacker is the author)
      const author = (await c.query<{ a: string }>('SELECT author_self_id a FROM public.artifacts WHERE id=$1', [id])).rows[0]!.a;
      expect(author, 'authored as the attacker, never the victim').toBe(attacker);
      expect(author).not.toBe(v.self);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

describe('P8 L §6 — mutation context binds to one backend/transaction; concurrency does not exchange it', () => {
  it('concurrent mutations for different Selves each author as their own Self; a reused backend without context cannot mutate', async () => {
    // two accounts/selves each with a session
    const mk = async (name: string) => {
      const account = (await su.query<{ id: string }>('INSERT INTO public.accounts DEFAULT VALUES RETURNING id')).rows[0]!.id;
      const self = (await su.query<{ id: string }>('INSERT INTO public.selves (account_id, self_slot, name) VALUES ($1,1,$2) RETURNING id', [account, name])).rows[0]!.id;
      const token = sha256(randomSecret());
      await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1,$2)', [account, token]);
      return { self, token };
    };
    const A = await mk('conc-A');
    const B = await mk('conc-B');
    const pool = new pg.Pool({ connectionString: process.env.TEST_APP_DATABASE_URL, max: 2 });
    try {
      const mutateAs = async (self: string, token: Buffer, body: string) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query('SELECT domain.set_acting_self($1, $2)', [token, self]);
          const setterPid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          const id = (await c.query<{ id: string }>("SELECT domain.create_artifact($1) AS id", [body])).rows[0]!.id;
          const mutPid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
          await c.query('COMMIT');
          const author = (await su.query<{ a: string }>('SELECT author_self_id a FROM public.artifacts WHERE id=$1', [id])).rows[0]!.a;
          return { setterPid, mutPid, author };
        } finally {
          c.release();
        }
      };
      const [ra, rb] = await Promise.all([
        mutateAs(A.self, A.token, 'A-body'),
        mutateAs(B.self, B.token, 'B-body'),
      ]);
      expect(ra.setterPid).toBe(ra.mutPid);        // setter and mutation on one backend/tx
      expect(rb.setterPid).toBe(rb.mutPid);
      expect(ra.author).toBe(A.self);              // each authored as its own Self …
      expect(rb.author).toBe(B.self);              // … no context exchange under contention

      // backend reuse without context cannot mutate
      const c = await pool.connect();
      try {
        await c.query('BEGIN'); // no set_acting_self
        await expectPgError(() => c.query("SELECT domain.create_artifact('no-context')"), 'PT404');
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
    } finally {
      await pool.end();
    }
  });
});

describe('P8 L — positive: each mutation succeeds for its legitimate authenticated acting Self', () => {
  let h: ReturnType<typeof makeAuthz>;
  let su2: pg.Pool;
  let service: AuthorizationService;
  beforeAll(() => { h = makeAuthz(); su2 = h.su; service = h.service; });
  afterAll(() => h.end());

  async function elapseFloor(id: string): Promise<void> {
    await su2.query("UPDATE public.placements SET created_at=now()-interval '2 min', departing_at=now()-interval '90 sec' WHERE id=$1", [id]);
  }

  it('the full text + Key lifecycle runs end-to-end through C3-bound mutations', async () => {
    const account = await newAccount(su2);
    const author = await newSelf(su2, account, 1, 'author');
    const grantee = await newSelf(su2, account, 2, 'grantee');

    await service.setDepartureInterval(accountCtx(account), 5);
    const art = await service.createArtifact(actingCtx(author), 'hello');
    const plc = await service.createPlacementDraft(actingCtx(author), art);
    await service.addRecipient(actingCtx(author), plc, grantee);
    await service.beginDeparture(actingCtx(author), plc);
    await elapseFloor(plc);
    await service.settlePlacement(actingCtx(author), plc);
    expect((await service.readArtifact(actingCtx(grantee), art)).ok).toBe(true); // settled-recipient can read

    // Key lifecycle
    const secret = await newArtifact(su2, author, 'secret');
    const kp = await service.createKeyPlacementDraft(actingCtx(author), secret);
    await service.addRecipient(actingCtx(author), kp, grantee);
    await service.beginDeparture(actingCtx(author), kp);
    await elapseFloor(kp);
    await service.settlePlacement(actingCtx(author), kp);
    expect((await service.readArtifact(actingCtx(grantee), secret)).ok).toBe(true); // KEY_VALID
    await service.revokeKey(actingCtx(author), grantee, secret);
    expect((await service.readArtifact(actingCtx(grantee), secret)).ok).toBe(false); // revoked
  });
});
