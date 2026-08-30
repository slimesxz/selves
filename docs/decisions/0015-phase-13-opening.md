# 0015 — Phase 13: CI, observability, and operational safety (opening authority, Gate 1 rulings, governing exit condition)

- **Status:** **PHASE 13 — CLOSED** at §11 (P13-H), subject to that segment's own
  transmission and hosted-CI acceptance. Segments A–H are closed. **Closure of
  Phase 13 is not authorization to deploy** — DB2 and DB3 remain open; see §11.7.
- **Date:** 2026-08-29 (opened) · 2026-08-30 (closed)
- **Phase:** Playbook Phase 13 — CI, observability, and operational safety
- **Ruled by:** Liberty (chamber); recorded by Claude as engineer
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law.
  Where this record conflicts with AGENTS.md, AGENTS.md wins. This record
  introduces **no** ontological object, **no** product semantics, and **no**
  authorization, lifecycle, schema, API, projection, or client change. The
  ontology remains exactly Self → Signal → Artifact → Placement → Graph.
- **Builds on:** [0004](./0004-auth-active-self.md) (the runtime pin; the
  deployment-blocking limitations from which DB1 descends),
  [0008](./0008-row-level-security.md) (§0 T1/T2/T3),
  [0009](./0009-phase-8-r4-ratification-c3-adopted.md) (§3.2 operational state
  is never a history; §3.4 the credential must not reach statement logging or
  monitoring), [0011](./0011-phase-9-outbox-projections.md) (§2.4 the closed
  observability classification; Q12 the exhaustive `selves_worker` EXECUTE
  surface; §7.1 the amendment-ledger standing rule),
  [0012](./0012-phase-10.md) (§21 P10-N4 permanent `main` prohibition; P10-F2
  the closed root manifest), [0013](./0013-phase-11-opening.md) (the
  Playbook-as-minimum model; evidence classes; DB1–DB3),
  [0014](./0014-phase-12-object-storage.md) (Phase 12 closure; the DB4 lesson).
- **Procedural baseline at opening:** `9128834754e6a7782c45de0c38d07c89310128ab`
  ("P12-F: close Phase 12"), **network-verified** against `origin/master` in the
  opening session. Node v24.18.0.

---

## 1. Opening authority

Phase 12 closed at `9128834` under [0014 §10](./0014-phase-12-object-storage.md).
That closure expressly authorized no later phase.

Phase 13 was opened by chamber transmission in the session that also authorized
the Phase 12 transmission. Two acts occurred in that order and are recorded
separately because they are separate:

1. **Phase 12 transmission.** The five Phase 12 commits (`P12-B` … `P12-F`)
   existed only locally at Phase 12 closure. The chamber authorized exactly one
   network mutation, `git push origin master:master`, conditioned on a plain
   fast-forward from `b5de44e` to `9128834`. The push was performed after the
   preconditions were verified and the result was independently verified over
   the network:

   ```text
   9128834754e6a7782c45de0c38d07c89310128ab	refs/heads/master
   ```

   No force, no tags, no new branches, no amendment, and no operation on `main`
   or `origin/main`.

2. **Phase 13 opening.** The same transmission opened Phase 13 for read-only
   substrate verification, authority recovery, and the Gate 1 packet, and
   expressly superseded the `CLAUDE.md` statement that no phase after Phase 12
   was authorized. That statement was historically correct until the ruling.

**A prior session's halted report is superseded.** It reported that Node
24.18.0 was unavailable, that the network was unreachable, and that no Selves
checkout was mounted. All three were false of the environment in which Phase 13
actually opened. It is recorded here because the transmission discipline in
[0008 §8](./0008-row-level-security.md) is the reason the halt cost nothing:
nothing was inferred from it, and no repository state depended on it.

### 1.1 Inherited constraints, expressly carried

- **P10-N4** ([0012 §21](./0012-phase-10.md)) — permanent prohibition on any
  operation against `main` / `origin/main`. `main` is the GitHub Pages branch
  serving the live site at selves.id. No later phase authorization lifts it.
  **In force throughout Phase 13**, and reaffirmed by C.5 below.
- **P10-F2** ([0012 §11](./0012-phase-10.md)) — the root `package.json` shape is
  closed. Reaffirmed by C.4.
- **[0011 §2.4](./0011-phase-9-outbox-projections.md)** — infrastructure
  telemetry is a **closed classification**; no behavioral telemetry without a
  ruling. This is the governing prior ruling of the phase.
- **[0011 Q12](./0011-phase-9-outbox-projections.md)** — `selves_worker`'s
  EXECUTE surface is exactly `proj.process_outbox(integer)` and
  `proj.outbox_depth()`. Carried into C.11.
- **[0011 §7.1](./0011-phase-9-outbox-projections.md)** — a change to a baseline
  file enters the amendment ledger regardless of how it is characterized.
- **[0009 §3.4](./0009-phase-8-r4-ratification-c3-adopted.md)** — the session
  credential must never appear in statement text and must not become visible
  through `pg_stat_activity` to any monitoring or operator role.
- **[0008 §0](./0008-row-level-security.md)** — T1/T2/T3 and the T2 containment
  line; the T3 exclusion is not repealed.
- Node **24.18.0** (`>=24.18.0 <25`, `engine-strict`).

### 1.2 Expressly not inherited

Phase 12 residue and Phase 10 residue do not become Phase 13 scope by adjacency.
Phase 13 does not dispose DB2 or DB3, does not resolve the object-storage
deferred implementation requirements ([0014 §7](./0014-phase-12-object-storage.md)
items 8–10), does not close any Phase 10 mounted binding, and does not become the
deferred repository-hygiene phase.

---

## 2. The governing Phase 13 text (recovered)

The only definition of Phase 13 in the repository is
[the Playbook](../BACKEND_IMPLEMENTATION_PLAYBOOK.md) §5, **PHASE 13 — CI,
observability, and operational safety**:

