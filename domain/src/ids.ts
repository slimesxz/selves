// Branded identifiers for the ontology. Branding keeps a SelfId from being
// passed where an ArtifactId is expected, even though both are uuid strings at
// runtime. Pure types — zero UI imports, zero runtime cost (AGENTS.md §8).

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type AccountId = Brand<string, 'AccountId'>;
export type SelfId = Brand<string, 'SelfId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type PlacementId = Brand<string, 'PlacementId'>;
export type KeyGrantId = Brand<string, 'KeyGrantId'>;

// outbox_events.id is a bigint; node-postgres returns bigint as a string to
// avoid precision loss, so this brands a string, not a number.
export type OutboxEventId = Brand<string, 'OutboxEventId'>;
