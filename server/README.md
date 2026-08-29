# Selves — server

Authoritative layer: database migrations now; API, authorization, and the
projection worker in later phases. One of three npm workspaces
(`client`, `domain`, `server`) sharing a single root lockfile — the conversion
foreseen by
[docs/decisions/0001-repo-boundary.md](../docs/decisions/0001-repo-boundary.md)
was performed in Playbook Phase 10. Dependencies install from the repository
root, not from this directory.

## Prerequisites

- **Docker Desktop** (for local PostgreSQL)
- **Node.js 24.18.0** — the ratified runtime pin
  ([docs/decisions/0004-auth-active-self.md](../docs/decisions/0004-auth-active-self.md)).
  Enforced by root `.nvmrc`, `engines: ">=24.18.0 <25"`, and
  `server/.npmrc` `engine-strict=true`. Node 25 is **rejected**; a newer major
  will refuse to install. Env loading uses Node's built-in `--env-file`, so no
  `dotenv` dependency exists.

## First-time setup

```bash
# 1. From the repo root, start PostgreSQL (one command):
docker compose up -d

# 2. From the repo root, install all workspaces (one root lockfile):
npm install

# 3. In this directory, configure env:
cd server
cp .env.example .env        # local-only values; edit only if you changed compose

# 4. Run migrations from zero (dev database):
npm run migrate

# 5. Run migrations against the isolated test database:
npm run migrate:test
```

`docker compose up -d` provisions two databases on first start: `selves_dev`
and `selves_test` (the test DB is created by `db/init`). No schema exists yet —
migrations create tables from Phase 3 onward.

## Commands

| Command | What it does |
|---|---|
| `npm run db:up` | Start PostgreSQL (wraps `docker compose up -d`) |
| `npm run db:down` | Stop PostgreSQL (keeps the data volume) |
| `npm run db:reset` | Destroy the data volume and recreate empty dev + test DBs |
| `npm run db:health` | Show container/health status |
| `npm run migrate` | Apply migrations to the dev database |
| `npm run migrate:down` | Roll back the last migration on the dev database |
| `npm run migrate:test` | Apply migrations to the isolated test database |

## Notes

- **No production credentials are used locally.** The compose credentials
  (`server` / `selves_local_dev`) are development-only and live in
  `docker-compose.yml` and `.env.example`. Your real `.env` is gitignored.
- Running the migrator against the empty `migrations/` directory creates
  node-pg-migrate's own `pgmigrations` bookkeeping table and reports
  "No migrations to run." That table is tooling metadata, not domain schema.
- Migration files use raw SQL (up/down), per
  [docs/decisions/0002-migration-foundation.md](../docs/decisions/0002-migration-foundation.md).