| # | Task, as written |
|---|---|
| T1 | Add CI for: type checking; linting; unit tests; integration tests; migrations from zero; production build |
| T2 | Add structured server and worker logs |
| T3 | Add request correlation IDs |
| T4 | Add outbox backlog and failure visibility |
| T5 | Add database backup and restore documentation |
| T6 | Add migration rollback or forward-repair strategy |
| T7 | Add rate limits **only where they protect resources or security**; do not introduce engagement mechanics |
| T8 | Add privacy-conscious error reporting |
| T9 | *(prohibition)* Do not log Artifact contents or sensitive recipient lists unnecessarily |

The Playbook states a purpose and named deliverables. It states **no entrance
condition and no exit condition** for this phase. That absence is normal: no
Playbook phase has ever supplied its own exit condition. Phase 11's governing
exit sentence was a chamber act at
[0013 §12.2](./0013-phase-11-opening.md), and Phase 12's was chamber-restated at
[0014 §10.1](./0014-phase-12-object-storage.md). The Gate 1 packet reported the
absence rather than filling it; the chamber supplied it at C.1 below.

---

## 3. Accepted Gate 1 facts

The Gate 1 packet was accepted as the controlling Phase 13 design record. Its
substrate findings are recorded here as accepted facts. **Evidence class:
STATIC** — read from committed source at `9128834`, not re-executed. See §7.

### 3.1 State of the estate against T1–T9 at opening

| Task | State at opening |
|---|---|
| **T1 CI** | **Absent entirely.** No `.github/` and no CI configuration of any kind — the repository fact behind **L12**. Component commands exist per workspace (`server`: `typecheck`, `test`, `migrate`; `client`: `lint`, `test`, `build`). The root manifest has no scripts, so no aggregated command exists. |
| **T2 server logs** | **Substantially present.** `src/app.ts` builds Fastify with `logger: { level: 'info', redact: DEFAULT_REDACT }`, redacting `req.headers.cookie`, `req.headers["x-acting-self"]`, and `res.headers["set-cookie"]`. Request bodies are never logged, so login secrets never reach the logs. |
| **T2 worker logs** | **Present and already structured JSON.** `src/worker/main.ts` emits `processed`, `failed`, `unclaimed`, `dead`, `oldestUnclaimedAge` plus start/stop lines, and its header already binds it to the [0011 §2.4](./0011-phase-9-outbox-projections.md) closed classification. |
| **T3 correlation** | **Partial.** Fastify's built-in `req.id` exists and appears in request logs. No response header, no client propagation, no cross-process correlation. |
| **T4 outbox visibility** | **Partial, with a named gap.** `proj.outbox_depth()` exists but is executable only by `selves_worker` under the [0011 Q12](./0011-phase-9-outbox-projections.md) exhaustive list; the operator CLI has five subcommands and no outbox command. The worker queries depth only inside `if (processed > 0 \|\| failed > 0)`, so an unserviced or fully dead-lettered backlog produces no depth line at all. |
| **T5 backup/restore docs** | **Absent.** |
| **T6 migration rollback** | **Mechanism present, strategy undocumented.** All 29 migrations carry a Down section; `migrate:down` / `migrate:test:down` exist; migrate-from-zero is exercised by `migration.test.ts` and `globalSetup.ts`. No written strategy. |
| **T7 rate limits** | **Absent — this is DB1.** [deployment-blockers.md](../deployment-blockers.md) names Phase 13 as the venue. `POST /auth/session` is the deliberately auth-exempt surface. |
| **T8 error reporting** | **Partial.** The error handler logs `{ err }` and returns a generic envelope; non-leakage of internal reasons is ratified and proven ([0005](./0005-authorization-service.md)). No external sink exists. |
| **T9 prohibition** | **Currently satisfied by construction** — and precisely what a Phase 13 change could break. |

### 3.2 Surface Phase 13 must not disturb

- **20 HTTP routes**: four in `src/app.ts` (`GET /health`, `GET /auth/selves`,
  `POST /auth/session`, `DELETE /auth/session`) and the **sixteen frozen domain
  routes** in `src/routes/domain.ts` ([0014 R1](./0014-phase-12-object-storage.md)).
- **Inherited static locks** reported byte-unchanged and passing at Phase 12
  closure ([0014 §8](./0014-phase-12-object-storage.md)): `authz-import-graph`,
  `authz-no-memoization`, `http-credential-audit`, `production-routes`,
  `globalSetup`. The last two are the ones Phase 13 is most likely to approach.
- **A real-browser Playwright venue already exists** at `client/browser/`
  (`cors`, `direct-url`, `refresh`, `secure-cookie`), driven against installed
  Chrome with no Playwright-managed browser download.

### 3.3 Collisions identified at Gate 1

Six were reported. All six are disposed by the rulings in §4: X1 root manifest
(C.4), X2 the closed observability classification (C.3), X3 credentials and
monitoring (C.3, C.6), X4 CI and P10-N4 (C.5), X5 dependencies (C.7), X6 the
Phase 11 artifact titling tension (C.14).

### 3.4 Repository-state findings reported at Gate 1

Reported read-only and **not repaired at Gate 1**: `CLAUDE.md` staleness;
`server/README.md` staleness (including a runtime line contradicting the ratified
pin); the absent root `README.md`; the untracked, un-ignored
`client/test-results/.last-run.json`; and the Expo-leftover root `.gitignore`.
Their dispositions are ruled at C.13 and executed — in part only — by this
segment. See §6.

---

## 4. Gate 1 chamber rulings — CHAMBER TEXT, VERBATIM

The block between the two markers below is the chamber's Gate 1 disposition **as
transmitted**. It is reproduced verbatim. Only mechanical Markdown formatting has
been applied — heading levels, list markers, code spans, and line wrapping — as
required to render it inside this record. **Nothing in it has been shortened,
normalized, reinterpreted, or improved.**

