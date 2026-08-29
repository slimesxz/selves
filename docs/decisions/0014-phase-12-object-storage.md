# 0014 — Phase 12: the object-storage boundary (Gate 1 rulings, ratified design, evidence, disposition)

- **Status:** **PHASE 12 — P12-E recorded.** Segments A–D are closed; this record
  memorializes the accepted boundary, its evidence, and its dispositions.
  Recording this disposition is **not** authorization to deploy — see §9.
- **Date:** 2026-08-29
- **Phase:** Playbook Phase 12 — Object-storage boundary
- **Ruled by:** Liberty (chamber); recorded by Claude as engineer
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law.
  Where this record conflicts with AGENTS.md, AGENTS.md wins. This record
  introduces **no** ontological object, **no** product semantics, and **no**
  authorization, lifecycle, schema, API, projection, or client change. The
  ontology remains exactly Self → Signal → Artifact → Placement → Graph.
- **Builds on:** [0005](./0005-authorization-service.md) (the
  `AuthorizationService` and the opaque `Visible<T>` denial),
  [0007](./0007-key-lifecycle.md) (the Key capability and prospective
  revocation — **not amended by this record**),
  [0008](./0008-row-level-security.md) (§0 T1/T2/T3, extended not replaced),
  [0011](./0011-phase-9-outbox-projections.md) (§7.1 amendment-ledger standing
  rule), [0012](./0012-phase-10.md) (§21 P10-N4 permanent prohibition),
  [0013](./0013-phase-11-opening.md) (Phase 11 closure; evidence classes).
- **Procedural baseline at opening:** `b5de44e3413bcbbc30b612e09613e15480dec653`
  ("P11-F: close Phase 11"). Node v24.18.0.
- **Artifacts amended by this phase:** [threat-model.md](../threat-model.md),
  [known-limitations.md](../known-limitations.md),
  [deployment-blockers.md](../deployment-blockers.md),
  [authorization-matrix.md](../authorization-matrix.md). See §8.

---

## 1. Opening authority and the governing question

Phase 11 closed at `b5de44e` under [0013 §12](./0013-phase-11-opening.md). Phase
12 was opened by chamber transmission. The governing purpose is
[the Playbook](../BACKEND_IMPLEMENTATION_PLAYBOOK.md) **PHASE 12 —
Object-storage boundary**: add an object-storage interface for *future* photo or
binary Artifacts, keep metadata and authorization in PostgreSQL, use short-lived
authorized upload/download mechanisms, expose no permanent public object URL,
and confirm that revoking future access prevents obtaining new download
authorization while acknowledging that already-downloaded content cannot be
erased.

## 2. Gate 1 rulings

**Q1 — Scope. BOUNDARY ONLY.** Phase 12 does **not** make `photo` a creatable
Artifact payload. It does not relax `artifacts_text_only`, make `text_body`
nullable, widen `ArtifactPayloadType` beyond `'text'`, add a photo creation
mutation, add a photo viewer or composer, or create a new authoritative
object-metadata table. The `photo` enum member remains a ratified future payload
category with no currently ratified product mechanics.

**Metadata rule.** "Keep metadata and authorization in PostgreSQL" means: when a
binary-bearing Artifact is eventually ratified, the authoritative object
identity, association, and authorization metadata must live in PostgreSQL rather
than be inferred from the object store. It does **not** independently authorize
new authoritative metadata persistence in Phase 12, and none was created.

**Q2 — Threat model.** Extend the existing integrated model; do not create a
competing one. `threat-model.md` is the integrated-system threat model. **Do not
silently extend T2**: the object store is an additional trust boundary with
separately stated guarantees.

**Q3 — Dependency. Dependency-free port first.** No S3/R2/MinIO SDK, no
emulator, no vendor adapter. The interface must not leak vendor concepts into
domain or authorization code. Provider selection and production credential
mechanics remain deployment work.

**Q4 — "Short-lived".** A single server-controlled maximum lifetime, not a
user-selectable list: **300 seconds**. Callers do not select the lifetime. A
shorter lifetime may be issued; a longer one never. No client-supplied TTL, no
persisted standing download URL.

