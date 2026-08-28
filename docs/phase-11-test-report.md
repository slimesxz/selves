# Selves — Phase 11 security test report

- **Status:** Phase 11 working artifact. **Phase 11 is OPEN, not closed.**
- **Date:** 2026-08-28
- **Phase:** Playbook Phase 11 — Adversarial and security testing
- **Authority:** [AGENTS.md](../AGENTS.md) is binding constitutional law. Where
  this document conflicts with AGENTS.md, AGENTS.md wins.
- **Companions:** [threat-model.md](./threat-model.md) ·
  [authorization-matrix.md](./authorization-matrix.md) ·
  [0013](./decisions/0013-phase-11-opening.md)
- **Recorded by:** Claude as engineer, under the Phase 11 chamber rulings.

This report binds every Phase 11 closure claim to a **named, executed, passing
proof**. A claim that P11-C intended to cover something is not evidence; only an
executed proof is. Where an obligation is met by inherited estate rather than by
new work, the inherited test is named.

---

## A. Exact substrate of the evidence run

| | |
|---|---|
| **Commit** | `455607415c5d2843655798ee4e91452647e79057` — *P11-C: close adversarial coverage gaps* |
| **Parent** | `68945b10494e1d8b9a4020fa5388b3e8a57eda61` — *P11-B: establish adversarial testing authority* |
| **Branch** | `master` |
| **Remote relation** | `origin/master` = `d604cc0e8cad9c2ef5bf02e71727706fa6baff2b` (the Phase 10 closure boundary, network-verified). Local `master` **2 ahead / 0 behind**. |
| **Tree at run time** | tracked clean · staged 0 · only the known BR5 artifact untracked, unchanged |
| **Node** | `v24.18.0` (`process.version === 'v24.18.0'`), session-local PATH selection of the pinned runtime; the machine default `v25.5.0` was not used |
| **PostgreSQL** | **PostgreSQL 17.10** (Debian 17.10-1.pgdg13+1, aarch64-linux-gnu), container `selves-postgres`, image `postgres:17`, health `healthy` |
| **Databases** | `selves_dev`, `selves_test` — the run used **`selves_test`** exclusively |
| **Roles present** | `selves_owner`, `selves_migrate`, `selves_app`, `selves_bootstrap`, `selves_operator`, `selves_worker` |
| **Schema provenance** | migrate-from-zero on every run: `globalSetup.ts` drops `auth`/`domain`/`proj`/`public` and re-migrates as `selves_migrate` with `current_user = selves_owner` |

> **Real or mocked enforcement:** **REAL.** Every permission-critical assertion
> runs against real PostgreSQL. Each role connects through its **own**
> `TEST_*_DATABASE_URL`, so privilege denials (`42501`), RLS zero-row results,
> and opaque session failures (`28000`) are decisions made by PostgreSQL, not
> simulated by the application or by a test double. Nothing security-critical is
> mocked anywhere in this report. The exceptions are explicitly typed as STATIC
> or ARCHITECTURAL in §H and are never counted as runtime enforcement.

### Commands executed

```
# server (cwd: server/)
npx tsc --noEmit                                     → exit 0, 0 error lines
npm test                                             → full estate
npx vitest run --exclude 'test/security/**'          → inherited estate alone
npx vitest run test/security                         → Phase 11 estate alone
npx vitest run test/security/regression/p11a2-f1-malformed-path-identifiers.test.ts
npx vitest run test/security/regression/c1-client-tampering-non-emission.test.ts
npx vitest run test/security/concurrency/c2-stale-decision-snapshot.test.ts
npx vitest run test/security/property/c4-ratified-invariants.property.test.ts
npx vitest run test/security/concurrency/c5-adversarial-contention.test.ts
# client (cwd: client/)
npm run lint                                         → exit 0
npm test
npm run build                                        → exit 0
```

C2, C4 and C5 were additionally executed **three further times each** to
evidence reproducibility; every repetition produced identical results.

