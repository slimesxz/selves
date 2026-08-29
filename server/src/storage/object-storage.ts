// The vendor-neutral object-storage port — Phase 12 boundary only.
//
// AUTHORITY. Phase 12 Gate 1 (Q1 "Boundary Only", Q3 dependency-free port, Q4
// the 300-second ceiling, R2 upload/Artifact separation, R3 ephemeral derivative
// capability, R4 identifiers are not authority) and the ratified P12-A boundary
// design. AGENTS.md remains binding constitutional law.
//
// WHAT THIS FILE IS. Types, one constant, and one identifier generator. It
// declares the byte plane and nothing else. It contains no authorization, no
// persistence, no domain vocabulary, and no product behaviour.
//
// WHAT PHASE 12 DOES NOT DO. `photo` is not a creatable Artifact payload; the
// artifacts_text_only CHECK is untouched, ArtifactPayloadType stays 'text', and
// no object-store operation manufactures an Artifact, association, Key grant,
// Graph edge, projection, or event. Successful `put` creates private byte-plane
// state and no authoritative fact (Gate 1 R2, R5).
//
// VENDOR NEUTRALITY (Gate 1 Q3). No bucket, ARN, region, binding, presigner,
// provider-specific signed-request type, or provider name appears in this file
// or in any consumer of it. Provider selection is deployment work and is not
// ratified here.

import { randomBytes } from 'node:crypto';

// An object-store identifier. NOT authority (Gate 1 R4): key secrecy is not an
// authorization ground anywhere in this design. The brand is declared LOCALLY —
// the ontology barrel (@selves/domain) gains no member, because an object is not
// an ontological object.
declare const OBJECT_KEY: unique symbol;
export type ObjectKey = string & { readonly [OBJECT_KEY]: 'ObjectKey' };

// The ratified maximum authorization lifetime (Gate 1 Q4). Server-controlled;
// there is no caller-selectable TTL and no persisted standing download URL. The
// PORT enforces this ceiling itself, so it binds the upload layer and the
// download layer identically and independently of any issuance service.
export const MAX_OBJECT_AUTHORIZATION_SECONDS = 300;

export type ObjectAccessMode = 'read' | 'write';

// An ephemeral derivative capability (Gate 1 R3). It is not an authoritative
// record, does not become a Key grant or a Graph edge, creates no authorization
// ground, and cannot widen the AuthorizationService decision.
//
// It deliberately declares NO `url` member: there is no URL representation of an
// authorization, permanent or otherwise. It deliberately declares NO artifact
// member: an upload authorization is never associated with an authoritative
// Artifact, because Phase 12 ratifies no production authority for unattached
// uploads (Gate 1 D2).
//
// `credential` is an opaque driver-scoped bearer value. Holding this object is
// not itself entitlement: redemption is decided against the port's own registry,
// never against the fields carried on this value.
export interface ObjectAuthorization {
  readonly key: ObjectKey;
  readonly mode: ObjectAccessMode;
  readonly expiresAt: Date;
  readonly credential: string;
}

// Closed failure set. These never cross a client boundary in Phase 12 — there is
// no production HTTP route — so no public error mapper is added and
// authz/reasons.ts is untouched.
export type ObjectStorageFailure =
  | 'expired' //            redeemed at or after expiresAt
  | 'invalid_credential' // unknown or forged credential
  | 'wrong_mode' //         a read credential used to write, or the reverse
  | 'unknown_object' //     no bytes are stored at that key
  | 'lifetime_exceeded'; // requested expiry beyond the ratified ceiling

export class ObjectStorageError extends Error {
  readonly reason: ObjectStorageFailure;
  constructor(reason: ObjectStorageFailure) {
    super(reason);
    this.name = 'ObjectStorageError';
    this.reason = reason;
  }
}

// The byte plane.
//
// LAYER SEPARATION (Gate 1 D2). `authorizeUpload` exists HERE, at the port, and
// only here: the byte plane can mint a bounded upload capability because that
// capability concerns bytes alone. There is no production upload issuance
// service, because no ratified production authority answers "may this actor
// upload these unattached bytes?" — and Artifact-read authority may not be
// substituted for an authority that does not exist. Download issuance is a
// separate application-layer concern (P12-C) and is subordinate to the existing
// authoritative readArtifact decision.
//
// There is deliberately NO authorization-revocation operation. A presigned-URL
// provider cannot revoke an issued URL; giving this port that power would let
// Phase 12 record a guarantee the architecture does not deliver. The bounded
// lifetime is the whole of the residual-exposure control.
export interface ObjectStorage {
  authorizeUpload(key: ObjectKey, expiresAt: Date): Promise<ObjectAuthorization>;
  authorizeDownload(key: ObjectKey, expiresAt: Date): Promise<ObjectAuthorization>;
  put(auth: ObjectAuthorization, bytes: Uint8Array): Promise<void>;
  get(auth: ObjectAuthorization): Promise<Uint8Array>;
}

/** Injected time source. Every lifetime bound is evaluated against it, so expiry
 *  is provable deterministically rather than by sleeping. */
export type Clock = () => Date;

/** A fresh object identifier: 256 bits of randomness, base64url. Unguessable in
 *  practice — and relied on for nothing. Defence in depth, never a ground. */
export function newObjectKey(): ObjectKey {
  return randomBytes(32).toString('base64url') as ObjectKey;
}
