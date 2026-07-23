# 0005 — AuthorizationService (Phase 5)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** Playbook Phase 5 — AuthorizationService with PostgreSQL
- **Ruled by:** Liberty (recorded by Claude as engineer)
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law. Where
  this record conflicts with AGENTS.md, AGENTS.md wins. This record documents the
  Phase-5 authorization layer; it introduces no ontological object.
- **Builds on:** [0001](./0001-repo-boundary.md), [0002](./0002-migration-foundation.md),
  [0003](./0003-domain-schema.md), [0004](./0004-auth-active-self.md)

---

## Governing ruling

The TypeScript **AuthorizationService** is the sole application-level authorization
decision point for every authorization-sensitive domain read in Phase 5. Phase 8
adds PostgreSQL row-level security as defense in depth, **mirroring** these
predicates rather than replacing or redefining them. Ground: collapsing service
and database enforcement would make a failed authorization unattributable between
contract and policy and would force two enforcement systems to stabilize at once.
The service layer is implemented and proven adversarially first; RLS mirrors it
later.

## Scope — read authorization only

Five implemented operations: `readArtifact`, `listOwnedArtifacts`, `readPlacement`,
`listReadablePlacements`, `listRecipientsOfAuthoredPlacement`. Every mutating
operation (create Self/Artifact/Placement, add/remove recipients, depart/settle/
cancel, any Key lifecycle) is **deferred**: no predicate, interface, placeholder,
operation enum, or policy hook is built for it. Absence of policy is the policy.
The Phase-4 Self switcher (`GET /auth/selves`) remains entirely Phase-4-governed
and is neither wrapped nor re-scoped.

## Ratified predicates (Gate 1 rulings)

- **Artifact visibility** = authorship ∪ (an explicit recipient row on a **settled**
  placement carrying it) ∪ a **valid Key** to the exact resource (Rulings 1, 2, 3,
  5). Each placement is an independent ground; an author may read its own artifact
  whether or not it was ever placed.
- **Key semantics (Ruling 3, narrow).** The `key_grants` schema has no operation
  column, so Phase 5 ratifies exactly one implicit Key operation:
  `readArtifact(protected_resource_id)` for the grantee while the grant is
  unrevoked. A Key grants no placement visibility, no recipient-row visibility, no
  mutation, no listing, and no other operation. No operation column, enum,
  registry, capability interface, or policy seam is added.
- **Placement visibility.** `sender_self_id = actingSelf` permits author read in
  every Phase-3 state; a recipient may read only when `state = 'settled'` and an
  explicit `placement_recipients` row names the actor. No same-account, sibling,
  prior-interaction, Graph, Ring, inferred, or Key branch exists. The exact Phase-3
  state set is `('draft','departing','settled','cancelled')`
  (migration `1784738615465_enums-and-identity.sql`).
- **Recipient rows (Ruling / §8, clarified).** The author of a placement may list
  its complete authoritative recipient set. A recipient has **no** row-read surface
  — not even for its own row. Denial for the recipient list manifests as an empty
  containment result: every non-author class (recipient, co-recipient,
  non-recipient, sibling) and a nonexistent placement receive an empty array,
  indistinguishably. There is no `OWN_RECIPIENT_ROW` allow.
- **Liveness (Ruling 4).** Visibility is re-evaluated from current authoritative
  facts on every request; no residual entitlement survives after all ratified
  grounds cease. Under Phase-3 settlement rules a settled placement is
  irreversible, so this introduces no unavailability mechanism.

## Ratified design (Gate 2)

- **Decision-and-read linearization.** Each single-resource read runs a Stage-1
  predicate-input read, a Stage-2 pure decision, and — only on allow — a Stage-3
  protected read, all on **one** request-local `REPEATABLE READ` transaction and
  snapshot on a single connection. No allow object or reusable boolean leaves the
  service. A revocation/transition committed before the snapshot is observed; one
  committing after need not retroactively invalidate the in-flight read; the next
  request (new snapshot) observes it. List operations compile authorization into
  actor-scoped containment SQL and return only authorized rows — no cross-Self
  superset is filtered in memory.