---

## B. Final measured estate

Measured, not assumed. Inherited and Phase 11-added counts were obtained by two
separate executions rather than by subtraction.

| Estate | Files | Tests | Result |
|---|---|---|---|
| **Server — inherited (pre-Phase-11)** | 55 | **445** | all passed |
| **Server — Phase 11 added** | 5 | **35** | all passed |
| **Server — total** | 60 | **480** | all passed |
| **Client — total (unchanged)** | 28 | **181** | all passed |

| Gate | Result |
|---|---|
| Server `tsc --noEmit` | **exit 0**, zero errors |
| Client `lint` (`tsc --noEmit`) | **exit 0** |
| Client `build` | **exit 0** — `dist/index.html` 222.74 kB, gzip 68.25 kB |

**Delta against the expected lineage: none.** Inherited 445, added 35, total
480, client 181 — each measured value equals the expected value exactly. No
inherited test was weakened, deleted, generalised, or rewritten; the inherited
estate was re-measured in isolation and is byte-for-byte the same 55 files.

### Phase 11 added tests, by file

| File | Item | Tests |
|---|---|---|
| `server/test/security/regression/p11a2-f1-malformed-path-identifiers.test.ts` | C7 | 9 |
| `server/test/security/regression/c1-client-tampering-non-emission.test.ts` | C1 | 16 |
| `server/test/security/concurrency/c2-stale-decision-snapshot.test.ts` | C2 | 3 |
| `server/test/security/concurrency/c5-adversarial-contention.test.ts` | C5 | 2 |
| `server/test/security/property/c4-ratified-invariants.property.test.ts` | C4 | 5 |
| `server/test/security/README.md` | C6 | — (convention) |

---

## C. Mandatory Playbook matrix — 24 cases

Legend for **PG real**: ✔ = the decisive assertion is settled by real PostgreSQL
(privilege, RLS, constraint, trigger, or SQLSTATE). **Det.** = deterministic
coordination where concurrency is material; — = not concurrency-sensitive.

