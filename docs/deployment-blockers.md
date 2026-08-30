# Selves — deployment-blocking issues (Phase 11)

- **Status:** Phase 11 artifact. **Phase 11 closed under decision record [0013](./decisions/0013-phase-11-opening.md) §12.**
- **Date:** 2026-08-28
- **Phase:** Playbook Phase 11 — Adversarial and security testing
- **Authority:** [AGENTS.md](../AGENTS.md) is binding constitutional law.
- **Companions:** [known-limitations.md](./known-limitations.md) ·
  [threat-model.md](./threat-model.md) ·
  [phase-11-test-report.md](./phase-11-test-report.md) ·
  [0013](./decisions/0013-phase-11-opening.md)
- **Phase 12 amendment:** extended by
  [0014](./decisions/0014-phase-12-object-storage.md) with the object-storage
  deployment-boundary analysis below. **DB1–DB3 are textually unchanged and
  remain unresolved**, and **Phase 12 adds no blocker** — the summary at the
  end of this document is unchanged.
- **Phase 13 amendment:** extended by
  [0015 §11.6](./decisions/0015-phase-13-opening.md) with the **DB1 disposition**
  below. **DB1 is DISCHARGED** at `f7fb467`. **DB2 and DB3 are textually
  unchanged and remain unresolved**, and Phase 13 adds no blocker. DB1's original
  provenance, risk statement, and required disposition are **preserved verbatim**
  — the disposition is appended beside them, not substituted for them, so the
  record does not make the earlier analysis appear more precise than it was.

This is **not** a production-readiness checklist. It answers exactly one
question:

> **What unresolved issue, if any, must prevent deployment of the integrated
> system represented by this Phase 11 boundary?**

The boundary is commit `1edbf217c9484293ca8faa8f3c80c5f0d29e5a4e`, whose
evidence is recorded in the test report: 24/24 Playbook cases proven, 16/16
chamber obligations discharged, 480 server and 181 client tests green against
real PostgreSQL enforcement.

> **A green security test matrix does not make the application deployable.**
> Everything Phase 11 proved concerns whether a request that reaches the
> authorization boundary is decided correctly. Three of the four blockers below
> concern what happens *before* or *around* that boundary — how many requests
> may be attempted, what a browser will actually enforce, and what executes
> inside the client origin. Phase 11 was not asked those questions and did not
> answer them.

---

## The three categories, distinguished

| Category | Meaning |
|---|---|
| **PHASE 11 CLOSURE BLOCKER** | Prevents Phase 11 from satisfying its own adversarial exit condition. The phase cannot close while one exists. |
| **DEPLOYMENT BLOCKER** | May permit Phase 11 to close, but must prevent production deployment of the integrated system. |
| **ACCEPTED LIMITATION / DEFERRED HARDENING** | Neither of the above. Recorded in [known-limitations.md](./known-limitations.md). |

The distinction is not cosmetic. Phase 11's exit condition is about
**adversarial evidence for the authorization system**. A missing rate limiter is
not a gap in that evidence — it is a gap in the deployed posture. Conflating the
two would either falsely block a phase that has done its work, or falsely ship a
system that is not ready.

---

## PHASE 11 CLOSURE BLOCKERS

> **NONE.**

Every mandatory Playbook case and every chamber attack-family obligation is
bound to a named, executed, passing proof
([test report §C, §D](./phase-11-test-report.md)). The one defect discovered
inside Phase 11's own scope — **P11A2-F1** — was closed in P11-C by regression
plus minimal correction and re-confirmed green in the final evidence run. No
ratified invariant fails. No obligation rests on intent.

**Phase 11 is not blocked from closing by anything in this document.** Closure
itself remains a P11-F act and is not claimed here.

---

## DEPLOYMENT BLOCKERS

### DB1 — No rate limiting, login throttling, or account lockout

| | |
|---|---|
| **Provenance** | [0004](./decisions/0004-auth-active-self.md), recorded verbatim as *"out of scope this phase; deployment-blocking"*. Never disposed since. |
| **Affected boundary** | The authentication surface: `POST /auth/session`, the one route deliberately exempt from the authenticated middleware chain. Secondarily every Self-scoped route, which is reachable at unbounded rate once a session exists. |
| **Concrete risk** | The enrollment credential is the sole authentication factor. Nothing limits guess attempts, so an attacker may attempt them continuously against a permanently valid credential. `contain_account` exists to *respond* to a compromise; nothing *prevents* the attempt. There is no lockout, no backoff, and no signal that would even surface the attempt. |
| **Why Phase 11 evidence does not discharge it** | Every Phase 11 proof is about a single request's correctness. `auth-api` proves a wrong secret yields a generic 401 with no oracle — which is exactly right, and exactly irrelevant to how many times that 401 may be provoked. Correct rejection at unbounded rate is still an unbounded attack. |
| **Required disposition before deployment** | Implement rate limiting / throttling / lockout on the authentication surface (Playbook Phase 13 places rate limits there), then prove it. Alternatively, an explicit chamber ruling accepting the risk for a bounded invite-only alpha with compensating controls. |

