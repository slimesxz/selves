# 0009 — PHASE 8 — R4 RATIFICATION: C3 ADOPTED

**Status:** Ratified. **Supersedes R4 and R4-B of 0008**, which vacated the acting-Self context mechanism and remanded it. R4 is now closed.
**Governs:** items 1–3 of the R4-B focused packet, plus two consequences and one process rule the packet did not surface.
**Leaves standing:** everything else in 0008 — R1, R2, R3, R5, R6, R7, R8, F1–F6, the split Gate-2 authorization, the probe discipline, the acceptance-test shape, and the Phase-8 security invariant.
**Procedural baseline at ruling:** `c824916a2483e36180de2f203f323d40230389cd`.

---

## 1. EMPIRICAL FINDINGS ACCEPTED

All three probes were executed in a disposable database under the real `selves_app` credential, with `selves_test` re-proven RLS-clean afterward. The findings are accepted as established by test result rather than by citation, which is what F1 required.

**F1 is resolved, and it refutes the Gate-1 packet's platform assertion.** An inline cross-table policy subquery is evaluated with the **invoking role's** privileges and is additionally subject to the **referenced table's RLS**. Under R5's revocation an inline subquery raises `42501` on every Artifact read; with the register under RLS and no policy, it silently returns zero rows and a legitimate key-holder reads nothing. The `SECURITY DEFINER` helper mandated by R3 resolves both cases exactly.

**This elevates R3 from mandate to law.** Recorded as standing rule: **no Phase-8 policy predicate may reference a second table inline. Every cross-table access in a policy goes through an owner-run `SECURITY DEFINER STABLE` boolean helper.** The Gate-1 design would have failed closed on every protected read; the helper requirement was load-bearing, not stylistic, and is not revisitable on grounds of convenience.

**C2 is empirically refuted on this substrate.** PostgreSQL 17.10: a custom placeholder parameter is `USERSET`, and `GRANT SET ON PARAMETER` combined with `REVOKE ... FROM PUBLIC` does not fence it — `selves_app` set and overwrote the parameter with the ACL rows in place. No parameter-based mechanism preserves trusted-set-only on this substrate without a C extension defining the variable `PGC_SUSET`, which is out of scope and would introduce a new dependency. C2 is closed. It may be reopened only by a substrate change, and only by returning to chamber.

**The C3 floor holds.** Direct `INSERT`, `UPDATE`, `DELETE`, and `SELECT` against an owner-owned context store fail `42501` for `selves_app`. The contained role can neither write nor read the trusted fact.

**The lifetime primitive behaves as specified.** `pg_current_xact_id_if_assigned()` returns NULL before XID assignment, the assigned `xid8` after a write, and NULL again in a fresh post-rollback transaction. Type confirmed `xid8`; no 32-bit wraparound ambiguity in the comparison.

---

## 2. R4 RATIFIED — C3 IS THE ACTING-SELF CONTEXT MECHANISM

The mechanism is:

> An owner-owned `SECURITY DEFINER` setter, `EXECUTE` to `selves_app` only, which validates the presented session credential against `auth.sessions`, validates that the requested Self belongs to the account resolved from that session, and writes the acting Self to an owner-owned context store on which `selves_app` holds no privilege. Policies obtain the acting Self through an owner-run `STABLE` helper. Context is bound to both `pg_backend_pid()` and the establishing transaction's `xid8`; absent or mismatched context denies.

Every requirement of 0008 R4-B carries forward unchanged and is now binding on implementation: write-once per transaction; uniform opaque setter failure with no credential oracle; account-scoped Self validation followed by exact acting-Self fixation; the four-part composition guarding sibling isolation; the deliberate-setter-attack tests as primary and the stale-inheritance tests as separate; the acceptance-test shape of 0008 §6.

---

## 3. LIFECYCLE RATIFIED, WITH CONDITIONS

The proposed lifecycle — a table keyed by `backend_pid` as primary key, storing `(xid8, acting_self)`, written by upsert — is ratified as the design to carry into implementation, subject to four conditions.

