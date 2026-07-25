# 0008 — PHASE 8 ROW-LEVEL SECURITY — GATE 1 RULINGS

**Status:** Ratified in part. **R4 vacated and remanded.** Gate 2 authorized in part (§4); the policy and context surface is held.
**Governs:** Q1–Q8 of the Phase-8 Gate-1 packet, plus six findings the packet did not surface.
**Does not disturb:** 0004, 0005, 0006-F, 0007. The five-object ontology is untouched. RLS introduces no object, no ground, and no effect.

**Amendment history.** R1–R3 and R5–R8 were ratified at first reading. R4 (acting-Self context mechanism) was ratified at first reading and is **vacated by this record** on the ground stated in R4 below. Where the two readings conflict, this record controls. The earlier "Gate 2 authorized" sentence is superseded by §4.

---

## 0. THREAT MODEL

The first reading ratified R4 without a written threat model. That omission is the direct cause of the vacatur, so the model is fixed here before anything else and every subsequent ruling is scoped against it.

**T1 — application-logic failure.** A bug, an omitted filter, an authorization path not taken, an injected fragment inside an otherwise fixed query. The adversary influences what the application asks for but does not control the session.

**T2 — compromised application credential.** The adversary holds `selves_app`'s connection credentials and executes arbitrary SQL directly: a leaked `DATABASE_URL`, an exfiltrated environment, backup or replica credential, log exfiltration, or third-party database access without application-host access.

This is the adversary the Gate-1 packet itself named — "a compromised *application/worker* path" — and the one its §11 test plan claims to defeat under "Direct-SQL adversary." The threat model is therefore not imposed on the builder from outside; it is the builder's own, held to what it wrote.

The achievable Phase-8 containment line for T2 is:

> **An adversary holding `selves_app`'s database credential, but not possession of a valid live session credential, retrieves zero rows.**

No database-layer control contains an adversary who owns the application host. Such an adversary possesses every database credential and every live session credential the legitimate application possesses. Phase 8 does not claim to contain that adversary. Residual exposure above the stated T2 line is a deployment property governed by credential custody and host integrity.

**T3 — compromised owner.** Out of scope per R8, conditional on the `selves_owner` posture assertions.

RLS keyed on any value the application role can itself assign contains T1 and **does not contain T2**. The distinction is the difference between a database boundary and an application convention.

---

## 1. STANDING RULE FOR PHASE 8

**Phase 8 may only narrow.** Every migration statement must either enable RLS, create a SELECT policy, revoke a privilege, or grant EXECUTE on a helper introduced by this phase. Any statement that widens a surface — a table GRANT, a column GRANT, a new DML path, a role attribute — returns to chamber before it is written.

This rule is what makes the phase auditable by inspection of the migration alone.

---

## 2. RULINGS

### R1 (Q1) — Stage-1 predicate reads move behind SECURITY DEFINER. **Granted (a). Stands.**

The governing ground is structural:

**The decider must not read through the mirror.**

RLS is an enforcement mirror of the TypeScript AuthorizationService (0005). If the service computes its decision from rows RLS has already filtered, the mirror becomes an input to the thing it reflects. The two layers cease to be independent, and divergence between predicate and policy can be silently corrected by the policy instead of surfacing as failure.

A mirror that feeds its subject is not a check.

Stage-1 fact reads therefore execute as `selves_owner` through `SECURITY DEFINER` predicate functions, RLS-exempt by ownership. `selves_app` retains only policed Stage-3 and list reads.

**Byte-identity of `src/authz/predicates.repo.ts` is released.** It was a Phase-7-scoped guarantee and discharged its duty at `58d5a4f`. It is replaced by the substitute obligation in R2.

**R4-independent.** These Stage-1 functions take the acting Self as a call parameter from the already-authorized service decision path; they do not consume the R4 policy context. They may proceed under §4 once implementation resumes.

