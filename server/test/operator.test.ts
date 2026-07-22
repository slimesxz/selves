import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Queryable } from '../src/db.ts';
import { containAccount, enrollAccount, recoverEnrollment, rotateCredential, sha256 } from '../src/operator/commands.ts';
import { appTestPool, bootstrapPool, operatorPool, superuserPool } from './helpers/auth.ts';

let bootstrap: pg.Pool;
let operator: pg.Pool;
let appPool: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  bootstrap = bootstrapPool();
  operator = operatorPool();
  appPool = appTestPool();
  su = superuserPool();
});
afterAll(async () => {
  await bootstrap.end();
  await operator.end();
  await appPool.end();
  await su.end();
});

// A Queryable that always fails without a SQLSTATE — models a connection/ack
// failure (ambiguous outcome), deterministically and with no real socket.
const connLost: Queryable = {
  async query() { throw Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' }); },
};

describe('P4-E operator commands', () => {
  describe('enrollment outcome trichotomy', () => {
    it('acknowledged commit: creates account+self+credential and yields the secret', async () => {
      const ref = randomUUID();
      const r = await enrollAccount(bootstrap, { accountRef: ref, name: 'op-enroll' });
      expect(r.status).toBe('committed');
      if (r.status !== 'committed') return;
      expect(r.accountId).toBe(ref);
      expect(r.secret.length).toBeGreaterThan(0);
      const { rows } = await su.query(
        `SELECT (SELECT count(*) FROM public.accounts WHERE id=$1)::int AS a,
                (SELECT count(*) FROM public.selves WHERE account_id=$1)::int AS s,
                (SELECT count(*) FROM auth.account_credentials WHERE account_id=$1)::int AS c`,
        [ref],
      );
      expect(rows[0]).toEqual({ a: 1, s: 1, c: 1 });
    });

    it('acknowledged db failure: duplicate reference is rejected with a SQLSTATE and no secret', async () => {
      const ref = randomUUID();
      await enrollAccount(bootstrap, { accountRef: ref, name: 'first' });
      const r = await enrollAccount(bootstrap, { accountRef: ref, name: 'second' });
      expect(r.status).toBe('db_failure');
      if (r.status !== 'db_failure') return;
      expect(r.sqlstate).toBe('23505');
      expect((r as Record<string, unknown>).secret).toBeUndefined();
      // the failed second enrollment created nothing extra
      const { rows } = await su.query('SELECT count(*)::int AS n FROM public.selves WHERE account_id=$1', [ref]);
      expect(rows[0].n).toBe(1);
    });

    it('ambiguous outcome: no SQLSTATE, no secret exposed', async () => {
      const r = await enrollAccount(connLost, { accountRef: randomUUID(), name: 'x' });
      expect(r.status).toBe('ambiguous');
      expect((r as Record<string, unknown>).secret).toBeUndefined();
    });
  });

  describe('ambiguous recovery decision', () => {
    it('recovers a committed enrollment (fresh credential) and reports not-committed for an unknown ref', async () => {
      const committed = await enrollAccount(bootstrap, { accountRef: randomUUID(), name: 'rec' });
      expect(committed.status).toBe('committed');
      if (committed.status !== 'committed') return;
      const rec = await recoverEnrollment(bootstrap, { account: committed.accountId });
      expect(rec.status).toBe('recovered');
      if (rec.status !== 'recovered') return;
      expect(rec.secret.length).toBeGreaterThan(0);
      expect(rec.credentialId).not.toBe(committed.credentialId);

      const unknown = await recoverEnrollment(bootstrap, { account: randomUUID() });
      expect(unknown.status).toBe('not_committed');
    });

    it('refuses recovery once the account holds more than one historical credential', async () => {
      const e = await enrollAccount(bootstrap, { accountRef: randomUUID(), name: 'multi' });
      expect(e.status).toBe('committed');
      if (e.status !== 'committed') return;
      const rot = await rotateCredential(bootstrap, { account: e.accountId, expectedActiveId: e.credentialId });
      expect(rot.status).toBe('rotated');
      const rec = await recoverEnrollment(bootstrap, { account: e.accountId });
      expect(rec.status).toBe('ineligible');
    });
  });

  describe('rotation (compare-and-swap)', () => {
    it('rotates with the expected active id, and a stale expectation fails with no mutation', async () => {
      const e = await enrollAccount(bootstrap, { accountRef: randomUUID(), name: 'rot' });
      if (e.status !== 'committed') throw new Error('enroll failed');
      const first = await rotateCredential(bootstrap, { account: e.accountId, expectedActiveId: e.credentialId });
      expect(first.status).toBe('rotated');

      // The old expected id is now stale -> CAS fails, no mutation.
      const stale = await rotateCredential(bootstrap, { account: e.accountId, expectedActiveId: e.credentialId });
      expect(stale.status).toBe('stale');

      const { rows } = await su.query(
        'SELECT count(*)::int AS active FROM auth.account_credentials WHERE account_id=$1 AND disabled_at IS NULL',
        [e.accountId],
      );
      expect(rows[0].active).toBe(1); // exactly one active credential remains
    });

    it('reports not_found for an unknown account', async () => {
      const r = await rotateCredential(bootstrap, { account: randomUUID(), expectedActiveId: randomUUID() });
      expect(r.status).toBe('not_found');
    });
  });

  describe('containment', () => {
    it('disables the active credential and revokes all live sessions, then is idempotent', async () => {
      const e = await enrollAccount(bootstrap, { accountRef: randomUUID(), name: 'con' });
      if (e.status !== 'committed') throw new Error('enroll failed');
      // create a live session via the app-role issue path
      await appPool.query('SELECT auth.issue_session($1, $2)', [sha256(e.secret), sha256('tok-' + e.accountId)]);

      const r1 = await containAccount(operator, e.accountId);
      expect(r1.status).toBe('contained');
      if (r1.status !== 'contained') return;
      expect(r1.credentialsDisabled).toBe(1);
      expect(r1.sessionsRevoked).toBe(1);
      expect(r1.alreadyContained).toBe(false);

      const r2 = await containAccount(operator, e.accountId);
      expect(r2.status).toBe('contained');
      if (r2.status !== 'contained') return;
      expect(r2).toMatchObject({ credentialsDisabled: 0, sessionsRevoked: 0, alreadyContained: true });
    });

    it('never reports success for an unknown account id', async () => {
      const r = await containAccount(operator, randomUUID());
      expect(r.status).toBe('not_found');
    });
  });
});
