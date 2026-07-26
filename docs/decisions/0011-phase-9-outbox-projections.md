# 0011 — Phase 9: Transactional outbox and projections (Gate 1 + Gate 2 rulings)

- **Status:** Ratified. Implementation authorized at Gate 2.
- **Date:** 2026-07-25
- **Phase:** Playbook Phase 9 — Transactional outbox and projection worker
- **Ruled by:** Liberty (chamber); recorded by Claude as engineer
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law. Where
  this record conflicts with AGENTS.md, AGENTS.md wins. This record introduces
  **no** ontological object. The ontology remains exactly Self → Signal →
  Artifact → Placement → Graph.
- **Builds on:** [0003](./0003-domain-schema.md) (outbox table, projection
  deferral), [0006](./0006-artifact-placement-apis.md) (settlement mechanics,
  Phase-9 attachment point), [0007](./0007-key-lifecycle.md) (N2, atomic
  settlement+grant), [0008](./0008-row-level-security.md) /
  [0009](./0009-phase-8-r4-ratification-c3-adopted.md) /
  [0010](./0010-phase-8-closure.md) (RLS posture, C3, worker reservation,
  standing DEFINER-authority rule).
- **Procedural baseline at ruling:** `f9f23dbb72d28cc4591194ee209d5e4b927f5d71`,
  network-verified against origin/master; 321 tests across 43 files green and
  unchanged.

Gate 1 packet accepted as satisfying the charter. A fact correction was accepted
and recorded by the chamber: **`selves_worker` has existed as a CONNECT-only
LOGIN principal since P4-A**; Phase 9 rules on the first broadening of an
existing principal, exactly as 0008 R6 reserved — not on a new principal.

---

## 1. GATE 1 RULINGS (Q1–Q13)

### Q1 — Reading A ratified: the outbox record is infrastructure beneath the ontology

Not the persisted Signal. Ground: the constitutional test "transactions are not
places" — the outbox is a transaction log; `processed_at`, `attempts`,
`failed_at`, and `last_error` are delivery machinery, and binding the frozen
ontology to worker bookkeeping is precisely the accretion the ontology tests
exist to prevent.

Recorded consequences, binding:

- The table remains `public.outbox_events`. No name in this phase — table,
  column, function, type, or variable — uses "signal."
- Event durability is operational, not constitutional. A future pruning ruling
  remains available.
- The ontological Signal remains unmaterialized vocabulary. The playbook's
  "Signal projection boundary" obligation is **not** discharged by this ruling;
  it stays open and is quarantined alongside the other open questions. No stub,
  no interface, no table for it.

### Q2 — Key Placement settlement emits nothing in Phase 9

Option (c) (uniform emission with worker-side exclusion) is **prohibited**:
charter law 4 forbids materializing a Key Placement as an ordinary event, and
worker-side exclusion materializes it first and ignores it second. Non-emission
is structural.

**Binding implementation constraint:** the emission predicate inside
`domain.settle_placement` is a **positive enumeration** of ratified emitting
payload types, not a negative exclusion of Key. Default-deny. A payload type
added in a later phase emits nothing until a ruling adds it to the enumeration.

### Q3 — No revocation event

No consumer exists; `key_grants.revoked_at` is the durable record. If a later
phase needs one, it arrives together with its consumer, under its own ruling.

### Q4 — Graph mirror: author-side only

An edge exists for the sending Self's mirror. Ground: the Graph is a mirror of
self-knowledge accumulated through the account's own placement behavior. A
recipient-side edge materializes another Self's activity into my mirror, which
is the first row of a social topology surface. Not built, not reserved for.

### Q5 — Existence only

No counts, no first/last timestamps, no recency, no column reserved for any of
them. Ground: counts are the input the quarantined ring-threshold math consumes;
recency is the raw material of Presence. Holding both out keeps the quarantine
mechanical rather than remembered. When the Prism eventually needs
quieting/alive correspondences, that arrives as its own ruling with its own
consumer — not as columns built on spec.