#### DB1 — Phase 13 disposition (P13-F, `f7fb467`)

> **DISCHARGED by bounded authentication-surface rate limiting.**

The original analysis above is preserved unchanged. This disposition records what
was actually built, and is deliberately narrower than the original blocker
language.

| | |
|---|---|
| **Discharged at** | `f7fb4679a52b7d394b043adaacd9835b11500173`, hosted CI run `33325442822` |
| **Control** | 30 requests / 60 seconds / request address on **both** unauthenticated database-driving routes — `POST /auth/session` and `DELETE /auth/session` |
| **State** | ephemeral and process-local; no persistent failed-attempt counter, no account lockout, no person-level behavioral history |
| **Lockout** | **deliberately not implemented.** Persistent per-account failure state is durable person-associated history, which the Phase 13 observability floor excludes. Bounded rate limiting satisfies the blocker without it. |
| **Not limited** | `/health` and every authenticated route — bounding a legitimate user's own product use would be the engagement-control shape the Playbook's T7 forbids |
| **Evidence** | `server/test/rate-limit.test.ts` 13/13, including: the 31st valid login refused **before** `auth.issue_session` executes, no session row and no cookie created on refusal, independent per-address buckets, independent login/logout budgets, and forged `X-Forwarded-For` minting no fresh key |

**What this does not claim.** The original risk paragraph assumed a guessable
authentication factor. The implemented credential is **256-bit random material**,
against which online guessing was never a credible path. P13-F does not make a
guessable credential safe; it adds a **second, independent operational bound on
unauthenticated resource consumption**, where previously there was none.

**Carried limitation — trusted proxy.** `trustProxy` is deliberately not enabled
and no forwarded header is consumed. Behind a reverse proxy, address keying
aggregates every caller into one bucket. **Equivalent per-client enforcement
behind a proxy remains conditional on separately reviewed trusted-proxy
configuration.**

---

### DB2 — No real-browser verification of cookie policy, `__Host-`, and CORS

| | |
|---|---|
| **Provenance** | [0004](./decisions/0004-auth-active-self.md), *"live-browser verification deferred to Phase 10"*; Phase 10 closed without disposing it ([0012 §74.P](./decisions/0012-phase-10.md)). Combines **L1** and **L2**. |
| **Affected boundary** | The browser–server session boundary: cookie storage and replay, `__Host-` prefix enforcement, `Secure`/`SameSite` behaviour, CORS preflight and enforcement, address-bar navigation, reload persistence. |
| **Concrete risk** | The session cookie is the sole bearer of account authority. Its protections are **asserted server-side and never observed being enforced by a user agent**. If a real browser does not enforce what the server intends — a mis-set attribute, an origin the browser treats differently, a `__Host-` precondition unmet in the deployed scheme/path — the session could be transmitted or accepted where it should not be. The failure would be invisible to every existing test, because no existing test is a browser. |
| **Why Phase 11 evidence does not discharge it** | `auth-api` proves the server *emits* hardened cookie attributes and answers CORS preflight correctly. C1 reaches a **real socket** with production client code — genuinely stronger than `inject()` — but its own committed header records that it *emulates* the user agent's three jobs rather than executing them, and cannot reach `App.tsx`'s `browserTransport`. Emission is proven; **enforcement by the agent is not**. |
| **Required disposition before deployment** | A real-browser verification venue exercising cookie policy, `__Host-` enforcement, CORS enforcement, address-bar navigation, and reload persistence against the deployed scheme and origin — or a chamber ruling accepting the risk with stated compensating controls. |

### DB3 — No Content-Security-Policy; no broader XSS hardening

