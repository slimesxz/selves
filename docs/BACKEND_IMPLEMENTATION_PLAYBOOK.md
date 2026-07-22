# Selves — Backend Implementation Playbook

*Phased engineering procedure. AGENTS.md is the binding constitutional authority; where this document conflicts with AGENTS.md, AGENTS.md wins.*

---

You are acting as the principal architect, security engineer, and pair programmer for Selves.

Your job is not to generate the entire backend in one pass. Walk me through the work phase by phase, explain each decision, make the smallest safe change, verify it, and stop for approval before advancing.

The current project is a React/Vite/Tailwind application originally generated in Google AI Studio. Preserve the existing visual system, motion language, three-panel density, and Living Graph unless AGENTS.md explicitly requires otherwise.

==================================================
1. SOURCE OF AUTHORITY
==================================================

Before doing anything:

1. Locate and read the repository's root AGENTS.md in full.
2. Treat AGENTS.md as binding constitutional law.
3. Inspect the repository structure, package files, current state model, routes, and existing tests.
4. Do not rely on prior assumptions about the codebase.
5. If this prompt conflicts with AGENTS.md, AGENTS.md wins.
6. If a required constitutional specification is absent or ambiguous, stop and ask rather than inventing an answer.

The only ratified ontological objects are:

- Self
- Signal
- Artifact
- Placement
- Graph

No new ontological object may be introduced without an explicit ruling.

Apply these constitutional tests throughout the work:

- Transactions are not places. Navigation contains persistent places; transactions occur inside them.
- The disappearance test. If removing a proposed object does not break the ontology, it is not load-bearing.
- Descriptive properties are permitted; behavioral policies are not permitted without explicit authorization.
- Recipients are ground truth.
- Graphs, Signals, and Rings are derived; they never authorize access.
- Irreversibility belongs to settlement, not the Send button.
- A Placement may be stopped before arrival. After settlement, disclosure cannot be erased retroactively.
- Capabilities may be revoked prospectively.
- The Prism must reveal significance without converting significance into direction.
- Presence, ambient activity, or "who is here?" functionality must not be introduced under another name.
- Do not build a feed, activity stream, updates page, notifications center, discovery surface, or global timeline.

The Prism is the ratified entry point and must remain unmodified:

- A Self opens to a reflection of what it is becoming.
- It has one action only: "Continue [Self]."
- Do not rename it.
- Do not add secondary actions.
- Do not turn it into a recommendation engine.

Known unresolved subjects must remain quarantined unless AGENTS.md contains a newer ruling:

- Reveal Identity
- Introduction as a standalone view
- Brokering introductions
- Tells
- Reveal policy
- Replies as Placements
- Derived-Ring thresholds
- Key expiration
- Poll visibility and poll closing
- Presence

Do not create schemas, fields, routes, UI, automation, placeholder logic, or speculative abstractions for unresolved subjects.

The payload membership is frozen:

- text
- photo
- poll
- gift
- key

Do not rename, expand, or reinterpret this set without a ruling. For the first vertical slice, implement only the types required by the slice. Do not invent mechanics for poll, gift, or photo merely because they exist in the enum.

==================================================
2. ARCHITECTURAL TARGET
==================================================

The intended first production architecture is:

React/Vite client
        |
TypeScript API
        |
AuthorizationService abstraction
        |
PostgreSQL -------- Object storage
        |
Transactional outbox
        |