**Q5 — Already-exercised access.** Phase 12 records the general
prospective-disclosure rule's concrete object-storage consequence. It does not
retroactively reopen Phase 7. See §5.

**Q6 — Deployment blockers.** Analyze, but do not preclassify. A new trust
boundary does not by itself create a blocker. See §7.

**R1 — Production API surface.** No new production HTTP route. The sixteen-route
surface remains frozen. **R2 — Upload authorization** must not imply authority
to create a photo Artifact; the port must distinguish permission to place bytes
from authority over an authoritative Artifact. **R3 — Download authorization**
is an ephemeral derivative capability: not an authoritative record, not a Key
grant, not a Graph edge, not a new ground, not refreshable after the underlying
authority is lost, never a permanent public URL. **R4 — Object identifiers** are
implementation identifiers, not authority. **R5 — Outbox/projection:** no
authoritative domain event may be emitted because bytes moved. **R6 — Client:**
no client work. **R7 — Test apparatus** may exist but must be structurally
distinguishable, with no production dependency on it.

**Design rulings taken during P12-A.** **D1** — the decision record belongs to
P12-E, not to an implementation segment (this record). **D2** — the proposed
Artifact-addressed `issueUploadAuthorization` was **rejected**; see §3. **D3** —
`Visible<ObjectAuthorization>` is ratified as the opaque issuance result rather
than a second allow/deny representation.

**P12-C ordering clarification.** The authoritative PostgreSQL Artifact-read
decision executes **first**; object-association state is consulted only after an
allow. This supersedes the ordering sentence in the P12-A packet.

**P12-D drafting correction.** A P12-D coverage bullet reading "300 seconds
rejected" was a chamber drafting error and did **not** amend Q4. The
authoritative rule is: exactly 300 seconds permitted; greater than 300 seconds
rejected; shorter positive lifetimes permitted; zero and negative rejected;
redemption valid strictly while `now < expiresAt`; expired at `now === expiresAt`.

## 3. The ratified boundary, as implemented

Three production modules, 330 lines total, none of which any production caller
reaches.

**`server/src/storage/object-storage.ts` — the vendor-neutral byte plane.**
`ObjectKey` (branded locally, so `@selves/domain` gains no member),
`MAX_OBJECT_AUTHORIZATION_SECONDS = 300`, `ObjectAccessMode`,
`ObjectAuthorization`, the closed five-member `ObjectStorageFailure` union,
`ObjectStorageError`, `Clock`, `newObjectKey()`, and:

```ts
export interface ObjectStorage {
  authorizeUpload(key: ObjectKey, expiresAt: Date): Promise<ObjectAuthorization>;
  authorizeDownload(key: ObjectKey, expiresAt: Date): Promise<ObjectAuthorization>;
  put(auth: ObjectAuthorization, bytes: Uint8Array): Promise<void>;
  get(auth: ObjectAuthorization): Promise<Uint8Array>;
}
```

`ObjectAuthorization` declares `key`, `mode`, `expiresAt`, `credential` — and
**no `url` member and no artifact member**. There is deliberately **no
authorization-revocation operation**: a presigned-URL provider could not honour
one, so offering it would let this record claim a guarantee the architecture
does not deliver.

**`server/src/storage/local-object-storage.ts` — the deterministic local
implementation.** Instance-scoped state, `node:crypto` only, no database,
network, or filesystem access. It enforces the 300-second ceiling **at the
port**, so no caller — including a future defective issuer — can obtain a longer
credential. Redemption is decided against the port's own registry, never against
the fields carried on the value handed to the holder.

**`server/src/storage/object-access.ts` — application-layer download issuance.**

```ts
export interface ObjectBindingResolver {
  objectFor(artifactId: string): Promise<ObjectKey | null>;
}
export interface ObjectAccessIssuer {
  issueDownloadAuthorization(
    ctx: ActingContext, artifactId: string,
  ): Promise<Visible<ObjectAuthorization>>;
}
```

Issuance order, exactly:

1. `authorization.readArtifact(ctx, artifactId)` — the existing authoritative
   decision, reaching real PostgreSQL through the ratified C3 acting-Self
   context and the ratified RLS policies;
2. denied → `{ ok: false }`;
3. `binding.objectFor(artifactId)` — object-association state, consulted **only
   now**;
4. no binding → `{ ok: false }`, indistinguishable from step 2;
5. `expiresAt = clock() + 300 s` — server-controlled, no caller input;
6. `storage.authorizeDownload(key, expiresAt)`;
7. `{ ok: true, value }`.

The Artifact value returned by `readArtifact` is discarded; only the allow
result is used. The issuer holds no database handle, no repository, and no
mutation, and its only value-bearing import is the lifetime constant.

### 3.1 The layer separation — the fact most easily misstated

> **Upload capability and download capability exist at different layers because
> the governing authority presently exists at different layers.**

- **Upload** exists **only at the byte-plane port**. Phase 12 ratifies **no
  production upload issuance service** and **no production authority** for
  unattached uploads, because no ratified authority answers "may this actor
  upload these unattached bytes?" Artifact-read authority may **not** be
  substituted for an authority that does not exist. No `artifactId` is attached
  to an upload authorization. A successful `put` creates private byte-plane
  state and **no authoritative fact**.
- **Download** issuance is an **application-layer** decision and is
  **subordinate** to the authoritative PostgreSQL Artifact-read decision.

Phase 12 therefore satisfies the Playbook's "short-lived authorized
upload/download mechanisms" at two different layers. **This record does not
describe Phase 12 as having a production upload feature.** A future ratified
binary-bearing Artifact slice must ratify the production authority under which
upload issuance occurs, and the PostgreSQL association mechanics.

### 3.2 What Phase 12 does not contain

Recorded so no reader infers more than exists:

- **no production `ObjectBindingResolver` implementation** — there is no
  binary-bearing Artifact and therefore no authoritative association to resolve;
  an always-null stub would add inert composition without proving a property;
- **no production composition factory** and **no current production caller** —
  nothing in `server.ts`, `app.ts`, `routes/domain.ts`, or the worker tree
  imports the storage tree;
- **no HTTP route** (the sixteen remain frozen and their two credential-handling
  files byte-unchanged), **no client behaviour**, **no schema change or
  migration**, **no projection or outbox semantics**, **no photo creation
  mechanics**, **no storage SDK or provider adapter**.

The modules are future-consumable infrastructure. That they have no caller is
the intended consequence of Boundary Only, not a gap.

### 3.3 Local-driver operational semantics

The port's `Promise`-returning signatures describe the abstraction boundary. The
dependency-free local driver performs its validation **synchronously**, before
returning a resolved Promise, so a rejected call throws synchronously rather
than rejecting. The chamber accepted this as a limitation of the current local
driver: it violates no ratified authorization, expiry, containment, or
disclosure property, and no Phase 12 security claim depends on rejection timing.
The evidence tolerates both forms, so nothing is concealed by it. It is **not** a
deployment blocker and must not be elevated into one by inference.

## 4. Evidence (P12-D)

Executed against a real PostgreSQL test instance under the ratified constrained
roles. Evidence classes are those defined in
[threat-model.md §1](../threat-model.md).

**The decisive test**, RUNTIME + DATABASE:

> `P12-D — loss of the revocable Artifact-read ground prevents issuance of a new
> download authorization`

It proves, in order: an authoritative **text** Artifact exists; recipient access
is established through the ratified revocable **Key** ground driven through the
real lifecycle; opaque bytes are placed and associated **only** through test
apparatus; a download authorization is issued while authority is live, bounded
to exactly 300 seconds, and redeems; the Key is revoked through the existing
authoritative lifecycle; the **preserved** `public.key_grants` row records
non-null `granted_at` and non-null `revoked_at` with `count = 1`; a fresh
issuance request returns opaque `{ ok: false }`; already-retrieved bytes remain
held; the previously issued authorization **still redeems while unexpired**; and
at `now === expiresAt` it fails and no replacement can be obtained.