Everything outside the markers, in this record and elsewhere, is builder text:
repository evidence, implementation implications, cross-references, segment
mapping, amendment-ledger entries, and evidence classification. The distinction
is the point of this section
([0008 §8](./0008-row-level-security.md) — rulings enter the repository from the
chamber, dated and attributable, never reconstructed from a builder or session
summary).

Two reading notes, builder-authored, offered before the block rather than inside
it: the chamber's reference to "B.2" in C.3 is the observability floor proposed
in the Gate 1 packet §B.2, and its reference to "A.1" in C.13 is that packet's
§A.1 recovery of the Playbook Phase 13 text and the Playbook §6 documentation
list. Neither reference is altered.

<!-- BEGIN CHAMBER TEXT — Phase 13 Gate 1 disposition, verbatim -->

### PHASE 13 — GATE 1 CHAMBER RULINGS

#### Governing charter

**Phase 13 — CI, Observability, and Operational Safety**

The Playbook's T1–T9 are the mandatory minimum, not an exhaustive license to
perform adjacent cleanup. The following chamber rulings supply the controlling
scope and exit condition. Anything not authorized here remains out of scope.

The governing principle is ratified, with one tightening:

> Phase 13 may observe the machine. It may not observe the person.
>
> Operational evidence may describe system state necessary to establish
> correctness, availability, failure, resource pressure, or recovery. It must
> not create or export a durable behavioral history of a person, Self,
> recipient, Artifact, or Placement.

No implementation is authorized by these rulings alone. They settle Gate 1 and
define the packet from which the next implementation charter may be constructed.

#### C.1 — Exit condition

**RULING: ADOPTED.**

Phase 13 closes only when:

> The estate automatically proves its required build and regression posture,
> exposes sufficient infrastructure-only evidence to diagnose operational
> failure, has a proven bounded defense on the authentication resource, and has
> documented recovery procedures — without creating behavioral telemetry,
> weakening an inherited security boundary, or making deployment readiness
> claims beyond the blockers actually discharged.

Closure requires all of the following:

1. CI proves the ratified typecheck/lint, unit/integration test,
   migration-from-zero, and production-build obligations from a clean checkout.
2. CI failure is fail-closed: a required check cannot silently skip because
   infrastructure is unavailable.
3. Server and worker operational logging is structured and satisfies the
   observability floor in C.3.
4. Request correlation exists only within the permitted request-local boundary
   established in C.10.
5. Outbox backlog/failure state has an explicitly authorized operational
   visibility path.
6. Authentication rate limiting is implemented and adversarially proven under
   C.7/C.8.
7. Backup/restore and migration rollback/forward-repair procedures are
   documented at the level authorized in C.9.
8. Privacy-conscious error handling is proven, including the T9 prohibition.
9. All inherited static locks and security tests remain unweakened.
10. The complete regression estate passes at the recorded Phase 13 closing tree.
11. Any baseline amendment is enumerated in the amendment ledger.
12. DB1 is disposed only according to C.8; DB2 and DB3 do not move by adjacency.
13. No Phase 13 work modifies or operationally acts upon `main`/`origin/main`
    contrary to P10-N4.
14. The decision record records the evidence, dispositions, residual
    limitations, and exact satisfaction of this exit condition.

That is the governing Phase 13 exit condition.

#### C.2 — Minimum or complete workload

**RULING: PLAYBOOK T1–T9 ARE THE MANDATORY MINIMUM; THIS CHARTER IS THE
CONTROLLING MAXIMUM.**

The Phase 11 model applies.

Work necessary to prove T1–T9 and the C.1 exit condition is authorized only
where expressly encompassed by these rulings or a later segment ruling.
"Operational safety" is not an open-ended cleanup license.

No unrelated refactor, dependency modernization, repository tidying, deployment
work, or blocker disposal enters Phase 13 by convenience.

#### C.3 — Observability floor

**RULING: B.2 ADOPTED, WITH REFINEMENT.**

Phase 13 operational telemetry may record things such as:

- process lifecycle and liveness;
- route templates, not caller-supplied URLs containing identifiers;
- HTTP method/status;
- bounded timing/duration;
- error class, not sensitive payload/context;
- queue aggregate depth, age, processed/failed/dead counts;
- migration/build/test state;
- non-personal resource-pressure information.

It may not log, metric-label, error-report, or otherwise export:

- account identifiers;
- Self identifiers;
- Artifact identifiers;
- Placement identifiers;
- recipient identities or recipient lists;
- Artifact contents;
- session credentials;
- cookies or authorization secrets;
- object keys or download capabilities;
- caller-supplied data capable of reconstructing those values;
- any actor→resource tuple or equivalent behavioral history.

The prohibition applies equally to application logs, worker logs, database logs,
CI output/artifacts, metrics, traces, exception reports, and future sinks
introduced within Phase 13.

Cardinality reduction does not cure forbidden semantics. Hashing or
pseudonymizing a forbidden identifier does not make it infrastructure telemetry.

A correlation ID is permitted under C.10.

Debugging that genuinely requires otherwise-forbidden information returns to
chamber.

#### C.4 — Root manifest

**RULING: OPTION (b).**

Do not amend the closed root `package.json`.

CI shall invoke the required workspace commands directly. P10-F2 remains intact.

A desire for a convenient aggregate local command is insufficient grounds to
reopen that lock.

#### C.5 — CI venue / P10-N4

**RULING: GITHUB ACTIONS AUTHORIZED, NARROWLY.**

A repository-local GitHub Actions workflow may be added for Phase 13 CI.

It may run for:

- pushes to `master`;
- pull requests whose base is `master`;
- manual `workflow_dispatch`, if useful for proving the workflow itself.

It must not target, deploy, push to, configure, inspect for operational
purposes, or otherwise act upon `main`.

This authorization does not authorize:

- changing the repository default branch;
- changing `origin/HEAD`;
- changing PR-base configuration;
- changing branch protection;
- changing Pages configuration;
- deployment;
- any mutation of `main` or `origin/main`.

