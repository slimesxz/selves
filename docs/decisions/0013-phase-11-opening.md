# 0013 — Phase 11: Adversarial and security testing (opening authority, Gate 1 rulings, coverage disposition)

- **Status:** **Phase 11 is OPEN, not closed.** This record establishes opening
  authority and the accepted coverage posture. It carries no closure.
- **Date:** 2026-08-28
- **Phase:** Playbook Phase 11 — Adversarial and security testing
- **Ruled by:** Liberty (chamber); recorded by Claude as engineer
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law.
  Where this record conflicts with AGENTS.md, AGENTS.md wins. This record
  introduces **no** ontological object, **no** product semantics, and **no**
  authorization, lifecycle, schema, API, or client change. The ontology remains
  exactly Self → Signal → Artifact → Placement → Graph.
- **Builds on:** [0004](./0004-auth-active-self.md) (runtime roles; recorded
  deployment-blocking limitations), [0005](./0005-authorization-service.md),
  [0006](./0006-artifact-placement-apis.md),
  [0007](./0007-key-lifecycle.md), [0008](./0008-row-level-security.md) (§0
  threat model, extended not replaced), [0009](./0009-phase-8-r4-ratification-c3-adopted.md)
  (§4.2 catalog-DML prohibition), [0011](./0011-phase-9-outbox-projections.md)
  (§7.1 amendment-ledger standing rule), [0012](./0012-phase-10.md) (§21 P10-N4
  permanent prohibition; §74 Phase 10 closure).
- **Procedural baseline at opening:** `d604cc0e8cad9c2ef5bf02e71727706fa6baff2b`
  ("P10-R82: close Phase 10"), network-verified against `origin/master`,
  ahead/behind `0 / 0`, tracked tree clean. Node v24.18.0.
- **Standalone artifacts established by this phase:**
  [threat-model.md](../threat-model.md),
  [authorization-matrix.md](../authorization-matrix.md).

---

## 1. Opening authority

Phase 10 closed at `d604cc0` under [0012 §74](./0012-phase-10.md). That closure
expressly **did not** open Phase 11 (§74.P). Phase 11 was opened by chamber
transmission, was not previously opened, and had no prior decision record,
branch, or implementation commit.

The governing Phase 11 purpose is recovered from
[the Playbook](../BACKEND_IMPLEMENTATION_PLAYBOOK.md), section 5, **PHASE 11 —
Adversarial and security testing**, which has never been amended (single commit
`33b1046`). It requires a security-focused test matrix over twenty-four
enumerated cases, integration tests against a real test PostgreSQL instance for
permission-critical behavior, and five deliverables: threat model, authorization
matrix, test report, known limitations, and issues that must block deployment.

**Controlling scope correction.** The Phase 11 charter issued by the chamber in
this phase is the controlling scope. The Playbook's twenty-four cases are the
**mandatory minimum**, not the complete workload. The chamber-added adversarial
families are additionally required, and Phase 11 may **not** be closed by
obtaining 24/24 Playbook coverage alone.

### 1.1 Inherited constraints, expressly carried

- **P10-N4** ([0012 §21](./0012-phase-10.md)) — permanent prohibition on any
  operation against `main` / `origin/main`. No later phase authorization lifts
  it. **In force throughout Phase 11.**
- **[0009 §4.2](./0009-phase-8-r4-ratification-c3-adopted.md)** — no direct DML
  against any system catalog.
- **[0008 §0](./0008-row-level-security.md)** — T1/T2/T3 and the T2 containment
  line; the T3 exclusion is not repealed.
- **[0011 §7.1](./0011-phase-9-outbox-projections.md)** — a change to a baseline
  file enters the amendment ledger regardless of how it is characterized.
- **[0004](./0004-auth-active-self.md)** — recorded deployment-blocking
  limitations remain live; see §5.
- Node **24.18.0** (`>=24.18.0 <25`, `engine-strict`).

### 1.2 Expressly not inherited

Phase 10 residue does not become Phase 11 scope by adjacency. Phase 11 does not
close the eleven OPEN mounted bindings, dispose the sixteen Class B
propositions, repair or rerun P10-BR2, reopen §52 7.6, clean the BR5 runtime
artifact, or write §75 into 0012.

---

## 2. Gate 1 rulings Q1–Q12