| # | Case | Disposition | Named test(s) | Boundary | Decisive assertion | PG real | Det. | Limitation |
|---|---|---|---|---|---|---|---|---|
| 1 | unauthenticated | **PROVEN** | `production-matrix` *unauthenticated — 401 across all sixteen*; `production-routes` | RUNTIME prod app | every one of 16 routes returns `401` + ratified body | ✔ | — | in-process inject, not socket (C1 covers socket) |
| 2 | valid sender | **PROVEN** | `authz-artifact` *allow AUTHOR*; `production-matrix` *sender* | RUNTIME + DATABASE | decision **ground** asserted, not just success | ✔ | — | — |
| 3 | valid recipient | **PROVEN** | `authz-placement` state table | DATABASE via real service | reads only when `settled`; ground `RECIPIENT_SETTLED` | ✔ | — | — |
| 4 | unauthorized third Self | **PROVEN** | `authz-artifact`/`authz-placement` *unsupported*; `production-matrix` | RUNTIME + DATABASE | outcome **kind** asserted | ✔ | — | — |
| 5 | sibling Self | **PROVEN** | `production-matrix` *sibling*; `authz-i-acceptance` sibling isolation; C5 postcondition 8 | RUNTIME + DATABASE | 404 on reads, `[]` on lists, 404 on mutations; disjoint visibility per Self | ✔ | ✔ (C5) | — |
| 6 | forged active-Self | **PROVEN** | `production-matrix` *forged*; `active-self`; C1 §1 | RUNTIME (incl. real socket) | 14 routes × malformed→400 / unowned→403 | ✔ | — | — |
| 7 | guessed Artifact id | **PROVEN** | `authz-nonleakage`; `production-parity` *no distinguishing headers* | RUNTIME | status, body **exact**, header map equal (mod `date`/`content-length`) | ✔ | — | timing not compared — §I |
| 8 | guessed Placement id | **PROVEN** | same pair, placement variant; `production-matrix` | RUNTIME | as #7 | ✔ | — | as #7 |
| 9 | recipient removed in Draft | **PROVEN** | `invariants`; `mutations`; C4 P1 | DATABASE | add/remove succeed while draft; model-tracked each step | ✔ | — | — |
| 10 | recipient modified in Departing | **PROVEN** | `invariants` freeze; `mutations` PT409; `mutations-race`; C4 P1; C5 postcondition 5 | DATABASE | INSERT and DELETE both `23514`; PT409; set does not grow under contention | ✔ | ✔ | — |
| 11 | recipient modified after settlement | **PROVEN** | `invariants` immutability; `mutations`; C4 P1 terminality | DATABASE | any UPDATE/DELETE rejected; terminal states refuse all | ✔ | — | — |
| 12 | cancel racing settle | **PROVEN** | `mutations-race` (both orderings) | DATABASE, two app connections | racer `PT409` **and** final authoritative state | ✔ | ✔ | — |
| 13 | duplicate Send | **PROVEN** | `mutations` *does not move settled_at*; `mutations-race`; C5 duplicate-settle | DATABASE | `t2` deep-equals `t1`; ≤1 outbox event per placement | ✔ | ✔ | — |
| 14 | duplicate worker delivery | **PROVEN** | `p9-projection` replay; `p9-outbox-emission`; C5 postcondition 6 | DATABASE, worker role | edges `=== snapshot` after re-open and full replay | ✔ | ✔ (C5) | — |
| 15 | active Key | **PROVEN** | `key-lifecycle`; `authz-artifact` `KEY_VALID`; C4 P3; C1 §2 | RUNTIME + DATABASE | grantee reads; sibling and stranger denied; exactly the resource | ✔ | — | — |
| 16 | revoked Key | **PROVEN** | `key-lifecycle`; `authz-freshness`; C4 P3; C5 postcondition 3; C1 §2 | RUNTIME + DATABASE | future reads denied, history intact, no resurrection under contention | ✔ | ✔ (C5) | — |
| 17 | grant by unauthorized Self | **PROVEN** | `key-lifecycle` foreign-probe / recorded-grantor; C1 §1 | RUNTIME + DATABASE | stranger and sibling `PT404`; artifact author who is not grantor cannot revoke | ✔ | — | — |
| 18 | direct DB under app role | **PROVEN** | `authz-i-acceptance` §6.4 (T2); `authz-privileges`; `authz-boundary` | DATABASE, real `selves_app` | zero rows by any exposed path; per-column privilege walk; `42501` | ✔ | — | T3 excluded — §I |
| 19 | stale pooled DB context | **PROVEN** | `authz-i-acceptance` 4A (`max:2` pool); `isolation`; C5 postcondition 7 | DATABASE + RUNTIME | setter PID = read PID; reused backend reads `NULL` ctx and **0 rows** | ✔ | ✔ | — |
| 20 | projection corruption | **PROVEN** | `p9-projection` poisoned edge; C5 postcondition 6 | DATABASE | authorization outcomes unchanged; rebuild heals; poison under contention grants nothing | ✔ | ✔ (C5) | — |
| 21 | Graph edge without permission | **PROVEN** | `p9-projection` forged Key event / no-edge; C5 | DATABASE | consumed with zero projection effect; no edge reflects Keys | ✔ | ✔ (C5) | — |
| 22 | **client tampering** | **PROVEN** *(was PARTIAL)* | **C1 §1 (8 cases) + §2 (8 cases)** | RUNTIME — production client → real `fetch` → real socket → prod server | authority cannot be manufactured **and** protected data is not emitted, read from `res.text()` | ✔ | — | no browser-agent semantics — §I |
| 23 | malformed payload type | **PROVEN** | `invariants`; `migration` enum freeze; C4 P5 (30 generated runs) | DATABASE | only non-empty `text` accepted; every other enum member and non-member refused | ✔ | — | — |
| 24 | fourth Self | **PROVEN** | `invariants`; `operator-add-self`; C4 P4 (25 runs); C5 postcondition 4 | DATABASE | no fourth legal coordinate exists; ≤3 selves under contention | ✔ | ✔ | — |

