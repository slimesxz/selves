# 0001 — Repository structure and client/server boundary

- **Status:** Accepted
- **Date:** 2026-07-21
- **Phase:** Playbook Phase 1 — Repository and boundary plan
- **Ruled by:** Liberty (recorded by Claude as architect)
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding constitutional law. Where
  this record conflicts with AGENTS.md, AGENTS.md wins. This record documents
  stack/structure choices; it does not amend the constitution.

---

## Context

The repository is a React/Vite/Tailwind client originally generated in Google
AI Studio. At Phase 1 the repo root is not an npm package; `client/` is a
standalone npm project; `legacy/` is quarantined; `reference/` is read-only.
No server exists.

The Backend Implementation Playbook targets:

```
React/Vite client -> TypeScript API -> AuthorizationService -> PostgreSQL
                                                             -> Transactional outbox -> Projection worker
```

Phase 1 does not build any of that. It fixes *where* each part will live and
*which* minimal stack each part uses, so that later phases have a ratified home
and authority never leaks into the client.

## Decisions

### 1. Repository layout — npm workspaces, three packages

```
/ (repo root)
├─ client/     React/Vite UI. Optimistic use of domain rules.
├─ domain/     Pure TS ontology. Zero UI imports, zero server imports. Imported by BOTH.
├─ server/     TS API + AuthorizationService + worker + migrations + integration tests.
│              The only authority.
├─ docs/       Decision records, schema, authorization matrix, threat model.
├─ legacy/     Quarantined (unchanged).
└─ reference/  Read-only (unchanged).
```

- Sharing between `client` and `server` uses **npm workspaces only**.
  **No Turborepo / Nx / Lerna**, now or later, without a separate ruling.
- The shared `domain/` package is a *functional* requirement, not
  organizational preference: AGENTS.md §8 requires placement rules, ring
  derivation, key grants, and the settlement state machine to live in pure
  TypeScript modules with zero UI imports, and requires the ontology to survive
  a re-skinning untouched. Two consumers need those rules — the server
  (authoritative enforcement) and the client (optimistic Draft → Departing →
  Cancel UX) — so a single shared package is the minimal way to avoid
  duplicating the state machine.

### 2. Scaffolding is deferred

`domain/`, `server/`, and the workspaces conversion are **not** created in
Phase 1. They are scaffolded in the phase that first needs them (expected
Phase 2/3), under that phase's own authorization. The workspaces conversion
consolidates to a single root lockfile; when it executes, `tsc --noEmit` and
`vite build` are re-verified green in the same step. `client/` is untouched
until then.

### 3. API framework — Fastify

Mature, first-class TypeScript, built-in schema validation (fewer extra
dependencies), and clean per-request hooks for the `SET LOCAL` database session
context required by later authentication/RLS phases. Chosen over Hono
(edge-portability is a non-goal) and Express (the existing dependency is an
unused AI-Studio leftover, not a chosen server).

### 4. SQL layer — pg + Kysely + explicit migrations, no ORM

- **`pg`** (node-postgres) for connections and raw control, including
  per-request `SET LOCAL` session variables for RLS.
- **Kysely** as a typed query *builder* — a zero-runtime type layer over SQL
  giving types and parameterization (injection safety) without hiding queries
  or adding a schema runtime. Kysely is not an ORM.
- **No ORM.** A full ORM (Prisma/Drizzle) is rejected: later phases require raw
  session variables and RLS, and the playbook demands explicit, reviewable
  migrations and deny-by-default. An ORM would hide the SQL the constitution
  wants visible and complicate RLS/session context — a net negative here.
- **Migration runner remains a Phase 2 decision** — flagged, not chosen.

### 5. Testing — Vitest + real-Postgres integration tests

**Vitest** for `client` and `domain` unit tests; **integration tests against a
real test PostgreSQL instance** for permission-critical server behavior (per
Playbook Phase 11). Installation deferred to the phase that adds tests.

## Confirmed hygiene (Phase 1)

- **Secrets:** no secret is committed. Root `.env` (`RESEND_API_KEY`) is
  untracked and gitignored. Only `.env.example` files are tracked.
- **gitignore:** root and `client/.gitignore` cover secrets and build output;
  `client/.gitignore` keeps `!.env.example`. A later de-Expo tidy of the root
  ignore file is recommended, non-urgent.
- **Env examples:** `client/.env.example` still references AI-Studio-only
  `GEMINI_API_KEY`/`APP_URL`. A `server/.env.example` (`DATABASE_URL`, DB role
  URLs, `PORT`) lands when `server/` is scaffolded.
- **Dev commands:** `client/` exposes `dev`, `build`, `preview`,
  `lint` (`tsc --noEmit`), `clean`. A documented root command set
  (`dev`, `build`, `test`, `migrate`, `db:*`) lands with workspaces.
- **Commit strategy:** one commit per approved sub-step, phase-tagged
  `P<n>-<step>: <desc>`; `tsc --noEmit` and `vite build` green before any
  commit; never cross a phase boundary without explicit authorization. A
  `pre-commit` hook is added once a test runner exists.

## Build baseline at Phase 1

`tsc --noEmit` exits 0; `vite build` succeeds. No source changed this phase.

## Docketed but not authorized (future client-cleanup phase)

- Remove unused AI-Studio leftovers from `client/package.json`:
  `@google/genai`, `express`, `dotenv`. `@google/genai` is additionally a
  latent constitutional risk — an LLM client inside the client is a standing
  temptation toward a forbidden Prism recommendation engine.
- Prune `client/.env.example` to drop the AI-Studio-only keys.
- Add a `pre-commit` hook once a test runner exists.