**Supporting evidence.** A denied Artifact read causes **zero** binding lookups
(with a binding present, so the assertion cannot pass vacuously); an allowed
decision produces `readArtifact → objectFor` in that order; an authorized
Artifact with no bound object returns the identical opaque `{ ok: false }`;
stranger, ground-less sibling, and absent Artifact are indistinguishable;
placing bytes, issuing a capability, and downloading change **no** authoritative
row count across `artifacts`, `placements`, `placement_recipients`,
`key_grants`, and `outbox_events`.

**Byte-plane contract**, RUNTIME over the local driver: both lifetimes are
port-bounded; exactly 300 s permitted; over-ceiling, zero, negative, and
non-finite refused; redeemable at `expiresAt − 1 ms`, denied at `expiresAt` and
after; forged credentials refused; read/write modes separated; the registry —
not the mutable returned fields — governs redemption; bytes copied in and out;
the surface exposes exactly four operations and no revocation; key knowledge
alone does not redeem.

**Containment**, STATIC: exact export and interface-member locks; the only
value-bearing edges are `node:crypto` and the port constant; no `pg`, `db.ts`,
repository, or `test/` value-import; no module outside `src/storage` imports the
tree; `ObjectBindingResolver` appears as exactly two AST references (declaration
plus dependency type); zero production occurrences of the rejected
upload-issuance symbol; no `DATABASE_URL`, `proj.`, `domain.`, or SQL keyword.

**Regression at P12-D closure:** server **63 files / 522 tests PASS**; client
**28 files / 181 tests PASS**; both typechecks PASS; inherited static locks PASS.

### 4.1 Claims whose evidence is weaker than RUNTIME

Recorded explicitly, per the standing rule that a claim is never silently
promoted:

- Every containment property in §4's third paragraph is **STATIC**. It proves a
  property of the committed **source**, never of a running adversarial system.
  In particular, "storage activity manufactures no authoritative fact" is STATIC
  as to the absence of a source-level write path; its RUNTIME counterpart is the
  row-count proof, which is bounded to the operations that test performs.
- The two scanning modes are bounded and say so in the test source: AST scans
  exclude comments (a header naming a vendor in order to deny it is not a leak);
  the SQL text scan is uppercase-only, matching the repository's universal SQL
  convention; the vendor token list omits `r2` because it collides with the Gate
  1 ruling identifier `R2` used in provenance comments, with Cloudflare R2
  covered by the `cloudflare` token instead.
- All byte-plane evidence is **ARCHITECTURAL** with respect to any cloud
  provider. Phase 12 selects no provider and models no provider's
  signed-request semantics.

## 5. The already-exercised-access disposition

The constitutional rule already exists ([AGENTS.md §5](../../AGENTS.md)):
capabilities may be revoked prospectively; disclosure cannot be erased
retroactively. Its concrete object-storage consequence is:

> **Revocation prevents obtaining a new download authorization once the
> authoritative Artifact-read ground is lost. Bytes already disclosed cannot be
> erased. An authorization issued before revocation may remain usable until its
> bounded expiry, because Phase 12 provides no stronger revocation guarantee —
> and the short lifetime is therefore what bounds the residual exposure.**

All three limbs are **proven**, not asserted (§4, steps 8–12).

**Phase 7 is not amended.** Repository inspection establishes that
[0007](./0007-key-lifecycle.md) promised no missing artifact on this subject; the
nearest existing disposition is **L11** in
[known-limitations.md](../known-limitations.md), which remains as Phase 11 left
it. This record adds the object-storage consequence; it does not revise history.

## 6. Threat-model extension

The object store is an **additional trust boundary**, recorded in
[threat-model.md §8](../threat-model.md) as **O1–O10**. **T1/T2/T3 are not
widened**: object-store compromise and PostgreSQL compromise remain distinct,
and **compromise of storage-driver credentials is not claimed contained by the
T2 line**. Two dispositions are recorded as properties rather than defects:
**replay before expiry succeeds by design** (O3), and an **authorization minted
before revocation retains a bounded residual window** (O7).

## 7. Deployment-boundary analysis