### R2 (Q2) — Internal reason taxonomy is preserved. **No amendment authorized. Stands.**

The external contract remains unchanged: every read denial remains 404.

The internal taxonomy:

- `ordinary_deny`
- `RECIPIENT_NOT_SETTLED`
- `KEY_REVOKED`
- `KEY_WRONG_RESOURCE`
- `unsupported`

survives intact under R1.

**Zero reason-exactness assertions change.**

The 0006-F A2 amend-to-conform allowance is **not** invoked for Phase 8. If implementation requires amending the existing reason assertions, that is evidence the DEFINER predicate functions do not reproduce the existing fact set. That is a design fault and returns to chamber.

All 237 Phase-7 baseline tests remain green, unamended.

### R3 (Q3) — Hardened `SECURITY DEFINER` helper predicates. **Mandatory, not preferred. Stands; held with the policies.**

Policy helpers are mandatory. The ground is stated in F1: R3 is a dependency of R5, not a preference for auditability.

Each obeys all four constraints:

1. **No helper accepts a Self as an argument.** Every policy helper obtains the ratified acting Self from the trusted R4 context internally. A helper with signature `(p_self, p_resource)` is an oracle answerable about arbitrary Selves and is prohibited.
2. **Boolean return only.** No helper returns a row, set, id, count, register entry, or metadata.
3. **`selves_owner`-owned, `STABLE`, `SECURITY DEFINER`, `SET search_path = ''`, fully qualified.**
4. **`EXECUTE` to `selves_app` only; `REVOKE ALL FROM PUBLIC`.**

Because these helpers consume the trusted acting-Self context, implementation of them is held pending R4.

### R4 (Q4) — Acting-Self context mechanism. **VACATED AND REMANDED.**

**Q9 is subsumed.** The defect later docketed by the builder as Q9 is not a new question. It is the defect in R4. A single defect carries a single docket entry.

The original Alt A — `set_config('selves.acting_self', <verified self>, true)` — is **not ratified as the acting-Self trust mechanism**.

The empirical probe established that execution genuinely occurred as `selves_app`, that the role was non-superuser and `NOBYPASSRLS`, and that the role could assign `selves.acting_self` to an arbitrary value of its own choosing.

**Transaction locality solves leakage. It does not solve forgery.**

"Server-set only" is an application coding convention, not a PostgreSQL privilege boundary, because the role being contained can call `set_config` itself.

A security boundary cannot contain a role by trusting an identity assertion that the same role is free to manufacture.

The following properties of Alt A remain binding requirements on whatever replaces it:

- request/transaction locality;
- automatic cleanup on commit and rollback;
- fail-closed behavior when trusted context is absent;
- pooled-connection non-leakage;
- one auditable application integration point where practical.

#### C1 — narrow the threat model. **REJECTED.**

Ratifying T1-only containment was available before the probe. It is not available after it.

The charter's exit condition requires that a compromised path cannot retrieve rows the **verified** acting Self is not authorized to read. An identity the contained role manufactures for itself is not verified. Reducing a full-role compromise from "all rows at once" to "all rows by iterating Self UUIDs" is not containment; it is a rate limit.

C1 would additionally require rewriting the Gate-1 packet's §11 "Direct-SQL adversary" tests, which currently assert a property the substrate would not have. A test asserting an untrue property is worse than no test.

C1 is recorded as rejected so that it is not re-proposed when the acceptance test proves inconvenient. Reopening it returns to chamber as an amendment to this record, not as an implementation choice.

#### The authentication anchor already exists

The builder's later premise that there is no database-layer authentication fact is rejected.

The session credential already reaches PostgreSQL through `auth.authenticate_session`, and `auth.sessions` is DEFINER-only: `selves_app` has no direct privilege over the session register.

The relevant precision is:

**lack of `selves_app` access to `auth.sessions` prevents possession of the database credential alone from manufacturing or altering an authoritative session fact or deriving a valid live session credential.**

