# 0004 — Authentication and active-Self context

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** Playbook Phase 4 — Authentication and active-Self context
- **Ruled by:** Liberty (recorded by Claude as architect)
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law. Where
  this record conflicts with AGENTS.md, AGENTS.md wins. This record documents the
  auth substrate; it introduces no ontological object.
- **Builds on:** [0001](./0001-repo-boundary.md), [0002](./0002-migration-foundation.md),
  [0003](./0003-domain-schema.md)

---

## Context

Phase 4 authenticates the account, establishes an explicit acting Self per
protected request, guarantees sibling ownership confers no authority and no
context bleed, and separates database roles. It was designed across seven ruling
rounds (Gate 1, three Gate-1 corrections, Gate 2, three Gate-2 amendments/
corrections) before any code. Authentication is *infrastructure*, not ontology:
`auth.sessions` and `auth.account_credentials` are not Self/Signal/Artifact/
Placement/Graph, hold no product surface, and carry no `last_seen`/activity
column (Presence stays dead — AGENTS.md §6 Tests 4–5).

## Ratified decisions

### R1 — Credential model (approved; not final consumer auth)
Opaque per-account **enrollment credential** + DB-backed **session**. The server
mints a 256-bit session token and stores only its SHA-256; a DB read never yields
a usable token and no signing key exists. This is the private-bootstrap model,
**not final consumer authentication**; credential recovery is out-of-band by
design. Revisit before any non-invite growth.

### R2 — Active-Self (per-request assertion, no server state)
`X-Acting-Self` per request; the server **persists no active-Self state**. The
acting Self exists only as a per-request assertion, verified against the
authoritative store (`public.selves`) on **every** protected Self-scoped request —
a prior success is never standing authorization. Constitutional ground: this keeps
switching a lightweight assertion change (AGENTS.md §3.4), makes concurrent tabs
independent by construction, and never treats sibling ownership as permission.
**Persisting active-Self state later requires a new ruling.**

### Exclusive write boundary
The auth functions are the authoritative write path **and** no caller holds
reproducing DML — both halves hold. Every mutation of `auth.*` and the identity
rows flows through a `SECURITY DEFINER` function owned by `selves_owner`
(`search_path=''`, fully-qualified). The only direct table grant is
`selves_app`'s column-scoped `SELECT` on `public.selves`.

### Stable serialization mechanism
A replaceable credential row cannot be a serialization point. Issuance,
disablement, rotation, recovery, and containment all serialize on the **stable
`public.accounts` row** via `FOR NO KEY UPDATE`.

### R10 preserved — rotation is compare-and-swap
`rotate_credential(account, expected_active_id, new_hash)` compares the actual
active credential id with the caller's expectation. Concurrent rotations produce
exactly one winner; a stale caller fails (`40001`) with no mutation and is **not**
retried automatically. `enroll_account` and `rotate_credential` return the
credential id needed for the next rotation (operator infrastructure, not client
authentication material). **Ambiguous-enrollment recovery** is a separate,
narrowly scoped operation, permitted only while the account holds exactly one
historical, active credential, and is itself one-winner — a successfully displayed
recovery secret is never silently invalidated by a concurrent recovery.

### enroll_account lock-protocol exemption
`enroll_account` creates the first credential; there is no prior row to lock, and
no session can reference a credential that does not yet exist. `one_active` and the
`accounts` primary key close double-enrollment.

### Enrollment outcome trichotomy
`enroll_account` runs as one autocommit statement (a function does not establish
its own commit boundary). Outcomes: **acknowledged commit** (driver resolves →
secret shown); **acknowledged failure** (server SQLSTATE → rolled back, no secret);
**ambiguous** (no SQLSTATE — connection/ack failure → commit unknown, secret NOT
shown). Ambiguity is resolved with the pre-recorded, nonsecret account reference
via `recover_enrollment_credential`: "recovered" proves it committed (fresh
secret issued); "not committed" proves no account exists.

### Logout ruling
`DELETE /auth/session` is authentication-maintenance: CORS + Origin enforced, but
**exempt from `authenticate`**. If a cookie is present it is hashed and passed to
`revoke_session`; missing/malformed/unknown/expired/already-revoked are externally
indistinguishable; the exact issued cookie variant is always cleared; the response
is always `204`; the revoke count is never exposed.

### SECURITY DEFINER inventory (11 functions)
`auth` holds exactly 2 tables, 7 indexes, 11 functions (3 `SECURITY INVOKER`
trigger functions + 8 `SECURITY DEFINER` callables), 3 triggers. **No new DEFINER
function enters `auth` without a ruling.** An inventory test enumerates every
object by name, owner, security mode, `search_path`, and EXECUTE ACL.