### Q6 — Never cross-account; never cross-sibling

In Phase 9 the posture is stricter than the semantics: zero grants, RLS-enabled,
no policy — no login role reads `proj.graph_edges` at all. The semantic ruling
is recorded now so Phase 10 inherits it rather than re-litigating it: when a
read surface arrives, a graph row is visible only to the account owning the Self
it describes, and only through that Self's own acting context. An edge of Self A
is not readable while acting as sibling Self B.

### Q7 — No provenance

No contributing placement ids. Rebuild from authoritative records makes
provenance redundant, and provenance is the first step toward the projection
being consulted as a record rather than a mirror.

### Q8 — No API read surface for any projection in Phase 9

The Graph read API arrives with Phase 10 under its own ruling.

### Q9 — `proj` schema ratified

New `selves_owner`-owned schema for projection tables and worker functions.
`auth` stays fixed at its ruled DEFINER inventory; `domain` stays purely the
ontology-mutation surface. Schema separation matches the authority hierarchy and
keeps the privilege matrix legible.

### Q10 — Separate worker process ratified; chamber-authorized lock delta

The worker runs as its own process connecting as `selves_worker`. The in-server
loop is rejected: it places `WORKER_DATABASE_URL` in the application process's
memory, so an app-process compromise yields both credentials, defeating the role
separation Phase 4 established and Phase 8 proved. Avoiding a one-entry lock
delta does not justify collapsing a credential boundary.

**Lock delta — chamber-authorized, exactly one entry:**

- The pg-importer positive lock grows from `['db.ts','operator/cli.ts']` to
  include exactly one new entry: the worker's own database module
  (`src/worker/db.ts`), following the existing precedent of `operator/cli.ts` —
  a non-server principal with its own db module and its own credential.
- `RAW_POOL_VALUE_ALLOW` remains **exactly** `['server.ts']`. Unchanged. The
  worker never value-imports the application pool.
- No other existing lock grows. If implementation finds any other lock must
  expand: stop and report, do not expand.
- New negative locks: no module under the worker tree may value-import `db.ts`
  or any `src/authz/**` module; `src/authz/**` may not import projection modules
  even type-only.
- The worker db module reads `WORKER_DATABASE_URL` only; asserted by test that
  it cannot resolve the application credential.

Mechanical consequence, recorded openly: the positive-lock exact-equality
assertion lives in the P5-A test `test/authz-import-graph.test.ts`; encoding the
chamber's expansion amends that baseline file. This is the chamber's own
expansion, not a builder amendment, and it is the **sole** baseline test change
in this phase.

### Q11 — Outbox delta ratified with amendment

`last_error` and the Phase-3-deferred unprocessed partial index are approved.
The column set is further amended by §2.3 (`failed_at`). The partial index
predicate must match the amended claim predicate exactly.

### Q12 — `proj.rebuild_graph()` is owner-only

Granted to no login role; invoked by `selves_migrate SET ROLE` as a deliberate
operator action. Ground: once §2.1 strips its queue side-effect, rebuild is a
recovery action rather than a steady-state one, and it TRUNCATEs. A destructive
truncation belongs outside every network-reachable credential. Tests invoke it
as owner, which is sufficient to discharge the exit condition. If a later phase
needs automated rebuild, it returns as its own ruling.

**`selves_worker`'s EXECUTE surface is therefore exactly:
`proj.process_outbox(integer)` and `proj.outbox_depth()`. Nothing else.**

### Q13 — `'placement_settled'` is the sole event type

The 0003 `event_type` free-text deferral is closed. Adding a type requires a
ruling; the Q2 positive enumeration enforces this mechanically.

### Containment ratified (affirmed as ruled law)

Worker functions return scalars only. No row, payload, recipient identity, Self
id, or artifact content crosses the function boundary into the worker process.
Cross-account computation lives entirely inside `selves_owner`-owned function
bodies. `selves_worker` is and remains `NOBYPASSRLS`, holds zero table
privileges in every schema, holds no EXECUTE on `domain.*` or `auth.*`, and
cannot establish acting-Self context.

