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
  state: PlacementState;
  createdAt: Date;
  departingAt: Date | null;
  settledAt: Date | null;
  cancelledAt: Date | null;
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