### selves_operator — sixth managed role
Ground: separation of duties — the identity-enrollment principal must never hold
compromise-containment authority, and the containment principal must never mint
identity. Grants: `USAGE` on `auth` + `EXECUTE auth.contain_account` only.

### Compromise containment / lifecycle
`contain_account` atomically disables the active credential AND revokes every
unrevoked session — it closes the deployment-blocking containment gap. Ordinary
`disable_credential`/`rotate_credential` block future login but do **not** revoke
existing sessions (they persist to absolute expiry or explicit revocation).

### SCRAM / password provisioning
Role passwords are provisioned with PostgreSQL/psql-native SCRAM verifier
generation (`password_encryption='scram-sha-256'` + `\getenv`); Selves code
implements no SCRAM. Plaintext never reaches argv, history, tracked files, or
logs; its transient passage through the local bootstrap connection is
acknowledged. `selves_owner` has no usable password (NOLOGIN, `PASSWORD NULL`,
`CONNECTION LIMIT 0`).

### Governed databases
Bootstrap targets an **exact configured dev/test allowlist** — never a prefix,
wildcard, or naming convention. It resolves the list, requires it nonempty and
duplicate-free, and fails closed before any change if a target is missing or a
template. The disposability ruling applies **only** to the explicitly configured
development and test databases; it is a present fact, not a naming-based or
standing policy.

### Disposability & upgrade path
All current databases are disposable local dev/test with no production data; they
are rebuilt from zero under the `selves_owner` model. No ownership-transition
mechanism is designed or built. **Before any environment holds non-disposable
data, an upgrade-path acceptance criterion must be added to the then-current
phase.**

### Test boundary
The 27 Phase-3 tests run on the superuser path and are unchanged; re-verifying
them under `selves_app` is a **Phase-8 (RLS) acceptance criterion**. Migrations
run as `selves_migrate` with `current_user=selves_owner`; the test globalSetup
resets auth-then-public-then-bookkeeping and migrates as the migrate role.

### Node runtime & dependencies
Baseline **Node 24.18.0** (24.x was EOL-checked and 25.5.0 rejected). Pins: root
`.nvmrc=24.18.0`, `server/package.json` engines `>=24.18.0 <25`, `server/.npmrc`
`engine-strict=true`. Exact runtime deps: `fastify 5.10.0`, `@fastify/cookie
11.1.2`, `@fastify/cors 11.3.0`.

## Authorization matrix (runtime roles)

| Role | Schema USAGE | Direct DML | EXECUTE |
|---|---|---|---|
| `selves_owner` (NOLOGIN) | owns all | owns all | owns all |
| `selves_migrate` | via `SET ROLE owner` | — | — |
| `selves_app` | auth, public | `SELECT(id,account_id,name,self_slot)` on `public.selves` | authenticate/issue/revoke session |
| `selves_bootstrap` | auth | none | enroll, rotate, disable, recover |
| `selves_operator` | auth | none | contain_account |
| `selves_worker` | none | none | none (CONNECT only) |

Sole membership edge: `selves_migrate → selves_owner` (`INHERIT FALSE, SET TRUE,
ADMIN FALSE`), granted by the bootstrap superuser.

## Deployment-blocking limitations (recorded)

- **Rate limiting / login throttling / account lockout** — out of scope this
  phase; deployment-blocking.
- **Real-browser cookie/CORS/`__Host-` verification** — `inject()` proves
  server-side emission and logic only; live-browser verification deferred to
  Phase 10.
- **No CSP / broader XSS hardening** — later phase.
- Not final consumer authentication (R1).

## Verification

- Migrations from zero on `selves_dev` and `selves_test`, executed as
  `selves_migrate` (`current_user=selves_owner`).
- **107 tests pass** (27 Phase-3 unchanged + 80 Phase-4), including 12
  deterministic two-connection linearization races and the full authorization,
  invariant, convergence, and outcome matrices.
- `tsc --noEmit` clean; client `vite build` green; server boots against a
  from-zero database and answers `/health`.
- Secrets scan: no synthetic role password in any tracked file or the client
  bundle; `.env` gitignored; `.env.example` placeholders only.

## Commits

`P4-A` bootstrap/roles · `P4-B` auth schema/functions/triggers/inventory ·
`P4-C` server auth module · `P4-D` active-Self middleware + `/auth/selves` ·
`P4-E` operator commands · `P4-F` adversarial/concurrency suite · `P4-G` this
record.