Possession of an actual valid live bearer credential is outside the T2 acceptance line above.

The authentication anchor therefore exists already. **0004 is not reopened.**

#### C3 — the floor

R4-B is not an open architecture search.

The security floor is:

> **A `SECURITY DEFINER` context setter, gated on the existing session fact, writing the exact acting Self to an owner-owned context store on which `selves_app` holds no INSERT, UPDATE, or DELETE. Policies obtain the acting Self through an owner-run `STABLE` helper.**

Both halves must close:

- the authentication anchor cannot be manufactured from the database credential alone;
- the contained role cannot directly write the trusted context fact.

A competing mechanism must beat C3 on stated grounds or C3 is adopted.

#### C2 — parameter-based optimization candidate

A parameter-based mechanism remains viable only if the actual PostgreSQL substrate empirically proves that the trusted owner path can assign the parameter while arbitrary SQL under `selves_app` cannot assign or overwrite it afterward.

This is an optimization question, not a prerequisite for the existence of a viable architecture, because C3 is the floor.

C2 inherits all setter-hardening requirements below.

#### C4 — signed application context. **Rejected.**

Recorded as available and rejected for the T2 boundary because the application host must possess the signing material. A host compromise obtains the same material.

#### Trust-chain rule

Wrapping `set_config` in a DEFINER function is not sufficient if `selves_app` can invoke that function with arbitrary assertions or overwrite the resulting context afterward.

A candidate is not a candidate unless it identifies:

- the trust anchor;
- the trusted writer;
- the closed direct-write path;
- the closed trusted-writer-induction path;
- the lifetime boundary.

---

### R4-B — C3 LIFETIME AND SETTER REQUIREMENTS

R4-B governs the focused packet returned before final R4 ratification.

#### Backend identity alone is insufficient

A context row keyed only by `pg_backend_pid()` fails under pooling.

The same backend may serve a later request. If a later transaction does not establish context but can still match the previous request's context row, stale identity becomes cross-Self visibility.

That failure is silent and fails open.

C3 therefore binds trusted context to **both the backend and the transaction that established it**.

The floor is:

- the owner-run setter writes the context record;
- that write causes the current transaction to acquire an XID;
- the context record stores the backend identity and transaction identifier;
- the policy-facing helper accepts the record only if both identify the current backend/transaction;
- a transaction that never established context has no matching trusted context and therefore denies;
- stale backend records never authenticate a later transaction;
- rollback leaves no context usable by a later transaction.

Use `pg_current_xact_id_if_assigned()` on the supported PostgreSQL version where available.

It returns `xid8`, so stored and current identifiers compare without 32-bit wraparound ambiguity.

When the current transaction has no assigned XID, the helper treats that state as **no trusted context → deny**.

The setter executes `SECURITY DEFINER` in the caller's transaction. DEFINER changes execution identity, not transaction identity. The XID written by the setter must therefore be the transaction whose subsequent policed reads consume the context.

Any design that establishes context outside that transaction is rejected.

#### Setter hardening — the setter is the door

Under C3, `selves_app` must hold EXECUTE on the setter so the legitimate application can establish context.

The setter is therefore a primary attack surface. It must satisfy all of the following.

##### Write-once per transaction

Once trusted context exists for the current transaction, a second setter call is refused.

Otherwise an injected call can re-point identity after the legitimate application has already established it.

##### No credential oracle

A fabricated or invalid session credential and a valid session credential paired with an unauthorized requested Self must produce one externally opaque failure contract.

The setter must not disclose whether a presented credential is live through differentiated error semantics. Timing behavior must also be examined for avoidable validity-dependent distinction.

##### Account-scoped Self validation and acting-Self fixation

The requested Self must belong to the account resolved from the valid live session credential.

That establishes that the account is permitted to **select** that Self. It does not itself create sibling authority.