| # | Question | Ruling |
|---|---|---|
| **Q1** | `CLAUDE.md` staleness | **ADOPT — reconcile at P11-B.** The statement that no phase beyond P7-E is authorized is materially false. Smallest governance-only correction; no historical ruling rewritten; no duplicated phase ledger. |
| **Q2** | Threat-model scope | **EXTEND, DO NOT SUPERSEDE.** 0008 §0 remains authoritative for the database/RLS boundary. Phase 11 extends across the integrated system without repealing the T3 exclusion, and must distinguish **tested resilience** from a newly claimed containment guarantee. |
| **Q3** | Client tampering | **Server-side-only is not sufficient.** The case concerns the integrated system. The eventual test must exercise an already-observable production boundary and prove both that unauthorized authority cannot be manufactured **and** that accepted responses do not emit protected data for the client to hide cosmetically. No forbidden instrumentation; no mounted binding reopened; STOP and return to chamber if unconstructible. |
| **Q4** | Deliverables | **Standalone documents in `docs/`, ratified by decision record 0013.** No `§75` in 0012. Filenames builder-autonomous if unambiguous and stable. |
| **Q5** | 0004 limitations | **CONSOLIDATE; DO NOT SILENTLY DISCHARGE.** Every still-live limitation appears in the known-limitations analysis. The stranded real-browser cookie/CORS/`__Host-` item remains an unresolved historical deferral unless affirmative evidence disposes it. |
| **Q6** | Test-only state | **SPLIT.** Transaction-scoped fixture data and deliberate corruption of **existing projection rows in an isolated test database** are authorized where necessary. Production schema changes, migrations, new roles, grants, tables, columns, functions, catalog mutation, and persistent privilege changes are **not**. Projection corruption must test whether poisoned **derived** state can manufacture authority; it must not modify authoritative records. |
| **Q7** | Baseline freeze | **NOT BYTE-FROZEN.** Existing tests may be extended in place; new files may be added. Every touched pre-Phase-11 baseline file enters the amendment ledger under 0011 §7.1. Tests may not be weakened, deleted, or generalized to make a new result green without explicit justification and chamber review. |
| **Q8** | Evidence environment | **AUTHORIZED when required by the authorized segment.** The normal isolated test PostgreSQL/Docker substrate may be used by segments requiring execution. Not authority to repair unrelated host state, alter persistent infrastructure, or clean Phase 10 residue. Read-only segments do not start it. |
| **Q9** | Property/fuzz testing | **ADOPT `fast-check`** as a test/dev dependency during P11-C; never a production dependency and never in production code. The campaign encodes ratified invariants — placement lifecycle legality, recipient freeze and uniqueness, Key grant/revocation, three-Self cardinality and slot uniqueness, payload-type boundaries, and authority isolation where a tractable model exists. Deterministic seeds/replay. Genuine counterexamples are minimized and promoted into the permanent regression corpus. |
| **Q10** | Load/concurrency testing | **DEPENDENCY-FREE in-process harness.** No `k6`, Artillery, or autocannon. Built on the existing real PostgreSQL pools, the production surface where appropriate, and the current deterministic concurrency infrastructure. The purpose is **security-semantic contention, not benchmarking**; throughput, RPS, and latency targets are **not** acceptance criteria. Must sustain overlapping operations and pooled-connection reuse, then establish that contention alters no security or lifecycle semantics. Record concurrency level, operation count, seed/execution information, and every failure. |
| **Q11** | `real-surface-journey` status | **The Phase 10 construction disclaimer remains historically valid; Phase 11 expressly authorizes execution of the existing apparatus as Phase 11 evidence.** The distinction is temporal. The test report must cite the **Phase 11** authorization and must **not** retroactively attribute observations to Phase 10. This does not convert the apparatus into a real-browser proof: browser cookie policy, `__Host-` enforcement by a browser, CORS enforcement by a browser, address-bar navigation, reload persistence, and browser-origin resolution remain outside what it executes. |
| **Q12** | Timing as an oracle dimension | **RECORD AS KNOWN LIMITATION.** Deterministic, application-controlled observables are in scope and must be indistinguishable where the contract requires. Statistical timing indistinguishability is **not** a Phase 11 closure criterion. This is not permission to retain a deterministic existence-dependent branch, which remains an in-scope defect. |

---

## 3. Segment disposition

