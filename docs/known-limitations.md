# Selves — consolidated known limitations (Phase 11)

- **Status:** Phase 11 working artifact. **Phase 11 is OPEN, not closed.**
- **Date:** 2026-08-28
- **Phase:** Playbook Phase 11 — Adversarial and security testing
- **Authority:** [AGENTS.md](../AGENTS.md) is binding constitutional law. Where
  this document conflicts with AGENTS.md, AGENTS.md wins.
- **Companions:** [threat-model.md](./threat-model.md) ·
  [authorization-matrix.md](./authorization-matrix.md) ·
  [phase-11-test-report.md](./phase-11-test-report.md) ·
  [deployment-blockers.md](./deployment-blockers.md) ·
  [0013](./decisions/0013-phase-11-opening.md)

This artifact **consolidates**. It does not conceal, and it does not discharge.

> **A green authorization test matrix does not close an inherited limitation.**
> Phase 11 proved a great deal about authorization, capability, lifecycle,
> projection, and contention semantics. That evidence is irrelevant to a
> limitation it never tested. Where an inherited item was recorded as
> deployment-blocking and Phase 11 produced no evidence bearing on it, it stays
> a blocker — its status is unchanged, not improved by adjacency.

## Classification key

| Class | Meaning |
|---|---|
| **ACCEPTED LIMITATION** | A known, bounded property of the system that the chamber accepts as-is. Not scheduled work. |
| **DEFERRED PRODUCT/DEPLOYMENT WORK** | Real work, correctly out of Phase 11 scope, owed to a later phase. Not blocking Phase 11 closure. |
| **DEPLOYMENT BLOCKER** | Must be resolved before the integrated system is deployed. May or may not block Phase 11 closure — see [deployment-blockers.md](./deployment-blockers.md). |
| **CLOSED BY CURRENT EVIDENCE** | Discharged by a named, executed, passing Phase 11 proof. |
| **OUT OF THREAT-MODEL SCOPE** | Expressly excluded from the ratified threat model; not a defect within it. |

---

## L1 — Real-browser cookie / CORS / `__Host-` verification

**Provenance:** [0004](./decisions/0004-auth-active-self.md) *Deployment-blocking
limitations*: *"`inject()` proves server-side emission and logic only;
live-browser verification deferred to Phase 10."*

**Status of the deferral:** Phase 10 **closed without disposing it**
([0012 §74.P](./decisions/0012-phase-10.md)). It has therefore been an
**unresolved historical deferral** since that closure, owned by no phase.

**What Phase 11 changed:** the C1 apparatus reaches a *real HTTP socket* with
real `fetch` carrying requests built by production client code — genuinely more
than `inject()`. **It does not close this item.** The apparatus *emulates* the
user agent's three jobs (origin resolution, `/api` prefix strip, cookie
storage/replay) rather than executing browser semantics, and `App.tsx`'s
module-level `browserTransport` is unreachable from it. Cookie policy,
`__Host-` enforcement **by a browser**, and CORS enforcement **by a browser**
remain unexecuted.

**Classification: DEPLOYMENT BLOCKER.** Carried forward at its inherited
severity. Phase 11 evidence narrows what remains unproven; it does not discharge
it.

---

## L2 — No real-browser proof of address-bar navigation, reload persistence, or browser-origin resolution

**Provenance:** recorded in `real-surface.ts` at construction and restated under
the Q11 ruling; [phase-11-test-report.md §I.1](./phase-11-test-report.md).

**Detail:** direct-URL navigation, reload persistence of the session, and the
browser's own origin resolution are not exercised anywhere in the estate. The
client estate runs under `node` and `jsdom`; no real browser participates.

**Bearing on security:** the server-side consequences of these behaviours *are*
proven — a Self-scoped route is 401 without a session, 403 for an unowned Self,
and ownership is re-verified per request, so a direct URL confers nothing. What
is unproven is the **user-agent behaviour itself**, not the server's response
to it.

**Classification: DEPLOYMENT BLOCKER**, jointly with **L1** — they are one
verification venue, and disposing one without the other would leave the venue
half-covered.

---

## L3 — No statistical timing-side-channel indistinguishability (Q12)

**Provenance:** chamber ruling **Q12**, recorded at
[0013 §2](./decisions/0013-phase-11-opening.md) and
[threat-model.md §5](./threat-model.md).

**Detail:** Phase 11 proves indistinguishability across **deterministic,
application-controlled observables** — status, body, envelope, headers, error
classification, projection effects. It does **not** prove constant-time or
statistically equivalent latency between an unauthorized-existing and a
nonexistent resource, and no closure criterion depends on that.

**Not a loophole:** a **deterministic existence-dependent branch** — an
application path whose observable behaviour directly exposes protected existence
— remains an in-scope Phase 11 defect. Inspection during P11-A2 and P11-C found
none.

**Classification: ACCEPTED LIMITATION.** Explicitly ruled out of closure
criteria by the chamber, not by builder judgement.