A workflow trigger is not itself a branch-configuration mutation. Nevertheless,
there is no reason for Phase 13 CI to name `main`, so it should not.

Enabling ordinary GitHub Actions execution necessary for this committed workflow
is encompassed by this ruling. Repository administrative configuration beyond
that is not.

#### C.6 — CI credentials and browser venue

**RULING: DISPOSAL SPLIT.**

A disposable PostgreSQL service inside CI is authorized. Synthetic CI-only
credentials may be supplied to that disposable environment, provided they confer
no authority over a persistent or production database and are not reused as real
credentials.

The existing bootstrap/governed-database constraints remain binding. CI output
must satisfy C.3.

The existing real-browser venue may be run in CI if it can run from the clean CI
substrate without weakening its semantics or adding a browser-management
dependency merely for convenience. It is not mandatory to force that venue into
CI if the environment cannot faithfully reproduce it.

Most importantly:

DB2 is NOT discharged by Phase 13 merely because a browser suite exists or is
run in CI.

The tension you identified must be recorded. DB2 moves only through a separate,
explicit disposition proving that its own stated condition has been met. Phase
13 may generate evidence relevant to that later disposition; it does not inherit
authority to declare it closed.

#### C.7 — Dependencies / rate limiter

**RULING: AUTHORIZE `@fastify/rate-limit` FOR T7 ONLY, SUBJECT TO
IMPLEMENTATION-SCOPE REVIEW.**

A security control on an exposed authentication endpoint is a poor place to
create a bespoke limiter merely to preserve dependency count.

The first-party Fastify-family plugin is the preferred design candidate. Its
exact version, compatibility with the pinned Fastify/runtime substrate, keying
strategy, storage semantics, failure behavior, headers, testability, and
dependency-tree impact must be inspected before the segment writes it.

This is not yet permission to install it. The implementation segment must first
present those exact facts and receive segment authority.

No metrics SDK, tracing SDK, external error-reporting SDK, observability agent,
or other Phase 13 dependency is authorized.

#### C.8 — DB1

**RULING: PHASE 13 IS THE DISPOSITION VENUE FOR DB1.**

T7 must not merely install throttling. Phase 13 must implement and prove the
authentication-surface defense required by DB1.

DB1 may be marked discharged at Phase 13 closure only if its required evidence
succeeds and the closing decision record expressly disposes it.

Until then, DB1 remains open.

DB2 and DB3 remain unchanged. No inference from Phase 13 work alters either.

#### C.9 — Backup/restore

**RULING: DOCUMENTARY AND PROCEDURAL EVIDENCE ONLY; NOT A NEW DEPLOYMENT
BLOCKER.**

T5 does not promote backup posture into a deployment gate.

The documentation must nevertheless be useful: identify what authoritative state
requires backup, the expected backup/restore procedure, prerequisites,
destructive boundaries, verification after restoration, and what remains
environment/operator responsibility.

Where a safe disposable verification of documented commands is possible,
verification is desirable. Do not perform destructive recovery operations
against a persistent development or production-like database merely to prove the
document.

No managed backup provider, production retention policy, RPO/RTO promise, or
deployment requirement is implied.

#### C.10 — Correlation boundary

**RULING: REQUEST-LOCAL SERVER CORRELATION ONLY.**

T3 does not authorize server→outbox→worker correlation.

Use a fresh opaque correlation/request identifier for the HTTP request. It may
associate infrastructure-only log entries produced while servicing that request
and may be returned in a response header if the design chooses.

It must not:

- encode identity or resource information;
- be accepted from an untrusted caller without an explicit validation/replacement
  policy;
- be persisted to authoritative domain/outbox state;
- become a session identifier;
- create a cross-request user trail.

The worker remains independently observable through aggregate operational
evidence. No outbox schema change for correlation is authorized.

#### C.11 — Outbox visibility

**RULING: DO NOT WIDEN THE APPLICATION OR OPERATOR LOGIN PRIVILEGE SURFACE
MERELY FOR CONVENIENCE.**

Preserve the exhaustive `selves_worker` execution boundary unless evidence
proves that impossible.

The preferred design is an explicit operator action through the already-ratified
privileged operational posture, not a grant of `proj.outbox_depth()` to an
ordinary application/operator login.

P13-E must present the exact proposed invocation path and privilege proof before
implementation. If that requires amending an exhaustive prior grant list,
identify it explicitly in the amendment ledger and return for segment ruling.

Do not add an HTTP observability route.

#### C.12 — Baseline amendments

**RULING: AUTHORIZED IN PRINCIPLE, NOT BLANKET-AUTHORIZED.**

Phase 13 may amend baseline files when a ratified Phase 13 deliverable genuinely
requires it.

Every such amendment must:

1. be named before or at the segment boundary;
2. enter the amendment ledger;
3. state why the existing baseline is insufficient;
4. preserve the original invariant or identify the explicit chamber amendment to
   it;
5. never weaken a test merely to preserve green status.

The static locks themselves are evidence. Altering one is therefore more serious
than merely touching an ordinary source file and must be specifically justified.

#### C.13 — Repository hygiene

**RULING: SPLIT.**

`CLAUDE.md` — IN SCOPE. Correct the now-stale phase authorization statement as
the smallest governance-only update.

`server/README.md` — IN SCOPE. Correct the false runtime/workspace development
instructions as part of Playbook §6.

Root `README.md` — IN SCOPE ONLY IF required to satisfy Playbook §6 after
inspecting whether development instructions can authoritatively live elsewhere.
Do not create one merely because conventional repositories have one.

`client/test-results/.last-run.json` — OUT OF SCOPE AND UNTOUCHABLE UNDER THE
EXISTING RESIDUE RULING. Do not stage, delete, modify, or absorb it.

Root `.gitignore` cleanup — OUT OF SCOPE. Do not turn Phase 13 into the deferred
hygiene phase.

