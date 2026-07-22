# 0002 — Migration foundation and local PostgreSQL

- **Status:** Accepted
- **Date:** 2026-07-21
- **Phase:** Playbook Phase 2 — Local PostgreSQL and migration foundation
- **Ruled by:** Liberty (recorded by Claude as architect)
- **Authority:** [AGENTS.md](../../AGENTS.md) is binding. This record documents
  tooling choices for the local database substrate; it introduces no schema and
  no ontology.
- **Builds on:** [0001 — Repository structure and client/server boundary](./0001-repo-boundary.md)

---

## Context

Phase 2 establishes a reproducible local PostgreSQL and explicit migration
tooling so later phases can write authoritative migrations and run tests
against an isolated database. No schema is created in this phase.

Decision record 0001 ratified `pg` + Kysely + explicit migrations, no ORM, and
left the migration runner as a Phase 2 choice. It also ratified a standalone
`server/` package and deferred the npm-workspaces conversion to the phase that
first shares `domain/`.

## Decisions

### A. Migration runner — node-pg-migrate, raw-SQL up/down

**node-pg-migrate** with raw-`.sql` up/down migrations. Chosen over the Kysely
built-in `Migrator` (no CLI; couples authoritative schema migrations to the
query builder; TS migrations need a transpile step) and over a hand-rolled
`psql` + shell runner (reinvents version tracking, ordering, and transactional
wrapping). node-pg-migrate gives a real CLI for the required
reset/migrate/test-db commands, tracks applied migrations in its own
`pgmigrations` table, and keeps authoritative schema decoupled from the query
layer. Raw SQL is the most reviewable migration form. Drizzle-kit and Prisma
migrate remain rejected per 0001 (ORM territory).

### B. Tooling home — standalone `server/` package

Migration tooling lives in a standalone `server/` npm package with its own
`package.json` (mirroring how `client/` stands alone today). **No root
`package.json` and no workspaces conversion in this phase** — the 0001 trigger
(sharing `domain/` between client and server) is not reached until Phase 3, so
the conversion stays deferred. The client build was re-verified green after
scaffolding; `client/` was not touched.

## What Phase 2 created

- `docker-compose.yml` (root) — one `postgres:17` service, `pg_isready`
  healthcheck, named volume `selves_pgdata`, port 5432, local-only credentials.
- `server/db/init/01-create-test-database.sql` — first-start provisioning of the
  isolated `selves_test` database. **Database creation only — no tables.**
- `server/package.json` — standalone package; deps `node-pg-migrate`, `pg`,
  `@types/pg` (dev), exactly as approved; scripts for the DB lifecycle and
  migrations.
- `server/.env.example` — `DATABASE_URL` (dev) and `TEST_DATABASE_URL` (test),
  local-only placeholders, no secrets.
- `server/.gitignore`, `server/migrations/.gitkeep` (empty), `server/README.md`.

## Environment and dependency notes

- Env loading uses Node's built-in `--env-file` (Node ≥ 20.6; developed on
  Node 25). No `dotenv` dependency. No `typescript` this phase.
- `migrate:test` reuses one `.env` and selects the test connection with
  node-pg-migrate's `-d TEST_DATABASE_URL`.

## Invariants honored

- No schema, no domain tables. Databases (`selves_dev`, `selves_test`) are
  provisioned empty.
- Running the migrator from zero creates node-pg-migrate's `pgmigrations`
  bookkeeping table — tooling metadata, not domain schema.
- No production credentials locally. Real `.env` is gitignored; only
  `.env.example` is tracked.
- Development and test databases are separate and isolated.

## Verification

Runtime acceptance closed in-session against a running Docker Desktop:
one-command bring-up, health check, `migrate` from zero, and `migrate:test`
against the isolated test database. Client build re-verified: `tsc --noEmit`
exit 0 and `vite build` success. (See the phase report for command output.)
