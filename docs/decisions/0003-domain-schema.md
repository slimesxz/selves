# 0003 — Authoritative domain schema

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** Playbook Phase 3 — Authoritative domain schema
- **Ruled by:** Liberty (recorded by Claude as architect)
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law.
  Where this record conflicts with AGENTS.md, AGENTS.md wins. This record
  documents the schema for the vertical slice; it does not amend the
  constitution.
- **Builds on:** [0001 — Repository & boundary](./0001-repo-boundary.md),
  [0002 — Migration foundation](./0002-migration-foundation.md)

---

## Context

Phase 3 designs the minimal authoritative schema for the required vertical
slice — the first source of truth from which Signals, the Graph, and the Prism
are later derived. The design was presented in full and ruled on before any
migration was written. Four decisions were put to Liberty; all four were ruled,
one with an amendment.

## Ruled decisions

### D1 — Settlement cancellation modeling: **Option A (terminal state)**

`cancelled` is a **fourth, terminal placement state**, reached **only from
`departing`**, and stamped with `cancelled_at`. The primary ratified sequence
(AGENTS.md §5) is unchanged:

```
draft → departing → settled
                 ↘  cancelled     (terminal; reachable only from departing)
```

Rationale: a single `state` column tells the whole lifecycle unambiguously, and
the cancel-vs-settle outcome becomes a pure mutual exclusion of terminal states
— which the Phase 6 "cancel racing settlement" guarantee depends on. Cancelled
placements are auditable historical facts (the row persists), satisfying the
Playbook's "auditable historical outcome" requirement.

### D2 — Domain types location: **server-local, no workspaces conversion**

Phase 3 domain types live in `server/src/domain/`. The 0001 workspaces trigger
(sharing `domain/` between **client and server**) is not reached in Phase 3 —
only the server consumes the types this phase — so the npm-workspaces conversion
stays deferred and `client/` is untouched. The types migrate to a shared
`domain/` package when the client first imports them (expected Phase 10).

### D3 — Dependencies: **typescript, vitest, @types/node (server dev deps only)**

Added to the standalone `server/` package as dev dependencies, exactly as
approved. No runtime dependencies added. Both fall inside the stack already
ratified in 0001 (TypeScript API; Vitest as test runner). Known dev-only
transitive advisories (esbuild dev-server CVE via vitest; glob CLI injection via
node-pg-migrate) are **not** auto-fixed: `npm audit fix --force` would force a
breaking major bump of the ratified `node-pg-migrate`/`vitest`, and neither
vulnerable surface (an exposed vite dev server; the glob CLI) is exercised here.

### D4 — Schema: **approved, with one amendment**

The full schema (below) was approved with the following amendment and notes:

- **Amendment — recipient immutability fires from `departing`, not `settled`.**
  After Send, the recipient set is frozen; the only permitted act is full
  cancellation. Recipients may be added or removed **only while `draft`**. This
  is stricter than the originally-presented "frozen at settlement" and is the
  ratified behavior.
- **The partial unique index on active key grants is declared explicitly** in
  the migration (`key_grants_one_active`), not left implicit.
- **The key-payload/artifact relationship is recorded OPEN** (see below).

## Additionally ratified during implementation

These constraints were added while writing the migrations and are ratified as
part of the accepted schema:

- **`key_grants_no_self_grant`** — a Self cannot grant a Key to itself
  (`grantor_self_id <> grantee_self_id`). (Explicitly ruled ratified by Liberty.)
- **`key_grants_revoke_after_grant`** — `revoked_at`, when set, is `>= granted_at`.
- **Draft-only deletion** — a placement is deletable only while `draft`; once it
  has left draft it is an auditable fact and cannot be deleted. This follows
  directly from the D4 amendment (it guarantees the recipient `ON DELETE CASCADE`
  can only ever originate from a draft parent).
- **Presence/non-empty checks** — `selves.name`, `artifacts.text_body`, and
  `outbox_events.event_type` are non-empty; `outbox_events.attempts >= 0`.

## The schema

Seven authoritative tables. Projection tables are deferred (see below).

