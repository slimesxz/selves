import './helpers/env';
import { describe, expect, it } from 'vitest';
import { createLocalObjectStorage } from '../src/storage/local-object-storage.ts';
import {
  MAX_OBJECT_AUTHORIZATION_SECONDS,
  newObjectKey,
  type ObjectAuthorization,
  type ObjectStorage,
} from '../src/storage/object-storage.ts';
import { failureReason, manualClock, type ManualClock } from './helpers/object-storage.ts';

// P12-D — the byte-plane contract of the ratified ObjectStorage port, proven
// against the deterministic local implementation (Gate 1 Q3: dependency-free, no
// SDK, no emulator). Every temporal claim is proven by ADVANCING an injected
// clock; there is no sleep, no delay, and no probabilistic success anywhere in
// this file.
//
// EVIDENCE CLASS: RUNTIME, over the real port implementation. It is not evidence
// about a cloud provider's signed-request semantics, which Phase 12 does not
// select and does not model.

const SECOND = 1000;
const CEILING_MS = MAX_OBJECT_AUTHORIZATION_SECONDS * SECOND;

interface Fixture {
  readonly mc: ManualClock;
  readonly storage: ObjectStorage;
  /** An expiry `seconds` from the clock's current instant. */
  at(seconds: number): Date;
}

function fixture(): Fixture {
  const mc = manualClock();
  const storage = createLocalObjectStorage({ clock: mc.clock });
  return { mc, storage, at: (seconds) => new Date(mc.nowMs() + seconds * SECOND) };
}

describe('P12-D lifetime ceiling — server-controlled, enforced at the port', () => {
  it('the ratified ceiling is 300 seconds', () => {
    expect(MAX_OBJECT_AUTHORIZATION_SECONDS).toBe(300);
  });

  it('an upload authorization at exactly the ceiling is issued and expires exactly there', async () => {
    const f = fixture();
    const auth = await f.storage.authorizeUpload(newObjectKey(), f.at(300));
    expect(auth.mode).toBe('write');
    expect(auth.expiresAt.getTime() - f.mc.nowMs()).toBe(CEILING_MS);
  });

  it('a download authorization at exactly the ceiling is issued and expires exactly there', async () => {
    const f = fixture();
    const auth = await f.storage.authorizeDownload(newObjectKey(), f.at(300));
    expect(auth.mode).toBe('read');
    expect(auth.expiresAt.getTime() - f.mc.nowMs()).toBe(CEILING_MS);
  });

  it('a shorter lifetime is accepted for both modes', async () => {
    const f = fixture();
    const up = await f.storage.authorizeUpload(newObjectKey(), f.at(30));
    const down = await f.storage.authorizeDownload(newObjectKey(), f.at(1));
    expect(up.expiresAt.getTime() - f.mc.nowMs()).toBe(30 * SECOND);
    expect(down.expiresAt.getTime() - f.mc.nowMs()).toBe(1 * SECOND);
  });

  it('a lifetime BEYOND the ceiling is refused for both modes', async () => {
    const f = fixture();
    expect(await failureReason(() => f.storage.authorizeUpload(newObjectKey(), f.at(301)))).toBe('lifetime_exceeded');
    expect(await failureReason(() => f.storage.authorizeDownload(newObjectKey(), f.at(301)))).toBe('lifetime_exceeded');
    expect(await failureReason(() => f.storage.authorizeDownload(newObjectKey(), f.at(86_400)))).toBe('lifetime_exceeded');
  });

  it('a zero or negative lifetime is refused for both modes', async () => {
    const f = fixture();
    expect(await failureReason(() => f.storage.authorizeUpload(newObjectKey(), f.at(0)))).toBe('lifetime_exceeded');
    expect(await failureReason(() => f.storage.authorizeDownload(newObjectKey(), f.at(0)))).toBe('lifetime_exceeded');
    expect(await failureReason(() => f.storage.authorizeDownload(newObjectKey(), f.at(-1)))).toBe('lifetime_exceeded');
  });

  it('an invalid expiry instant is refused rather than treated as unbounded', async () => {
    const f = fixture();
    expect(await failureReason(() => f.storage.authorizeDownload(newObjectKey(), new Date(NaN)))).toBe('lifetime_exceeded');
  });
});