| Segment | Status |
|---|---|
| **P11-A** — adversarial coverage ledger (read-only) | **ACCEPTED with corrections.** |
| **P11-A2** — assertion-level coverage audit (read-only) | **ACCEPTED.** |
| **P11-B** — threat model, authorization matrix, `CLAUDE.md`, this record | **AUTHORIZED; this record is its product.** |
| **P11-C** — gap closure | **NOT AUTHORIZED.** |
| **P11-D** — evidence run and test report | **NOT AUTHORIZED.** |
| **P11-E** — known limitations and deployment blockers | **NOT AUTHORIZED.** |
| **P11-F** — closure | **NOT AUTHORIZED.** |

Two corrections were ruled against P11-A and carried here. First, the chamber
family tally is **12**, not 11: "stale sessions and decisions" separates into
**stale-session attempts** and **stale-decision attempts** for closure
accounting. Second, completing the assertion-level audit is **not** P11-C work;
it was designated **P11-A2** and remained read-only.

---

## 4. Accepted coverage posture (P11-A + P11-A2)

Thirty-six obligations are separately accounted: **24 mandatory Playbook cases**
and **12 chamber attack families**. Beneath three of the twelve headings the
sub-obligations carry divergent statuses and are itemized rather than collapsed,
which the chamber accepted; the itemized total is **16** family obligations.

**Playbook cases: 23 PROVEN-EXISTING · 1 PARTIAL (client tampering) · 0 ABSENT.**

**Chamber families: 10 PROVEN-EXISTING · 3 PARTIAL · 3 ABSENT.**

| Family | Status |
|---|---|
| 1 cross-account attacks | PROVEN-EXISTING |
| 2 sibling-Self attacks | PROVEN-EXISTING |
| 3 acting-Self substitution | PROVEN-EXISTING |
| 4 **stale-session attempts** | PROVEN-EXISTING |
| 5 **stale-decision attempts** | **PARTIAL** |
| 6 repository / direct-DB / privilege-boundary bypass | PROVEN-EXISTING |
| 7a revocation races · 7b placement-state races | PROVEN-EXISTING (deterministic) |
| 7c **TOCTOU** | **PARTIAL** |
| 8a recipient-set leakage · 8b existence oracles | PROVEN-EXISTING |
| 9 projection poisoning + replay/duplicate delivery | PROVEN-EXISTING |
| 10a privilege escalation | PROVEN-EXISTING |
| 10b **malformed/adversarial input** | **PARTIAL** |
| 11 **fuzz/property testing** | **ABSENT** |
| 12a **load/concurrency under contention** | **ABSENT** |
| 12b **permanent regression corpus** | **ABSENT** |

Classifications rest on assertion-level inspection of the decisive test cases,
their enforcement boundaries, and — where tests cannot answer the question — the
committed production source. Every security-critical database claim reaches real
PostgreSQL enforcement through a connection authenticated as the real
constrained role; none is mocked. Concurrency-sensitive claims that are marked
PROVEN use deterministic coordination (an observed `pg_stat_activity` lock wait
that raises if it never occurs), not timing repetition.

### 4.1 Read-path semantics recovered during P11-A2

> Protected reads establish acting-Self context, authorization predicates, the
> authorization decision, and the protected read inside one REPEATABLE READ
> transaction and one MVCC snapshot. This prevents a concurrent commit from
> widening the result after an allow decision. It also means an in-flight
> request may complete according to the snapshot established before a
> subsequently committed revocation or other ground change. Phase 11 treats that
> as a bounded intra-request snapshot property, not as standing authority across
> requests.

This is **architectural reasoning read from committed source, not execution
evidence.** It is expressly **not** recorded as proven adversarial resilience.
The evidence is owed by C2. It is consistent with AGENTS.md §5: revocation is
prospective.

This recovery is the reason family 5 is PARTIAL and was **downgraded** from the
combined P11-A classification: a stale-session proof is not a stale-decision
proof.

---

## 5. P11A2-F1 — accepted open Phase 11 defect

**Accepted by the chamber as a Phase 11 defect. Unrepaired.**

`GET /artifacts/:id`, `GET /placements/:id`, and `GET /placements/:id/recipients`
(`src/routes/domain.ts`) pass an unvalidated path identifier to the
`AuthorizationService` with no error mapping, unlike every mutation route, which
wraps its call and maps `22P02` to the ratified `400 {"error":"bad_request"}`. A
malformed path identifier therefore raises PostgreSQL `22P02`, escapes to the
generic error handler, and returns `500 {"error":"internal_error"}`, where a
well-formed unknown identifier returns `404 {"error":"not_found"}`. The comment
in `src/authz/reasons.ts` describing `22P02` as "route validates first;
belt-and-braces" does not hold for these three read routes.

