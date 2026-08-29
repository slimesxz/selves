// The object-download authorization issuance boundary — Phase 12, application
// layer.
//
// AUTHORITY. Phase 12 Gate 1 (Q1 "Boundary Only", Q4 the 300-second ceiling,
// R2 upload/Artifact separation, R3 ephemeral derivative capability, R4
// identifiers are not authority, R5 no projection or authoritative event), the
// ratified P12-A boundary design, and the P12-C ordering clarification.
// AGENTS.md remains binding constitutional law.
//
// WHAT THIS BOUNDARY IS. One derivative decision: given a verified acting Self
// and an Artifact, may a bounded, short-lived capability to read the bytes bound
// to that Artifact be minted? The answer is not computed here. It is TAKEN from
// the existing authoritative AuthorizationService decision, which reaches real
// PostgreSQL through the ratified C3 context and the ratified RLS policies.
//
// WHAT THIS BOUNDARY IS NOT.
//
//   * It is not an authorization ground. It adds no predicate, no reason, no
//     allow ground, and no entry to the decision taxonomy. It calls exactly one
//     existing method, readArtifact, and can only narrow its answer.
//   * It is not an upload service. Download issuance is subordinate to
//     authoritative Artifact-read authority; upload is NOT, because no ratified
//     production authority answers "may this actor upload these unattached
//     bytes?" — and Artifact-read authority may not be substituted for an
//     authority that does not exist (Gate 1 D2). Upload capability therefore
//     lives at the byte-plane port alone. This boundary is download issuance
//     only.
//   * It is not addressable by object key. The issuer accepts an artifactId and
//     nothing else; the key is resolved internally, and only after the
//     authoritative allow. Key secrecy is never an authorization ground (R4).
//   * It is not composed in production. Phase 12 ships no production
//     ObjectBindingResolver, no composition factory, and no caller — there is no
//     binary-bearing Artifact, so there is no authoritative association to
//     resolve. A future ratified binary-bearing Artifact slice must supply the
//     PostgreSQL-backed resolver and the governing association semantics.
//
// The issuer holds no database handle, no repository, and no mutation. Every
// import below that could carry runtime authority is TYPE-ONLY; the sole
// value-bearing import is the ratified lifetime constant.

import type { ActingContext, AuthorizationService, Visible } from '../authz/service.ts';
import type {
  Clock,
  ObjectAuthorization,
  ObjectKey,
  ObjectStorage,
} from './object-storage.ts';
import { MAX_OBJECT_AUTHORIZATION_SECONDS } from './object-storage.ts';

/** Resolves the object bound to an Artifact, or null when that Artifact bears no
 *  binary object.
 *
 *  Phase 12 defines this port and provides NO production implementation of it:
 *  there is presently no binary-bearing Artifact and therefore no authoritative
 *  production association to resolve. An always-null production stub would add
 *  inert composition without proving an additional security property. The only
 *  Phase 12 implementation is test apparatus, which is structurally
 *  distinguishable and unreachable from src/ (Gate 1 R7). */
export interface ObjectBindingResolver {
  objectFor(artifactId: string): Promise<ObjectKey | null>;
}

/** Download issuance only. There is deliberately no upload counterpart. */
export interface ObjectAccessIssuer {
  issueDownloadAuthorization(
    ctx: ActingContext,
    artifactId: string,
  ): Promise<Visible<ObjectAuthorization>>;
}

export function createObjectAccessIssuer(deps: {
  readonly authorization: AuthorizationService;
  readonly binding: ObjectBindingResolver;
  readonly storage: ObjectStorage;
  readonly clock: Clock;
}): ObjectAccessIssuer {
  const { authorization, binding, storage, clock } = deps;

  return {
    async issueDownloadAuthorization(ctx, artifactId) {
      // 1. The authoritative decision, first and unconditionally. This reaches
      //    real PostgreSQL through the existing service — the acting Self comes
      //    from the verified Phase-4 context, never from an argument here.
      const artifact = await authorization.readArtifact(ctx, artifactId);
      // 2. Denied: the same opaque result the estate already ratified. No
      //    reason, no existence signal, no storage-specific taxonomy.
      if (!artifact.ok) return { ok: false };

      // 3. Only now is object-association state consulted. A principal who has
      //    not passed the authoritative Artifact-read decision never causes a
      //    binding lookup at all. The Artifact value itself is discarded — only
      //    the allow result was ever wanted.
      const key = await binding.objectFor(artifactId);
      // 4. Binding absence is opaque, and indistinguishable from denial above.
      if (key === null) return { ok: false };

      // 5. The lifetime is server-controlled: no caller supplies or influences
      //    it. The port independently refuses anything beyond the ceiling, so
      //    this computation cannot widen the bound even if it were wrong.
      const expiresAt = new Date(clock().getTime() + MAX_OBJECT_AUTHORIZATION_SECONDS * 1000);

      // 6-7. An ephemeral derivative capability: not an authoritative record,
      //      not a Key grant, not a Graph edge, not a URL, and not refreshable
      //      once the underlying authority is lost.
      return { ok: true, value: await storage.authorizeDownload(key, expiresAt) };
    },
  };
}