Other missing Playbook §6 documents identified in A.1 are not automatically
Phase 13 deliverables merely because Phase 13 is the final numbered Playbook
phase. Only T5/T6 and documentation directly necessary to close C.1 enter
automatically. Remaining §6 estate-wide documentation must be inventoried at
closure and reported as outstanding unless separately authorized.

#### C.14 — Artifact titles

**RULING: DO NOT RETITLE THE OLDER PHASE 11 ARTIFACTS.**

Continue the accepted additive/amendment pattern.

Historical titles are provenance. Their later amendment does not make those
titles false, and repeatedly renaming integrated evidence documents would
obscure rather than improve the ledger.

Phase 13 additions must be clearly labeled within the relevant artifacts as
Phase 13 amendments.

### GATE 1 DISPOSITION

Gate 1 is ACCEPTED WITH THE RULINGS ABOVE.

The proposed segmentation is accepted as the planning skeleton, with one
adjustment:

P13-B is authorized next as a governance/documentation-only segment.

Its permitted write surface is limited to:

- create the Phase 13 decision record recording the opening charter, Gate 1
  facts, these rulings, governing observability floor, exit condition, and
  planned segmentation;
- minimally update `CLAUDE.md` to record that Phase 13 is open;
- correct `server/README.md` only for the already-established runtime/workspace
  facts necessary to remove the stale instructions identified in Gate 1.

Do not yet modify application code, tests, workflows, package
manifests/lockfiles, dependencies, database objects, migrations, routes, client
code, `.gitignore`, or the Playwright residue.

P13-B must also preserve the fact that the regression estate has not yet been
re-executed in the Phase 13 session; recorded Phase 12 green evidence must not
be rewritten as fresh Phase 13 proof.

After P13-B, report the exact diff and stop for chamber review before commit
unless the governing chamber process independently gives commit authority at
that segment boundary.

P13-C and all implementation remain NOT AUTHORIZED.

<!-- END CHAMBER TEXT -->

---
## 5. Segmentation

The Gate 1 skeleton is accepted as the planning skeleton, with the P13-B
adjustment ruled at Gate 1 disposition.

| Segment | Content | Status |
|---|---|---|
| **P13-A** | Gate 1 packet | **ACCEPTED** |
| **P13-B** | This record; `CLAUDE.md`; `server/README.md` | **CLOSED** — `1acba05` |
| **P13-C** | T1 CI | **CLOSED** — `1d181d0` |
| **P13-D** | T2/T3/T8 observability under the C.3 floor, and the T9 prohibition proven by test | **CLOSED** — `8e54afd` |
| **P13-E** | T4 outbox visibility, under C.11 | **CLOSED** — `35b2f1d` |
| **P13-F** | T7 authentication rate limiting, under C.7/C.8 | **CLOSED** — `f7fb467` |
| **P13-G** | T5/T6 documentation, under C.9 | **CLOSED** — `e42918b` |
| **P13-H** | Record convergence and closure against C.1 | **CLOSED** — this section (§11) |

Segment lettering is a planning skeleton, not an authorization. Each segment is
authorized one at a time by ruling, and work stops at each segment boundary.

### 5.1 P13-B permitted write surface

**The authoritative statement of this surface is the chamber's own, in §4 under
GATE 1 DISPOSITION.** It is not restated here, so that no builder paraphrase of
it can drift from the ruling.

Builder record of what P13-B actually wrote against that surface: three files —
this record (created), `CLAUDE.md` (amended), `server/README.md` (amended).
Nothing else in the working tree was created, modified, staged, or deleted.

---

## 6. What P13-B did not repair

Recorded so no reader mistakes silence for absence of the problem. Each item was
identified at Gate 1 and is **left in place** because the C.13 write surface does
not reach it:

- **`server/README.md` residual staleness beyond the runtime/workspace facts.**
  Its opening sentence still describes the API, authorization, and projection
  worker as belonging to "later phases", and its setup section still states that
  no schema exists yet. Both are false at `9128834` — all three components and
  29 migrations exist. These are **schema- and phase-state** claims, not the
  runtime/workspace facts C.13 authorizes correcting, so they are reported here
  rather than repaired. Its command table also omits `bootstrap`, `start`,
  `worker`, `operator`, `typecheck`, `test`, and `migrate:test:down`.
- **Root `README.md` absent.** C.13 makes it conditional on an inspection that
  P13-B is not the segment to perform.
- **Root `.gitignore`** remains the Expo/React-Native leftover. Out of scope.
- **`client/test-results/.last-run.json`** remains untracked and un-ignored.
  Untouchable.
- **Playbook §6 estate-wide documentation** — architecture overview, schema
  diagram, projection/rebuild documentation, deployment runbook, open-questions
  register, constitutional compliance checklist — remains outstanding. Under
  C.13 this must be inventoried and reported at closure.

---

## 7. Evidence posture at P13-B — stated exactly

> **The regression estate has NOT been re-executed in the Phase 13 session.**

Every figure this record cites for the estate — server 63 files / 522 tests,
client 28 files / 181 tests, both typechecks — is **recorded Phase 12 evidence**
carried from [0014 §4](./0014-phase-12-object-storage.md). It is cited as the
inherited posture at the Phase 13 opening baseline. **It is not fresh Phase 13
proof and must never be reported as such.**

All §3 substrate findings are class **STATIC**: properties of the committed
source at `9128834`, established by reading it. No RUNTIME or DATABASE evidence
was produced by P13-A or P13-B, and none was required by either.

C.1 clause 10 requires the complete estate to pass **at the recorded Phase 13
closing tree**. That obligation is live and undischarged.

---

## 8. Amendment ledger (0011 §7.1)

**P13-B baseline amendments: two.** The complete Phase 13 ledger is at §11.4.

