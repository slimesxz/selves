# Selves — authorization matrix

- **Status:** Phase 11 working artifact. Phase 11 is **open, not closed**.
- **Date:** 2026-08-28
- **Phase:** Playbook Phase 11 — Adversarial and security testing
- **Authority:** [AGENTS.md](../AGENTS.md) is binding constitutional law. Where
  this document conflicts with AGENTS.md, AGENTS.md wins.
- **Companion:** [threat-model.md](./threat-model.md). Evidence classes
  (RUNTIME / DATABASE / STATIC / ARCHITECTURAL) are defined there and used here
  unchanged.
- **Recorded by:** Claude as engineer, under the Phase 11 Gate 1 chamber rulings
  recorded in [0013](./decisions/0013-phase-11-opening.md).

---

## 0. The two layers are not interchangeable

This artifact contains **two separate matrices**.

**Part A — application authorization.** Who may do what to which object,
decided by the `AuthorizationService` on authoritative facts, per request.

**Part B — database roles and privileges.** What each PostgreSQL role may touch
at all, enforced by PostgreSQL privileges and row-level security.

> **Part B is defense in depth. It is not a restatement of Part A, and neither
> layer substitutes for the other.**

Part A expresses product semantics and is the layer that decides an ordinary
request. Part B constrains what a compromised or buggy application path can
reach at all, and is the layer that survives a Part A failure. A permission
absent from Part A but permitted by Part B is **not** authorized; a grant
present in Part B is never evidence that an actor is authorized. Reading one
matrix as a proxy for the other is an error.

Neither layer derives authority from a Graph edge, a Ring label, a shared
account, a client claim, or knowledge of an identifier.

---

## Part A — application authorization

### A.1 Actor classes

| Actor | Definition |
|---|---|
| **Unauthenticated** | No valid session. |
| **Author / sender** | The Self that authored the Artifact or sent the Placement. |
| **Settled recipient** | A Self named in an explicit `placement_recipients` row of a placement in state `settled`. |
| **Unsettled recipient** | Named recipient of a placement in `draft`, `departing`, or `cancelled`. |
| **Sibling Self** | Another Self of the **same account** as the author, with no relation to the record. |
| **Unrelated Self** | A Self of another account, with no relation to the record. |
| **Active Key holder** | Grantee of an unrevoked `key_grants` row for the exact protected Artifact. |
| **Revoked Key holder** | Grantee whose grant carries `revoked_at`. |
| **Forged acting Self** | An authenticated caller asserting a Self it does not own, or a malformed assertion. |

### A.2 Object × operation × actor

`200/201/204` = permitted. `404` = the uniform denial (`{"error":"not_found"}`).
`[]` = the frozen empty array. `401` unauthenticated. `403` acting-Self
ownership failure. `400` malformed assertion or body. `409` conflict, returned
**only** to an actor already authorized for the object.

