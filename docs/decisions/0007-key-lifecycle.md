# 0007 — Key capability lifecycle (Phase 7)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Phase:** Playbook Phase 7 — Key capability lifecycle
- **Ruled by:** Liberty (recorded by Claude as engineer)
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law. Where
  this record conflicts with AGENTS.md, AGENTS.md wins. This record documents the
  Key lifecycle; it introduces **no** ontological object. The ontology remains
  exactly Self → Signal → Artifact → Placement → Graph. A Key is a **capability
  payload carried by a Placement**, never a new object and never an Artifact.
- **Builds on:** [0001](./0001-repo-boundary.md), [0002](./0002-migration-foundation.md),
  [0003](./0003-domain-schema.md), [0004](./0004-auth-active-self.md),
  [0005](./0005-authorization-service.md), [0006](./0006-artifact-placement-apis.md)

---

## Charter amendment (committed with this record, P7-A)

AGENTS.md §5 receives, **verbatim**, the governing sentence and its two
corollaries, ahead of any schema or implementation commit (constitution precedes
code):

1. **"Settlement of the transmission is irreversible; revocation of the
   capability is prospective."**
2. Cancellation of a Key Placement before settlement means the capability never
   existed; it is not revocation.
3. A Key Placement never contributes to recipient-ground artifact access; the
   sole revocable read path is the capability register.

The stale CLAUDE.md authorization line ("Currently authorized: nothing") is
corrected in the same commit to reflect P1–P6 complete and P7 authorized through
P7-E.

## Ontological ruling (Q1 — Alt A, clarified)

**Key issuance is a Placement.** A Key is a capability payload, not an Artifact
and not content; carrying a Key as a Placement payload does not permit
representing it as an Artifact — the `artifacts` CHECK exclusion of `key` stands.
A Key Placement uses the ordinary `Draft → Departing → Settled` lifecycle. **No
authorization exists while Draft or Departing.** Settlement establishes the
authoritative grant binding `(granting Self, grantee Self, exact protected
Artifact)`. The settled Placement is immutable historical fact; revocation does
not reverse, cancel, or mutate settlement — it prospectively terminates the
capability's authorization effect. `key_grants` remains the authoritative
capability register produced by settlement; it is **not** a second transmission
object. Alt B (subtype) and Alt C (distinct register) are rejected.

**Authorization distinction (preserved):** *Authorship permits issuance;
recorded grantorship permits revocation.* Issuance authority is the acting Self's
authorship of the exact protected Artifact (checked at draft creation);
revocation authority binds to the grant row's **recorded grantor**, never a
dynamic re-check of current authorship.

## Governing rulings (R2–R19, condensed)

- **R2 Placement representation.** `placements` gains an explicit payload
  discriminator; a Key Placement has `artifact_id = NULL` and a separate
  `protected_resource_id` referencing the exact Artifact. Mutually exclusive,
  payload-correct shapes are schema-enforced. `payload_type` (and the
  artifact/protected pointers) are immutable from draft creation. No Key Artifact.
- **R3 Ground isolation (hard structural invariant).** A Key Placement must
  **never** establish `RECIPIENT_SETTLED` to its protected Artifact. The only
  settlement effect is the active `key_grants` fact, i.e. `KEY_VALID`. This is a
  property of the R2 shape (a Key Placement's `artifact_id` is NULL, so the
  Phase-5 recipient predicate cannot match it) — **not** a behavioral patch. The
  Phase-5 predicate implementation is unchanged.
- **R4 Grantor authority — author only.** The sender of a Key Placement must
  author the exact `protected_resource_id`. Non-author/absent resource →
  non-leaking 404. No transfer, delegation, or re-grant by a holder.
- **R5 Grantee cardinality (final).** A Key Placement has exactly one recipient.
  Multiple grantees require multiple Key Placements. Settlement never partially
  succeeds across a recipient set. A Key-payload narrowing of Phase-6 recipient
  law, not a repeal.
- **R6 Grantee eligibility.** A sibling Self may be the grantee (authority only
  from the settled grant, never sibling status). The sending Self may not be its
  own Key recipient — rejected during composition (400), not left to the DB
  CHECK at settlement.
- **R7 Revocation authority + addendum.** Only the recorded grantor may revoke;
  revocation is idempotent; a revoked grant is terminal. `revoke_key` is
  addressed by `(grantee Self, protected resource)` under the verified acting
  grantor; `key_grants.id` is never exposed. Lookup: locate the active row for
  `(grantor=acting, grantee, resource)`; if active, revoke exactly it; else if a
  revoked historical row for that grantor/grantee/resource exists, return
  idempotent success mutating nothing; else 404. Active lookup precedes
  historical-idempotency lookup so revoked history never shadows a later active
  re-grant.
- **R8 Capability state.** Keep nullable `revoked_at` (active iff `revoked_at IS
  NULL`); no `grant_status`. Placement state and capability state are orthogonal.
- **R9 Re-grant.** Only through a new Key Placement producing a new grant row; a
  revoked grant is never reactivated.
- **R10 Settlement collision.** Settlement and its `key_grants` insert are one
  atomic transaction. If the active-grant unique index refuses the insert
  (`23505`), the whole transaction rolls back, the Placement stays `departing`,
  and the authorized sender receives 409. No `settlement_refused` state. If the
  earlier conflicting grant was revoked before this Placement settles, settlement
  is a legitimate new grant.
- **R11 Compromise.** The complete Phase-7 response is prospective revocation.
  No Key secret, rotation, containment, expiry, or credential-lifecycle behavior;
  Phase-4 credential semantics remain categorically fenced.