| | |
|---|---|
| **Provenance** | [0004](./decisions/0004-auth-active-self.md): *"No CSP / broader XSS hardening — later phase."* |
| **Affected boundary** | The client origin, and through it every Self-scoped API route. |
| **Concrete risk** | Requests are same-origin and the session cookie travels by default. Any script executing in the client origin therefore acts with the user's full session authority against all sixteen routes. Without a CSP there is no second line of defence if injection occurs. Artifact text is user-authored content that round-trips through the client, which is precisely the shape that rewards a CSP. |
| **Why Phase 11 evidence does not discharge it** | C1 §2 proves the server never *emits* a forbidden dataset for the client to hide — this closes the "hide it with CSS" failure mode and is genuinely reassuring. It says nothing about code executing *inside* the client origin, which would be authorized to request exactly what the user is authorized to see. Non-emission and injection resistance are different properties. |
| **Required disposition before deployment** | Emit a Content-Security-Policy appropriate to the deployed client, together with the standard companion headers; verify in the same real-browser venue as **DB2**. |

---

## Environmental responsibility — outside the blocker set

### Credential custody and host integrity

**Not a Phase 11-derived deployment blocker.** Recorded here because it is real
operational work, and recorded *outside* the blocker set because promoting it
would repeal an exclusion Phase 11 was forbidden to touch.

**The reasoning, stated plainly.** [0008 §0](./decisions/0008-row-level-security.md)
excludes **T3** — a compromised owner or application host — from the containment
guarantee, conditional on the `selves_owner` posture assertions, which are
proven (`authz-r8-owner-posture`). Its remark that residual exposure above the
T2 line *"is a deployment property governed by credential custody and host
integrity"* **characterises what lies outside the guarantee**; it does not
impose a ratified deployment requirement. No governing decision record imposes
one: `0004`'s deployment-blocking list contains exactly the three items **DB1**,
**DB2**, **DB3** (plus R1, classified as deferred work), and no other record
independently requires a secrets-management, rotation, backup, or host-integrity
posture as a precondition of deployment.

Treating "Phase 11 does not prove resilience above an expressly excluded
boundary" as a deployment blocker would convert an **OUT OF THREAT-MODEL SCOPE**
limitation into a mandatory gate without any ratified operational-security
requirement behind it. That is not a conclusion Phase 11 has the authority to
reach.

> **Phase 11 makes no T3 containment claim.** It proves the **T2** line — an
> adversary holding `selves_app`'s credential without a valid live session
> retrieves zero rows — and nothing above it. An adversary who owns the
> application host is outside the model and is not contained by any control
> this phase examined or could examine.

**Recorded responsibility, not a gate.** Secrets management, credential
rotation, backup and restore, and host integrity for a target environment are
deployment-time and operational concerns, owed to the Playbook's later
deployment and operational phases. They should be established before production
operation as ordinary operational diligence. **They do not appear in the blocker
set, and Phase 11 asserts no finding about them.**

## Not blockers — recorded so their absence from the list is deliberate

| Item | Why not a blocker |
|---|---|
| **L3** timing side channel | Expressly ruled out of closure criteria by **Q12**. A *deterministic* existence-dependent branch would be an in-scope defect; none exists. |
| **L7** not final consumer authentication | The ratified model for the invite-only stage the Playbook contemplates, with a recorded gate: **revisit before any non-invite growth**. It becomes a blocker at that growth boundary, not at this one. |
| **L8** `reasons.ts` comment | Documentation debt. The behaviour it mis-describes is correct and directly covered by regression, so a reader misled by the comment is corrected by a failing test before shipping. **No substantive security consequence identified** — the condition the chamber set for reclassification is not met. |
| **L9** static-evidence bound | A recorded property of the evidence, complemented by DATABASE evidence at the same boundary. |
| **L10** outbox revival scope | Correctly scoped, correctly recorded, no operational consequence. |
| **L11** intra-request snapshot window | The ratified prospective-revocation semantics of AGENTS.md §5, now proven in both orderings by C2. |
| **L12** CI absent | *(Phase 11 assessment, superseded.)* Deferred to Phase 13 and not a property of the running system. It is, however, the reason DB1–DB3 must be re-verified rather than assumed at deployment time: nothing automatically re-runs this estate. **Phase 13 disposition: CI now exists** (`1d181d0`) and automatically exercises typecheck, lint, unit and integration tests, migrations-from-zero and the production build on every push to `master`, so the estate is re-run automatically rather than assumed. Branch protection remains outside the claim — CI reports, it does not block a merge. |

---

## Object-storage deployment boundary (Phase 12)

Recorded under [0014 §7](./decisions/0014-phase-12-object-storage.md). Phase 12
added a **vendor-neutral object-storage boundary** for future binary-bearing
Artifacts. It is **Boundary Only**: `photo` is not a creatable payload, there is
no production HTTP route, no production caller, no provider adapter, and no
schema change.

