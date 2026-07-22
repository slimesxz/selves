import './helpers/env';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { bootstrapPool, enroll, sha256, superuserPool } from './helpers/auth.ts';
import { connect, race } from './helpers/race.ts';

// P4-F — deterministic linearization. Every credential state transition and
// session issuance serialize on the stable public.accounts row; these races
// prove the required outcomes for both orderings, with no timing sleeps.

let bootstrap: pg.Pool;
let su: pg.Pool;
let app: pg.Client, op: pg.Client, boot: pg.Client, boot2: pg.Client, probe: pg.Client;

const U = process.env;

beforeAll(() => { bootstrap = bootstrapPool(); su = superuserPool(); });
afterAll(async () => { await bootstrap.end(); await su.end(); });

beforeEach(async () => {
  app = await connect(U.TEST_APP_DATABASE_URL);
  op = await connect(U.TEST_OPERATOR_DATABASE_URL);
  boot = await connect(U.TEST_BOOTSTRAP_DATABASE_URL);
  boot2 = await connect(U.TEST_BOOTSTRAP_DATABASE_URL);
  probe = await connect(U.TEST_DATABASE_URL);
});
afterEach(async () => {
  for (const c of [app, op, boot, boot2, probe]) { try { await c.end(); } catch { /* already closed */ } }
});

const ISSUE = 'SELECT auth.issue_session($1, $2) AS id';
const DISABLE = 'SELECT * FROM auth.disable_credential($1)';
const ROTATE = 'SELECT auth.rotate_credential($1, $2, $3) AS id';
const CONTAIN = 'SELECT * FROM auth.contain_account($1)';
const RECOVER = 'SELECT auth.recover_enrollment_credential($1, $2) AS id';

async function activeCount(account: string): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM auth.account_credentials WHERE account_id = $1 AND disabled_at IS NULL', [account]);
  return rows[0]!.n;
}
async function activeId(account: string): Promise<string | null> {
  const { rows } = await su.query<{ id: string }>(
    'SELECT id FROM auth.account_credentials WHERE account_id = $1 AND disabled_at IS NULL', [account]);
  return rows[0]?.id ?? null;
}

