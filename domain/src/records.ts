// Authoritative record shapes — one interface per table in the Phase 3 schema.
// These describe rows as the domain sees them (camelCase, branded ids). They
// are the authoritative source of truth's shape; projections (Graph, Signal,
// Prism) are separate and arrive in Phase 9.

import type {
  AccountId,
  SelfId,
  ArtifactId,
  PlacementId,
  KeyGrantId,
  OutboxEventId,
} from './ids';
import type { ArtifactPayloadType } from './payload';
import type { PlacementState } from './placement';

// Max 3 Selves per account (AGENTS.md §3.1); the slot is an internal cap device.
export type SelfSlot = 1 | 2 | 3;

export interface Account {
  id: AccountId;
  createdAt: Date;
}

export interface Self {
  id: SelfId;
  accountId: AccountId;
  selfSlot: SelfSlot;
  name: string;
  createdAt: Date;
}

export interface Artifact {
  id: ArtifactId;
  authorSelfId: SelfId;
  payloadType: ArtifactPayloadType;
  textBody: string;
  createdAt: Date;
}

export interface Placement {
  id: PlacementId;
  senderSelfId: SelfId;
  // Null for a Key Placement, which carries a capability payload over a protected
  // resource rather than a content Artifact (decision 0007, R2). Non-null for the
  // text payload.
  artifactId: ArtifactId | null;
  // R4 read-shape fields (decision 0012 §35 ruling 1): descriptive mirrors of
  // existing columns, exposed only on a placement the actor may already read.
  payloadType: ArtifactPayloadType;
  // The exact protected Artifact of a Key Placement (0007 R2) — the R8 revoke
  // address (P10-M2). Null for the text payload.
  protectedResourceId: ArtifactId | null;
  state: PlacementState;
  createdAt: Date;
  departingAt: Date | null;
  settledAt: Date | null;
  cancelledAt: Date | null;
  // Three states (0012 §35 F3), so absence means exactly one thing:
  //   absent — the actor is not the author (recipient projection omits the key);
  //   null   — author, not yet departed (no snapshot exists);
  //   number — author, snapshotted at departure.
  departureIntervalSeconds?: number | null;
}

// Recipients are explicit rows — never a Ring or a Zone (AGENTS.md §3.7).
export interface PlacementRecipient {
  placementId: PlacementId;
  recipientSelfId: SelfId;
  addedAt: Date;
}

// A capability record, distinct from Artifact content. revokedAt null = active;
// there is no expiration (AGENTS.md §11 open question — nothing designed here).
export interface KeyGrant {
  id: KeyGrantId;
  grantorSelfId: SelfId;
  granteeSelfId: SelfId;
  protectedResourceId: ArtifactId;
  grantedAt: Date;
  revokedAt: Date | null;
}

// Transactional outbox row. Worker semantics arrive in Phase 9.
export interface OutboxEvent {
  id: OutboxEventId;
  eventType: string;
  payload: unknown;
  occurredAt: Date;
  processedAt: Date | null;
  attempts: number;
}