**3.1 Write-once and upsert must be reconciled explicitly.** As written they conflict: `ON CONFLICT (backend_pid) DO UPDATE` silently overwrites, which is precisely what write-once exists to prevent. The setter must raise when a context row already exists for the current backend **and** its stored `xid8` equals the current transaction's. Replacement is permitted only across transactions, never within one. This is the control that closes injected re-pointing, so it must be a raise, not a no-op — a silent second call that appears to succeed while leaving the first context in place is indistinguishable to the caller from a successful substitution.

**3.2 The context store is operational state and must never become a history.** One row per backend, replaced in place. No append, no insert-only variant, no `set_at` audit column, no retention. An append-only variant would be a durable record of which Self acted when — activity outside the five objects, accumulating a shadow of the Graph that no placement authorized. The retention property is constitutional, not operational, and belongs in the ruling rather than in whoever writes the migration.

**3.3 Physical tuning is required, not optional.** A table of roughly `max_connections` rows updated once per protected read is a small number of very hot pages. HOT-update eligibility is real but depends on page headroom, so the table requires an explicitly lowered `fillfactor` and per-table aggressive autovacuum settings. Measure dead-tuple accumulation and page churn at representative volume during implementation, not after.

**3.4 The session credential now travels on every protected read.** Previously it reached the database once per authentication; under C3 it accompanies every policed transaction. It must be passed as a bind parameter and never interpolated into statement text, and the setter's arguments must be excluded from statement logging and must not become visible through `pg_stat_activity` to any monitoring or operator role. Frequency multiplies exposure; the control is that the credential never appears in text anywhere.

---

## 4. CONSEQUENCES RECORDED

**4.1 C3 forecloses read replicas for policed reads.** Establishing context requires a write; a write requires an XID; a hot standby permits neither. `pg_current_xact_id_if_assigned()` is permanently NULL on a standby, so every policed read denies there. The behaviour is correct — fail-closed — but the architectural consequence is that protected reads cannot be served from a replica under this mechanism.

This is accepted knowingly. C2 would not have had the property, and it is the only thing lost by C2's refutation. Recorded so that a future scaling decision collides with a written ruling rather than with a surprise: **serving policed reads from a replica requires a new context mechanism and returns to chamber as its own ruling.** It may not be solved by weakening the binding.

**4.2 Direct system-catalog DML is prohibited.** The residual `pg_parameter_acl` row was removed by direct `DELETE` against a shared catalog. It was the right call in the circumstances — the row carried an empty ACL and was provably inert, the alternative was cluster residue that 0008 §5 forbids, and the builder disclosed it. It does not become precedent. **No further direct DML against any system catalog.** If catalog residue recurs and no supported mechanism removes it, that returns to chamber before any hand edit.

---

## 5. STATE AFTER THIS RULING

**Closed:** R4. The context mechanism is ratified and Gate 2's held surface is unblocked in principle.

**Now implementable, in the order given by 0008 §4.1 with R7.2 first:** R7.2 identity-read narrowing; R1 Stage-1 DEFINER predicate functions; R5 revocation and RLS-with-no-policy; R6 defense-in-depth enables; R8 owner-posture tests; F3 enforcement. Then the C3 context store, setter, and helper; then the R3 policy helpers; then the policies and RLS enablement on `artifacts`, `placements`, `placement_recipients`.

**Conditions on all of it are unchanged:** 0008 §4.3 governs. All 237 baseline tests remain green and unamended; every security-critical denial is proven by database result or SQLSTATE; the down-migration restores every revoked grant and removes every policy and helper; Phase 8 only narrows.

**Still open and unaffected:** Phase 8-B — the `public.selves` read inventory and policy posture — remains required before Phase-8 closure.

**The acceptance proof of 0008 §6 is now due at implementation, not at design.** Write forgery, stale inheritance, induction of the trusted writer, and the final T2 containment proof. The mechanism has been proven to have the right shape; it has not yet been proven to hold.

---

## 6. NOTE

Three of this phase's load-bearing decisions were settled by probe against the real substrate after a documented assertion pointed the other way: the packet's claim about policy-expression privileges, the assumption that a custom parameter could be fenced, and the first reading's ratification of a context mechanism the contained role could write. In each case the written claim was plausible and wrong.

Recorded as standing practice: **where a security property depends on platform behaviour, the platform is asked, not cited.**
