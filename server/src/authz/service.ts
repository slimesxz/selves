// The AuthorizationService — the sole application-level authorization decision
// point for Phase-5 domain reads (Gate 1 §1, invariant 1). Handlers import ONLY
// this surface; the predicate and domain repositories are internal and reachable
// only through here, so no protected read can be issued around a decision.
//
// This file declares the public contract. The factory (createAuthorizationService)
// and the pure decision functions arrive in P5-C.
import type { Artifact, Placement, PlacementRecipient } from '../domain/records.ts';
import type { SelfId } from '../domain/ids.ts';

// The acting Self reaches the service ONLY through the verified Phase-4 context
// (req.actingSelf). The service never re-derives identity and never trusts an
// acting Self from a body, query, route, client claim, or repository result
// (Gate 1 invariant 3).
export interface ActingContext {
  readonly actingSelf: SelfId;
}

// A single-resource read result. On deny, the caller receives an opaque
// { ok: false } — no reason, no existence signal. The public mapper turns it
// into the uniform 404 (§13). There is no reusable allow: the value is the
// protected record itself, produced within the decision's own transaction, and
// nothing authorization-bearing outlives the call (invariant 2, Gate 1 §3).
export type Visible<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export interface AuthorizationService {
  readArtifact(ctx: ActingContext, artifactId: string): Promise<Visible<Artifact>>;
  listOwnedArtifacts(ctx: ActingContext): Promise<Artifact[]>;
  readPlacement(ctx: ActingContext, placementId: string): Promise<Visible<Placement>>;
  listReadablePlacements(ctx: ActingContext): Promise<Placement[]>;
  listRecipientsOfAuthoredPlacement(
    ctx: ActingContext,
    placementId: string,
  ): Promise<PlacementRecipient[]>;
}