describe('P4-F linearization (deterministic two-connection races)', () => {
  it('login commits first -> a later containment revokes the resulting session', async () => {
    const e = await enroll(bootstrap);
    const tok = sha256('t-' + e.accountId);
    const out = await race(
      { client: app, sql: ISSUE, params: [sha256(e.secret), tok] },
      { client: op, sql: CONTAIN, params: [e.accountId] }, probe);
    expect(out.racer.errCode).toBeUndefined();
    const { rows } = await su.query('SELECT revoked_at FROM auth.sessions WHERE token_hash = $1', [tok]);
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it('containment commits first -> login cannot issue a session', async () => {
    const e = await enroll(bootstrap);
    const tok = sha256('t-' + e.accountId);
    const out = await race(
      { client: op, sql: CONTAIN, params: [e.accountId] },
      { client: app, sql: ISSUE, params: [sha256(e.secret), tok] }, probe);
    expect(out.racer.errCode).toBe('28000');
    expect(await su.query('SELECT 1 FROM auth.sessions WHERE token_hash=$1', [tok]).then((r) => r.rowCount)).toBe(0);
  });

  it('disablement commits first -> login cannot issue a session', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: boot, sql: DISABLE, params: [e.accountId] },
      { client: app, sql: ISSUE, params: [sha256(e.secret), sha256('t-' + e.accountId)] }, probe);
    expect(out.racer.errCode).toBe('28000');
  });

  it('login commits first -> disablement disables the credential; the session survives', async () => {
    const e = await enroll(bootstrap);
    const tok = sha256('t-' + e.accountId);
    const out = await race(
      { client: app, sql: ISSUE, params: [sha256(e.secret), tok] },
      { client: boot, sql: DISABLE, params: [e.accountId] }, probe);
    expect(out.racer.ok?.[0]).toMatchObject({ credentials_disabled: 1, already_disabled: false });
    const { rows } = await su.query('SELECT revoked_at FROM auth.sessions WHERE token_hash=$1', [tok]);
    expect(rows[0].revoked_at).toBeNull(); // ordinary disablement does not revoke sessions
  });

  it('rotation before disablement -> disablement disables the REPLACEMENT (never already_disabled while active)', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: boot, sql: ROTATE, params: [e.accountId, e.credentialId, sha256('new-' + e.accountId)] },
      { client: boot2, sql: DISABLE, params: [e.accountId] }, probe);
    expect(out.racer.ok?.[0]).toMatchObject({ credentials_disabled: 1, already_disabled: false });
    expect(await activeCount(e.accountId)).toBe(0);
  });

  it('disablement before rotation -> rotation fails (stale) with no mutation', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: boot, sql: DISABLE, params: [e.accountId] },
      { client: boot2, sql: ROTATE, params: [e.accountId, e.credentialId, sha256('new-' + e.accountId)] }, probe);
    expect(out.racer.errCode).toBe('40001');
    expect(await activeCount(e.accountId)).toBe(0);
  });

  it('rotation before containment -> containment disables the replacement', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: boot, sql: ROTATE, params: [e.accountId, e.credentialId, sha256('new-' + e.accountId)] },
      { client: op, sql: CONTAIN, params: [e.accountId] }, probe);
    expect(out.racer.ok?.[0]).toMatchObject({ credentials_disabled: 1 });
    expect(await activeCount(e.accountId)).toBe(0);
  });

  it('containment before rotation -> rotation fails (stale) with no mutation', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: op, sql: CONTAIN, params: [e.accountId] },
      { client: boot, sql: ROTATE, params: [e.accountId, e.credentialId, sha256('new-' + e.accountId)] }, probe);
    expect(out.racer.errCode).toBe('40001');
    expect(await activeCount(e.accountId)).toBe(0);
  });

  it('disablement before containment -> containment reports zero credentials disabled', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: boot, sql: DISABLE, params: [e.accountId] },
      { client: op, sql: CONTAIN, params: [e.accountId] }, probe);
    expect(out.racer.ok?.[0]).toMatchObject({ credentials_disabled: 0 });
  });

  it('containment before disablement -> disablement reports already_disabled', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: op, sql: CONTAIN, params: [e.accountId] },
      { client: boot, sql: DISABLE, params: [e.accountId] }, probe);
    expect(out.racer.ok?.[0]).toMatchObject({ credentials_disabled: 0, already_disabled: true });
  });

  it('concurrent rotations with the same expected id -> exactly one winner; the loser mutates nothing', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: boot, sql: ROTATE, params: [e.accountId, e.credentialId, sha256('A-' + e.accountId)] },
      { client: boot2, sql: ROTATE, params: [e.accountId, e.credentialId, sha256('B-' + e.accountId)] }, probe);
    const winnerNew = out.holdRows[0]!.id as string;
    expect(out.racer.errCode).toBe('40001');           // loser
    expect(await activeCount(e.accountId)).toBe(1);
    expect(await activeId(e.accountId)).toBe(winnerNew); // winner's credential is not invalidated
  });

  it('concurrent recoveries -> one winner; the second sees >1 credential and fails, not invalidating the winner', async () => {
    const e = await enroll(bootstrap);
    const out = await race(
      { client: boot, sql: RECOVER, params: [e.accountId, sha256('rA-' + e.accountId)] },
      { client: boot2, sql: RECOVER, params: [e.accountId, sha256('rB-' + e.accountId)] }, probe);
    const winnerNew = out.holdRows[0]!.id as string;
    expect(out.racer.errCode).toBe('23514');
    expect(await activeId(e.accountId)).toBe(winnerNew);
  });
});
