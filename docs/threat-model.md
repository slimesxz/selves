# Selves — Phase 11 whole-system threat model

- **Status:** Phase 11 artifact. **Phase 11 closed under decision record [0013](./decisions/0013-phase-11-opening.md) §12.**
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
- **Phase 12 amendment:** extended by
  [0014](./decisions/0014-phase-12-object-storage.md) with **§8**, the
  object-storage trust boundary. Sections 1–7 are unchanged and **T1/T2/T3 are
  not widened**: the object store is an additional trust boundary with
  separately stated guarantees.

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
STATIC for the absence of cross-request memoization in `src/authz/**`; and, for
the intra-request property described in §4, **RUNTIME + DATABASE** since C2 —
see §4.1. It was ARCHITECTURAL only when this model was first filed.

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
**Evidence:** **RUNTIME — both halves established by C1.** Refusal of tampered
client material (acting-Self substitution and fabrication, path identifiers,
body identifiers, stale client-held Self state, capability tampering,
account-scoped body identifiers) and **non-emission**, asserted against the raw
response bytes at the production boundary with an entitled-recipient control
proving the detection is not vacuous. The apparatus's browser limitations are
unchanged — see §7.

### A10 — Malformed-input adversary
**Controls:** payload shape, field types, and identifier syntax.
**Must not achieve:** an unhandled failure path, an injected query, or a
non-fail-closed outcome.
**Evidence:** DATABASE and RUNTIME for payload-type boundaries, malformed
bodies, and SQL-injection payloads (bound as data; never parsed as SQL).
Malformed path identifiers were an open defect (**P11A2-F1**); it is **closed**
by C7 regression plus a minimal correction, and the three protected read routes
now **map** malformed UUID failures into the existing 400 bad-request path —
**they do not pre-validate UUIDs**.

### A11 — Concurrency adversary
**Controls:** overlapping operations, connection reuse, racing lifecycle
transitions.
**Must not achieve:** context leakage between requests, duplicated
authority-bearing effects, illegal lifecycle results, or resurrection of
revoked authority.
**Evidence:** DATABASE and RUNTIME for paired operations and pooled backend
reuse, and — since C5 — for **sustained contention**: 400 operations at
concurrency 16 over a 6-connection pool, zero violations, with security-semantic
postconditions asserted afterwards.

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

**Evidence class when this model was first filed: ARCHITECTURAL.** The paragraph
above was *derived* from the committed implementation (`src/db.ts`,
`src/authz/service.ts`) rather than observed, and was expressly not claimed as
proven adversarial resilience. **That derivation stands and is retained** — it is
what explains *why* the behaviour holds, and it remains the reasoning a future
reader needs.

### 4.1 · Executed adversarial confirmation (C2)

**The execution evidence owed by C2 now exists.** It does not replace the
derivation above; it confirms it, and it upgrades the evidence class for this
property from ARCHITECTURAL to **RUNTIME + DATABASE**.

`server/test/security/concurrency/c2-stale-decision-snapshot.test.ts` proves
**both orderings** against real PostgreSQL:

- a ground change (Key revocation — an already-ratified *prospective* authority
  transition) committed **before** the read transaction opens → the current
  ground governs and the request is **denied**;
- a ground change committed **after** the in-flight read has established its
  snapshot → that request completes according to its established snapshot, the
  grant is confirmed authoritatively revoked, and **the next request is
  denied**.

The synchronization is deterministic and is part of the proof: the read path's
*first* statement (`set_acting_self`) acquires the snapshot and does not touch
`public.key_grants`, while its *second* statement (`artifact_facts`) does. A
session holding `ACCESS EXCLUSIVE` on that table therefore blocks the read
strictly **after** its snapshot exists, and the block is a definite, observable
condition. There are no sleeps, no arbitrary delays, no retry-until-it-happens
loops, and no probabilistic success; the harness **raises** rather than
proceeding if the wait is never observed, so it can fail but cannot pass by
luck.

**The bounded intra-request semantics are unchanged by this confirmation**: the
window is one in-flight request long, and it is never standing authority across
requests. Evidence detail is in
[phase-11-test-report.md](./phase-11-test-report.md) §C and §D.

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

*Every gap recorded when this model was first filed has since been discharged by
executed evidence. The table is retained, with each row's disposition, so the
history is legible rather than erased.*

| Gap as first recorded | Adversary | Disposition |
|---|---|---|
| Client non-emission (Playbook §2.5) — accepted responses are not swept for data the acting Self is not entitled to | A9 | **DISCHARGED — C1 §2** |
| Intra-request stale-decision window (§4) has no execution evidence | A6 | **DISCHARGED — C2** (§4.1) |
| TOCTOU: no construction races a ground change against an in-flight authorized operation | A6, A11 | **DISCHARGED — C2** |
| **P11A2-F1** — malformed path identifiers escaped PostgreSQL `22P02` into the generic `500` handler | A10 | **CLOSED — C7** regression plus minimal correction |
| No property/fuzz campaign over the ratified invariants | A10, A11 | **DISCHARGED — C4** (5 properties, 120 runs, seed 20260828) |
| No sustained-contention evidence | A11 | **DISCHARGED — C5** (400 ops, concurrency 16, pool 6) |
| No permanent security regression corpus | all | **ESTABLISHED — C6** |

**No gap in this table remains open.** The limitations that *do* remain are not
gaps in Phase 11's adversarial evidence but bounded properties and inherited
deployment items, consolidated with their classifications in
[known-limitations.md](./known-limitations.md), with the deployment-blocking
subset in [deployment-blockers.md](./deployment-blockers.md).

