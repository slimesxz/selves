# Selves — Phase 11 whole-system threat model

- **Status:** Phase 11 working artifact. Phase 11 is **open, not closed**.
- **Date:** 2026-08-28
- **Phase:** Playbook Phase 11 — Adversarial and security testing
- **Authority:** [AGENTS.md](../AGENTS.md) is binding constitutional law. Where
  this document conflicts with AGENTS.md, AGENTS.md wins. This document
  introduces **no** ontological object and **no** product semantics.
- **Relationship to prior authority:** This model **extends and incorporates**
  [0008 §0](./decisions/0008-row-level-security.md); it does **not** replace or
  repeal it. The T1/T2/T3 analysis and the T3 exclusion remain authoritative for
  the database/RLS boundary and are restated unchanged in §2.
- **Recorded by:** Claude as engineer, under the Phase 11 Gate 1 chamber rulings
  recorded in [0013](./decisions/0013-phase-11-opening.md).

---

## 1. Evidence classes

Every claim in this document, and in the Phase 11 test report that will follow,
carries exactly one of the following classes. **A claim is never silently
promoted from a weaker class to a stronger one.**

| Class | Meaning |
|---|---|
| **RUNTIME** | Established by executing the real application surface — the production Fastify app, its real middleware chain, and the real `AuthorizationService` — against a real PostgreSQL instance. |
| **DATABASE** | Established by executing SQL on a connection authenticated as the real constrained role (`selves_app`, `selves_worker`, `selves_bootstrap`, `selves_operator`), so PostgreSQL privileges and RLS decide the outcome. |
| **STATIC** | Established by analysis of committed source — TypeScript AST import-graph walks, source-site enumeration, catalog inventory. Proves a property of the **source**, never of a running adversarial system. |
| **ARCHITECTURAL** | Reasoned from the committed design. Explains why a class of attack is expected to fail. **It is not evidence.** An architectural claim that has no RUNTIME, DATABASE, or STATIC counterpart is recorded here as unproven. |

Phase 11 does not accept an ARCHITECTURAL claim as discharging an adversarial
obligation. Where this document relies on architecture alone, it says so.

---

## 2. Inherited database threat model (0008 §0, preserved)

The following is carried forward from 0008 §0 unchanged in substance and remains
authoritative for the database boundary.

- **T1 — application-logic failure.** A bug, an omitted filter, an authorization
  path not taken, an injected fragment inside an otherwise fixed query. The
  adversary influences what the application asks for but does not control the
  session.
- **T2 — compromised application credential.** The adversary holds
  `selves_app`'s connection credentials and executes arbitrary SQL directly: a
  leaked `DATABASE_URL`, an exfiltrated environment, a backup or replica
  credential, log exfiltration, or third-party database access without
  application-host access.
- **T3 — compromised owner.** **Out of scope**, conditional on the
  `selves_owner` posture assertions. **Phase 11 does not repeal this
  exclusion.**

The ratified containment line for T2 is unchanged:

> An adversary holding `selves_app`'s database credential, but not possession of
> a valid live session credential, retrieves zero rows.

Also unchanged: no database-layer control contains an adversary who owns the
application host; such an adversary possesses every credential the legitimate
application possesses. Residual exposure above the T2 line is a deployment
property governed by credential custody and host integrity.

---

## 3. Phase 11 extension — the integrated adversary catalogue

Phase 11 widens the analysis from the database boundary to the integrated
system. Each adversary below names what it controls, what it must not achieve,
and the current evidence class. Coverage status is recorded in
[the authorization matrix](./authorization-matrix.md) and in the P11-A2 ledger
recorded in [0013](./decisions/0013-phase-11-opening.md).

### A1 — Unauthenticated caller
**Controls:** arbitrary requests to any route, no session.
**Must not achieve:** any Self-scoped or account-scoped effect or read.
**Evidence:** RUNTIME — every production route answers `401` with the ratified
body.