| # | Baseline file | Why the existing baseline is insufficient |
|---|---|---|
| 1 | `CLAUDE.md` | Its closing sentence states that no phase after Phase 12 is authorized. The Gate 1 opening ruling superseded that statement. Precedent for this exact correction is [0013 Q1](./0013-phase-11-opening.md) — the smallest governance-only correction, no historical ruling rewritten, no duplicated phase ledger. |
| 2 | `server/README.md` | It instructs a developer to install inside `server/` on the basis that no workspaces conversion has occurred, and states a Node baseline of "≥ 20.6 … developed on Node 25". The workspaces conversion occurred in Phase 10 (single root lockfile; `workspaces: ["client","domain","server"]`), and the ratified runtime is **24.18.0** with `>=24.18.0 <25` and `engine-strict=true` ([0004](./0004-auth-active-self.md)). Following the file as written selects a runtime the estate refuses. |

**Exactly four corrections were made to `server/README.md`, and no others:**

1. the standalone-package/"no workspaces yet" sentence → the three-workspace,
   single-root-lockfile fact, with install at the repository root;
2. the "Node.js ≥ 20.6 … developed on Node 25" prerequisite → the ratified
   **24.18.0** pin and the three mechanisms that enforce it;
3. the first-time-setup install step → root install, with the `cd server` step
   reduced to env configuration;
4. consequential renumbering of the two following setup steps (3→4, 4→5) so the
   corrected block reads as a coherent sequence.

Nothing else in the file was touched. Its residual staleness is enumerated in §6.

No test file, static lock, or production source file was amended in P13-B. This
record and any future Phase 13-native document are **additions**, not baseline
amendments.

---

## 9. Constitutional conformance

Phase 13 introduces no ontological object, no product semantics, no feed,
activity stream, notification path, discovery surface, presence mechanic,
relationship inference, derived ring, or Prism materialization.

The phase's specific constitutional exposure is named rather than assumed:
**observability is the shape under which behavioral telemetry would arrive.**
AGENTS.md §6 Test 5 forbids attention telemetry from shaping anything; Test 4
kills Presence under every name;
[0011 §2.4](./0011-phase-9-outbox-projections.md) closed the observability
classification to infrastructure telemetry only; and
[0009 §3.2](./0009-phase-8-r4-ratification-c3-adopted.md) holds that the
retention property of operational state is **constitutional, not operational**,
because an append-only variant would accumulate "a shadow of the Graph that no
placement authorized." C.3 is the written floor that keeps those prohibitions
mechanical rather than remembered.

The five objects remain exactly: Self, Signal, Artifact, Placement, Graph.

---

## 10. What this record does not do

*This section states the position **as the P13-B opening record was filed**, and
is preserved unaltered as history. **It is not a current-status statement.** Its
closure and authorization sentences are superseded by **§11**, which records
Phase 13 as closed. Read what follows as of the P13-B act only.*

- It does **not** close Phase 13, and it satisfies no clause of C.1.
- It does **not** authorize P13-C or any later segment, or any implementation.
- It does **not** install, propose installing, or select a version of any
  dependency, including `@fastify/rate-limit` (C.7 requires an inspection and a
  further segment authority first).
- It does **not** create, enable, or configure any CI workflow.
- It does **not** dispose DB1, DB2, or DB3, and creates no new blocker.
- It does **not** re-execute, re-verify, or restate the regression estate as
  Phase 13 evidence (§7).
- It does **not** repair the items enumerated in §6.
- It performs no operation on `main` or `origin/main`. **P10-N4 is preserved
  permanently.**
- It authorizes no commit and no push, and performs neither.

> **PHASE 13 — OPEN. GATE 1 — ACCEPTED. P13-B — governance and documentation
> only. P13-C onward — NOT AUTHORIZED.**
> **DB1 — open, Phase 13 is its authorized disposition venue. DB2 / DB3 —
> unchanged and open.**

---

## 11. PHASE 13 CLOSURE (P13-H)

*The closure record. It rests on the transmitted estate and on five
push-triggered hosted CI runs. No evidence was reopened, and no implementation
was touched to produce it: P13-H is a record-convergence segment, amending four
documents and no source, test, manifest, or workflow.*

### 11.1 The accepted commit sequence

Every segment was committed, transmitted as an ordinary single-commit
fast-forward, network-verified with `git ls-remote`, and independently proven by
a push-triggered hosted CI run.

| Commit | Segment | Hosted run | Conclusion |
|---|---|---|---|
| `1acba05` | P13-B — open Phase 13 and record its Gate 1 charter | — (governance only, preceded CI) | — |
| `1d181d0` | P13-C — add continuous integration | `33262606906` | success |
| `8e54afd` | P13-D — harden operational logging privacy | `33267108812` | success |
| `35b2f1d` | P13-E — add privileged outbox visibility | `33323350752` | success |
| `f7fb467` | P13-F — bound authentication resource consumption | `33325442822` | success |
| `e42918b` | P13-G — document and prove database recovery | `33326832396` | success |

**Closing implementation tree:** `e42918bd7d4c7d7c15926341c54fe92dd2672731`.

**Estate at that tree**, from hosted run `33326832396`:

```text
server   66 files / 561 tests passed
client   28 files / 181 tests passed
typecheck (server, client) and client production build green
0 non-success steps · 0 skipped steps
```

Five runs, five green, zero skipped steps in any of them.

### 11.2 T1–T9 disposition

| T | Obligation | Segment | Evidence |
|---|---|---|---|
| **T1** | CI: typecheck, lint, unit, integration, migrations-from-zero, production build | P13-C | `.github/workflows/ci.yml`; five hosted runs from a clean checkout |
| **T2** | Structured server and worker logs | P13-D | allowlist serializers; worker `errorClass`; `observability.test.ts` 12/12 |
| **T3** | Request correlation IDs | P13-D | Fastify `req.id`; `requestIdHeader` defaults false, so a caller cannot set it; no response header; no persistence |
| **T4** | Outbox backlog and failure visibility | P13-E | `operator outbox-depth` through `selves_worker`; `p9-worker-role.test.ts` 16/16 |
| **T5** | Backup and restore documentation | P13-G | [backup-and-recovery.md](../backup-and-recovery.md); recovery proof 6/6 |
| **T6** | Migration rollback / forward-repair strategy | P13-G | forward-repair doctrine; failed-migration atomicity proven |
| **T7** | Rate limits protecting resources/security only | P13-F | 30/60s per address on the two unauthenticated routes; `rate-limit.test.ts` 13/13 |
| **T8** | Privacy-conscious error reporting | P13-D | `{type, code}` allowlist; generic external envelope |
| **T9** | *(prohibition)* no Artifact contents or recipient lists logged | P13-D, held through P13-G | field-agnostic sweeps proving absence |

