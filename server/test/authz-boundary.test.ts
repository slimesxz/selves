import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { appTestPool, bootstrapPool, enroll, operatorPool, sha256, superuserPool, workerPool } from './helpers/auth.ts';
import { expectPgError } from './helpers/db';

// P4-F — the exclusive function-authorization boundary, proven by real calls:
// unauthorized roles cannot EXECUTE the privileged functions, and no callable
// role can reproduce their effects through direct table writes.

const B32 = Buffer.alloc(32);
const UUID = '00000000-0000-0000-0000-000000000000';

const FUNCS: Record<string, { sql: string; params: unknown[]; approved: string }> = {
  authenticate_session: { sql: 'SELECT auth.authenticate_session($1)', params: [B32], approved: 'selves_app' },
  issue_session: { sql: 'SELECT auth.issue_session($1,$2)', params: [B32, B32], approved: 'selves_app' },
  revoke_session: { sql: 'SELECT auth.revoke_session($1)', params: [B32], approved: 'selves_app' },
  enroll_account: { sql: 'SELECT auth.enroll_account($1,$2,$3)', params: [UUID, 'n', B32], approved: 'selves_bootstrap' },
  rotate_credential: { sql: 'SELECT auth.rotate_credential($1,$2,$3)', params: [UUID, UUID, B32], approved: 'selves_bootstrap' },
  disable_credential: { sql: 'SELECT auth.disable_credential($1)', params: [UUID], approved: 'selves_bootstrap' },
  recover_enrollment_credential: { sql: 'SELECT auth.recover_enrollment_credential($1,$2)', params: [UUID, B32], approved: 'selves_bootstrap' },
  contain_account: { sql: 'SELECT auth.contain_account($1)', params: [UUID], approved: 'selves_operator' },
};

let app: pg.Pool, boot: pg.Pool, operator: pg.Pool, worker: pg.Pool, su: pg.Pool;
let roles: Record<string, pg.Pool>;

beforeAll(() => {
  app = appTestPool(); boot = bootstrapPool(); operator = operatorPool(); worker = workerPool(); su = superuserPool();
  roles = { selves_app: app, selves_bootstrap: boot, selves_operator: operator, selves_worker: worker };
});
afterAll(async () => { await Promise.all([app.end(), boot.end(), operator.end(), worker.end(), su.end()]); });

describe('P4-F function-authorization boundary', () => {
  it('every unauthorized role (and worker=PUBLIC) is denied EXECUTE (42501)', async () => {
    for (const [fnName, fn] of Object.entries(FUNCS)) {
      for (const [roleName, pool] of Object.entries(roles)) {
        if (roleName === fn.approved) continue;
        await expectPgError(() => pool.query(fn.sql, fn.params), '42501');
      }
    }
  });

  it('no callable role can reproduce a protected effect through direct table writes (42501)', async () => {
    const e = await enroll(boot);
    // app: no direct access to auth tables at all
    await expectPgError(() => app.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1,$2)', [e.accountId, sha256('x')]), '42501');
    await expectPgError(() => app.query('UPDATE auth.sessions SET revoked_at = now()'), '42501');
    await expectPgError(() => app.query('SELECT * FROM auth.sessions'), '42501');
    await expectPgError(() => app.query('SELECT * FROM auth.account_credentials'), '42501');
    // bootstrap: cannot mint identities or touch credentials directly
    await expectPgError(() => boot.query('INSERT INTO public.accounts DEFAULT VALUES'), '42501');
    await expectPgError(() => boot.query('INSERT INTO auth.account_credentials (account_id, credential_hash) VALUES ($1,$2)', [e.accountId, sha256('y')]), '42501');
    await expectPgError(() => boot.query('UPDATE auth.account_credentials SET disabled_at = now()'), '42501');
    // operator: cannot revoke sessions or disable credentials directly
    await expectPgError(() => operator.query('UPDATE auth.sessions SET revoked_at = now()'), '42501');
    await expectPgError(() => operator.query('UPDATE auth.account_credentials SET disabled_at = now()'), '42501');
  });

  it('app retains exactly its column-scoped read on public.selves', async () => {
    const e = await enroll(boot);
    const { rows } = await app.query('SELECT id, account_id, name, self_slot FROM public.selves WHERE id = $1', [e.selfId]);
    expect(rows).toHaveLength(1);
    await expectPgError(() => app.query('SELECT created_at FROM public.selves'), '42501'); // column not granted
  });

  it('DEFINER functions ignore a caller-controlled search_path (no name redirection)', async () => {
    // Run as the superuser: it can create a shadow temp table AND set a hostile
    // search_path. The function's own search_path='' must still win, proving the
    // guard is in the function, not a privilege side effect. (selves_app cannot
    // even create temp tables — TEMP was revoked from PUBLIC — a separate win.)
    const e = await enroll(boot);
    const c = await su.connect();
    try {
      await c.query('CREATE TEMP TABLE sessions (x int)'); // incompatible shape on purpose
      await c.query('SET search_path = pg_temp');
      const tok = sha256('redir' + e.accountId);
      await c.query('SELECT auth.issue_session($1, $2)', [sha256(e.secret), tok]);
      const real = await c.query('SELECT 1 FROM auth.sessions WHERE token_hash = $1', [tok]); // qualified read
      expect(real.rowCount).toBe(1);
      const shadow = await c.query('SELECT count(*)::int AS n FROM pg_temp.sessions');
      expect(shadow.rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });
});