### A2 — Cross-account adversary
**Controls:** a valid session for its own account; knowledge of another
account's identifiers.
**Must not achieve:** any read, mutation, or setting change touching another
account.
**Evidence:** RUNTIME and DATABASE. Caller-supplied account and Self
identifiers in a body or header are not authority inputs; the authenticated
session alone selects the account.

### A3 — Sibling-Self adversary
**Controls:** a valid session for an account, acting through a Self of that
account that has no relation to the target record.
**Must not achieve:** any inherited visibility or authority. **Shared account
ownership confers nothing.**
**Evidence:** RUNTIME and DATABASE.

### A4 — Acting-Self substitution adversary
**Controls:** a valid session; arbitrary `X-Acting-Self` values.
**Must not achieve:** action or visibility as a Self it does not own.
**Evidence:** RUNTIME (malformed → `400`, unowned → `403`, per request) and
DATABASE (the mutation DEFINER functions accept **no** acting-Self authority
argument; authority derives from context established from the session, so
substitution is structurally impossible rather than merely rejected).

### A5 — Stale-session adversary
**Controls:** a session that was valid when issued; a Self whose ownership or
existence has since changed.
**Must not achieve:** any effect on the strength of a prior success. **Session
presence is never standing authorization.**
**Evidence:** RUNTIME — ownership reassignment and Self deletion each convert a
prior success into `403` on the next request; revoked sessions fail opaquely at
the database boundary.

### A6 — Stale-decision adversary
**Controls:** the ability to commit a ground change (revocation, state
transition, ownership change) concurrently with an in-flight authorized
operation.
**Must not achieve:** an authorization outcome that outlives its grounds across
requests.
**Evidence:** RUNTIME for the cross-request property (no allow persists);
STATIC for the absence of cross-request memoization in `src/authz/**`;
**ARCHITECTURAL only** for the intra-request property described in §4.

### A7 — Database-credential adversary (T2)
As §2. **Evidence:** DATABASE.

### A8 — Worker / projection adversary
**Controls:** the projection surface, replayed or duplicated events, and
(hypothetically) poisoned derived rows.
**Must not achieve:** any authorization effect. **The Graph is a projection and
is never an authorization input.**
**Evidence:** DATABASE and RUNTIME — a poisoned edge changes no authorization
outcome and is healed by rebuild; duplicate delivery and full replay are
idempotent; the worker role is CONNECT-only.

### A9 — Client adversary
**Controls:** all client-side state and every byte of the request the client
constructs.
**Must not achieve:** (a) manufactured server authority; (b) receipt of
protected data that the client is merely expected to hide. The second is the
Playbook §2.5 obligation — *the client must never receive a broad forbidden
dataset and hide it cosmetically*.
**Evidence:** RUNTIME **partial** — refusal of forged and unowned acting-Self
assertions is established across a real socket with production client code.
**The non-emission half is not yet established.** See §6.

### A10 — Malformed-input adversary
**Controls:** payload shape, field types, and identifier syntax.
**Must not achieve:** an unhandled failure path, an injected query, or a
non-fail-closed outcome.
**Evidence:** DATABASE and RUNTIME for payload-type boundaries, malformed
bodies, and SQL-injection payloads (bound as data; never parsed as SQL).
**Malformed path identifiers are an open defect — see §6, P11A2-F1.**

### A11 — Concurrency adversary
**Controls:** overlapping operations, connection reuse, racing lifecycle
transitions.
**Must not achieve:** context leakage between requests, duplicated
authority-bearing effects, illegal lifecycle results, or resurrection of
revoked authority.
**Evidence:** DATABASE and RUNTIME for **paired** operations and for pooled
backend reuse. **Sustained contention is not established** — see §6.

---

## 4. Read-path transaction semantics (recovered and recorded)

The following property of the protected read path is recorded here because it
governs the stale-decision analysis and was not previously written down.

> Protected reads establish acting-Self context, authorization predicates, the
> authorization decision, and the protected read inside one REPEATABLE READ
> transaction and one MVCC snapshot. This prevents a concurrent commit from
> widening the result after an allow decision. It also means an in-flight
> request may complete according to the snapshot established before a
> subsequently committed revocation or other ground change. Phase 11 treats that
> as a bounded intra-request snapshot property, not as standing authority across
> requests.