Carried forward from earlier phases and **not** disposed by Phase 11: rate
limiting / login throttling / account lockout (deployment-blocking); real-browser
cookie, CORS, and `__Host-` verification (recorded in 0004 as deferred to
Phase 10, which closed without disposing it — an unresolved historical
deferral); absence of CSP and broader XSS hardening; and the recorded fact that
consumer authentication is not final. Each is classified in
[known-limitations.md](./known-limitations.md); the three that block deployment
are **DB1–DB3** in [deployment-blockers.md](./deployment-blockers.md). The
**T3** exclusion of §2 is unchanged and is **not** a deployment blocker:
credential custody and host integrity are recorded there as environmental
responsibility outside the blocker set, and **Phase 11 makes no T3 containment
claim**.

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

---

## 8. Phase 12 extension — the object-storage trust boundary

Recorded under [0014](./decisions/0014-phase-12-object-storage.md). Phase 12 is
**Boundary Only**: `photo` is not a creatable Artifact payload, there is no
production HTTP route, no production caller, and no provider adapter. What
follows models the boundary that a future binary-bearing Artifact slice will
consume, and the properties Phase 12 actually proved about it.

**§7's disclaimers remain in force** and are extended by §8.4.

### 8.1 The boundary is separate from the database boundary

> **The object store is an additional trust boundary. It is not inside T2.**

T1, T2, and T3 in §2 remain authoritative, unchanged, and scoped to the
PostgreSQL/RLS boundary. Compromise of the object store is a **different event**
from compromise of PostgreSQL, and satisfaction of the T2 containment line says
**nothing** about it. In particular, **compromise of storage-driver credentials
is not claimed to be contained by T2, or by any control this phase examined.**

Two structural facts bound what an object-store compromise reaches: the store
holds bytes and no principal, policy, or authorization state; and no
authorization question anywhere in the system is answered by consulting it.

### 8.2 The adversary catalogue O1–O10

| ID | Adversary / event | Must not achieve | Disposition and evidence |
|---|---|---|---|
| **O1** | **Object-store compromise**, distinct from PostgreSQL compromise | Any authorization ground; any authoritative fact | Bytes held in the store are readable by whoever holds the store. **No ground is obtainable**: the store contains no authorization state and is never consulted by a decision. *(ARCHITECTURAL for the compromise itself; STATIC for "the boundary names no authoritative surface and holds no database handle".)* |
| **O2** | **Leaked upload or download authorization** | Unbounded access | A bearer credential; exposure is bounded by the ratified lifetime (≤ 300 s). It names one object and one mode. *(RUNTIME)* |
| **O3** | **Replay before expiry** | — | **Succeeds by design.** An unexpired credential is redeemable by whoever holds it. Recorded, not concealed. *(RUNTIME)* |
| **O4** | **Replay after expiry** | Access after the bound | Denied. Redemption is valid strictly while `now < expiresAt`; at `now === expiresAt` it is `expired`. Proven by advancing an injected clock — no sleeps. *(RUNTIME)* |
| **O5** | **Object-key guessing** | Entitlement from an identifier | **No untrusted or external principal supplies an `ObjectKey` to the application-level issuer.** Issuance is addressed by `artifactId`; the key is resolved internally, and only after the authoritative allow. The byte-plane port *does* accept a key from its trusted internal caller, and possession of a key is still insufficient: redemption additionally requires a valid, unexpired, mode-correct credential. **Key secrecy is defence in depth, never an authorization ground.** *(RUNTIME)* |
| **O6** | **Confused-deputy issuance** | Issuance for a principal without authority | Bounded by the PostgreSQL-first ordering: `readArtifact` executes first, and a denied read causes **zero** binding lookups. The acting Self comes from the verified request context, never from an argument. *(RUNTIME)* |
| **O7** | **Authorization minted before revocation, exercised after** | — | **Remains usable until its bounded expiry.** Phase 12 provides no stronger revocation guarantee, and the port deliberately exposes no revocation operation — a presigned-URL provider could not honour one. The short lifetime is what bounds the residual exposure. Proven in both limbs. *(RUNTIME)* — recorded as **L14**. |
| **O8** | **Authorization requested after revocation** | A fresh capability | **Not issued.** Loss of the revocable Artifact-read ground yields opaque `{ ok: false }`, indistinguishable from every other denial. This is the mandatory Phase 12 proof. *(RUNTIME + DATABASE)* |
| **O9** | **Permanent or public URL exposure** | A durable unauthenticated fetch path | **Outside the Phase 12 representation.** `ObjectAuthorization` declares no `url` member; no URL form of an authorization exists to leak or persist. *(STATIC, by interface-member lock)* |
| **O10** | **Storage-driver credential compromise** | — | **Provider/deployment responsibility.** Phase 12 selects no provider, ships no adapter, and **proves nothing here**. Not contained by T2. *(No evidence. Recorded as unproven.)* |

### 8.3 What storage activity cannot manufacture

No object-store operation produces an Artifact, an association, a Key grant, a
Graph edge, a projection row, or an outbox event. A successful upload creates
private byte-plane state and nothing else. *(RUNTIME by authoritative row-count
equality across `artifacts`, `placements`, `placement_recipients`, `key_grants`,
and `outbox_events`; STATIC as to the source-level absence of any write path.)*

Upload authorization additionally confers **no** authority over an authoritative
Artifact. Phase 12 ratifies no production upload issuance service, because no
production authority for unattached uploads has been ratified.

### 8.4 What §8 does not establish

- It does not extend the T2 containment line, and it makes **no** claim that
  storage-credential compromise is contained.
- It does not model any cloud provider's signed-request semantics. All
  byte-plane evidence is over the dependency-free local driver.
- It does not claim retroactive erasure of disclosed bytes (**L13**) or of an
  already-issued authorization (**L14**).
- It does not introduce a deployment blocker; see
  [deployment-blockers.md](./deployment-blockers.md).