> **A new trust boundary is not, by itself, a deployment blocker.** The **DB4**
> lesson is controlling: an excluded or deferred concern is not transformed into
> a blocker by adjacency or inference. Each issue below is classified on its own
> footing.

| # | Issue | Classification |
|---|---|---|
| 1 | Download issuance is subordinate to the authoritative PostgreSQL Artifact-read decision; a denied read causes zero binding lookups | **Security property proven by Phase 12** |
| 2 | Upload and download authorization lifetimes are bounded at 300 s, enforced at the port; expiry is exact and deterministic | **Security property proven by Phase 12** |
| 3 | Storage activity manufactures no Artifact, Key grant, Graph edge, projection, or outbox event | **Security property proven by Phase 12** |
| 4 | Object keys confer no entitlement; no permanent or public URL representation exists | **Security property proven by Phase 12** |
| 5 | Bytes already disclosed cannot be revoked (**L13**) | **Accepted limitation** |
| 6 | An already-issued authorization remains usable until its bounded expiry (**L14**) | **Accepted limitation** |
| 7 | The local driver validates synchronously, so a rejected call throws rather than rejecting ([0014 §3.3](./decisions/0014-phase-12-object-storage.md)) | **Accepted limitation** |
| 8 | Object-store credential custody, provider hardening, container/bucket policy, encryption at rest, provider-side audit | **Provider/deployment responsibility** |
| 9 | Production provider selection and the vendor adapter | **Deferred implementation requirement** (Playbook Phase 14) |
| 10 | Production `ObjectBindingResolver`, the PostgreSQL association mechanics, and any production upload authority | **Deferred implementation requirement** — owed to a future ratified binary-bearing Artifact slice |
| 11 | Deployment blockers introduced by Phase 12 | **NONE** |

**Why items 8–10 are not blockers.** Nothing in the deployed system currently
uses the object store: no route reaches it, no module composes it, and no
Artifact can carry binary content. A deferred provider cannot block deployment
of a system that stores no objects. The moment a binary-bearing Artifact slice is
ratified, items 8–10 become live preconditions for **that** slice — and this row
is the record that they were identified, not disposed.

**Why item 7 is not a blocker.** It concerns rejection *timing* inside a
dependency-free local driver that no production caller invokes. No ratified
authorization, expiry, containment, or disclosure property depends on it.

**What Phase 12 does not claim.** It makes no containment claim about
**storage-driver credential compromise**, which is expressly a provider and
deployment responsibility and is recorded as unproven in
[threat-model.md §8 (O10)](./threat-model.md). It does not extend the **T2**
line. It does not dispose **DB1**, **DB2**, or **DB3** — Phase 12 had no
authority to dispose any of them, produced no evidence bearing on any of them,
and disposed none.

---

## Summary

| ID | Blocker | Category |
|---|---|---|
| — | *(none)* | **PHASE 11 CLOSURE BLOCKER** |
| **DB1** | No rate limiting / throttling / lockout | **DISCHARGED** — Phase 13 (P13-F, `f7fb467`) |
| **DB2** | No real-browser cookie / `__Host-` / CORS verification | DEPLOYMENT BLOCKER |
| **DB3** | No CSP / XSS hardening | DEPLOYMENT BLOCKER |

> **Phase 11 closure blockers: NONE.**
> **Deployment blockers: TWO. DB1 is discharged; the integrated system must not
> be deployed to production until DB2 and DB3 are disposed.**

**DB2 and DB3 did not move.** Phase 13 touched **zero** client files, the
real-browser venue was expressly excluded from its CI, and no
Content-Security-Policy or companion header exists anywhere in the source. Their
status is exactly as Phase 11 left it. **Deployment readiness remains NOT
ESTABLISHED.**

*(Phase 11 statement, preserved as history and true as of that closure; DB1 was
subsequently discharged in Phase 13 — see the summary above.)*
**All three are inherited from [0004](./decisions/0004-auth-active-self.md) at
their original severity** — they are exactly that record's deployment-blocking
list. **None is closed by Phase 11's green matrix**, and none was repaired in
Phase 11: repair was not authorized, and recording them accurately is the
required output.

Credential custody and host integrity are recorded above as **environmental
responsibility outside the blocker set**, because the T3 exclusion they sit
behind is expressly out of the ratified threat model and no governing record
independently imposes them as a deployment precondition.