Each object-storage issue is classified; nothing is inferred into a blocker.

| # | Issue | Classification |
|---|---|---|
| 1 | Download issuance is subordinate to the authoritative Artifact-read decision; denial causes no binding lookup | **Security property proven by Phase 12** |
| 2 | Both authorization lifetimes are bounded at 300 s, enforced at the port; expiry is exact | **Security property proven by Phase 12** |
| 3 | Storage activity creates no Artifact, grant, edge, projection, or event | **Security property proven by Phase 12** |
| 4 | Object keys confer no entitlement; no permanent/public URL representation exists | **Security property proven by Phase 12** |
| 5 | Bytes already disclosed cannot be erased (**L13**) | **Accepted limitation** |
| 6 | An already-issued authorization may remain usable until expiry (**L14**) | **Accepted limitation** |
| 7 | Synchronous validation throw in the local driver (§3.3) | **Accepted limitation** |
| 8 | Object-store credential custody, provider hardening, bucket/container policy, encryption at rest, and provider-side audit | **Provider/deployment responsibility** |
| 9 | Production provider selection and vendor adapter | **Deferred implementation requirement** (Playbook Phase 14) |
| 10 | Production `ObjectBindingResolver`, PostgreSQL association mechanics, and upload authority | **Deferred implementation requirement** — a future ratified binary-bearing Artifact slice |
| 11 | Object-storage deployment blockers introduced by Phase 12 | **NONE** |

**No new deployment blocker.** Deferred provider selection, deferred credential
mechanics, and an additional trust boundary are not, by inference, blockers. The
DB4 lesson is controlling: an excluded or deferred concern is not transformed
into a blocker by adjacency. **DB1–DB3 remain textually unchanged and
unresolved**; Phase 12 had no authority to dispose any of them and disposed
none.

## 8. Amendment ledger (0011 §7.1)

The standing rule is that a change to a baseline or accepted artifact enters the
ledger regardless of how it is characterised. Phase 12's amendments are:

| # | File | Nature of amendment |
|---|---|---|
| 1 | [threat-model.md](../threat-model.md) | New **§8** (object-storage trust boundary, O1–O10) and one header bullet. §§1–7 unchanged; T1/T2/T3 unchanged. |
| 2 | [known-limitations.md](../known-limitations.md) | New **L13**, **L14**, two summary rows, one header bullet. L1–L12 unchanged. |
| 3 | [deployment-blockers.md](../deployment-blockers.md) | New object-storage analysis section and one header bullet. DB1–DB3 and the summary unchanged. |
| 4 | [authorization-matrix.md](../authorization-matrix.md) | New **A.4** (derivative download issuance) and one header bullet. A.1–A.3 and Part B unchanged. |

**No baseline test file was amended in any Phase 12 segment.** The inherited
locks — `authz-import-graph`, `authz-no-memoization`, `http-credential-audit`,
`production-routes`, `globalSetup` — are byte-unchanged and passing.

**Recorded tension, disclosed rather than resolved silently.** Three of the four
amended artifacts are titled and status-lined as **Phase 11** artifacts. The
Phase 12 additions are strictly additive and each carries a header bullet naming
this record, so no existing sentence is contradicted and the extension is
visible. Retitling them as cross-phase artifacts would rewrite accepted Phase 11
wording and was **not** undertaken. If the chamber prefers retitling, it is a
separate ruling.

## 9. What this record does not do

- It does not make `photo` a creatable payload, or relax any Artifact
  constraint.
- It does not add a production HTTP route, client surface, schema object,
  migration, projection, or outbox event.
- It does not claim a production upload issuance authority, or that Phase 12
  ships a usable object-storage feature.
- It does not claim retroactive revocation of disclosed bytes or of an
  authorization already issued.
- It does not widen T1/T2/T3, and it makes no containment claim about
  storage-driver credential compromise.
- It does not dispose DB1, DB2, or DB3, and it does not create a new blocker.
- It does not amend [0007](./0007-key-lifecycle.md) or any other historical
  record.
- **It is not authorization to deploy.** Three inherited deployment blockers
  stand.