> **24 / 24 PROVEN.** Case 22 moved from PARTIAL on executed C1 evidence.

---

## D. Chamber attack-family matrix — 12 headings, 16 obligations

Sub-obligations with divergent evidence remain separately visible.
Stale-session and stale-decision are bound **independently**.

| # | Family | Disposition | Bound to (executed) | Evidence class |
|---|---|---|---|---|
| 1 | cross-account attacks | **PROVEN** | `production-matrix` *account routes across every actor class*; `authz-i-acceptance` 6.3 (cross-account session pairing → same opaque `28000`); **C1 §1** account-scoped body identifiers; **C5** ground-model reads | RUNTIME + DATABASE |
| 2 | sibling-Self attacks | **PROVEN** | `production-matrix` *sibling*; `authz-i-policies` F5; **C1 §2** sibling non-emission; **C4 P6**; **C5** postcondition 8 | RUNTIME + DATABASE |
| 3 | acting-Self substitution | **PROVEN** | `authz-l-mutation-c3` (author id asserted `=== attacker`, `!== victim`); `active-self`; **C1 §1** | DATABASE + RUNTIME |
| 4 | **stale-session attempts** | **PROVEN** | `active-self` ownership reassignment → 403; `production-routes` Self deleted between requests → 403; `authz-g-c3-context` revoked session `28000`; **C1 §1** stale client-held Self across a session change → 403; discarded session → 401 | RUNTIME + DATABASE |
| 5 | **stale-decision attempts** | **PROVEN** *(was PARTIAL)* | **C2** — both branches executed: ground committed **before** the transaction → denied; ground committed **after** the in-flight read established its snapshot → that request completes on its snapshot, the grant is confirmed authoritatively revoked, and **the next request is denied**. Supported by `authz-ordering`, `authz-no-memoization`, `authz-freshness` | RUNTIME + DATABASE (architecture in §4 of the threat model now **executed**, no longer ARCHITECTURAL alone) |
| 6 | repository / direct-DB / privilege-boundary bypass | **PROVEN** | `authz-import-graph` (AST, with a positive allowlist lock); `authz-privileges`; `authz-boundary` | STATIC + DATABASE |
| 7a | revocation races | **PROVEN** | `key-race` — settlement collision `23505`, one grant; revoke-vs-revoke one winner | DATABASE, deterministic |
| 7b | placement-state races | **PROVEN** | `mutations-race` (4 ordered pairs); `concurrency` (12 linearizations); `operator-add-self` slot race | DATABASE, deterministic |
| 7c | **TOCTOU** | **PROVEN** *(was PARTIAL)* | **C2** — a ground change is committed while an authorized read is provably mid-flight and provably past its snapshot. `authz-ordering` proves no protected read occurs on any deny path | RUNTIME + DATABASE, deterministic |
| 8a | recipient-set leakage | **PROVEN** | `authz-recipient-list`; `authz-i-policies` F5; **C1 §2** — body byte-exactly `[]`, containing neither the co-recipient id nor the recipient's own | RUNTIME + DATABASE |
| 8b | existence oracles | **PROVEN** (deterministic observables) | `authz-nonleakage`; `production-parity`; `mapDenied()` never consults the reason; DB layer fails opaquely `28000`; **C7 §4** re-proves uniformity survived the correction | RUNTIME + DATABASE |
| 9 | projection poisoning + replay/duplicate delivery | **PROVEN** | `p9-projection`; `p9-outbox-emission`; `p9-deadletter`; **C5** postcondition 6 under contention | DATABASE |
| 10a | privilege escalation | **PROVEN** | `bootstrap` (`SET ROLE` denied `42501`); `authz-r8-owner-posture`; `authz-boundary`; `p9-worker-role` | DATABASE |
| 10b | **malformed / adversarial input** | **PROVEN** *(was PARTIAL)* | **C7** (9 cases, 5 malformed forms × every UUID-bearing path position incl. `:rid`); `authz-f3` injection payloads bound as data; **C4 P5** payload boundary | RUNTIME + DATABASE |
| 11 | **fuzz / property testing** | **PROVEN** *(was ABSENT)* | **C4** — 5 properties, 120 generated runs, deterministic seed, stateful sequences | RUNTIME + DATABASE |
| 12a | **load / concurrency under contention** | **PROVEN** *(was ABSENT)* | **C5** — 400 operations, concurrency 16, pool 6, zero violations, 8 security postconditions | RUNTIME + DATABASE |
| 12b | **permanent regression corpus** | **ESTABLISHED** *(was ABSENT)* | **C6** — `server/test/security/` with `README.md` and three categories, inside the existing runner/config/substrate | convention |