describe('P12-D expiry boundary — redeemable before, denied at and after', () => {
  it('a download authorization redeems up to the instant before expiry and fails at it', async () => {
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(300));
    await f.storage.put(up, new Uint8Array([7, 8, 9]));
    const down = await f.storage.authorizeDownload(key, f.at(300));

    // one millisecond before expiry: still redeemable
    f.mc.advanceMs(CEILING_MS - 1);
    expect(Array.from(await f.storage.get(down))).toEqual([7, 8, 9]);

    // exactly at expiry: denied (the bound is `now < expiresAt`)
    f.mc.advanceMs(1);
    expect(f.mc.nowMs()).toBe(down.expiresAt.getTime());
    expect(await failureReason(() => f.storage.get(down))).toBe('expired');

    // and after
    f.mc.advanceSeconds(1);
    expect(await failureReason(() => f.storage.get(down))).toBe('expired');
  });

  it('an upload authorization expires on the same bound', async () => {
    const f = fixture();
    const up = await f.storage.authorizeUpload(newObjectKey(), f.at(60));
    f.mc.advanceSeconds(60);
    expect(await failureReason(() => f.storage.put(up, new Uint8Array([1])))).toBe('expired');
  });
});

describe('P12-D credential discipline', () => {
  it('a forged or unknown credential is refused', async () => {
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(60));
    await f.storage.put(up, new Uint8Array([1]));
    const down = await f.storage.authorizeDownload(key, f.at(60));

    const forged: ObjectAuthorization = { ...down, credential: 'not-a-real-credential' };
    expect(await failureReason(() => f.storage.get(forged))).toBe('invalid_credential');
    expect(await failureReason(() => f.storage.put({ ...up, credential: '' }, new Uint8Array([2])))).toBe('invalid_credential');
  });

  it('modes are separated: a write credential cannot read and a read credential cannot write', async () => {
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(60));
    await f.storage.put(up, new Uint8Array([1]));
    const down = await f.storage.authorizeDownload(key, f.at(60));

    expect(await failureReason(() => f.storage.get(up))).toBe('wrong_mode');
    expect(await failureReason(() => f.storage.put(down, new Uint8Array([2])))).toBe('wrong_mode');
  });

  it('a valid read credential for a key holding no bytes reports unknown_object', async () => {
    const f = fixture();
    const down = await f.storage.authorizeDownload(newObjectKey(), f.at(60));
    expect(await failureReason(() => f.storage.get(down))).toBe('unknown_object');
  });

  it('possession of a key is insufficient: redemption additionally requires a credential', async () => {
    // Key secrecy is NOT an authorization ground. This records the converse
    // property the boundary actually relies on: a holder who knows the exact key
    // still cannot read without a valid, unexpired, mode-correct credential.
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(60));
    await f.storage.put(up, new Uint8Array([42]));
    const forgedWithRealKey: ObjectAuthorization = {
      key,
      mode: 'read',
      expiresAt: f.at(60),
      credential: 'known-key-but-no-credential',
    };
    expect(await failureReason(() => f.storage.get(forgedWithRealKey))).toBe('invalid_credential');
  });
});