---

## 2. GATE 1 AMENDMENTS (B.1–B.5)

### 2.1 (B.1) — Rebuild does not touch delivery state

`proj.rebuild_graph()` TRUNCATEs and deterministically recomputes
`proj.graph_edges` from authoritative records. It reads, writes, and clears
**no** column of `public.outbox_events`.

Ground — recorded because it generalizes past the graph: with one projection,
marking events processed during rebuild is harmless. With two, a rebuild of
projection A declares delivered the events projection B has not applied. That is
silent data loss written into the semantics before the second projection exists.
**Rebuild state and delivery state are different facts and must never be written
by the same operation.**

**Ratified invariant (law):** *rebuild and process are independent and
composable in any order.* After a rebuild, unprocessed events remain unprocessed
and are applied normally on the next pass; the apply is idempotent, so the
result is identical. This independence is what makes the exit condition provable
rather than asserted. Proven by test.

### 2.2 (B.2) — No semantic ordering guarantee

The Gate-1 packet's claim that identity values are "assigned in commit-visible
order" was **false and is struck**, along with "per-Self and per-resource
ordering follow from global order." A `GENERATED ALWAYS AS IDENTITY` value is
allocated at INSERT time, not commit time; two transactions can allocate 100 and
101 and commit in the order 101, 100.

**Ratified:** Phase 9 claims no semantic ordering guarantee beyond deterministic
worker traversal. Projection correctness must be order-independent. The
existence-only edge is commutative and idempotent, so this costs nothing.

**Binding mechanical requirement:** the worker claims by **predicate**, never by
stored position. The claim query filters on the unprocessed predicate and
re-evaluates it on every pass. No high-water mark, no cursor table, no
"last seen id" column, in this phase or any optimization of it. A
late-committing lower id is picked up on a subsequent pass precisely because
nothing advanced past it.

The ordering test is correspondingly replaced: reverse-order application must
yield identical projection state, and a lower id committing after a higher id
must still be claimed and applied.

### 2.3 (B.3) — Terminal failure is a distinct state

The conflation of "pending" and "permanently failed" under `processed_at IS
NULL` is rejected.

**Ratified schema amendment:** `failed_at timestamptz NULL` as a terminal
marker, with a CHECK enforcing that `processed_at` and `failed_at` are mutually
exclusive — an event may never be both delivered and dead.

- Claim predicate: `processed_at IS NULL AND failed_at IS NULL`. The partial
  index matches this exactly.
- On reaching the attempts threshold: set `failed_at`, record `last_error`,
  leave `processed_at` NULL. The event is terminal and excluded from claiming.
  It is never deleted.
- Attempts threshold: **5**. Operational parameter, amendable without
  constitutional consequence. Placement governed by §2.5.
- **Recovery:** Phase 9 builds no recovery path reachable by any login role.
  Reviving a dead-lettered event (clearing `failed_at`, resetting `attempts`) is
  owner-run SQL under `selves_migrate SET ROLE`, same posture as rebuild. Proven
  by test that a revived event applies correctly.

**Recorded property:** because rebuild recomputes from authoritative records, a
dead-lettered event's effect is recovered by rebuild even if the event is never
revived. Dead-lettering is a delivery failure, never a state loss —
authoritative records remain ground truth throughout.

### 2.4 (B.4) — Minor conformance items

- The availability coupling is **deliberately accepted**: if the outbox INSERT
  fails, the settlement transaction rolls back and the sender receives an error.
  Settlement-without-event and event-without-settlement are both impossible by
  construction. Recorded as accepted, not as unnoticed.
- The test plan includes a **positive** assertion that Key Placement settlement
  produces zero outbox rows.
- The observability classification (infrastructure telemetry only) is a
  **closed classification**. No behavioral telemetry, now or by later addition,
  without a ruling.