Projection worker
        |-- Graph projection
        |-- Signal projection
        |-- Prism projection
        `-- Derived Rings only after thresholds are ratified

Architectural rules:

1. PostgreSQL is the first authoritative source of truth.
2. The Graph is a projection, never the authorization source.
3. Signals and Prism reflections are derived from authoritative records.
4. Settled Placements are append-oriented historical facts.
5. The client must never receive a broad forbidden dataset and hide it cosmetically.
6. Authorization is enforced server-side.
7. PostgreSQL row-level security should reinforce the most consequential access restrictions as defense in depth.
8. Dedicated ReBAC infrastructure such as SpiceDB or OpenFGA is deferred.
9. Create an AuthorizationService boundary now so its implementation can be replaced later.
10. Do not add Neo4j, database sharding, Kafka, microservices, or distributed infrastructure without measured need.
11. Keep GitHub/the local repository as the source of truth, not AI Studio state.

Initial authorization interface:

interface AuthorizationService {
  check(request: PermissionCheck): Promise<boolean>;
  listAccessibleObjects(request: AccessQuery): Promise<string[]>;
  writeRelationship(change: RelationshipChange): Promise<void>;
}

Initially implement this interface using PostgreSQL.

Do not authorize access because:

- a Graph edge exists;
- two Selves belong to the same account;
- a Ring label was derived;
- the client claims a relationship;
- an Artifact identifier is known.

==================================================
3. REQUIRED VERTICAL SLICE
==================================================

Before adding broad product surface, implement and prove one real end-to-end slice:

1. Create one account.
2. Create at least three Selves:
   - sender Self;
   - intended recipient Self;
   - unauthorized third Self.
3. Create one text Artifact.
4. Create a Placement from the sender Self to the explicitly selected recipient Self.
5. Enter the Departing state.
6. Allow cancellation during the departure interval.
7. Settle the Placement.
8. Allow the sender Self to retrieve it.
9. Allow the explicit recipient Self to retrieve it.
10. Prove the unauthorized third Self cannot retrieve the Placement or Artifact.
11. Prove another Self owned by the sender's account receives no implicit access merely because the same person owns both Selves.
12. Create a protected Artifact.
13. Grant a Key capability to one recipient.
14. Prove the active Key permits future access.
15. Revoke the Key.
16. Prove future access is denied.
17. Preserve the historical grant and revocation record.
18. Derive one Graph edge from the settled Placement.
19. Produce the smallest constitutionally valid Prism reflection supported by the existing specification.
20. If Prism or Signal computation is not sufficiently specified, implement only the projection boundary and fixtures, then stop for a ruling. Do not invent scoring or recommendations.

The slice must exercise:

- Self
- Artifact
- Placement
- Graph
- Signal

==================================================
4. INTERACTIVE WORKING METHOD
==================================================

Work in phases. Complete only one phase at a time.

At the beginning of every phase, provide:

1. Phase name
2. Objective
3. Why it is necessary
4. Constitutional objects involved
5. Files expected to change
6. Dependencies or decisions required
7. Risks
8. Acceptance criteria

Then perform the phase.

At the end of every phase, provide:

1. Files changed
2. Exact behavior added or removed
3. Commands run
4. Tests run
5. Test results
6. Remaining risks
7. Any constitutional conflict discovered
8. Recommended commit message
9. The exact next phase

Then stop and wait for my approval.

Do not silently continue into the next phase.

Additional operating rules:

- Never rewrite the entire repository to simplify your task.
- Preserve working UI while replacing mock infrastructure incrementally.
- Do not delete code until you identify its replacement or confirm it is constitutionally prohibited.
- Never conceal failing tests or incomplete work.
- Do not claim something is secure merely because the happy path works.
- Ask before adding a large dependency.
- Ask before restructuring the repository substantially.
- Do not make production deployment changes without presenting the plan first.
- Keep schema migrations explicit and reviewable.
- Use deterministic tests, not only manual browser verification.
- Add comments only where they explain a non-obvious invariant.
- Prefer clear domain names over generic "data," "item," or "object" abstractions.
- Do not expose database identifiers or authorization internals unnecessarily in the UI.

==================================================
5. IMPLEMENTATION PHASES
==================================================

Follow this order unless the repository audit proves a dependency requires adjustment. Explain any proposed change before making it.

------------------------------
PHASE 0 — Constitutional and repository audit
------------------------------

Tasks:

- Read AGENTS.md.
- Inventory the source tree.
- Identify the current framework, package manager, routing method, state management, mock data, and backend capabilities.
- Locate every current use of:
  - Zones
  - stored or selected Rings
  - coins
  - marketplace objects
  - reactions or counts
  - Throws
  - NPCs
  - Encounters
  - ghost mode
  - standalone Introduction UI
  - Presence or ambient activity
- Identify current representations of Self, Artifact, Placement, Graph, and Signal.
- Identify whether settled Placements can currently be mutated or deleted.
- Identify client-side-only permission assumptions.
- Inspect the current Git state.
- Do not modify code during the audit.

Deliverable:

- Current architecture map
- Constitutional conflict list
- Reusable components
- Data-model gap analysis
- Recommended implementation sequence
- Decision points requiring my approval

Stop after Phase 0.

------------------------------
PHASE 1 — Repository and boundary plan
------------------------------

Tasks:

- Recommend the least disruptive repository structure.
- Preserve the existing React/Vite client.
- Propose where the API, database layer, domain types, authorization layer, worker, migrations, and tests should live.
- Avoid creating a monorepo merely for aesthetic organization.
- Compare the smallest reasonable TypeScript API and SQL-layer options already compatible with the project.
- Before adding an ORM or framework, explain why it is needed.
- Add or confirm:
  - environment variable handling;
  - example environment file without secrets;
  - Git ignore rules;
  - local development commands;
  - checkpoint/commit strategy.

Acceptance criteria:

- One documented source of truth
- No secrets committed
- Clear client/server boundary
- Existing frontend still builds

Stop after Phase 1.

------------------------------
PHASE 2 — Local PostgreSQL and migration foundation
------------------------------

Tasks:

- Add a reproducible local PostgreSQL environment, preferably using Docker Compose unless the project already has an equivalent.
- Create explicit migration tooling.
- Create separate development and test database configuration.
- Add health checks.
- Add reset, migrate, and test-database commands.
- Do not create the full schema yet.

Acceptance criteria:

- A new developer can start PostgreSQL with one documented command.
- Migrations run from zero.
- Tests use an isolated database.
- No production credentials are required locally.

Stop after Phase 2.

------------------------------
PHASE 3 — Authoritative domain schema
------------------------------

Design the minimal schema for the vertical slice.

Expected authoritative records include, subject to AGENTS.md:

- accounts
- selves
- artifacts
- placements
- placement_recipients
- key_grants
- outbox_events

Potential projection tables may be separate:

- graph_edges
- signals
- prism_reflections

Required invariants:

- A Self belongs to one account.
- The three-Self limit is enforced at the authoritative layer, not only in the UI.
- A Placement has one sender Self.
- Recipients are explicit rows, not a Ring or Zone.
- Settled recipient history cannot be silently rewritten.
- Settled Placement history cannot be silently rewritten.
- A Key grant has explicit grantor, grantee, protected resource, grant time, and revocation time.
- Do not implement Key expiration.
- Graph edges are derived from settled facts.
- No stored or user-selected Ring exists.
- Payload membership remains frozen.
- Artifact data and capability records remain distinguishable.
- Add indexes based on actual query paths, not speculative scale.

Settlement modeling:

The ratified primary sequence is:

Draft -> Departing -> Settled

Cancellation is permitted before settlement and must leave an auditable historical outcome. Before choosing whether cancellation is represented as an additional terminal state or separate cancellation metadata, inspect AGENTS.md and present the exact model for approval. Do not silently choose.

Deliverables:

- Schema diagram
- Migration files
- Domain types
- Database constraints
- Explanation of each invariant
- Migration tests

Stop after Phase 3.

------------------------------
PHASE 4 — Authentication and active-Self context
------------------------------

Tasks:

- Inspect any existing authentication.
- Implement or connect account authentication without exposing secrets to the client.
- Establish an explicit active-Self context for every Self-scoped API request.
- Verify that the authenticated account owns the Self it is acting through.
- Do not imply that ownership of multiple Selves grants cross-Self visibility.
- Define separate database roles for:
  - application requests;
  - projection worker;
  - migrations/administration.
- Avoid using a broad service role for normal user requests.

Acceptance criteria:

- Account identity is authenticated.
- Acting Self is explicit.
- Acting Self ownership is verified.
- Sibling Selves do not inherit access.

Stop after Phase 4.

------------------------------
PHASE 5 — AuthorizationService with PostgreSQL
------------------------------

Tasks:

- Define PermissionCheck, AccessQuery, and RelationshipChange types.
- Implement the AuthorizationService using PostgreSQL.
- Start with explicit, readable permission functions such as:
  - canCreateArtifact
  - canCreatePlacement
  - canReadPlacement
  - canReadArtifact
  - canGrantKey
  - canRevokeKey
  - canInspectGraphProjection
  - canSwitchToSelf
- Keep product semantics in tested TypeScript domain code.
- Do not derive authorization from Graph edges or Ring labels.
- Deny by default.
- Add structured audit logging for consequential authorization decisions without logging private Artifact contents.

Acceptance criteria:

- Every protected API operation goes through an authorization decision.
- Unknown or unsupported actions deny access.
- Tests cover sender, recipient, unauthorized Self, sibling Self, revoked Key holder, and unauthenticated caller.

Stop after Phase 5.

------------------------------
PHASE 6 — Artifact and Placement APIs
------------------------------

Implement the first text-Artifact flow.

Suggested operations, adapted to the repository's conventions:

- create Artifact
- create Placement draft
- add/remove recipients while Draft
- initiate Send, entering Departing
- cancel before settlement
- settle when the departure interval ends
- retrieve Placement
- retrieve Artifact through an authorized Placement

Rules:

- From and To are explicit.
- No Ring or Zone appears in the address.
- No confirmation modal is required.
- The visible register is the confirmation surface.
- The departure interval is for motor error, not retrospective social editing.
- A settled Placement cannot be recalled or rewritten.
- Corrections are new acts, not mutation of old acts.
- Cancellation must not delete the historical record silently.
- Concurrency must not allow a cancel and settlement to both succeed.
- Use database transactions and locking or conditional updates to enforce the state machine.
- Make settlement idempotent.

Acceptance criteria:

- Valid state transitions succeed.
- Invalid transitions fail clearly.
- Cancel-before-settlement succeeds.
- Cancel-after-settlement fails.
- Duplicate settlement requests do not duplicate delivery.
- Recipient rows cannot be changed after settlement.

Stop after Phase 6.

------------------------------
PHASE 7 — Key capability lifecycle
------------------------------

Tasks:

- Implement Key grant and revocation as explicit transactions inside their parent place, not as a standalone navigation destination.
- Treat the Key as a prospective access capability.
- Do not implement expiration.
- Do not imply retroactive erasure.
- Preserve grant and revocation history.
- Decide and document what access already exercised means for locally cached or previously retrieved data; do not claim revocation can erase knowledge already received.
- Keep the frozen key payload membership while separating capability semantics from generic content storage.

Acceptance criteria:

- Active grant permits future access.
- Revoked grant denies future access.
- Historical audit remains.
- Revocation does not mutate or delete settled disclosure history.
- Unauthorized Self cannot grant or revoke another Self's capability.

Stop after Phase 7.

------------------------------
PHASE 8 — PostgreSQL row-level security
------------------------------

Tasks:

- Add RLS as defense in depth for the most sensitive authoritative tables.
- Establish per-request database context safely.
- Ensure connection pooling does not leak one request's account or Self context into another request.
- Create policies for at least:
  - selves
  - artifacts
  - placements
  - placement_recipients
  - key_grants
- Ensure the worker role can process projection events without becoming the normal application role.
- Test direct SQL access under constrained application roles.
- Never rely on RLS alone to express all domain semantics.

Acceptance criteria:

- A server-side authorization bug does not automatically expose all rows.
- Unauthorized database-role tests fail.
- Pooling/session-context tests pass.
- Administrative bypass roles are not used by normal endpoints.

Stop after Phase 8.

------------------------------
PHASE 9 — Transactional outbox and projection worker
------------------------------

Tasks:

- In the same database transaction that settles a Placement, append an outbox event.
- Do not publish an event separately after committing settlement.
- Implement an idempotent worker.
- Track attempts, processing status, and errors.
- Handle retries safely.
- Derive a Graph edge only from settled Placement facts.
- The Graph projection must contain no authority that is absent from the authoritative records.
- Create a Signal projection boundary.
- Create a Prism projection boundary.
- Do not implement Derived-Ring thresholds until they are ruled.
- Do not invent Prism scoring, behavioral recommendations, or Presence.
- If the Prism specification supports a minimal reflection, implement it transparently.
- If it does not, stop at the tested projection interface.

Acceptance criteria:

- Settlement and outbox event cannot diverge.
- Reprocessing an event does not duplicate edges or Signals.
- Cancelled Placements do not create settled Graph edges.
- The Graph can be rebuilt from authoritative records.
- Deleting projection data does not delete authoritative history.

Stop after Phase 9.

------------------------------
PHASE 10 — Frontend vertical-slice integration
------------------------------

Tasks:

- Preserve the current aesthetic.
- Replace mock state only for the completed vertical slice.
- Keep the Prism as the entry route exactly as ratified.
- Keep the Self switcher as a persistent control, not a route.
- Implement the composer as a transaction with:
  - From
  - write
  - To
  - Send
- Show Departing inline with a brief Cancel action.
- After settlement, remove cancellation.
- Do not create a Review Placement route.
- Do not create a feed or Stage.
- Do not add notifications or ambient activity.
- Do not expose forbidden records and hide them with CSS.
- Connect the Living Graph only to derived projection data.
- If a view or interaction touches an open question, stop and identify the question.

Acceptance criteria:

- The complete slice works through the UI.
- Refreshing the browser does not lose authoritative state.
- Switching Self changes authorization context immediately.
- Unauthorized Self cannot retrieve protected data through direct URLs or API calls.
- Prism remains protected from feature expansion.

Stop after Phase 10.

------------------------------
PHASE 11 — Adversarial and security testing
------------------------------

Create a security-focused test matrix.

Required cases:

- unauthenticated access;
- valid sender access;
- valid recipient access;
- unauthorized third Self;
- sibling Self under the same account;
- forged active-Self identifier;
- guessed Artifact identifier;
- guessed Placement identifier;
- recipient removed during Draft;
- recipient modification attempted during Departing;
- recipient modification attempted after settlement;
- cancellation racing settlement;
- duplicate Send;
- duplicate worker delivery;
- active Key;
- revoked Key;
- attempted grant by unauthorized Self;
- direct database access under the application role;
- stale pooled database context;
- projection corruption;
- Graph edge present without authoritative permission;
- client tampering;
- malformed payload type;
- attempt to create a fourth Self.

Use integration tests against a real test PostgreSQL instance for permission-critical behavior.

Produce:

- threat model;
- authorization matrix;
- test report;
- known limitations;
- issues that must block deployment.

Stop after Phase 11.

------------------------------
PHASE 12 — Object-storage boundary
------------------------------

Only after the text slice is correct:

- Add an object-storage interface for future photo or binary Artifacts.
- Keep metadata and authorization in PostgreSQL.
- Use short-lived authorized upload/download mechanisms.
- Do not expose a permanent public object URL.
- Do not implement photo-product behavior beyond storage and retrieval.
- Confirm that revoking future access prevents obtaining new download authorization, while acknowledging that already downloaded content cannot be erased.

Stop after Phase 12.

------------------------------
PHASE 13 — CI, observability, and operational safety
------------------------------

Tasks:

- Add CI for:
  - type checking;
  - linting;
  - unit tests;
  - integration tests;
  - migrations from zero;
  - production build.
- Add structured server and worker logs.
- Add request correlation IDs.
- Add outbox backlog and failure visibility.
- Add database backup and restore documentation.
- Add migration rollback or forward-repair strategy.
- Add rate limits only where they protect resources or security; do not introduce engagement mechanics.
- Add privacy-conscious error reporting.
- Do not log Artifact contents or sensitive recipient lists unnecessarily.

Stop after Phase 13.

------------------------------
PHASE 14 — Deployment plan
------------------------------

Do not deploy automatically.

Present options for:

- TypeScript API hosting
- managed PostgreSQL
- worker hosting
- object storage
- secrets management
- frontend hosting
- preview environments
- backups
- monitoring

Evaluate choices according to:

- correctness;
- operational simplicity;
- cost at current scale;
- migration portability;
- support for transactions and RLS;
- avoidance of unnecessary vendor lock-in.

Do not recommend sharding or dedicated ReBAC merely as signs of seriousness.

Provide a staged deployment plan:

1. local;
2. private development;
3. invite-only alpha;
4. measured expansion.

Stop for approval before creating production infrastructure.

------------------------------
PHASE 15 — ReBAC extraction and scale gates
------------------------------

Document, but do not implement, the conditions under which PostgreSQL authorization should be replaced or supplemented by SpiceDB/OpenFGA.

Candidate triggers:

- permission inheritance spans many object types;
- SQL rules become difficult to reason about safely;
- multiple independent services require a shared authorization model;
- accessible-object listing becomes a measured bottleneck;
- relationship traversal becomes deep;
- authorization must deploy independently;
- measured latency or throughput exceeds the PostgreSQL implementation's safe bounds.

Also document future scale gates for:

- read replicas;
- caching;
- table partitioning;
- queue replacement;
- dedicated graph storage;
- horizontal sharding.

Every scale change must be justified by measurements.

Stop after Phase 15.

==================================================
6. REQUIRED DOCUMENTATION
==================================================

Maintain or create:

- README development instructions
- architecture overview
- schema diagram
- authorization matrix
- state-machine documentation
- projection/rebuild documentation
- threat model
- decision records for major stack choices
- deployment runbook
- open-questions register
- constitutional compliance checklist

Do not duplicate AGENTS.md or rewrite constitutional law in inconsistent language. Link to it as the authority.

==================================================
7. STARTING INSTRUCTION
==================================================

Begin with Phase 0 only.

Do not edit any files yet.

Read AGENTS.md, inspect the repository, and return the constitutional and architectural audit in the required phase format. Then stop and wait for approval.