**Evidence class: ARCHITECTURAL.** This is read from the committed
implementation (`src/db.ts`, `src/authz/service.ts`), not from an executed
adversarial experiment. **Phase 11 does not claim it as proven adversarial
resilience.** The execution evidence is owed by the C2 work item and does not
exist at the time of writing.

The property is consistent with `AGENTS.md §5`: revocation of a capability is
**prospective**. It ends future access; it does not reach into an operation
already authorized under an earlier snapshot, and it cannot undo access already
exercised.

The mutation path is different and is not covered by the paragraph above:
mutations run READ COMMITTED and serialize on the placement row through the
DEFINER functions' `SELECT … FOR UPDATE`, so they block and re-read rather than
observe a fixed snapshot.

---

## 5. Existence oracles and the timing limitation (Q12)

**In scope, and currently established (RUNTIME):** indistinguishability across
deterministic, application-controlled observables wherever the contract requires
it — HTTP status, response body and envelope, response headers, error
classification, projection effects, and stable externally observable application
behavior. An unauthorized-existing resource and a nonexistent resource are
answered identically; the internal denial reason is never consulted when
producing the public response.

**Expressly not established:**

> **Phase 11 does not establish timing-side-channel indistinguishability.**
> Statistical or constant-time equivalence of response latency between
> unauthorized-existing and nonexistent resources is not a Phase 11 closure
> guarantee, and no Phase 11 acceptance criterion depends on it.

This is a limitation of scope, not a permission. A **deterministic
existence-dependent branch** — a deliberate application path whose observable
behavior directly exposes protected existence — remains an in-scope Phase 11
defect. Inspection during P11-A2 found no such branch.

---

## 6. Known gaps at the time of writing

Recorded without concealment. Each is an open Phase 11 obligation, not a
disposed one.

| Gap | Adversary | Status |
|---|---|---|
| Client non-emission (Playbook §2.5) — accepted responses are not swept for data the acting Self is not entitled to | A9 | **PARTIAL** |
| Intra-request stale-decision window (§4) has no execution evidence | A6 | **PARTIAL** |
| TOCTOU: no construction races a ground change against an in-flight authorized operation | A6, A11 | **PARTIAL** |
| **P11A2-F1** — malformed path identifiers on `GET /artifacts/:id`, `GET /placements/:id`, `GET /placements/:id/recipients` escape PostgreSQL `22P02` into the generic `500` handler, while malformed mutation inputs already receive the intended `400`. Not a protected-existence oracle (the distinguishing input class is malformed-versus-well-formed), but it violates fail-closed malformed-request expectations | A10 | **OPEN DEFECT — must be repaired with regression coverage before closure** |
| No property/fuzz campaign over the ratified invariants; all cases are enumerated examples | A10, A11 | **ABSENT** |
| No sustained-contention evidence; maximum concurrency exercised anywhere is two operations | A11 | **ABSENT** |
| No permanent security regression corpus | all | **ABSENT** |

Carried forward from earlier phases and **not** disposed by Phase 11 to date:
rate limiting / login throttling / account lockout (deployment-blocking);
real-browser cookie, CORS, and `__Host-` verification (recorded in 0004 as
deferred to Phase 10, which closed without disposing it — it remains an
unresolved historical deferral); absence of CSP and broader XSS hardening; and
the recorded fact that consumer authentication is not final.

---

## 7. What this document does not establish

- It does not close any Phase 11 obligation.
- It does not report test results; no Phase 11 evidence run has occurred.
- It does not extend the T2 containment line or repeal the T3 exclusion.
- It does not convert the real-surface apparatus into a real-browser proof.
  Browser cookie policy, `__Host-` enforcement by a browser, CORS enforcement by
  a browser, address-bar navigation, reload persistence, and browser-origin
  resolution remain outside what that apparatus executes.
- It does not describe the §4 snapshot property as proven resilience.