| Operation | Author / sender | Settled recipient | Unsettled recipient | Sibling | Unrelated | Active Key | Revoked Key | Unauth. |
|---|---|---|---|---|---|---|---|---|
| `GET /artifacts` (own) | 200 own only | 200 `[]` | 200 `[]` | 200 `[]` | 200 `[]` | 200 `[]` | 200 `[]` | 401 |
| `POST /artifacts` | 201 | 201 (own) | 201 (own) | 201 (own) | 201 (own) | 201 (own) | 201 (own) | 401 |
| `GET /artifacts/:id` | 200 | 200 | 404 | 404 | 404 | 200 **exact resource only** | 404 | 401 |
| `GET /placements` | 200 own, any state | 200 settled-to-me only | excluded | 200 `[]` | 200 `[]` | 200 `[]` | 200 `[]` | 401 |
| `POST /placements` | 201 (own artifact) | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `GET /placements/:id` | 200 any state | 200 | 404 | 404 | 404 | 404 | 404 | 401 |
| `GET /placements/:id/recipients` | 200 full set | 200 `[]` | 200 `[]` | 200 `[]` | 200 `[]` | 200 `[]` | 200 `[]` | 401 |
| `POST …/recipients` | 204 **draft only**, else 409 | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `DELETE …/recipients/:rid` | 204 **draft only**, else 409 | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST …/departure` | 204 from draft, ≥1 recipient; else 409 | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST …/cancellation` | 204 from departing; else 409 | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST …/settlement` | 204 from departing after the floor; else 409; repeat 204 | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST /key-placements` | 201 (own artifact) | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST /keys/revocation` | 204 **recorded grantor only** | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `GET/PUT /account/departure-interval` | **account-scoped** — session alone | | | | | | | 401 |

A **forged acting Self** receives `400` (malformed) or `403` (unowned) on all
fourteen Self-scoped routes, ahead of any authorization decision.

### A.3 The load-bearing negatives

These are the properties the matrix exists to make explicit. Each is stated as a
prohibition, because each is a place where a plausible implementation would leak.

1. **Sibling-Self non-inheritance.** A Self of the author's own account receives
   exactly what an unrelated Self receives: `404` on single reads, `[]` on
   lists, `404` on every mutation. Shared account ownership is **never** an
   authorization ground. *(RUNTIME, DATABASE)*
2. **Cross-account isolation.** The authenticated session alone selects the
   account. An `accountId` or `selfId` in a body, or an `X-Acting-Self` header
   on an account-scoped route, changes nothing and can never reach another
   account. *(RUNTIME)*
3. **Recipient limitation.** A recipient reads only when the placement is
   `settled`, drives **no** transition, and cannot list recipients — not even
   its own row. Co-recipients are never disclosed. *(RUNTIME, DATABASE)*
4. **Key authority.** A Key authorizes reading **exactly one** protected
   Artifact and nothing else — no placement visibility, no recipient rows, no
   mutation. A settled Key Placement contributes **no** recipient ground for its
   protected Artifact; the capability register is the sole revocable read path.
   Revocation is prospective and denies future reads while leaving settled
   history intact. Authority to revoke is the **recorded grantor**, never
   current Artifact authorship. *(RUNTIME, DATABASE)*
5. **Projection non-authority.** No Graph edge, Signal, or derived row is ever
   an authorization input. A poisoned edge changes no outcome. *(RUNTIME,
   DATABASE)*
6. **Acting-Self validation is per request.** Ownership is re-verified on every
   request; a prior success is not standing authorization. A Self deleted or
   reassigned between two requests turns the second into `403`. *(RUNTIME)*
7. **Terminal placement behavior.** `settled` and `cancelled` are terminal:
   no further transition, no recipient change, no UPDATE, no DELETE. Recipients
   freeze from `departing` onward. A settled Placement cannot be recalled.
   *(RUNTIME, DATABASE)*
8. **Denial uniformity.** Unauthorized-existing and nonexistent are answered
   identically across status, body, and headers; the internal reason never
   reaches the caller. *(RUNTIME — subject to the Q12 timing limitation and to
   open defect P11A2-F1, both recorded in the threat model.)*

---

## Part B — database roles and privileges

Six managed roles. Convergent bootstrap; roles are cluster-global. The sole
membership edge is `selves_migrate → selves_owner` (`INHERIT FALSE, SET TRUE,
ADMIN FALSE`).

| Role | Login | Schema USAGE | Direct DML | EXECUTE |
|---|---|---|---|---|
| `selves_owner` | **NOLOGIN**, no password, `CONNECTION LIMIT 0`, not superuser, **not BYPASSRLS** | owns all | owns all | owns all |
| `selves_migrate` | yes | via `SET ROLE selves_owner` | — | — |
| `selves_app` | yes | `auth`, `public` | **none** | domain + auth + identity functions |
| `selves_bootstrap` | yes | `auth` | none | enroll, add_self, rotate, disable, recover |
| `selves_operator` | yes | `auth` | none | contain_account |
| `selves_worker` | yes | none | none | the two ruled projection functions (CONNECT only otherwise) |

### B.1 `selves_app` table reach

| Table | `selves_app` |
|---|---|
| `artifacts` | column `SELECT` on exactly `id, author_self_id, payload_type, text_body, created_at` |
| `placements` | column `SELECT` on exactly `id, sender_self_id, artifact_id, payload_type, protected_resource_id, state, created_at, departing_at, settled_at, cancelled_at, departure_interval_seconds` |
| `placement_recipients` | column `SELECT` on exactly `placement_id, recipient_self_id, added_at` |
| `accounts` | **nothing** |
| `selves` | **nothing** — the account→Self map is DEFINER-mediated and session-bound |
| `key_grants` | **nothing** — the capability register is invisible to the application |
| `outbox_events` | **nothing** |
| any table | **no** table-level `SELECT`; **no** `INSERT`/`UPDATE`/`DELETE` anywhere |

All writes go through owner-run `SECURITY DEFINER` functions with hardened
`search_path`. `selves_app` cannot `SET ROLE` into `selves_owner` or
`selves_migrate` and cannot create a schema.

### B.2 Row-level security

RLS is enabled on the policed tables with six ratified PERMISSIVE `SELECT`
policies for `selves_app`, and enabled **with no policy** on the
defense-in-depth tables — including `key_grants` and `proj.graph_edges`, which
are therefore invisible to every non-owner role. **No table anywhere uses
`FORCE ROW LEVEL SECURITY`**; owner bypass is by table ownership alone, which is
why the `selves_owner` posture in Part B's first row is a load-bearing
condition rather than hygiene.

Policies key on the transaction-local acting-Self context established by an
owner-run setter gated on `auth.sessions`. **Fail-closed:** a transaction that
establishes no context reads zero rows, and a reused pooled backend inherits
nothing.

### B.3 The T2 line

> An adversary holding `selves_app`'s database credential, but **without** a
> valid live session credential, retrieves zero rows.

This is the achievable database-layer containment. It does not contain an
adversary who owns the application host (T3, excluded). See
[threat-model.md §2](./threat-model.md).

---

## 3. Status of this matrix

This document records the **authorization design and its current evidence
classes**. It is not a test report, and no Phase 11 evidence run has occurred.
Coverage classification for each obligation — including the three PARTIAL
obligations, the three ABSENT obligations, and open defect **P11A2-F1** — is
recorded in [0013](./decisions/0013-phase-11-opening.md) and summarized in
[threat-model.md §6](./threat-model.md).