**The observability floor held under every later segment.** The concrete
regression that opened P13-D — identifier-bearing `req.url` records — went
**182 → 0** at P13-D and remained 0 in the P13-E, P13-F and P13-G hosted runs.
The production emission surface is closed and unchanged since P13-D: neither
P13-E nor P13-F added a single logging call.

### 11.3 C.1 exit condition — clause-by-clause adjudication

| # | Clause | Verdict |
|---|---|---|
| 1 | CI proves typecheck/lint, unit/integration, migration-from-zero, production build from a clean checkout | **SATISFIED** |
| 2 | CI failure is fail-closed; a required check cannot silently skip | **SATISFIED** |
| 3 | Server and worker logging structured and satisfying C.3 | **SATISFIED** |
| 4 | Correlation only within the C.10 request-local boundary | **SATISFIED** |
| 5 | Outbox backlog/failure has an authorized operational visibility path | **SATISFIED** |
| 6 | Authentication rate limiting implemented and adversarially proven | **SATISFIED** |
| 7 | Backup/restore and rollback/forward-repair documented at the C.9 level | **SATISFIED** |
| 8 | Privacy-conscious error handling proven, including T9 | **SATISFIED** |
| 9 | All inherited static locks and security tests remain unweakened | **SATISFIED** — see §11.5 |
| 10 | The complete regression estate passes at the recorded closing tree | **SATISFIED** — 66/561 and 28/181 at `e42918b` |
| 11 | Any baseline amendment is enumerated in the amendment ledger | **SATISFIED** by §11.4 |
| 12 | DB1 disposed only per C.8; DB2 and DB3 do not move by adjacency | **SATISFIED** by §11.7 |
| 13 | No Phase 13 work modifies or operationally acts upon `main`/`origin/main` | **SATISFIED** — see §11.9 |
| 14 | The record records evidence, dispositions, residual limitations, and exact satisfaction | **SATISFIED** by this section |

> **PHASE 13 EXIT CONDITION — SATISFIED. 14 / 14 CLAUSES.**

Clauses 11, 12 and 14 were the three the transmitted estate could not discharge
on its own: they are recording obligations, and this section is the record that
discharges them. They required no new operational capability, and none was added.

### 11.4 The complete Phase 13 baseline-amendment ledger

Under [0011 §7.1](./0011-phase-9-outbox-projections.md) the ledger is chamber
record, and a change to a baseline file enters it however it is characterized.

| # | Baseline file | Segment | Nature |
|---|---|---|---|
| 1 | `CLAUDE.md` | P13-B | governance status correction |
| 2 | `server/README.md` | P13-B | false runtime/workspace development instructions |
| 3 | `server/src/app.ts` | P13-D, P13-F | log serializers; rate-limiter registration and 429 handling |
| 4 | `server/src/worker/main.ts` | P13-D | allowlisted error classification |
| 5 | `server/src/operator/cli.ts` | P13-E | `outbox-depth` command |
| 6 | `server/src/operator/commands.ts` | P13-E | `outboxDepth` and its fixed diagnostic statement |
| 7 | `server/test/p9-worker-role.test.ts` | P13-E | **strengthening** |
| 8 | `server/test/authz-import-graph.test.ts` | P13-E | **C2 containment-lock widening** |
| 9 | `server/package.json` | P13-F | `@fastify/rate-limit` 11.2.0, exact |
| 10 | `package-lock.json` | P13-F | +3 entries, 0 removed, 0 version-changed |

**The ledger is closed at ten.**

Phase-13-native **additions** — not baseline amendments — are:
`.github/workflows/ci.yml`, `server/test/observability.test.ts`,
`server/test/rate-limit.test.ts`, `server/test/backup-and-recovery.test.ts`,
[docs/backup-and-recovery.md](../backup-and-recovery.md), and this record.
Later modification of a Phase-13-native document creates no eleventh entry.

Exactly one direct dependency entered the estate in the whole phase.

### 11.5 Security-lock amendment — stated plainly, not euphemized

Two inherited test files were amended, and they are **not** the same kind of act.

**`p9-worker-role.test.ts` — a strengthening.** It added assertions making an
existing negative property executable: that `selves_operator`, `selves_app`,
`selves_bootstrap` and unassumed `selves_migrate` are all denied
`proj.outbox_depth()`. No prior assertion was altered or removed.

**`authz-import-graph.test.ts` — a security-lock widening.** The C2
projection-reference lock ([0011 C2](./0011-phase-9-outbox-projections.md))
previously required that **only** the worker tree reference the `proj` schema.
P13-E's operator diagnostic necessarily names `proj.outbox_depth()` in the
operator tree, so the lock now permits exactly two named modules:

```text
operator/cli.ts
operator/commands.ts
```

This is a widening of a security lock and is recorded as one. It is **not** a
weakening, and the structure of the amended test is the proof: the scan is
unchanged, the allowlist is pinned by its own assertion, and
`expect(offenders.sort()).toEqual([...])` still fails on **any** third
non-worker production `proj.` reference. C2 itself prescribed this outcome —
*"if one is ever placed outside it, this test fails and the lock must name that
module explicitly."* Phase 9 built the mechanism; Phase 13 exercised it.

**No database privilege accompanied it:** no grant, schema USAGE, EXECUTE, table
privilege, role membership, or migration. The privilege boundary is byte-identical
to Phase 9.

