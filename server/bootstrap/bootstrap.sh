#!/usr/bin/env bash
# P4-A — Selves managed-role bootstrap (superuser, convergent, idempotent).
#
# Runs the container's psql. Role passwords travel host-env -> `docker compose
# exec -e NAME` (value NOT on the command line) -> container env -> psql
# \getenv. They never appear in argv, shell history, or a tracked file; the
# server generates the SCRAM verifier. Local/test credentials are synthetic.
#
# Usage:  npm run bootstrap        (loads server/.env)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"     # server/bootstrap
SERVER_DIR="$(dirname "$HERE")"                           # server
ROOT_DIR="$(dirname "$SERVER_DIR")"                       # repo root
COMPOSE=(docker compose -f "$ROOT_DIR/docker-compose.yml")

# Load local env (exports role passwords + governed list). Gitignored, synthetic.
set -a; . "$SERVER_DIR/.env"; set +a

: "${SELVES_GOVERNED_DATABASES:?set SELVES_GOVERNED_DATABASES}"
for v in SELVES_MIGRATE_PASSWORD SELVES_APP_PASSWORD SELVES_WORKER_PASSWORD \
         SELVES_BOOTSTRAP_PASSWORD SELVES_OPERATOR_PASSWORD; do
  eval ": \"\${$v:?set $v}\""
done

# Maintenance database to run the cluster-global script against (always present).
CONTROL_DB="${BOOTSTRAP_CONTROL_DB:-postgres}"

# Only variable NAMES appear here — values are injected by docker from our env.
ENV_PASS=( -e SELVES_GOVERNED_DATABASES
           -e SELVES_MIGRATE_PASSWORD -e SELVES_APP_PASSWORD -e SELVES_WORKER_PASSWORD
           -e SELVES_BOOTSTRAP_PASSWORD -e SELVES_OPERATOR_PASSWORD )

echo "[bootstrap] roles + membership + config + db grants (control db: $CONTROL_DB)"
"${COMPOSE[@]}" exec "${ENV_PASS[@]}" -T postgres \
  psql -U selves -d "$CONTROL_DB" -v ON_ERROR_STOP=1 -f - < "$HERE/roles.sql"

# Per-database public-schema ownership (database-local; connect to each target).
IFS=',' read -r -a DBS <<< "$SELVES_GOVERNED_DATABASES"
for db in "${DBS[@]}"; do
  db="$(echo "$db" | xargs)"   # trim whitespace
  echo "[bootstrap] public-schema ownership on $db"
  "${COMPOSE[@]}" exec -T postgres \
    psql -U selves -d "$db" -v ON_ERROR_STOP=1 -f - < "$HERE/schema-owner.sql"
done

echo "[bootstrap] done"