> **16 / 16 discharged.** Five obligations moved on executed evidence: 5, 7c,
> 10b, 11, 12a; 12b established. **Nothing was marked PROVEN on intent.**

---

## E. Property-testing record (C4)

| | |
|---|---|
| **Library** | `fast-check` **4.9.0** (dev/test dependency, `server` workspace only; transitive: `pure-rand@8.4.2`) |
| **Seed** | **`20260828`**, fixed in source |
| **Run counts** | P1 lifecycle 20 · P3 keys 20 · P4 selves 25 · P5 payload 30 · P6 isolation 25 — **120 generated runs** |
| **Replay data** | fast-check reports `{ seed, path, endOnFailure }` on failure; the seed is fixed in source, so a run is reproducible by construction |
| **Reproducibility** | executed 4 times total; identical results each time |

**Properties exercised**, each naming the ratified invariant it defends:

| Property | Invariant |
|---|---|
| P1 lifecycle + recipient set (stateful, sequences ≤10 commands) | AGENTS.md §5 state machine; 0006 sender-only transitions, ≥1-recipient departure; 0003 invariant 6 freeze. Authoritative state **and** recipient set asserted against an independent model **after every step**, plus terminality |
| P3 Key grant / revoke / non-resurrection | AGENTS.md §5 Key transmission; 0007 R9; 0003 invariant 8 — ≤1 active grant ever; history preserved equals grants settled |
| P4 Self cardinality | AGENTS.md §3.1; 0003 invariants 1–2 — no fourth Self, no duplicate slot |
| P5 payload-type boundary | AGENTS.md §3.9; 0003 invariants 11–12 — only non-empty `text` accepted |
| P6 authority isolation | 0004 R2 / 0008 R7; 0005 grounds — outcomes and containment lists equal the ratified model for every actor × state |

### Counterexamples encountered

**One, and it was a test-model defect — not a production defect.**

| | |
|---|---|
| **Reproduction** | `seed: 20260828, path: "0", endOnFailure: true` · counterexample `["grant","revoke","revoke"]` · shrunk 0 times |
| **Symptom** | the property asserted `PT404` on the second revoke; production returned success |
| **Adjudication** | the **property was wrong**. The ratified contract is idempotent success for a repeat revoke **by the recorded grantor** — fixed by `key-lifecycle.test.ts` (*"revocation is idempotent and mutates nothing on repeat"*) and by the DEFINER at migration `1784930000010`, which raises `PT404` only when **no grant history exists for that grantor** |
| **Action** | the **model** was corrected; **no production code was changed**. The disagreement and its reproduction data are recorded in the test file itself |
| **Classification** | **TEST-MODEL DEFECT** |

> **No genuine product counterexample was found**, so nothing was promoted into
> the minimized-counterexample corpus. No run count was raised to make any
> failure disappear — expressly forbidden by the C6 convention and not done.

