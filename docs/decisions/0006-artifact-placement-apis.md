# 0006 — Artifact and Placement APIs (Phase 6)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** Playbook Phase 6 — Artifact and Placement APIs
- **Ruled by:** Liberty (recorded by Claude as engineer)
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law. Where
  this record conflicts with AGENTS.md, AGENTS.md wins. This record documents the
  first mutation phase; it introduces **no** ontological object. The ontology
  remains exactly Self → Signal → Artifact → Placement → Graph.
- **Builds on:** [0001](./0001-repo-boundary.md), [0002](./0002-migration-foundation.md),
  [0003](./0003-domain-schema.md), [0004](./0004-auth-active-self.md),
  [0005](./0005-authorization-service.md)

---

## Charter amendment (committed with this record)

AGENTS.md §5 "Departing" is amended: the previous "a short, **uniform** inline
Cancel" wording is replaced with the ratified **account-level configurable
departure interval** — a descriptive account setting, **server-authoritative**,
bounded to the closed list **{5, 10, 30, 60}s (default 30)**, **snapshotted onto
the Placement at departure**, with later setting changes never affecting an
in-progress departure. Settlement is **client-initiated** and gated by a
server-enforced floor; there is no automatic settlement; a Placement left in
Departing simply remains cancellable. The amendment and this record are committed
**before** any implementation so the constitution never lags the code.

The interval is stored on the **account** record as implementation state. This is
**not** a new ontological object and **not** a behavioral policy that acts on the
user's behalf (§6 Test 3): it is a descriptive property the user sets and the
server reads; disclosure remains an **act** (pressing Send), never a setting.

## Governing rulings (Gate 1, eight)

1. **Write boundary (foundational).** The exclusive `SECURITY DEFINER` write
   boundary ratified in 0004 **extends to domain mutations**. No login role holds
   direct INSERT/UPDATE/DELETE on any table; every mutation flows through a
   `SECURITY DEFINER` function owned by `selves_owner` (`search_path=''`, fully
   qualified). `selves_app` gains only `EXECUTE` on the new functions. This keeps
   all state-machine locking inside owner functions invoked as single statements
   through the existing `Queryable`, leaving the Phase-5 mechanical-boundary
   positive locks (`pg`/raw-pool importers) **unchanged**.
2. **Settlement driver.** Client-initiated `settle`; **server-enforced interval
   floor**; **no auto-settlement**; a **stuck `departing`** placement is accepted
   for the slice (nothing is disclosed until settlement crosses the boundary).
3. **Departure interval (Q3 modification).** User-configurable, **account-level**,
   **server-authoritative**, bounded closed list **{5, 10, 30, 60}s, default 30**,
   **snapshotted onto the Placement at `begin_departure`**. Later setting changes
   never affect in-progress departures. The snapshot column is written **exactly
   once** and is thereafter immutable regardless of any subsequent mutation.
4. **Minimum recipients.** **≥1 explicit recipient required before departure**;
   zero recipients permitted while `draft`. Recipients are explicit rows only —
   never inferred, never a Ring or Zone.
5. **Sender = author.** The placing Self **must equal the Artifact's author**
   (`sender_self_id = artifacts.author_self_id`). A Self may place only its own
   Artifact.
6. **Recipient eligibility (Q6 modification).** **Any explicitly selected Self**
   may be a recipient — **including the sending Self itself and sibling Selves of
   the same account**. Receipt confers no authority; sibling ownership is not
   permission (0004 R2). Self- and sibling-addressing are supported positive cases.
7. **Split error mapping.** `404` for unauthorized/absent (non-leakage preserved —
   an outsider cannot distinguish "not yours" from "doesn't exist"); `409` for an
   **authorized** actor hitting a wrong-state/conflict (the author already knows
   the resource exists and is theirs — honest feedback is not a leak); `400` for
   malformed input (structural, pre-authorization).
8. **Domain schema.** The mutation functions live in a **new hardened `domain`
   schema** owned by `selves_owner`, `SECURITY DEFINER`, `search_path=''`, fully
   qualified — **not** in `auth`. The `auth` inventory stays fixed at 11 functions
   (0004).

## Operation inventory