```
accounts ─1──≤3─ selves ─┬─authors→ artifacts ←protected_resource─ key_grants
                         │                         (grantor, grantee → selves)
                         ├─sender→  placements ─1──N─ placement_recipients
                         └─recipient─────────────────────┘
                                                   outbox_events (append-only)
```

### Invariant → enforcement (constraint/trigger, never a comment)

| # | Invariant | Enforcement |
|---|---|---|
| 1 | A Self belongs to one account | `selves.account_id NOT NULL` FK |
| 2 | Max 3 Selves per account, authoritative | `self_slot` CHECK (1..3) + `UNIQUE(account_id, self_slot)` |
| 3 | One sender Self per Placement | single `sender_self_id NOT NULL` FK |
| 4 | Recipients explicit, never Ring/Zone | `placement_recipients` table; no ring/zone column exists |
| 5 | Settled/cancelled history not silently rewritten | `trg_guard_placement_mutation` (terminal states immutable; non-draft non-deletable) + state/timestamp CHECK |
| 6 | Recipient history frozen from departing | `trg_freeze_recipients` (mutations allowed only while parent is `draft`) |
| 7 | Key grant carries grantor/grantee/resource/grant time/revoke time | five explicit columns; `revoked_at` nullable = active |
| 8 | No Key expiration | no expiry column exists (asserted by a schema test) |
| 9 | Graph edges derived from settled facts only | projection deferred to Phase 9; no edge table yet |
| 10 | No stored/user-selected Ring | whole-schema grep clean (asserted by a schema test) |
| 11 | Payload membership frozen | `payload_type` enum = the five; `artifacts` CHECK = 'text' (slice) |
| 12 | Artifact data vs capability distinguishable | separate `artifacts` / `key_grants`; `key` excluded from artifacts |
| 13 | Indexes from actual query paths only | indexes only on the enumerated slice query paths; outbox poll index deferred to Phase 9 |

Triggers are used only where a declarative CHECK cannot express the invariant
(OLD/NEW comparison; cross-row parent-state lookup). A trigger that RAISEs is an
enforcement mechanism, not a comment.

### State/label mapping

`placement_state` labels are lowercase by SQL convention and map 1:1 to
AGENTS.md §5's `Draft / Departing / Settled / Cancelled`.

## Deferred (not built in Phase 3)

- **Projection tables** `graph_edges`, `signals`, `prism_reflections` — there is
  no worker to populate them and no derivation is ruled; they are built in
  Phase 9 from settled facts. Building them now would be speculative.
- **Forward-transition orchestration** (draft→departing→settled/cancelled) and
  **cancel-vs-settle locking** — Phase 6. Phase 3 owns terminal immutability and
  state/timestamp coherence only.
- **Object storage** for photo/binary artifacts — Phase 12.
- **Outbox worker semantics** (retry/backoff/dead-letter, unprocessed-poll
  index) — Phase 9.

## Open question recorded (NOT ratified)

- **Key payload vs Artifact.** The frozen enum lists `key` as a payload type,
  but a Key is modeled here as a **capability** (`key_grants`), never an
  Artifact row; `artifacts.payload_type` is CHECK-restricted to exclude `key`.
  How a `key` payload relates to placement — whether placing a Key is a
  Placement, a capability grant, or both — is **not ruled**. The conservative
  stance (key is a capability, never content) holds until a ruling. Nothing is
  designed for the unresolved interpretations. This joins the register with the
  existing quarantined items (key expiration, poll visibility, presence, etc.),
  which remain untouched.

## Verification

- Migrations run from zero on `selves_dev` (up → down×5 → re-up) and on the
  isolated `selves_test`.
- 27 Vitest integration tests pass against real Postgres; global setup proves
  migrate-from-zero on every run.
- `tsc --noEmit` clean (server domain types + tests).
- Client build re-verified: `tsc --noEmit` exit 0 and `vite build` success.
  `client/` unchanged this phase.

## Commits

`P3-A` tooling · `P3-B` migrations · `P3-C` domain types · `P3-D` tests ·
`P3-E` this record.