The setter then fixes that exact Self, write-once, as the acting Self for the transaction.

Every policy keys exclusively on that fixed Self and contains no account-level or sibling fallback.

Thus common account ownership permits deliberate Self selection at establishment time but never causes one established Self to inherit another sibling Self's authorization.

Sibling isolation therefore has no single enforcement point. It is the composition of:

1. session authentication;
2. setter account→Self validation;
3. write-once transaction fixation;
4. absence of any account/sibling fallback in policy predicates.

Emergent properties regress silently, because no single test guards them. The same-account/same-session/two-Selves visibility test is mandatory because it guards this composition.

#### Required adversarial setter tests

The deliberate setter attacks are primary.

With the full effective privileges of `selves_app` and **without possession of a valid live session credential**:

- fabricated session credential → failure, no context;
- expired credential → failure, no context;
- revoked credential → failure, no context;
- valid credential for account X paired with Self in account Y → failure, no false context;
- second setter call in the same transaction naming a different Self → refused;
- direct INSERT/UPDATE/DELETE against the context store → privilege failure;
- no alternate exposed path may establish false context.

The eventual RLS acceptance proof additionally requires that false-context attempts cannot yield a row authorized only to the target Self.

Before RLS exists, R4-B proves context-establishment failure rather than pretending an unimplemented policy already supplies row containment.

#### Required stale-inheritance tests

Separate from deliberate setter attacks:

1. request A checks out backend P;
2. A establishes Self A;
3. A completes;
4. request B receives backend P;
5. B does not invoke the setter;
6. B performs a policed read;
7. B receives zero rows.

Also prove rollback behavior, absent-XID behavior, stale records associated with a reused backend, and sibling-Self transaction separation.

#### C3 cost obligation

C3 converts otherwise-read-only protected transactions into transactions that acquire an XID and write context state.

Specify the actual row lifecycle before estimating its cost. Do not benchmark an abstract "context table."

State whether the chosen lifecycle uses delete + insert, insert/upsert, update, or another exact mechanism.

Then quantify or responsibly estimate:

- context writes per protected read transaction;
- XID consumption at representative volume;
- dead-tuple production from that lifecycle;
- HOT-update eligibility where relevant;
- index churn;
- table/index growth;
- autovacuum implications;
- wraparound headroom;
- cleanup requirements.

Cost does not invalidate C3. C3 is the security floor against which C2 is compared.

#### C2 consequence

The parameter-ACL probe remains substantive.

If the actual PostgreSQL substrate proves that a custom parameter can be written by the trusted path while `selves_app` cannot assign or overwrite it, C2 may preserve transaction-local semantics without the C3 context write/XID cost.

No presumed parameter behavior is accepted.

C2 still inherits every setter-door requirement. Closing the direct parameter-write path does not prevent the contained role from attempting to induce the trusted setter.

---

### R5 (Q5) — `key_grants`: remove direct application read entirely. **Stands.**

Once Stage-1 grantee fact computation moves into owner-run predicate functions, `selves_app` has no remaining legitimate reason to read `key_grants` directly.

Therefore `REVOKE SELECT ON public.key_grants FROM selves_app` for every currently granted column.

Enable RLS on `key_grants` and create no application SELECT policy.

The capability register becomes invisible to the application role: not narrowed, not merely non-listable, but absent from direct application visibility.

If any direct `selves_app` read of `key_grants` survives R1, the builder names it and returns to chamber rather than writing a policy to accommodate it.

The down-migration restores the prior column grant.

### R6 (Q6) — Defense-in-depth enables; worker unchanged; ledger untouched. **Stands.**

Enable RLS with no application policy on:

- `auth.account_credentials`;
- `auth.sessions`;
- `public.accounts`;
- `public.outbox_events`.

The application role already holds no direct privilege on them. RLS therefore grants nothing and causes a future accidental table grant to fail closed.