Eight mutations, all `SECURITY DEFINER` in `domain`:
`create_artifact`, `create_placement_draft`, `add_recipient`, `remove_recipient`,
`begin_departure`, `cancel_placement`, `settle_placement`, `set_departure_interval`.

Slice payload types: **text only** (`artifacts.payload_type` CHECK `='text'`).
Explicitly **not** implemented: artifact edit/delete, draft discard, any
photo/poll/gift/key artifact, Key lifecycle (Phase 7), reply/introduction/
brokering (quarantined), Graph/Signal/Prism writes (Phase 9).

Reads consumed unchanged from Phase 5: `readArtifact`, `listOwnedArtifacts`,
`readPlacement`, `listReadablePlacements`, `listRecipientsOfAuthoredPlacement`.

## State machine

```
draft ──begin_departure──▶ departing ──settle──▶ settled   (terminal)
                               └────cancel────▶ cancelled  (terminal)
```

- Only the **sender Self** drives every transition. Recipients drive nothing.
- Recipients editable **only in `draft`** (Phase-3 `trg_freeze_recipients`
  backstops; the service gates for clean mapping).
- `begin_departure` requires `state='draft'` **and** ≥1 recipient; it snapshots
  the account interval onto the placement.
- `settle` requires `state='departing'` **and** `now() ≥ departing_at +
  snapshotted_interval`; idempotent on `state='departing'`.
- `cancel` requires `state='departing'`.
- Terminal states immutable (Phase-3 `guard_placement_mutation`).

## Concurrency & idempotency

Each mutation is a single-statement DEFINER function taking `SELECT … FROM
public.placements WHERE id=$1 FOR UPDATE` (the placement row is the stable
identity; unlike replaceable credential rows it is not serialized via `accounts`).
Cancel-vs-settle: both lock the row; the first commits, the second's conditional
`… WHERE state='departing'` matches 0 rows → single winner. Duplicate settle:
conditioned on `state='departing'`, a second call matches 0 rows and re-reads to
return idempotent success (already settled) or conflict (cancelled). This is the
compare-and-swap shape already proven for `rotate_credential` in P4-F.

**Phase-9 readiness:** `settle_placement` remains a **single-statement** DEFINER
function so the transactional-outbox `INSERT` attaches inside the same function
later with no redesign — settlement and its event cannot diverge.

## Privilege delta

- **Direct INSERT/UPDATE/DELETE grants to any login role: NONE**, on any table.
- **New `EXECUTE` to `selves_app`:** the eight `domain` functions (`REVOKE … FROM
  PUBLIC` first, then grant, per the auth-migration pattern).
- Withheld: all direct DML on `accounts`, `selves`, `artifacts`, `placements`,
  `placement_recipients`, `key_grants`. `selves_app` keeps only its existing
  column-scoped `SELECT`s plus a read of `accounts.departure_interval_seconds`
  where a predicate needs it.

## Mechanical boundary

New internal `src/authz/mutations.repo.ts`, value-importable **only** by
`authz/service.ts`. Import-graph allowlist delta: `INTERNAL_REPOS +=
mutations.repo.ts`; `INTERNAL_REPO_VALUE_ALLOW` unchanged. The `pg`/raw-pool
positive locks (`['db.ts','operator/cli.ts']`, `['server.ts']`) **remain
unchanged** — writes use the existing `Queryable`, not the raw pool. Had any
ruling required widening a trusted surface, implementation would stop and report
rather than widen; it did not.

## Limitations recorded

Application-layer containment until Phase 8 RLS; no Key lifecycle (Phase 7); no
outbox emission yet (Phase 9); stuck-`departing` accepted for the slice; runtime
pinned to Node 24.18.0 (0004). Phase-3 database constraints remain the sole
authority for structural invariants; this layer describes the same rules and never
weakens them.

## Commits

`P6-A` charter amendment + this record · `P6-B` migrations (interval columns,
`domain` schema, eight DEFINER functions, grants) · `P6-C` mutations repo +
service surface + import-graph allowlist · `P6-D` routes with 404/409/400 mapping ·
`P6-E` adversarial/transition/race/snapshot/floor test suite.