### 11.6 DB1 — discharged

> **DB1 — DISCHARGED by bounded authentication-surface rate limiting.**
> Unauthenticated database-driving session issuance and revocation are bounded to
> 30 requests per 60 seconds per request address. Limiter state is ephemeral and
> process-local; no persistent failed-attempt counter, account lockout, or
> person-level behavioral history is introduced. Authentication credentials
> remain 256-bit random material. Account lockout is deliberately not implemented
> because bounded rate limiting satisfies the deployment blocker without creating
> durable person-associated attempt history. Equivalent per-client enforcement
> behind a reverse proxy remains conditional on separately reviewed trusted-proxy
> configuration.

Discharged at `f7fb4679a52b7d394b043adaacd9835b11500173`, hosted run
`33325442822`.

**The closure is deliberately narrower than the original blocker language.**
DB1's risk paragraph assumed a guessable authentication factor. The implemented
credential is 256-bit random material, against which online guessing was never a
credible path. What P13-F adds is a **second, independent operational bound on
unauthenticated resource consumption**, where previously there was none. The
original DB1 text is preserved in
[deployment-blockers.md](../deployment-blockers.md) rather than rewritten, so the
record does not make the earlier analysis appear more precise than it was.

### 11.7 DB2 and DB3 — unchanged, and unmoved by adjacency

**DB2** (no real-browser cookie / `__Host-` / CORS verification) and **DB3** (no
CSP or broader XSS hardening) are **exactly as inherited**. Neither moved, and
the mechanical proof is that **Phase 13 touched zero client files**:

```text
git diff --name-only 9128834..HEAD | grep '^client/'   →  0
client/browser/ last modified at P10-BR4
grep for Content-Security-Policy | helmet | X-Frame-Options | X-Content-Type
  across server/src and client/src  →  no match
```

The real-browser venue was expressly excluded from CI at Gate 1 C.3, precisely so
that running it could not be mistaken for discharging DB2.

> **Closing Phase 13 is not authorization to deploy.** Deployment readiness
> remains **NOT ESTABLISHED** while DB2 and DB3 stand. They are deployment
> blockers, not Phase 13 closure blockers — which is why Phase 13 may close while
> deployment may not proceed.

### 11.8 Residual limitations, carried openly

1. **Trusted-proxy limitation.** `trustProxy` is deliberately not enabled and no
   forwarded header is consumed. Behind a reverse proxy, address keying
   aggregates every caller into one bucket. Equivalent per-client enforcement
   requires a separately reviewed trusted-proxy configuration.
2. **Recovery non-claims.** No RPO, RTO, backup schedule, retention policy,
   offsite copy, or managed provider. [0004](./0004-auth-active-self.md)'s
   condition remains the trigger: before any environment holds non-disposable
   data, an upgrade-path acceptance criterion must be added to the then-current
   phase.
3. **The migration-transaction guarantee is estate-specific.** It holds because
   no committed migration opts out of the wrapping transaction. Any future
   non-transactional migration requires an explicit recovery review before
   acceptance.
4. **CI reports; it does not block.** Required-status-check and branch-protection
   configuration is outside C.5 and was never authorized. C.1 clause 2 means that
   within a run, unavailable infrastructure fails the workflow rather than
   silently skipping a proof; it does not mean CI prevents a human from merging
   around it.
5. **Timing-side-channel indistinguishability** remains unestablished, as
   [0013 Q12](./0013-phase-11-opening.md) recorded.

### 11.9 P10-N4 — preserved

No Phase 13 act touched the Pages deployment branch. There is no local `main`;
every transmission was `git push origin master:master`, an ordinary
single-commit fast-forward with no force and no tags; the CI workflow names the
branch **zero** times and contains no deploy job, no `git` or `gh` write, and
`permissions: contents: read`. No repository administration was performed at any
point.

### 11.10 Playbook §6 documentation inventory

Required by C.13 to be inventoried and reported at closure. These are recorded as
**not produced by Phase 13** — they are not Phase 13 deliverables and their
absence is not a defect in the Phase 13 exit condition.

**Present:** authorization matrix · threat model · known limitations · deployment
blockers · decision records · backup and recovery ·
`server/README.md` development instructions.

**Outstanding:** architecture overview · schema diagram · state-machine
documentation · projection/rebuild documentation · deployment runbook (Playbook
Phase 14) · standalone open-questions register (AGENTS.md §11 serves the
function) · constitutional-compliance checklist · root `README.md`.

### 11.11 Protected residue

The pre-existing untracked `client/test-results/` residue remains **untracked and
untouched** throughout Phase 13. It was never staged, deleted, modified,
gitignored, normalized, or absorbed into any commit.

### 11.12 Closure

> **PHASE 13 — CLOSED.**
>
> **PHASE 13 EXIT CONDITION — SATISFIED. 14 / 14 CLAUSES.**
> **T1–T9 — DISCHARGED.**
> **DB1 — DISCHARGED.**
> **PHASE 13 CLOSURE BLOCKERS — NONE.**

Final network acceptance requires the push-triggered hosted CI run on the P13-H
closure commit itself to be green; chamber acceptance of that run completes this
record externally.

### 11.13 What this closure does not do

It does **not** authorize deployment. It does **not** dispose DB2 or DB3. It does
**not** authorize Playbook Phase 14 or any later phase. It does **not** reopen
Phase 10, 11, or 12, close any Phase 10 mounted binding, or dispose any Class B
proposition. It does **not** produce the outstanding Playbook §6 documents. It
does **not** repair `server/README.md`'s residual schema- and phase-state
staleness recorded at §6, the absent root `README.md`, or the root `.gitignore`.
It performs no operation on `main` or `origin/main`, and **P10-N4 is preserved
permanently.**

> **PHASE 13 — CLOSED. P13-A through P13-H — COMPLETE.**
> **EXIT CONDITION — SATISFIED. DEPLOYMENT READINESS — NOT ESTABLISHED.**