Do **not** enable RLS on `public.pgmigrations`. The absence of any grant is already the control, and the ledger is the one table read under the tooling rather than the application.

`selves_worker` receives no Phase-8 privilege change. It remains CONNECT-only.

Any Phase-9 worker broadening returns as its own ruling. It may never arise accidentally from role inheritance, ownership, or `BYPASSRLS`.

### R7 (Q7) — `public.selves`: interim posture, immediate narrowing, remand. **Stands.**

`selves_app` currently possesses broad column visibility over the Self/account mapping. Unrestricted `account_id → Self` readability is the sibling map.

Bounded disclosure does not survive its disclosure: the product's premise is that a person's Selves are not linkable to each other, and the linkage is a single unfiltered column. It outranks Artifact contents — an Artifact leak exposes what one Self said; this exposes who every Self is.

#### R7.1 Interim

No RLS policy is created on `public.selves` until Phase 8-B resolves its mixed read requirements. `selves` is the substrate that establishes identity context and a wrong policy breaks verification.

This is interim, not accepted as the final posture.

#### R7.2 Immediate narrowing

Move the account-scoped identity reads `selfOwnedByAccount` and `listSelves` behind owner-run `SECURITY DEFINER` functions taking the verified account as a parameter.

Then reduce `selves_app`'s surviving direct column visibility to what cross-account recipient display actually requires.

`account_id` is revoked.

`self_slot` is presumed unnecessary once the switcher moves and is revoked absent a named surviving read that requires it.

Every surviving directly readable column must be justified by naming the read that requires it.

#### R7.3 Phase 8-B remand

Before any `public.selves` RLS policy is written, return a dedicated read inventory classifying every read as account-scoped, acting-Self-scoped, or cross-account by necessity.

Bulk readability of even `(id, name)` remains an enumeration surface and is open rather than accepted.

### R8 (Q8) — Enable RLS, do not FORCE. **Granted conditionally. Stands.**

Do not use `FORCE ROW LEVEL SECURITY` in Phase 8. It protects only against T3 and would put the ratified write state machine through a context-and-policy redesign.

The ruling is conditional on `selves_owner` remaining:

- `NOLOGIN`;
- without a password;
- `CONNECTION LIMIT 0`;
- reachable solely via `selves_migrate SET ROLE`.

Add tests asserting all four facts. If any changes, the FORCE posture returns to chamber automatically — the suite, not anyone's memory, enforces the condition.

---

## 3. FINDINGS

### F1 — Cross-table policy execution rests on a disputed platform fact and must be empirically established

The Gate-1 packet asserted that RLS policy expressions are evaluated as the policy/table owner rather than as the invoking role, and rested the key-valid mirror on it: an `EXISTS` subquery over `key_grants` gating the Artifact read while the register stays unreadable to the application.

**That assertion is not safe to build on, and is not yet verified.** PostgreSQL's behavior when a policy expression references a second table — whose privileges apply, and whether the referenced table's own policies re-enter — is precisely the area that produces recursive-policy and permission errors in practice.

**This is why R3 is a dependency of R5, not a preference.** If the invoking role's privileges apply, R5's revocation makes an inline subquery fail `42501` on **every** Artifact read. With DEFINER helpers the design is correct under either reading of the platform, because owner-execution is explicit rather than incidental.

Run an isolated empirical experiment establishing:

- invoking role;
- referenced-table privilege requirements;
- referenced-table RLS behavior;
- returned rows or SQLSTATE;
- whether referenced-table policy evaluation re-enters.

Record the observed behavior. Do not cite documentation. A claim this load-bearing is established by a test result or it is not established.

Regardless of the result, R3 remains mandatory. The purpose of F1 is to replace a disputed platform assertion with observed substrate behavior, not to reopen the helper decision.

### F2 — Every SELECT policy is explicitly PERMISSIVE

Artifact access is a union: author ∪ settled-recipient ∪ valid-Key.