- **R12 Visibility.** Ordinary Placement visibility applies to the Key Placement
  itself (sender/settled-recipient rules), conferring no additional Artifact
  authorization. A general `listKeyGrants` register operation is **deferred**;
  `selves_app` column privileges are **not** widened for a listing surface.
- **R13 Error/non-leakage.** Unchanged split — 404 unauthorized/absent/foreign,
  409 authorized state conflict (incl. settlement collision), 400
  malformed/structural, 403 upstream identity-context failure. Self-recipient
  rejection uses 400.
- **R14 Mechanical boundary.** Reuse `authz/mutations.repo.ts`; no `keys.repo.ts`;
  no import-graph allowlist expansion. Grant creation is inside the Key-aware
  `settle_placement`; `revoke_key` is the one new standalone mutation. All writes
  stay behind the SECURITY DEFINER boundary.
- **R15 "Protected" Artifact.** No stored `protected`/Vault boolean. Any Artifact
  authored by the granting Self may be a protected resource; "protected" is a
  role in an explicit capability relation, not a stored property.
- **R16 Register consistency.** Q9 is closed by Q1: Key transmission occurs
  through an ordinary Placement and satisfies the addressed-transmission /
  composer-payload law. `key_grants` records the settled capability; it is not a
  second transmission register.
- **R17 Phase 8/9 readiness.** The authorization ground is the explicit unrevoked
  `(grantor Self, grantee Self, protected Artifact)` relation, so Phase-8 RLS can
  mirror it without reinterpretation. Settlement + grant creation are atomic so
  Phase-9's outbox write attaches to the same transaction with no redesign. No
  RLS or outbox work is done now.
- **R18 Constitutional floor.** No inferred grants, derived Rings, notifications,
  feeds, delegation, transfer, expiration, reuse limits, rotation, gifting,
  marketplace/value mechanics, or any Key effect beyond `readArtifact` of the
  exact protected Artifact.

## Payload-vocabulary reconciliation

The physical `payload_type` enum already declares the frozen composer vocabulary
(`text, photo, poll, gift, key`) and is reused unchanged for `placements`. No
narrowed `text|key` enum is created. The Phase-7 implemented subset is enforced
by a per-table CHECK (`payload_type IN ('text','key')`), exactly as
`artifacts_text_only` restricts artifacts; `photo`, `poll`, and `gift` remain
declared but not implemented. Schema vocabulary ≡ composer vocabulary ≡
constitutional §3.9 enum.

## Procedural supersession (waiver, recorded)

The reconciled implementation contract returned after Gate 1 is ratified as the
Gate-2 final design. The separately-scheduled Gate-2 design-packet step is
**waived as redundant for Phase 7** because the reconciled contract already
specifies the ruled schema delta, mutation surfaces, transaction semantics,
authorization predicates, error mapping, privilege delta, and proof obligations.
This waiver is deliberate and recorded here; **it does not alter the two-gate
discipline for future phases.**

## Operation inventory

- **New DEFINER functions (`domain`):** `create_key_placement_draft`,
  `revoke_key`.
- **Key-aware `CREATE OR REPLACE` (behaviour additive; text path unchanged):**
  `add_recipient` (self-as-Key-recipient → PT400; second Key recipient → PT409),
  `begin_departure` (Key requires exactly one recipient; text keeps ≥1),
  `settle_placement` (for a Key Placement, writes the `key_grants` row in the
  same transaction).
- **Schema:** `placements.payload_type` (default `'text'`, so the existing
  `create_placement_draft` is byte-identical), `placements.protected_resource_id`,
  `artifact_id` nullable, the shape + slice CHECKs, and an additive immutability
  guard in `guard_placement_mutation`.
- **Read effect (already ratified Phase 5, unchanged):** `readArtifact` via an
  active `KEY_VALID` grant. `predicates.repo.ts` is byte-identical to 716c95d.
- **Deferred:** `list_key_grants` / any capability-register listing/management
  surface.

## Privilege delta

No new column grant is required or added: the Phase-5 read repos select only
already-granted `placements` columns, and the DEFINER functions run as
`selves_owner`. `selves_app` gains only `EXECUTE` on the two new functions
(`REVOKE … FROM PUBLIC` first). `key_grants` privileges are untouched — no direct
DML, and `id` / `grantor_self_id` / `granted_at` remain withheld (42501).

## Proof obligations (frozen audit points, proven in P7-E)

1. Constitution precedes code (P7-A lands before schema/impl).
2. Settlement atomicity proven at the DB boundary via fault injection (a
   capability-insert refusal after the state transition persists neither).
3. R3 is structural: a settled Key Placement's grantee has no `RECIPIENT_SETTLED`
   path; the sole revocable read path is `KEY_VALID`; `predicates.repo.ts` is
   byte-identical to 716c95d.
4. No `key_grants` privilege widening (42501 probes for `id`, `grantor_self_id`,
   `granted_at`).
5. Revocation lookup correctness: active-over-history targeting; idempotent
   no-op with matching revoked history; foreign actor → 404 (never idempotent
   success); recorded grantorship never substituted by current authorship; no
   capability-row id exposed.

## Commits

`P7-A` charter amendment + CLAUDE.md correction + this record · `P7-B` migration
(placement key-payload shape, immutability, slice CHECK) · `P7-C` Key mutations
(`create_key_placement_draft`, key-aware `add_recipient`/`begin_departure`/
`settle_placement`, `revoke_key`) + service/repo surface · `P7-D` test-adapter
routes · `P7-E` Phase-7 test suite + full regression.
