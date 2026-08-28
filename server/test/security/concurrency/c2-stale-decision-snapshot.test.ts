import '../../helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  actingCtx, makeAuthz, newAccount, newArtifact, newKeyGrant, newSelf, type AuthzHarness,
} from '../../helpers/authz.ts';
import { superuserPool } from '../../helpers/auth.ts';

// P11-C · C2 — deterministic adversarial evidence for the recovered
// REPEATABLE READ boundary (0013 §4.1).
//
// WHY helpers/race.ts IS NOT USED
//
// That harness proves BLOCKING races: it holds a placement row lock and waits
// for the racer to be observed waiting on it. The protected READ path takes no
// row lock and, under MVCC, a plain reader is never blocked by a concurrent
// writer — so a committed ground change would produce no lock wait at all and
// that mechanism would have nothing definite to observe. This experiment
// therefore constructs its own synchronization, and the mechanism is part of
// the proof.
//
// THE SYNCHRONIZATION, AND WHY IT PLACES THE SNAPSHOT EXACTLY
//
// A protected read is: BEGIN ISOLATION LEVEL REPEATABLE READ →
// `domain.set_acting_self(...)` → `domain.artifact_facts(...)` → decision →
// protected read → COMMIT.
//
//   * `set_acting_self` is the FIRST statement, so it is the statement that
//     acquires the transaction snapshot. It touches auth.sessions, public.selves
//     and domain.acting_self_context — it does NOT touch public.key_grants.
//   * `artifact_facts` is the SECOND statement, and it DOES read
//     public.key_grants (migration 1784930000002 / 1784930000008).
//
// So a session holding ACCESS EXCLUSIVE on public.key_grants blocks the read at
// `artifact_facts` — strictly AFTER its snapshot exists. ACCESS EXCLUSIVE is the
// correct instrument precisely because a row-level write lock would NOT block a
// reader; only a table-level conflict with the reader's ACCESS SHARE will.
// The wait is then a DEFINITE, observable condition in pg_stat_activity.
//
// There is no sleep, no arbitrary delay, no retry-until-it-happens loop, and no
// probabilistic success anywhere below. If the wait is never observed the
// harness RAISES rather than proceeding, so this test can fail but cannot pass
// by luck.
//
// GROUND. Key revocation — an already-ratified PROSPECTIVE authority transition
// (AGENTS.md §5, decision 0007), which makes the experiment unambiguous.

let h: AuthzHarness;
let su: pg.Pool;

beforeAll(() => {
  h = makeAuthz();
  su = superuserPool();
});
afterAll(async () => {
  await h.end();
  await su.end();
});

interface Scene { grantor: string; grantee: string; artifact: string }

async function scene(label: string): Promise<Scene> {
  const a = await newAccount(h.su);
  const grantor = await newSelf(h.su, a, 1, `${label}-grantor`);
  const b = await newAccount(h.su);
  const grantee = await newSelf(h.su, b, 1, `${label}-grantee`);
  const artifact = await newArtifact(h.su, grantor, `${label} protected body`);
  await newKeyGrant(h.su, { grantor, grantee, resource: artifact });
  return { grantor, grantee, artifact };
}

const revoke = (s: Scene, c: pg.PoolClient | pg.Pool): Promise<unknown> =>
  c.query(
    'UPDATE public.key_grants SET revoked_at = now() WHERE grantee_self_id = $1 AND protected_resource_id = $2 AND revoked_at IS NULL',
    [s.grantee, s.artifact],
  );

/** Wait until a backend is OBSERVED blocked on a Lock inside artifact_facts.
 *  A definite condition, polled; raises if it never becomes true. */
async function waitForPredicateLockWait(probe: pg.Pool): Promise<number> {
  for (let i = 0; i < 600; i++) {
    const { rows } = await probe.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE '%artifact_facts%'`,
    );
    if (rows.length > 0) return rows[0]!.pid;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    'the protected read was never observed blocked inside artifact_facts — ' +
      'the synchronization did not hold and no conclusion may be drawn',
  );
}

describe('C2 — ground change committed BEFORE the read transaction: the current ground governs', () => {
  it('a revocation committed before the request denies that request', async () => {
    const s = await scene('before');
    expect((await h.service.readArtifact(actingCtx(s.grantee), s.artifact)).ok).toBe(true);

    await revoke(s, su); // committed before the next request opens its transaction

    expect((await h.service.readArtifact(actingCtx(s.grantee), s.artifact)).ok).toBe(false);
  });
});

describe('C2 — ground change committed AFTER the in-flight read established its snapshot', () => {
  it('the in-flight request completes on its snapshot; the NEXT request observes the changed ground', async () => {
    const s = await scene('after');
    expect((await h.service.readArtifact(actingCtx(s.grantee), s.artifact)).ok).toBe(true);

    const holder = await su.connect();
    let observedPid: number | undefined;
    let inFlight: Promise<{ ok: boolean }>;
    try {
      // 1. Close public.key_grants to readers. The in-flight read's SECOND
      //    statement will block here; its FIRST statement (the snapshot) will not.
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE public.key_grants IN ACCESS EXCLUSIVE MODE');

      // 2. Start the protected read. Do NOT await it: it establishes its
      //    snapshot, then blocks inside artifact_facts.
      inFlight = h.service.readArtifact(actingCtx(s.grantee), s.artifact) as Promise<{ ok: boolean }>;

      // 3. Observe the block. Definite condition; raises if it never occurs.
      observedPid = await waitForPredicateLockWait(su);

      // 4. Commit the ground change while the read is provably mid-flight and
      //    provably past its snapshot.
      await revoke(s, holder);
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }

    expect(observedPid, 'the read was observed blocked past its snapshot').toBeTypeOf('number');

    // 5. The in-flight request completes according to the snapshot it
    //    established BEFORE the revocation committed.
    expect((await inFlight).ok, 'in-flight request completes on its own snapshot').toBe(true);

    // 6. The authoritative ground really did change.
    const active = await su.query<{ n: number }>(
      'SELECT count(*)::int n FROM public.key_grants WHERE grantee_self_id = $1 AND protected_resource_id = $2 AND revoked_at IS NULL',
      [s.grantee, s.artifact],
    );
    expect(active.rows[0]!.n, 'the grant is authoritatively revoked').toBe(0);

    // 7. THE OBLIGATION THAT MATTERS: the next request must observe it. The
    //    snapshot property is bounded to one in-flight request and is never
    //    standing authority.
    expect(
      (await h.service.readArtifact(actingCtx(s.grantee), s.artifact)).ok,
      'the NEXT request observes the revocation',
    ).toBe(false);
  });

  it('no snapshot survives its transaction: repeated later requests stay denied', async () => {
    const s = await scene('repeat');
    await revoke(s, su);
    for (let i = 0; i < 3; i++) {
      expect((await h.service.readArtifact(actingCtx(s.grantee), s.artifact)).ok).toBe(false);
    }
  });
});