---

## L4 — T3: compromised owner / application host

**Provenance:** [0008 §0](./decisions/0008-row-level-security.md), preserved
unchanged by Phase 11 (Q2).

**Detail:** an adversary who owns the application host possesses every database
credential and every live session credential the legitimate application
possesses. No database-layer control contains that adversary. The achievable
containment line is **T2**, which Phase 11 re-proved: an adversary holding
`selves_app`'s credential **without** a valid live session retrieves zero rows.

**Condition:** the exclusion is conditional on the `selves_owner` posture
assertions — NOLOGIN, no password, `CONNECTION LIMIT 0`, not superuser, **not
BYPASSRLS**, reachable solely via one `selves_migrate` membership edge. Those
assertions are proven (`authz-r8-owner-posture`). Residual exposure above the
T2 line is a deployment property of **credential custody and host integrity**.

**Classification: OUT OF THREAT-MODEL SCOPE.** Not a defect; a stated boundary.

**This is not a deployment blocker, and must not become one by inference.**
0008 §0's remark that residual exposure above the T2 line is *"a deployment
property governed by credential custody and host integrity"* **characterises
what lies outside the guarantee**; it imposes no ratified deployment
requirement, and no governing record imposes one elsewhere. Credential custody
and host integrity are recorded in
[deployment-blockers.md](./deployment-blockers.md) as **environmental
responsibility outside the blocker set**. Phase 11 makes **no T3 containment
claim**.

---

## L5 — Rate limiting, login throttling, account lockout

**Provenance:** [0004](./decisions/0004-auth-active-self.md), recorded verbatim
as *"out of scope this phase; **deployment-blocking**."*

**Status:** **unchanged.** No rate limiting, throttling, or lockout exists
anywhere in the system, and Phase 11 added none — it was never in Phase 11's
authorized scope, and the Playbook places rate limits in Phase 13.

**Why Phase 11 evidence does not touch it:** every Phase 11 proof concerns
whether a *single* request is correctly authorized. None concerns the *rate* at
which requests may be attempted. An unthrottled enrollment-secret login surface
remains brute-forceable regardless of how correct each individual rejection is.
The login surface is the exempt surface in the middleware chain, which makes
this more acute rather than less.

**Classification: DEPLOYMENT BLOCKER.** Inherited at that severity and
explicitly **not** closed by Phase 11's green matrix.

---

## L6 — No CSP; no broader XSS hardening

**Provenance:** [0004](./decisions/0004-auth-active-self.md): *"No CSP / broader
XSS hardening — later phase."*

**Status:** unchanged. No Content-Security-Policy header is emitted; no broader
XSS hardening posture exists.

**Bearing:** the session cookie's server-side attributes are proven
(`auth-api`), and the client's non-emission behaviour is proven (C1 §2) — a
forbidden dataset is never delivered for the client to hide. Neither addresses
script injection into the client origin, which would execute with the session
cookie available to same-origin requests.

**Classification: DEPLOYMENT BLOCKER.** A browser-delivered application without
a CSP, whose session cookie authorizes every Self-scoped route, should not be
deployed on that basis alone.

---

## L7 — Not final consumer authentication (0004 R1)

**Provenance:** [0004 R1](./decisions/0004-auth-active-self.md): an opaque
per-account enrollment credential plus a DB-backed session; *"This is the
private-bootstrap model, **not final consumer authentication**; credential
recovery is out-of-band by design. **Revisit before any non-invite growth.**"*

**Status:** **live and unchanged.** Phase 11 proved this model's *mechanics*
thoroughly — session issuance, opaque failure, revocation, containment,
per-request re-verification, and the absence of any credential in bodies, URLs,
logs, or statement text. It proved nothing about the model's *suitability* for
consumer authentication, which is a design question the chamber reserved.

**Classification: DEFERRED PRODUCT/DEPLOYMENT WORK**, with the recorded gate:
**revisit before any non-invite growth.** For the invite-only alpha the Playbook
contemplates, the model is the ratified one. It is not a blocker for that stage
and would become one at the growth boundary.

---

## L8 — `reasons.ts` comment inaccuracy (documentation debt)

**Provenance:** discovered in P11-A2; chamber-dispositioned during P11-C.

**Detail:** the comment in `server/src/authz/reasons.ts` describes `22P02` as
*"route validates first; belt-and-braces."* Since the C7 correction the three
protected read routes **map** malformed UUID failures into the existing 400
bad-request path; **they do not pre-validate UUIDs**. The comment is therefore
inaccurate as to mechanism.

**Security consequence: none identified.** The behaviour is correct and proven
(C7, 9 cases); only the explanatory comment is wrong. The blocker analysis in
E2 examined whether an inaccurate comment could mask a substantive security
consequence and found none: the mapping is exercised directly by regression, so
a future reader misled by the comment would be corrected by a failing test
before shipping a change.