- **Operation-scoped reason taxonomy.** Allow grounds: `AUTHOR`,
  `RECIPIENT_SETTLED`, `KEY_VALID` (readArtifact only), `AUTHOR_RECIPIENT_LIST`
  (the recipient list's constitutive marker). Ordinary denials:
  `RECIPIENT_NOT_SETTLED`, `KEY_REVOKED`, **`KEY_WRONG_RESOURCE`**. Plus
  `unsupported` (a structurally valid relationship with no ratified significance —
  sibling, same-account, co-recipient, prior interaction, a Key offered for a
  non-Key operation), `invariant_failure` (a distinct internal reason for
  impossible/contradictory state), and `absent`.
- **KEY_WRONG_RESOURCE correction (Gate 2 ruling).** A Key held for a different
  artifact than requested is an **ordinary** supported-predicate denial, not
  `unsupported`. The Stage-1 Key query is actor-scoped (grantee only) and computes
  `has_active_for_target`, `has_revoked_for_target`, and `has_active_elsewhere`;
  the decision emits `KEY_WRONG_RESOURCE` after `KEY_REVOKED` and before
  `unsupported`.
- **Non-leakage.** Every denied single-resource read — unauthorized-existing,
  nonexistent, unsupported, or externally fail-closed invariant — maps to the
  identical public `404 {"error":"not_found"}`. No internal reason reaches a
  response. Identical wall-clock timing is not claimed (deferred limitation).

## Enforcement mechanisms

- **Mechanical bypass boundary.** A build-blocking test uses the TypeScript
  compiler API (no new dependency) to parse every `src/` module and forbid value
  imports of `pg`, the raw pool (`appPool`/`appTxPool`), the internal authz repos,
  or any `test/` path outside exact file-specific allowlists; type-only edges are
  exempt. Handlers reach protected data only through the AuthorizationService.
  Recorded limitation: this is application-layer containment until Phase 8 RLS.
- **No cross-request memoization.** A static scan of `src/authz/**` rejects any
  module-scope cache or memoize helper (Gate 1 §2), backed by behavioral freshness
  tests.
- **Exact privileges.** `selves_app` receives column-scoped `SELECT` on
  `artifacts`, `placements`, `placement_recipients` (all columns — predicate inputs
  and protected reads), and `key_grants` (**strict subset**: `grantee_self_id`,
  `protected_resource_id`, `revoked_at`; `id`, `grantor_self_id`, `granted_at`
  withheld). A privilege-only migration; the catalog ACL is asserted exactly, and
  reads of the withheld `key_grants` columns fail with `42501`.
- **Read-ordering instrumentation** is injected purely by tests (recording
  decorators + a ledger sink); production composes the plain repos and `NoopSink`,
  so no production path emits, logs, or persists a decision marker. No new
  audit-log subsystem is added; `invariant_failure` is test-visible and, absent a
  Phase-5 production domain route, has no production emission beyond the uniform
  response.
- **Test-only external adapter.** External non-leakage is proven through an HTTP
  adapter mounted only from the test composition root; it exposes no domain
  mutation and is absent from the production import graph, route inventory, and
  build.

## Limitations recorded

Application-layer containment until Phase 8 RLS; wall-clock timing not equalized;
no Key lifecycle (Phase 7); runtime pinned to Node 24.18.0 (0004). Phase-3 database
constraints remain the sole authority for structural invariants; the service
describes the same rules and never duplicates or weakens them.

## Commits

`P5-A` module & mechanical boundary · `P5-B` predicate repositories & exact
privileges · `P5-C` decision contracts & protected operations · `P5-D`
adversarial/freshness/ordering/non-leakage tests · `P5-E` this record.
