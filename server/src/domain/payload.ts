// Payload type is a closed enum (AGENTS.md §3.9, §4). Frozen membership; never
// extended without a ruling. Mirrors the Postgres `payload_type` enum.
export const PAYLOAD_TYPES = ['text', 'photo', 'poll', 'gift', 'key'] as const;
export type PayloadType = (typeof PAYLOAD_TYPES)[number];

// Artifacts carry content, and the vertical slice implements only 'text'. A
// Key is a capability, never an Artifact row, so it is not an artifact payload.
// This mirrors the artifacts.payload_type CHECK (= 'text').
export type ArtifactPayloadType = 'text';