### 2.5 (B.5) — Threshold placement

The attempts threshold is an operational parameter, not a constitutional
invariant, and is implemented as one:

- It lives on the **owner side** — a constant declared within the owner-owned
  `proj.process_outbox` body. It is **not** a function parameter and **not** a
  default argument: the ruled EXECUTE surface is `proj.process_outbox(integer)`,
  one parameter, which is `p_limit`. A caller-supplyable threshold would let
  `selves_worker` set dead-lettering policy.
- It appears **exactly once** in the codebase, as a single named constant inside
  the `proj.process_outbox` body. The literal may not appear anywhere else — not
  in worker TypeScript, not in any other SQL body, not in tests. Tests assert
  dead-lettering behavior by driving an event to terminal state, never by
  hardcoding the count.
- Ground: 0010 §2 — resources may be named by the caller; authority may not be.
  Dead-lettering policy determines what is permanently excluded from delivery,
  which is authority-adjacent.
- Changing it is an ordinary operational change requiring no ruling, provided it
  remains owner-side and single-sourced.

---

## 3. GATE 2 CONSTRAINTS (C1–C4)

### C1 — No foreign keys from projection to authoritative tables

`proj.graph_edges` columns are plain `uuid NOT NULL`; no `REFERENCES` clauses.
Ground: a FK lets projection rows constrain authoritative mutation, inverting
law 1 (authoritative tables decide; projections reflect), and makes a table that
must be destroyable and rebuildable at will into one other tables must respect.
Referential integrity is supplied by derivation — both write paths (worker
apply, rebuild) join against authoritative rows, so an orphan edge is
unconstructible. **This constraint governs every projection table in this phase
and later ones until separately ruled.**

### C2 — Negative lock scoped by role, not by path

The negative import lock covers projection modules **wherever they reside**, not
merely `src/worker/**` by path convention. The test states this explicitly and
mechanically identifies projection modules by content (reference to the `proj`
schema surface); if any projection module is ever placed outside `src/worker/`,
the lock must name it.

### C3 — Variable naming

`v_payload` holds a payload **type**, not a payload. Renamed to `v_payload_type`
in the new `domain.settle_placement` so the emission guard reads unambiguously
against `p.payload_type` in `rebuild_graph`. The enumeration literal appears in
three places by design and all three read alike.

### C4 — Transient faults count toward dead-lettering (accepted operational property)

The per-event handler catches all exceptions, so five serialization or
connection faults will dead-letter a legitimate event. **Accepted as ruled** —
§2.3 records that rebuild recovers the effect and no state is lost — and
recorded here as a known, accepted operational property rather than left to be
discovered.

---

## 4. ACCEPTED PROPERTIES AND DELIBERATE DUPLICATION

1. **Availability coupling** (§2.4): settlement fails if emission fails; both
   divergences impossible by construction.
2. **Transient-fault dead-lettering** (C4): accepted; recoverable by revival or
   rebuild; never state loss.
3. **Three-site enumeration duplication:** the positive enumeration literal
   (`IN ('text')`) appears in exactly three owner-owned SQL bodies — the
   `domain.settle_placement` emission guard, the `proj.process_outbox`
   derivation guard, and the `proj.rebuild_graph` derivation predicate. The
   derivation guard exists so a forged event cannot make the worker materialize
   a non-enumerated payload (Q2 holds structurally at application, not only at
   emission). No shared helper is created (speculative abstraction); agreement
   of the three sites is **mechanically enforced by the rebuild-equivalence
   test**, and each site carries the same Q2/Q13 comment.

---

## 5. CONSTITUTIONAL CONFORMANCE

Phase 9 introduces no feed, activity stream, discovery surface, notification
path, presence mechanic, relationship inference, derived ring, Prism
materialization, or reply model — each structurally impossible per the Gate-1
packet's item 14 (outbox invisible to the application role; worker returns
scalars only; existence-only edges carry no recency; no transitive computation
exists; no ring/count input exists; no Prism table or function exists; no reply
field exists). The five objects remain exactly: Self, Signal, Artifact,
Placement, Graph. Behavioral telemetry is a closed classification (§2.4).