---

## F. Contention / load record (C5)

| | |
|---|---|
| **Seed** | `20260828` (hand-rolled `mulberry32`; **no load-testing dependency** — no k6, Artillery, or autocannon) |
| **Operations** | **400** |
| **Concurrency** | **16** in-flight workers |
| **Pool size** | **6** — deliberately `< CONCURRENCY`, so pooled connections are provably **reused** across different accounts and different acting Selves |
| **Prior estate ceiling** | 2 concurrent operations |
| **Elapsed** | 212 ms (first D1 run); 208 / 221 / 227 ms across three repeats |
| **Violations** | **0** in every run |

**Operation classes exercised** (deterministic mix from the seed): authorized
author reads · authorized settled-recipient reads · denied reads by arbitrary
actors including siblings and other accounts · capability reads against revoked
and unrevoked fixtures · full lifecycle churn with duplicate settlement ·
concurrent worker/projection passes. Every operation carried an expectation
fixed **before** it ran.

**Security-semantic postconditions asserted after contention** — all passed:
lifecycle/timestamp coherence · ≤1 outbox event per placement (no duplicated
authority-bearing effect) · ≤1 active grant per triple and **no revoked
capability resurrected** · three-Self cardinality intact · recipient freeze
intact (behavioural check) · projection grants no authority and replay
manufactures nothing · **connections return to a fail-closed state** (a reused
pooled connection with no context reads `NULL` acting Self and **zero rows**) ·
authority isolation intact on fresh reads including no sibling leakage.

> **Elapsed time and throughput are METADATA, not acceptance thresholds.** No
> RPS, latency, or throughput target appears anywhere in the harness, and none
> is a Phase 11 acceptance criterion. A run that is fast and crash-free proves
> nothing on its own; the conclusions rest on the per-operation expectations and
> the postconditions above.

### Harness defect encountered

| | |
|---|---|
| **Symptom** | a postcondition comparing `placement_recipients.added_at > placements.departing_at` reported 70 rows |
| **Adjudication** | a **fixture artifact**. The harness's `rewind()` deliberately backdates `departing_at` to move placements past the settlement floor, so every fixture row trips such a comparison for reasons unrelated to the freeze |
| **Action** | replaced with a **behavioural** check — a non-draft placement must refuse a recipient change (`PT409`) and its set must not grow. The contract under test was not weakened |
| **Classification** | **TEST-HARNESS / POSTCONDITION DEFECT** — not a product defect |

---

## G. Defects and regressions

### P11A2-F1 — malformed path identifiers on the protected read routes

| | |
|---|---|
| **Discovered** | P11-A2, by source inspection |
| **Violated contract** | the ratified bad-request semantics (0006 A4 / the P10-S4 chamber pin). Nothing in the ratified contract admits `500` for caller-supplied malformed input |
| **Red state** | `4 failed / 5 passed` — `GET /artifacts/:id`, `GET /placements/:id`, and `GET /placements/:id/recipients` each returned `500 {"error":"internal_error"}`; the actor-independence case likewise. Established **before** any production change |
| **Reference contract** | §1 of the same suite **passed while red**, proving the mutation routes — including the second `:rid` position — already answered the frozen `400 {"error":"bad_request"}`. The contract was taken from ratified behaviour, not invented |
| **Adjacency audit** | every UUID-bearing production path position enumerated; only the three read positions were defective; §1 keeps the adjacent positions locked so a route-specific fix cannot pass |
| **Regression test** | `server/test/security/regression/p11a2-f1-malformed-path-identifiers.test.ts` — 9 cases, 5 malformed forms, all actor classes, plus §4 re-proving denial uniformity |
| **Minimal correction** | `server/src/routes/domain.ts` (+32/−10): `runRead`/`runList` added beside the existing `runVoid`/`runId`, reusing the already-ratified `mapErr` → `mapMutationError` path. **No new error class and no new response envelope**; an unrecognised SQLSTATE is still rethrown to the generic 500 |
| **Green state** | `9 passed`, re-confirmed in the D1 final run |
| **Current status** | **CLOSED** by regression + minimal correction |
| **Deployment-blocking** | **No** — closed |

