// The deterministic, dependency-free local implementation of the ObjectStorage
// port (Phase 12 Gate 1 Q3: no S3/R2/MinIO SDK, no emulator, no vendor adapter).
//
// It exists to prove the architecture and the authorization semantics of the
// boundary, not to be a production storage provider. Provider selection and
// production credential mechanics remain deployment work.
//
// PROPERTIES IT ESTABLISHES
//
//  1. The 300-second ceiling is enforced HERE, at the port. A caller — including
//     a future defective issuance service — cannot obtain a longer-lived
//     authorization, because the port refuses to mint one (Gate 1 Q4).
//  2. Redemption is decided against the port's OWN registry, never against the
//     fields carried on the ObjectAuthorization value. A holder who rewrites
//     `expiresAt`, `key`, or `mode` on the value it was handed changes nothing.
//  3. Possession or knowledge of an ObjectKey is insufficient to redeem: a
//     valid, unexpired, mode-correct credential is additionally required. Key
//     secrecy remains defence in depth and never an authorization ground
//     (Gate 1 R4).
//  4. A successful `put` writes bytes and returns void. It creates no Artifact,
//     association, grant, Graph edge, projection, event, or other authoritative
//     fact (Gate 1 R2, R5).
//
// State is INSTANCE-scoped, created inside the factory: there is no module-level
// mutable store, and nothing here is a cross-request authorization cache. This
// module holds no database access, no network access, and no filesystem access;
// it value-imports only node:crypto and its own port module.

import {
  MAX_OBJECT_AUTHORIZATION_SECONDS,
  ObjectStorageError,
  type Clock,
  type ObjectAccessMode,
  type ObjectAuthorization,
  type ObjectKey,
  type ObjectStorage,
} from './object-storage.ts';
import { randomBytes } from 'node:crypto';

const MAX_LIFETIME_MS = MAX_OBJECT_AUTHORIZATION_SECONDS * 1000;

/** What the port itself knows about an issued credential. This — not the value
 *  handed to the caller — is the authority for every redemption. */
interface IssuedAuthorization {
  readonly key: ObjectKey;
  readonly mode: ObjectAccessMode;
  readonly expiresAtMs: number;
}

export function createLocalObjectStorage(deps: { readonly clock: Clock }): ObjectStorage {
  const { clock } = deps;
  const objects = new Map<string, Uint8Array>();
  const issued = new Map<string, IssuedAuthorization>();

  const nowMs = (): number => clock().getTime();

  const authorize = (
    key: ObjectKey,
    expiresAt: Date,
    mode: ObjectAccessMode,
  ): ObjectAuthorization => {
    const expiresAtMs = expiresAt.getTime();
    const lifetimeMs = expiresAtMs - nowMs();
    // Never longer than the ratified ceiling; never already-expired or
    // non-finite. A shorter lifetime is permitted.
    if (!Number.isFinite(expiresAtMs) || lifetimeMs <= 0 || lifetimeMs > MAX_LIFETIME_MS) {
      throw new ObjectStorageError('lifetime_exceeded');
    }
    const credential = randomBytes(32).toString('base64url');
    issued.set(credential, { key, mode, expiresAtMs });
    // The Date is copied on the way out, so the holder cannot mutate the value
    // it was handed into something that looks longer-lived than it is.
    return Object.freeze({ key, mode, expiresAt: new Date(expiresAtMs), credential });
  };

  /** Resolve a presented authorization against the registry. Order is fixed:
   *  unknown credential, then temporal validity, then mode. Expiry is evaluated
   *  before mode because the bounded lifetime is the ratified security property
   *  and must not be shadowed by a lesser failure. */
  const redeem = (auth: ObjectAuthorization, required: ObjectAccessMode): IssuedAuthorization => {
    const record = issued.get(auth.credential);
    if (!record) throw new ObjectStorageError('invalid_credential');
    if (nowMs() >= record.expiresAtMs) throw new ObjectStorageError('expired');
    if (record.mode !== required) throw new ObjectStorageError('wrong_mode');
    return record;
  };

  return {
    authorizeUpload(key, expiresAt) {
      return Promise.resolve(authorize(key, expiresAt, 'write'));
    },

    authorizeDownload(key, expiresAt) {
      return Promise.resolve(authorize(key, expiresAt, 'read'));
    },

    put(auth, bytes) {
      const record = redeem(auth, 'write');
      // Copy in: a later mutation of the caller's buffer must not rewrite what
      // the store holds.
      objects.set(record.key, bytes.slice());
      return Promise.resolve();
    },

    get(auth) {
      const record = redeem(auth, 'read');
      const stored = objects.get(record.key);
      if (stored === undefined) throw new ObjectStorageError('unknown_object');
      // Copy out: a reader cannot reach into the store through its result.
      return Promise.resolve(stored.slice());
    },
  };
}
