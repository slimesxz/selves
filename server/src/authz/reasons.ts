// The Phase-5 authorization outcome taxonomy, the public error mapper, and the
// decision sink. These are INTERNAL classifications: a reason never appears in a
// public response (§13 non-leakage). The sink exists so tests can observe a
// decision through dependency injection; production wires the no-op sink, so no
// production code path emits, logs, or persists a decision marker (Gate 1 §12/§14).

// ── allow grounds, per operation (operation-scoped; no ground crosses ops) ────
// readArtifact: authorship, a settled placement addressed to the actor, or a
// valid Key to the exact resource. KEY_VALID is permitted for readArtifact ONLY.
export type ArtifactAllowGround = 'AUTHOR' | 'RECIPIENT_SETTLED' | 'KEY_VALID';
// readPlacement: authorship (any state) or a settled placement + explicit
// recipient row. No Key ground exists for placements.
export type PlacementAllowGround = 'AUTHOR' | 'RECIPIENT_SETTLED';
// listRecipientsOfAuthoredPlacement: the placement's author, compiled into the
// actor-scoped containment WHERE. Constitutive marker for the operation.
export type RecipientListAllowGround = 'AUTHOR_RECIPIENT_LIST';

// ── ordinary denials: a recognized predicate form whose state or exact-resource
// scope is not satisfied (Gate 1 §4, addendum §4). Distinct from UNSUPPORTED. ──
export type OrdinaryReason =
  // a recipient row exists but the placement has not settled
  | 'RECIPIENT_NOT_SETTLED'
  // a Key to the requested resource exists but is revoked
  | 'KEY_REVOKED'
  // the actor holds an active Key, but to a different resource than requested
  | 'KEY_WRONG_RESOURCE';

// The internal outcome of a single-resource decision. Never serialized to a
// caller; only mapped (all non-allow kinds collapse to one public response) and,
// under test, delivered to the sink.
export type Outcome<G extends string> =
  // present, and a ratified ground holds
  | { readonly kind: 'allow'; readonly ground: G }
  // present, a recognized predicate form evaluates to deny
  | { readonly kind: 'ordinary_deny'; readonly reason: OrdinaryReason }
  // a structurally valid relationship with no ratified authorization
  // significance for this resource type / operation (sibling, same-account,
  // co-recipient, prior interaction, a Key offered for a non-Key operation)
  | { readonly kind: 'unsupported' }
  // an impossible or contradictory authoritative state — fails closed with a
  // DISTINCT internal reason (Gate 1 §9); never normalized into a policy deny
  | { readonly kind: 'invariant_failure'; readonly detail: string }
  // no such row
  | { readonly kind: 'absent' };

/** True only for an allow. Every other kind denies. */
export function isAllow<G extends string>(o: Outcome<G>): o is { kind: 'allow'; ground: G } {
  return o.kind === 'allow';
}

// ── public mapping (§13): unauthorized-existing, nonexistent, unsupported, and
// externally fail-closed invariant conditions are indistinguishable. ──────────
export interface PublicError {
  readonly status: number;
  readonly body: { readonly error: string };
}

// A single-resource read that does not resolve to an allow maps here, uniformly.
export const NOT_FOUND: PublicError = { status: 404, body: { error: 'not_found' } };
// Mutation outcomes add two public shapes (decision 0006, ruling 7). CONFLICT is
// only ever returned to an AUTHORIZED actor (the author/sender) whose action hit a
// wrong state or lost a race — it never distinguishes existence for an outsider.
export const CONFLICT: PublicError = { status: 409, body: { error: 'conflict' } };
export const BAD_REQUEST: PublicError = { status: 400, body: { error: 'bad_request' } };

/** Map any denied single-resource read outcome to the uniform public response.
 *  The internal reason is deliberately not consulted — there is no existence
 *  oracle and no internal reason reaches the caller. */
export function mapDenied(): PublicError {
  return NOT_FOUND;
}

/** Map a domain mutation failure's SQLSTATE to the ratified split (ruling 7):
 *  404 unauthorized/absent, 409 authorized wrong-state/conflict, 400 malformed.
 *  The custom PT4xx codes are raised by the `domain.*` DEFINER functions;
 *  structural constraint violations (empty body, unknown recipient, guard/freeze
 *  backstops) surface as 23xxx and map to 400. An unrecognized code returns null
 *  so the caller fails closed with a generic 500 rather than guessing. As with
 *  reads, the public body is generic — the SQLSTATE only selects the status and
 *  never reaches the client. */
export function mapMutationError(sqlstate: string | undefined): PublicError | null {
  switch (sqlstate) {
    case 'PT404':
      return NOT_FOUND;
    case 'PT409':
    case '23505': // unique_violation — not reachable in P6 flows; a conflict if it were
      return CONFLICT;
    case 'PT400':
    case '23514': // check_violation (empty text body, bounded interval, guard/freeze)
    case '23503': // foreign_key_violation (unknown recipient / self)
    case '22P02': // invalid uuid text (route validates first; belt-and-braces)
      return BAD_REQUEST;
    default:
      return null;
  }
}

// ── decision sink (§12): observation via DI only. ─────────────────────────────
export interface DecisionSink {
  onDecision(operation: string, outcome: Outcome<string>): void;
}

/** Production sink: records nothing. The decision marker is observable only when
 *  a test injects a recording sink. */
export const NoopSink: DecisionSink = {
  onDecision(): void {
    /* production: emit nothing */
  },
};