Multiple permissive policies OR; restrictive policies AND. A `RESTRICTIVE` declaration silently converts the union into an intersection.

Every Phase-8 SELECT policy is declared `PERMISSIVE` explicitly.

Add a union-semantics test in which a Self satisfying exactly one authorization ground can read the row.

### F3 — No user-controlled expression reaches a policed predicate

PostgreSQL may evaluate non-`LEAKPROOF` functions in a query's own `WHERE` clause before applying RLS, leaking filtered rows through error messages and behavior.

Every `selves_app` query against a policed table uses fixed SQL and bound parameters compared by equality.

No user-supplied expression, operator, pattern, cast, ordering fragment, or predicate fragment may be interpolated into a query over a policed table.

Any future dynamic filtering or search over those tables returns to chamber. This is also the principal T1 control and stands regardless of how R4 resolves.

### F4 — Fail-closed is proven at the point of failure

A policed read issued without trusted acting-Self context must return zero rows.

This behavior is tested explicitly rather than inferred. Absent context presents as a bug rather than a breach, and a builder debugging it will be tempted to relocate context establishment outward. Freeze the expectation first.

### F5 — Co-recipient non-disclosure is constitutional

A recipient must not learn who else received the same placement. This is the substrate form of bounded disclosure.

The database-level proof is `rows.length === 0` for a co-recipient attempting to read `placement_recipients`. An HTTP response is not sufficient.

### F6 — R4 and R7 compose

R4's defect makes arbitrary acting-Self assertion possible. R7's broad `public.selves` visibility provides the inventory of Self ids and account groupings to iterate.

Together they form: enumerate → assert → iterate.

Any R4 candidate must therefore be evaluated against an adversary that already knows the full Self inventory. A design whose security argument depends on UUID secrecy is rejected on sight.

R7.2 is the first-priority R4-independent narrowing when implementation resumes.

**Procedural clarification:** R7.2 is temporarily serialized behind R4-B only because nothing is deployed. F6 describes a shipped-system exposure. This serialization is not precedent for delaying an unconditional narrowing when live exposure exists.

---

## 4. GATE 2 AUTHORIZATION — SPLIT

The original single Gate-2 authorization is superseded.

### 4.1 R4-independent work

Ratified in principle because it narrows independently of the acting-Self context architecture:

1. R7.2 identity-read narrowing;
2. R1 Stage-1 DEFINER predicate functions;
3. R5 direct `key_grants` SELECT revocation and RLS-with-no-policy;
4. R6 RLS-with-no-policy defense-in-depth enables;
5. R8 owner-posture tests;
6. F3 fixed-query invariant enforcement/tests.

For procedural serialization, none of this begins until the current R4-B packet returns and is ruled. This is safe only because nothing is deployed.

### 4.2 Held pending final R4 ruling

- context storage/write mechanism;
- acting-Self lookup helper;
- R3 policy helpers;
- all acting-Self-dependent SELECT policies;
- RLS enablement on `artifacts`, `placements`, and `placement_recipients`;
- application context integration.

### 4.3 Conditions on every Gate-2 change

1. Phase 8 only narrows.
2. All 237 Phase-7 baseline tests remain green and reason-exactness assertions remain unamended.
3. Every security-critical denial is proven by database result (zero rows) or SQLSTATE such as `42501`, not merely HTTP behavior.
4. Down-migration restores every revoked grant and removes every policy/helper introduced by the phase.
5. The working tree must be understood and clean against the current procedural baseline before implementation begins.

### 4.4 Returns to chamber

Return before implementation or continuation if any of the following arises:

- unresolved R4 candidate choice;
- surviving direct `selves_app` read of `key_grants`;
- inability to justify a surviving `public.selves` column by a named read;
- any need to amend a reason assertion;
- any widening statement;
- change to the R8 owner assumptions;
- unexpected worker visibility;
- any proposal to reopen C1.

Phase 8-B remains required before Phase-8 closure.

