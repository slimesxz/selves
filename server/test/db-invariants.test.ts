import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { bootstrapPool, enroll, sha256, superuserPool } from './helpers/auth.ts';
import { expectPgError } from './helpers/db';

// P4-F — authoritative DB invariants, exercised directly as the superuser (which
// bypasses ownership but NOT triggers/constraints), so the raw guards are tested
// independent of the function boundary.

let su: pg.Pool;
let bootstrap: pg.Pool;

beforeAll(() => { su = superuserPool(); bootstrap = bootstrapPool(); });
afterAll(async () => { await su.end(); await bootstrap.end(); });

describe('P4-F authoritative DB invariants', () => {
  it('rejects non-32-byte credential and token hashes (23514)', async () => {
    const e = await enroll(bootstrap);
    for (const len of [31, 33]) {
      await expectPgError(
        () => su.query('INSERT INTO auth.account_credentials (account_id, credential_hash) VALUES ($1, $2)', [e.accountId, Buffer.alloc(len)]),
        '23514');
      await expectPgError(
        () => su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [e.accountId, Buffer.alloc(len)]),
        '23514');
    }
  });

  it('rejects a session whose lifetime is not exactly 604800 seconds', async () => {
    const e = await enroll(bootstrap);
    await expectPgError(
      () => su.query(
        "INSERT INTO auth.sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '6 days')",
        [e.accountId, sha256('t6' + e.accountId)]),
      '23514');
  });

  it('lifetime is exactly 604800 elapsed seconds across a DST transition (non-UTC)', async () => {
    const e = await enroll(bootstrap);
    const c = await su.connect();
    try {
      await c.query("SET TIME ZONE 'America/New_York'");
      // created_at is just before the 2026-03-08 spring-forward.
      const { rows } = await c.query<{ secs: string; calendar_secs: string }>(
        `INSERT INTO auth.sessions (account_id, token_hash, created_at)
         VALUES ($1, $2, timestamptz '2026-03-08 01:30:00-05')
         RETURNING extract(epoch FROM (expires_at - created_at))::bigint AS secs,
                   extract(epoch FROM ((created_at + interval '7 days') - created_at))::bigint AS calendar_secs`,
        [e.accountId, sha256('dst' + e.accountId)]);
      expect(Number(rows[0]!.secs)).toBe(604800);           // exact elapsed seconds
      expect(Number(rows[0]!.calendar_secs)).toBe(604800 - 3600); // 'interval 7 days' would lose an hour
    } finally {
      c.release();
    }
  });

  it('session identity and lifetime are immutable', async () => {
    const e = await enroll(bootstrap);
    const tok = sha256('imm' + e.accountId);
    await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [e.accountId, tok]);
    await expectPgError(() => su.query("UPDATE auth.sessions SET expires_at = expires_at + interval '1 day' WHERE token_hash=$1", [tok]), '23514');
    await expectPgError(() => su.query("UPDATE auth.sessions SET created_at = created_at - interval '1 day' WHERE token_hash=$1", [tok]), '23514');
  });

  it('a revoked session cannot be un-revoked', async () => {
    const e = await enroll(bootstrap);
    const tok = sha256('rev' + e.accountId);
    await su.query('INSERT INTO auth.sessions (account_id, token_hash) VALUES ($1, $2)', [e.accountId, tok]);
    await su.query('UPDATE auth.sessions SET revoked_at = now() WHERE token_hash=$1', [tok]);
    await expectPgError(() => su.query('UPDATE auth.sessions SET revoked_at = NULL WHERE token_hash=$1', [tok]), '23514');
  });

  it('a disabled credential cannot be re-enabled', async () => {
    const e = await enroll(bootstrap);
    await su.query('UPDATE auth.account_credentials SET disabled_at = now() WHERE id=$1', [e.credentialId]);
    await expectPgError(() => su.query('UPDATE auth.account_credentials SET disabled_at = NULL WHERE id=$1', [e.credentialId]), '23514');
  });

  it('at most one active credential per account (one_active, 23505)', async () => {
    const e = await enroll(bootstrap);
    await expectPgError(
      () => su.query('INSERT INTO auth.account_credentials (account_id, credential_hash) VALUES ($1, $2)', [e.accountId, sha256('second' + e.accountId)]),
      '23505');
  });

  it('rejects non-finite timestamps (23514)', async () => {
    const e = await enroll(bootstrap);
    await expectPgError(
      () => su.query("INSERT INTO auth.sessions (account_id, token_hash, created_at) VALUES ($1, $2, 'infinity')", [e.accountId, sha256('inf' + e.accountId)]),
      '23514');
    // disabled_at = infinity on a (second, otherwise blocked) row: use a fresh account with its sole credential.
    const e2 = await enroll(bootstrap);
    await expectPgError(
      () => su.query("UPDATE auth.account_credentials SET disabled_at = 'infinity' WHERE id=$1", [e2.credentialId]),
      '23514');
  });
});
