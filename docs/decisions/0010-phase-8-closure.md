# PHASE 8 — FINAL CHAMBER CLOSURE

**Phase 8 is accepted and closed at `5a421b4`.**

The final packet discharges the remaining architectural, implementation, and proof obligations:

- Scope B is established across both reads and mutations.
- Stage-1 authority is C3-bound without compromising R1’s owner-run/RLS-independent fact reads.
- The mediated `public.selves` authority surface is session-bound; no direct app grant survives.
- Every mutation family now derives authority from authenticated context rather than caller-selected identity.
- The complete T2 adversary proof covers all exposed read and mutation mechanisms.
- `listReadablePlacements` old-set/RLS-set equivalence is proven.
- Effective privileges and effective RLS behavior are audited across every non-owner role.
- Migration-from-zero, per-step reversibility, the cumulative amendment ledger, the frozen reason-exactness surfaces, and the clean tree are all reported.
- The full suite is green at **321 tests across 43 files** under Node v24.18.0.

## 1. Scope-B containment accepted

The governing Phase-8 T2 statement is now fully discharged:

> **An adversary holding `selves_app`’s database credential, but not possession of a valid live session credential, can neither retrieve protected facts outside an authenticated acting Self’s authority nor successfully exercise mutation authority as another Self.**

The provisional qualification placed on 0008 §6.4 is removed.

The final proof correctly includes:

- direct policed reads;
- C3 forgery, stale inheritance, and setter induction;
- Stage-1 fact functions;
- the identity/switcher functions;
- every domain mutation family;
- `set_departure_interval`;
- `key_grants`;
- sibling isolation;
- concurrent connection reuse.

**0008 §6.4 is now fully accepted.**

## 2. Standing DEFINER-authority rule accepted

The completed substrate now satisfies the standing rule:

> **Resources may be named by the caller; authority may not be.**

No `selves_app`-executable `SECURITY DEFINER` function may derive authority from a caller-supplied actor, account, author, sender, grantor, or equivalent identity assertion.

Caller-supplied resource and target identifiers remain permissible only where authorization authority is derived independently from authenticated session or C3 context.

Internal consistency between attacker-selectable values is not authentication.

This rule governs the completed Phase-8 surface and remains a constraint on future database APIs.

## 3. Phase 8-B closed

Phase 8-B is resolved:

- direct `selves_app` access to `public.selves` is zero;
- the account-switcher and ownership-check functions are session-bound;
- caller-supplied account authority has been removed;
- `public.selves` RLS was correctly **not** added merely for symmetry;
- no prohibited mediated disclosure surface remains.

The anticipated `(id, name)` direct enumeration surface was eliminated earlier by R7.2, and the residual mediated-authority surface was corrected by K.

No further Phase 8-B work remains.

## 4. R1 and RLS independence preserved

J correctly removes caller-selected `p_acting_self` from the Stage-1 functions while retaining:

- owner execution;
- RLS-exempt underlying table reads;
- AuthorizationService independence from the enforcement mirror;
- the established denial-reason taxonomy;
- fail-closed behavior without trusted context.

The decider still does not read through the mirror.

## 5. Mutation boundary accepted

L correctly converts the mutation path from unauthenticated autocommit authority to:

1. one checked-out connection;
2. one transaction;
3. authenticated C3 context establishment;
4. DEFINER mutation on the same backend and transaction;
5. commit or rollback.

The exclusive authoritative write boundary remains the mutation functions. C3 introduces no direct app-role DML path.

Positive lifecycle behavior remains intact, while direct database-role impersonation is denied.

## 6. `listReadablePlacements` boundary change accepted

The removal of the old application-level recipient subquery and reliance on RLS to produce the authorized Placement set is accepted.

The required equivalence proof covers:

- author;
- settled recipient;
- non-recipient;
- sibling Self;
- absent context;
- revoked/invalid context.

The RLS-produced set is therefore accepted as semantically equivalent to the former application-filtered set while avoiding a query predicate that was itself visibility-constrained by RLS.

## 7. Narrow-amendment ledger accepted

The cumulative ledger is accepted as complete.

Every listed baseline amendment is attributable to a ratified ruling that made the former expected mechanical state false. The amendments preserve or increase exactness and do not weaken behavioral coverage.

The reason-exactness surfaces remain byte-identical:

- `authz-artifact`;
- `authz-placement`;
- `authz-ordering`.

The harness adaptations remain correctly classified outside the amendment ledger because they supply the real authenticated execution context while preserving the existing scenarios and observable outcomes.

## 8. Effective privilege and RLS posture accepted

The final database posture is accepted:

- all non-owner roles are non-superuser and `NOBYPASSRLS`;
- `selves_owner` retains the ruled `NOLOGIN` posture;
- `selves_worker` remains CONNECT-only;
- `selves_app` has no direct table-level SELECT surface;
- direct sensitive-table access is absent or constrained by column privilege plus RLS;
- Artifact, Placement, and recipient visibility is enforced by explicitly permissive policies;
- protected support/register tables use RLS-with-no-policy where ruled;
- `public.selves` relies on zero direct grants plus session-bound DEFINER mediation;
- `pgmigrations` remains outside RLS as ruled;
- no table uses FORCE RLS under the tested owner posture.

## 9. Constitutional conformance affirmed

Phase 8 introduces no new ontology, inferred grant, capability effect, Graph shadow, notification/feed surface, or direct-write escape.

The context store remains bounded operational state:

- one row per backend;
- no history;
- no archival;
- no `set_at`;
- no trigger or secondary record of acting-Self activity.

Protected reads remain unavailable on read replicas under C3; any future replica-capable context mechanism returns to chamber.

No direct system-catalog DML is authorized as precedent.

The five objects remain exactly:

- Self
- Signal
- Artifact
- Placement
- Graph

## 10. Closure state

**Phase 8 closes at:**

```text
5a421b4
```

**Accepted implementation sequence:**

```text
fe9487c  P8-A — R7.2 identity narrowing
0c4d0d6  P8-B — R1 Stage-1 DEFINER reads
fcddd2b  P8-C — R5 key_grants revocation/RLS
0695eac  P8-D — R6 defense-in-depth RLS
16aaad1  P8-E — R8 owner posture
15a4718  P8-F — F3 fixed-query invariant
b1e14dc  P8-G — C3 context mechanism
a3fd3d3  P8-H — R3 policy helpers
8193bf8  P8-I — policies/RLS/context integration
a8ddaf9  P8-J — Stage-1 C3 binding
8af3cab  P8-K — session-bound identity functions
8c95c9d  P8-L — mutation C3 binding
5a421b4  P8 closure equivalence proof
```

The working tree is reported clean, and nothing has been pushed.

## 11. Required persistence before push

Persist this closure as a standalone decision record, following the same chamber-payload transport discipline used for 0008 and 0009.

Suggested filename:

```text
docs/decisions/0010-phase-8-closure.md
```

The closure record should contain this ruling verbatim or as a chamber-supplied canonical attachment—not a builder reconstruction.

Commit it standalone as governance persistence. Then report:

```bash
git rev-parse HEAD
git status --porcelain
git show --stat --oneline HEAD
```

The resulting clean commit becomes the final Phase-8 baseline.

**Do not push until the closure record is persisted and verified.**

After that standalone persistence commit is confirmed, the complete Phase-8 sequence may be presented for final push authorization.