> **Wording, preserved exactly:** the three protected read routes now **map**
> malformed UUID failures into the existing 400 bad-request path. **They do not
> pre-validate UUIDs.** No artifact may claim otherwise.

### New defects found in P11-D

**None.** The final evidence run produced no failure of any kind. No new
production security defect, no failing ratified invariant, no reproducibility
failure, no authority/system mismatch, and no regression in the inherited
445 / 181 estate.

### Documentation / code-comment debt (recorded, not repaired)

The comment in `server/src/authz/reasons.ts` describing `22P02` as *"route
validates first; belt-and-braces"* is inaccurate: the routes do not pre-validate;
they map. Recorded here per chamber disposition. **Not a security defect. Not a
deployment blocker.** `reasons.ts` was deliberately not modified.

---

## H. Evidence classes

The four classes are kept distinct and are never blended. A claim carries the
weakest class that supports it.

| Class | Meaning | Where it carries this report |
|---|---|---|
| **RUNTIME** | real production app, real middleware chain, real `AuthorizationService`, against real PostgreSQL | production-surface suites; C1 (real socket); C5; C7 |
| **DATABASE** | SQL executed as the real constrained role, so PostgreSQL privileges/RLS decide | `authz-*` suites; `invariants`; race suites; C2; C4 |
| **STATIC** | analysis of committed source — AST import graph, source-site enumeration, catalog inventory | `authz-import-graph`; `authz-no-memoization`; `http-credential-audit`; `authz-f3` (source half) |
| **ARCHITECTURAL** | reasoned from committed design; **not evidence** | *(none load-bearing after C2)* |

> **Class movement recorded:** the read-path snapshot property was ARCHITECTURAL
> in the P11-B threat model. **C2 has now executed it**, so families 5 and 7c
> rest on RUNTIME + DATABASE evidence rather than architecture alone. The threat
> model's §4 caveat should be updated accordingly in the next authorized
> documentation segment; it is **not** edited here.

---

## I. Explicit non-claims

Phase 11 does **not** establish any of the following, and no closure claim rests
on them.

1. **No real-browser proof.** Browser cookie policy, `__Host-` enforcement by a
   browser, CORS enforcement by a browser, address-bar navigation, reload
   persistence, and browser-origin resolution are **not** exercised. The C1
   apparatus emulates the user agent's three jobs (origin resolution, `/api`
   prefix strip, cookie storage/replay) rather than executing browser semantics,
   and `App.tsx`'s module-level `browserTransport` is unreachable from it.
2. **No statistical timing-side-channel indistinguishability.** Constant-time or
   statistically equivalent latency between unauthorized-existing and
   nonexistent resources is not established and is not a closure criterion
   (Q12). Deterministic observables **are** proven; inspection found no
   deterministic existence-dependent branch, which would remain an in-scope
   defect if discovered.
3. **T3 remains excluded.** An adversary who owns the application host is out of
   scope, conditional on the `selves_owner` posture assertions. The T2
   containment line is unchanged and unextended.
4. **The protected read routes map malformed UUID failures into the existing 400
   bad-request path; they do not pre-validate UUIDs.**
5. **No performance SLA or throughput guarantee.** C5 establishes that security
   and lifecycle semantics survive contention. It establishes **nothing** about
   throughput, latency, capacity, or scaling, and its elapsed-time figures are
   metadata only.
6. **Static evidence is not runtime evidence.** Families and cases resting on
   STATIC analysis prove properties of committed source, not of a running
   adversarial system, and are labelled as such in §H.
7. **This report does not close Phase 11.** Known limitations and
   deployment-blocking issues remain unfinalised and belong to a later
   authorized segment.