Quarantined questions remain quarantined. The Signal projection boundary remains
open (Q1). Derived-ring thresholds, poll visibility, presence, replies,
introduction-as-view, brokering, tells, reveal policy: untouched.

---

## 6. IMPLEMENTATION AUTHORIZATION

Gate 2 authorized the commit sequence:

- **P9-A** — this record, standalone, before any implementation (constitution
  precedes code).
- **P9-B** — migrations: outbox delta (`last_error`, `failed_at`,
  mutual-exclusion CHECK, partial index matching the claim predicate); `proj`
  schema owned by `selves_owner`; `proj.graph_edges` with RLS enabled and no
  policy in the same migration; `selves_worker` USAGE on `proj`.
- **P9-C** — `domain.settle_placement` DROP+CREATE with the
  positive-enumeration emission, same transaction, same DEFINER boundary.
- **P9-D** — `proj.process_outbox`, `proj.outbox_depth`, `proj.rebuild_graph`.
  EXECUTE to `selves_worker` on the first two only; `rebuild_graph` granted to
  no login role; `REVOKE ALL FROM PUBLIC` on all three.
- **P9-E** — worker process (`src/worker/`), `WORKER_DATABASE_URL` only, plus
  the import-lock delta per Q10/C2.
- **P9-F** — the full revised fourteen-area test plan. All existing tests green;
  the sole baseline amendment is the chamber-expanded lock encoding (Q10).
- **P9-G** — additive amendment to this record if audit establishes any
  requirement not in force at commit time (0006-F A2 discipline).

**Stop conditions** (halt and report): any lock change beyond the one
chamber-authorized pg-importer entry; any privilege beyond the exhaustive
`selves_worker` list; any Phase-8 acceptance suite requiring amendment to stay
green; any ruling herein proving unimplementable as written; any divergence from
the accepted conformance note.

**Closure requirement:** the phase does not close on a local commit. Push to
origin/master, verify over the network with `git ls-remote` in the same
session, report in the standard format, and stop. Phase 10 is not authorized.

---

## 7. P9-G — ADDITIVE AMENDMENT (ruled by Liberty, 2026-07-25)

These entries are **additive**. They record three items established during
chamber audit, none defective against instructions in force at commit time.
Nothing already recorded is amended.

### 7.1 Second authorized baseline amendment

`server/test/globalSetup.ts` was modified in P9-B to drop the `proj` schema
before migrate-from-zero. It is a baseline file and is hereby recorded as the
**second** authorized baseline amendment of this phase, alongside
`authz-import-graph.test.ts`. Precedent: P6 established exactly this pattern for
the `domain` schema. The change is correct and was disclosed; what is corrected
is the ledger, not the code. **The phase's baseline amendment count is TWO, not
one.**

**Standing rule:** the amendment ledger is chamber record. A change to a
baseline file enters the ledger regardless of whether it is characterized as
harness, tooling, or test infrastructure.

### 7.2 Chamber drafting error, recorded with provenance

The Gate 2 regression obligation read "all 321 existing tests byte-unchanged."
That was unsatisfiable as written: the chamber had authorized a lock delta in
the same document, and the lock lives inside `authz-import-graph.test.ts`. The
obligation should have read "byte-unchanged except
`authz-import-graph.test.ts`, which changes only by the authorized lock delta."
The builder satisfied the intent and disclosed the conflict rather than
resolving it silently. **The error was the chamber's.**

### 7.3 Revival test scope

The revival test repairs the poison event's payload before revival. It
therefore proves **revival-plus-cause-resolution, not revival alone**. This is
the correct thing to prove — an unrepaired event fails again on the next pass —
but it is stated here so a future reader does not mistake the test for proof
that clearing `failed_at` and resetting `attempts` is sufficient on its own.