**Characterization, as accepted:** this is **not** presently evidence of a
protected-existence oracle, because the distinguishing input class is
malformed-versus-well-formed, not unauthorized-existing-versus-nonexistent; two
well-formed identifiers remain byte-identical. It nevertheless violates the
fail-closed malformed-request expectations of Phase 11.

**No test in the estate exercises a malformed path identifier on any production
route.** Every occurrence of a malformed identifier in the estate is in the
`X-Acting-Self` header position.

**Disposition:** repair with regression coverage is required before Phase 11
closure, and is scheduled into P11-C as C7. The repair itself is **not yet
authorized**. When P11-C opens: add regression coverage establishing the desired
malformed-identifier contract first, then make the **smallest** production
correction that maps malformed identifiers to the existing bad-request
semantics. **Do not invent a new error taxonomy.** Because this modifies
`src/routes/domain.ts`, that baseline production-file amendment is individually
ledgered; if the smallest correct fix would require a broader API-semantic
change, **STOP for ruling**.

---

## 6. Remaining obligations and carried limitations

**PARTIAL:** Playbook case 22 (client tampering — non-emission unproven);
family 5 (stale-decision); family 7c (TOCTOU); family 10b (malformed input).
**ABSENT:** family 11 (fuzz/property); family 12a (contention); family 12b
(regression corpus).
**Open defect:** P11A2-F1.

Carried from [0004](./0004-auth-active-self.md) and **not** disposed to date:
rate limiting / login throttling / account lockout (deployment-blocking);
real-browser cookie, CORS, and `__Host-` verification (recorded as deferred to
Phase 10, which closed without disposing it — an unresolved historical
deferral); no CSP or broader XSS hardening; consumer authentication is not
final. Per Q5 these are consolidated, not discharged.

Per Q12, the threat model records that Phase 11 does not establish
timing-side-channel indistinguishability.

---

## 7. P11-C backlog (design only; NOT AUTHORIZED)

| Item | Scope |
|---|---|
| **C1** | Integrated client tampering **and** forbidden-data non-emission, over the Q11-authorized real-surface apparatus, using already-observable production boundaries only. |
| **C2** | Adversarial TOCTOU / stale-decision proof. **`helpers/race.ts` cannot be assumed adequate:** its mechanism observes a PostgreSQL **lock wait**, whereas the read path uses REPEATABLE READ/MVCC and may intentionally never block on the concurrent commit. C2 must construct deterministic synchronization appropriate to the actual phenomenon at an already-authorized test boundary. **No production instrumentation.** If deterministic placement of the authorized read relative to snapshot establishment and the concurrent ground mutation cannot be observed or controlled through existing test/database boundaries, **return to chamber rather than substituting timing sleeps**. |
| **C3** | No statistical timing test. Q12 is carried into the threat model and the known-limitations report. |
| **C4** | Property/stateful fuzz campaign per Q9. |
| **C5** | Dependency-free contention campaign per Q10. |
| **C6** | Permanent security regression corpus — durable convention and location; minimized counterexamples promoted into it. |
| **C7** | P11A2-F1 regression coverage and minimal repair, per §5. |

---

## 8. Deliverable status

| Deliverable | Status |
|---|---|
| Threat model | **Created** — [threat-model.md](../threat-model.md) |
| Authorization matrix | **Created** — [authorization-matrix.md](../authorization-matrix.md) |
| Test report | **Not created.** No Phase 11 evidence run has occurred. Reserved for P11-D. |
| Known limitations (consolidated) | **Not created.** Reserved for P11-E. |
| Deployment-blocking issues | **Not created.** Reserved for P11-E. |

The three uncreated deliverables are deliberately **not** populated ahead of the
segments that generate their evidence. Their eventual existence is reserved
here; nothing in this record asserts results that have not been observed.

---

## 9. What this record does not do

**It does not close Phase 11.** It does not authorize P11-C, P11-D, P11-E, or
P11-F. It does not report test results. It does not repair P11A2-F1. It does not
discharge any carried limitation. It does not add a dependency. It does not
modify production source or test source. It does not reopen Phase 10, close a
mounted binding, dispose a Class B proposition, or write `§75` into 0012. It
does not authorize a commit or a push, and it performs neither.

> **PHASE 11 — OPEN.**
> **P11-C THROUGH P11-F — NOT AUTHORIZED.**