describe('P12-D the registry governs redemption, not the returned value', () => {
  it('the returned authorization is frozen', async () => {
    const f = fixture();
    const auth = await f.storage.authorizeDownload(newObjectKey(), f.at(60));
    expect(Object.isFrozen(auth)).toBe(true);
  });

  it('rewriting expiresAt on a copy does not extend an expired authorization', async () => {
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(60));
    await f.storage.put(up, new Uint8Array([5]));
    const down = await f.storage.authorizeDownload(key, f.at(60));

    f.mc.advanceSeconds(60);
    const extended: ObjectAuthorization = { ...down, expiresAt: new Date(f.mc.nowMs() + 10 * 60 * SECOND) };
    expect(await failureReason(() => f.storage.get(extended))).toBe('expired');
  });

  it('rewriting the key on a copy does not redirect the read', async () => {
    const f = fixture();
    const mine = newObjectKey();
    const other = newObjectKey();
    const upMine = await f.storage.authorizeUpload(mine, f.at(60));
    await f.storage.put(upMine, new Uint8Array([1, 1, 1]));
    const upOther = await f.storage.authorizeUpload(other, f.at(60));
    await f.storage.put(upOther, new Uint8Array([2, 2, 2]));

    const downMine = await f.storage.authorizeDownload(mine, f.at(60));
    const redirected: ObjectAuthorization = { ...downMine, key: other };
    // The registry's key wins: the caller still reads its own object.
    expect(Array.from(await f.storage.get(redirected))).toEqual([1, 1, 1]);
  });

  it('rewriting the mode on a copy does not grant the other mode', async () => {
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(60));
    const posingAsRead: ObjectAuthorization = { ...up, mode: 'read' };
    expect(await failureReason(() => f.storage.get(posingAsRead))).toBe('wrong_mode');
  });
});

describe('P12-D byte handling', () => {
  it('bytes are copied in: mutating the caller buffer after put does not rewrite the store', async () => {
    const f = fixture();
    const key = newObjectKey();
    const source = new Uint8Array([1, 2, 3]);
    const up = await f.storage.authorizeUpload(key, f.at(60));
    await f.storage.put(up, source);
    source[0] = 99;

    const down = await f.storage.authorizeDownload(key, f.at(60));
    expect(Array.from(await f.storage.get(down))).toEqual([1, 2, 3]);
  });

  it('bytes are copied out: mutating a result does not reach the store', async () => {
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(60));
    await f.storage.put(up, new Uint8Array([1, 2, 3]));

    const first = await f.storage.get(await f.storage.authorizeDownload(key, f.at(60)));
    first[0] = 99;
    const second = await f.storage.get(await f.storage.authorizeDownload(key, f.at(60)));
    expect(Array.from(second)).toEqual([1, 2, 3]);
  });
});

describe('P12-D the port surface itself', () => {
  it('exposes exactly the four ratified operations and no revocation operation', () => {
    const f = fixture();
    expect(Object.keys(f.storage).sort()).toEqual(['authorizeDownload', 'authorizeUpload', 'get', 'put']);
    // An already-issued authorization cannot be revoked: a presigned-URL
    // provider could not honour such an operation, so the port does not offer
    // one. The bounded lifetime is the whole of the residual-exposure control.
    expect('revokeAuthorization' in f.storage).toBe(false);
    expect('revoke' in f.storage).toBe(false);
    expect('delete' in f.storage).toBe(false);
  });

  it('a successful upload yields byte-plane state only', async () => {
    // STRUCTURAL SCOPE: this proves the port's own result and surface. That an
    // upload creates no authoritative PostgreSQL fact is proven separately, by
    // row counts, in object-storage-authorization.test.ts.
    const f = fixture();
    const key = newObjectKey();
    const up = await f.storage.authorizeUpload(key, f.at(60));
    const result = await f.storage.put(up, new Uint8Array([1]));
    expect(result).toBeUndefined();
    // The only way to observe the bytes remains a bounded read authorization.
    expect(Array.from(await f.storage.get(await f.storage.authorizeDownload(key, f.at(60))))).toEqual([1]);
  });

  it('an authorization carries no URL and no artifact association', async () => {
    const f = fixture();
    const auth = await f.storage.authorizeDownload(newObjectKey(), f.at(60));
    expect(Object.keys(auth).sort()).toEqual(['credential', 'expiresAt', 'key', 'mode']);
    expect('url' in auth).toBe(false);
    expect('artifactId' in auth).toBe(false);
  });

  it('two authorizations for the same key carry distinct credentials', async () => {
    const f = fixture();
    const key = newObjectKey();
    const a = await f.storage.authorizeDownload(key, f.at(60));
    const b = await f.storage.authorizeDownload(key, f.at(60));
    expect(a.credential).not.toBe(b.credential);
  });
});