**Classification: ACCEPTED LIMITATION** (documentation/code-comment debt).
**Not repaired**, per chamber disposition. Not a security defect. Not a
deployment blocker.

---

## L9 — Static-evidence obligations are not runtime obligations

**Provenance:** [phase-11-test-report.md §H](./phase-11-test-report.md).

**Detail:** family 6 (repository / direct-DB / privilege-boundary bypass) rests
substantially on **STATIC** evidence — a TypeScript AST import-graph walk with a
positive allowlist lock — complemented by DATABASE evidence for the privilege
half. Similarly `authz-no-memoization` and `http-credential-audit` prove
properties of committed **source**, not of a running adversarial system.

**Why this is sound but bounded:** a static import-graph proof is strong against
the failure it targets (a module acquiring a bypass path) and is checked on
every run. It cannot observe runtime reflection, dynamic import, or a bypass
introduced outside the analysed tree.

**Classification: ACCEPTED LIMITATION.** Recorded so no reader upgrades STATIC
evidence into RUNTIME evidence.

---

## L10 — Outbox revival proves revival-plus-cause-resolution

**Provenance:** [0011 §7.3](./decisions/0011-phase-9-outbox-projections.md),
recorded by the chamber.

**Detail:** the revival test repairs the poison event's payload before revival,
so it proves **revival plus cause resolution**, not that clearing `failed_at`
and resetting `attempts` suffices alone.

**Classification: ACCEPTED LIMITATION.** Correctly scoped and correctly
recorded; carried forward unchanged.

---

## L11 — Intra-request snapshot window

**Provenance:** recovered in P11-A2; **executed** by C2 in P11-C.

**Detail:** a protected read establishes context, predicates, decision, and the
protected read inside one REPEATABLE READ transaction and one MVCC snapshot. A
ground change committing **after** that snapshot does not affect the in-flight
request; the **next** request observes it. Both orderings are now proven by
executed RUNTIME/DATABASE evidence (C2), not by architecture alone.

**Why this is not a defect:** it is exactly the ratified semantics of
[AGENTS.md §5](../AGENTS.md) — revocation of a capability is **prospective**. It
ends future access; it does not reach into an operation already authorized, and
it cannot undo access already exercised.

**Classification: CLOSED BY CURRENT EVIDENCE** as an *obligation*, and recorded
as a **bounded, ratified property** of the system — not standing authority
across requests.

---

## L12 — CI is absent

**Provenance:** repository fact — no `.github/` or other CI configuration
exists. The Playbook places CI at **Phase 13**.

**Detail:** the Phase 11 estate is executed on demand by a developer. Nothing
enforces that the 480 server tests, 181 client tests, typecheck, lint, and build
run before a change lands.

**Classification: DEFERRED PRODUCT/DEPLOYMENT WORK** (Phase 13). It is not a
Phase 11 closure blocker — Phase 11 was never asked to build CI — but a security
estate that no automation enforces is a real deployment concern and is carried
into [deployment-blockers.md](./deployment-blockers.md) as such.

---

## Items expressly NOT disposed here

Phase 10 residue is **not** Phase 11 scope and is **not** classified by this
artifact: the eleven OPEN mounted bindings; the sixteen Class B propositions;
P10-BR2 as historical failed apparatus; the BR5 runtime artifact. These remain
exactly as [0012 §74.P](./decisions/0012-phase-10.md) left them. They are named
here only so a reader does not mistake their absence for disposal.

---

## Summary

| Item | Classification |
|---|---|
| L1 real-browser cookie / CORS / `__Host-` | **DEPLOYMENT BLOCKER** |
| L2 browser navigation / reload / origin resolution | **DEPLOYMENT BLOCKER** |
| L3 timing side channel (Q12) | ACCEPTED LIMITATION |
| L4 T3 owner/host compromise | OUT OF THREAT-MODEL SCOPE |
| L5 rate limiting / throttling / lockout | **DEPLOYMENT BLOCKER** |
| L6 CSP / XSS hardening | **DEPLOYMENT BLOCKER** |
| L7 not final consumer authentication | DEFERRED PRODUCT/DEPLOYMENT WORK |
| L8 `reasons.ts` comment | ACCEPTED LIMITATION (documentation debt) |
| L9 static-evidence bound | ACCEPTED LIMITATION |
| L10 outbox revival scope | ACCEPTED LIMITATION |
| L11 intra-request snapshot window | CLOSED BY CURRENT EVIDENCE (ratified property) |
| L12 CI absent | DEFERRED PRODUCT/DEPLOYMENT WORK |

**Three deployment blockers**, mapping from the items above:
**L5 → DB1**, **L1 + L2 → DB2** (one verification venue), **L6 → DB3**.
**Zero of them are Phase 11 closure blockers** — see
[deployment-blockers.md](./deployment-blockers.md) for that distinction and its
reasoning. **L4 is not among them**: an expressly out-of-scope boundary does not
become a mandatory deployment gate merely because Phase 11 proves nothing above
it.