---

## 5. R4-B PROBE DISCIPLINE

All DDL probes execute against a **disposable database created for the probe and dropped afterward**.

**No DDL against `selves_test` under any circumstance.**

This applies to candidate context-store privilege experiments, F1 cross-table RLS experiments, parameter privilege experiments requiring persistent database state, and any table/function/policy/grant/ownership/RLS probe.

After all probes and after dropping the disposable database, re-run the Gate-1 catalog check against `selves_test`. It must report:

- every table: `relrowsecurity = f`
- every table: `relforcerowsecurity = f`
- `pg_policies` count = 0

Any deviation stops the phase before repair. A stray table or leftover policy contaminates migrate-from-zero and the 237-test baseline that R2 makes the acceptance criterion for R1.

The C3 privilege experiment must establish that direct `INSERT`, `UPDATE`, and `DELETE` against the proposed owner-owned context store fail for `selves_app` with the expected privilege result, normally SQLSTATE `42501`.

The C2 parameter experiment must establish actual behavior empirically on the repository's PostgreSQL version. Documentation or convention is not evidence.

F1 remains separate from R4 authenticity probes.

---

## 6. R4-B ACCEPTANCE TEST SHAPE

The eventual implementation must prove all three attack classes independently.

### 6.1 Write forgery

Can the contained role directly modify the trusted context fact?

Direct context-store DML or direct parameter assignment/overwrite must fail as appropriate.

### 6.2 Stale inheritance

Can a later request inherit a trusted fact from a previous request on a reused backend?

It must not. A transaction that did not establish context must read zero protected rows even if its backend previously served a transaction that did. Rollback must not create reusable context.

### 6.3 Induction of the trusted writer

Can the contained role persuade the privileged setter to install a false context?

Required cases: fabricated credential; expired credential; revoked credential; valid credential for account X paired with a Self in account Y; second setter call in one transaction; any alternate setter path.

The false context must not be established.

### 6.4 Final T2 containment proof

1. legitimate context for Self A through the ratified path;
2. arbitrary SQL with the full effective privileges of `selves_app`, **without possession of a valid live session credential**;
3. knowledge of Self B's UUID;
4. attempts through every exposed mechanism to substitute B;
5. query of a row authorized only to B.

Required result: **zero rows**, or the substitution attempt itself fails with a concrete database privilege/error result.

HTTP denial is not sufficient.

---

## 7. CONSTITUTIONAL CONFORMANCE

Affirmed.

Phase 8 introduces:

- no new ontology;
- no inferred grant;
- no derived Ring;
- no capability effect beyond exact-Artifact `readArtifact`;
- no direct-write escape;
- no notification/feed surface;
- no Phase-9 outbox;
- no capability-register listing;
- no expiry, delegation, transfer, rotation, reuse limits, gifting, or value mechanics;
- no resolution of poll visibility;
- no reply-model ruling;
- no derived-ring threshold ruling.

Support tables acquiring RLS do not acquire ontological standing. Being governed does not make a table an object.

The five objects remain: Self, Signal, Artifact, Placement, Graph.

---

## 8. PROCEDURAL NOTE

The R4 defect reached the chamber from a separate builder session whose model was substituted mid-flight.

Recorded as standing practice:

**rulings enter the repository from the chamber, dated and attributable — never reconstructed from a builder or session summary.**

The builder surfaces findings. The chamber rules them.

A superseded ruling is not preserved merely because it appeared earlier in a session. The purpose of the decision record is to contain the current controlling law.

A corollary, learned in the persistence of this record: **a transport instruction and its payload travel together, or the instruction does not go.**

---

## 9. PHASE-8 SECURITY INVARIANT

> **Who writes the fact — can the contained party write it, inherit it, or induce the trusted writer to write a false one?**

Write access. Lifetime isolation. Induction resistance.

All three must hold before the fact constitutes a security boundary.