# Selves — backup and recovery

- **Status:** Phase 13 artifact (P13-G), covering Playbook **T5** (database backup
  and restore documentation) and **T6** (migration rollback / forward-repair
  strategy).
- **Date:** 2026-08-30
- **Authority:** [AGENTS.md](../AGENTS.md) is binding constitutional law. The
  governing Phase 13 rulings are recorded in
  [decision 0015](./decisions/0015-phase-13-opening.md); this document is their
  operational form.
- **Companions:** [deployment-blockers.md](./deployment-blockers.md) ·
  [known-limitations.md](./known-limitations.md) ·
  [threat-model.md](./threat-model.md)
- **Executable counterpart:** `server/test/backup-and-recovery.test.ts` proves
  the procedures below against disposable databases. Every claim here that can be
  mechanically checked, is.

---

## The governing principle

> **Recovery must restore authority, not merely data. A recovered database is
> valid only when its data, ownership, privileges, RLS posture, DEFINER
> boundary, and migration ledger are restored together.**

This is not a stylistic preference. In this system, **ownership *is* authority**:
every table and function in `public`, `auth`, `domain`, and `proj` is owned by
`selves_owner`, and that ownership is what allows the `SECURITY DEFINER`
functions to run with owner rights and to read past row-level security (tables
use `ENABLE`, not `FORCE`, so the owner is exempt). A restore that brought back
every row but re-owned the objects would produce a database that looks complete
and has no working authorization substrate.

---

## 1. What is backed up, and why

The backup unit is a **database-level logical dump** of the authoritative
database, taken with `pg_dump`, **preserving ownership and ACL information**.

A dump of this estate carries, in one artifact:

| Content | Why it must be in the backup |
|---|---|
| Authoritative rows | accounts, selves, artifacts, placements, recipients, key grants, outbox events |
| Object ownership | `selves_owner` ownership is what makes the DEFINER boundary and the RLS exemption function |
| Grants and column privileges | including the deliberate **absence** of privilege — e.g. `selves_app` has no direct table read anywhere, and specific `key_grants` columns are withheld |
| Row-level security | policy definitions **and** the tables that are RLS-enabled with no policy at all (a deliberate fail-closed posture) |
| `SECURITY DEFINER` function bodies | the entire authoritative write and predicate surface |
| The `pgmigrations` ledger | so the restored database knows exactly which migrations it has |

There are no extensions beyond `plpgsql` to reinstall, and no binary/large-object
state: Phase 12 established the object-storage boundary but no production object
binding exists, so the database dump is the whole picture.

### The dump is sensitive

**The dump contains every authoritative record in the system.** It contains no
role passwords — see §2 — but that absence must never be mistaken for the dump
being non-secret. Treat a dump as you would the database itself.

```text
database dump    sensitive authoritative data — required
globals dump     authentication credential material — prohibited
```

---

## 2. Two prohibitions, and their reasons

### `pg_dumpall --globals-only` is prohibited

A globals dump contains `CREATE ROLE` statements carrying each role's
**SCRAM-SHA-256 verifier** — authentication credential material for all six
managed roles. Producing one turns a routine operational task into the creation
of a credential artifact that must then be protected, stored, and destroyed.

It is also **unnecessary**. Roles are cluster-global and therefore absent from a
database dump, and `server/bootstrap/bootstrap.sh` already recreates all six
convergently and idempotently from environment-supplied values. Recovery
recreates roles by bootstrapping them, never by restoring their secrets.

### `pg_dump --no-owner` is prohibited

`--no-owner` strips the `OWNER TO` statements. Restoring such a dump would leave
every object owned by whoever ran the restore. Because ownership carries the
DEFINER execution identity and the RLS exemption, the result would be a database
whose data is intact and whose authorization boundary is silently broken. This is
the single most dangerous available flag in this procedure.

---

## 3. Backup procedure

**Principal.** Backup runs as **`selves_migrate` assuming `selves_owner`** — the
migration credential in its already-ratified operational posture, configured
through the existing connection/environment convention (the migrate connection
string carries `options=-c role=selves_owner`). The cluster superuser is
deliberately **not** prescribed for routine backup: a database-scoped operation
should not normalize possession of cluster-superuser credentials.

Backup necessarily has authority to read all authoritative content. That is
inherent to backup, not a defect — and it is why §1's sensitivity note matters.

**Client version.** The client major must be at least the server major.
`pg_dump` refuses outright otherwise:

```text
pg_dump: error: aborting because of server version mismatch
pg_dump: detail: server version: 17.10; pg_dump version: 16.14
```

On a machine whose system PostgreSQL is older than the server, run the dump with
the **server container's own client**, the same way `bootstrap.sh` reaches the
database:

```bash
docker compose exec -T -e PGOPTIONS postgres \
  pg_dump -U selves_migrate -d selves_dev > /path/you/chose/selves-backup.sql
```

with `PGOPTIONS=-c role=selves_owner` exported in the invoking shell, so the
value travels by environment rather than on the command line. **Do not place a
literal credential in a command.** Use the existing environment and
connection-string posture.

### Handling the artifact

- Choose the destination deliberately; a dump is not scratch output.
- **Never commit a dump.** Do not place one inside the repository tree.
- **Never attach a dump as a CI artifact.** The CI workflow uploads nothing, and
  that must remain true.
- **Never write dump contents into application logs.** The Phase 13 observability
  floor forbids exporting authoritative content, and a dump is authoritative
  content in bulk.
- Storage location, encryption at rest, access control, and retention are
  **operator and deployment responsibilities**, appropriate to the environment.

**No repository-level retention or RPO/RTO promise is implied** — see §6.

---

## 4. Restore procedure

The order is not adjustable. Steps 1 and 3 are separated because the dump's
`OWNER TO` and `GRANT` statements name roles that must already exist.

```text
1. establish required cluster roles through bootstrap
2. create a fresh empty target database
3. restore the database dump with ownership/ACL/RLS metadata
4. apply only migrations newer than the restored pgmigrations ledger
5. run post-recovery verification
```

**Step 1 — roles.** Run the committed bootstrap. Roles are cluster-global and
convergent, so this is safe to repeat.

```bash
npm run bootstrap -w server
```

**Step 2 — target database.** Create it empty, and give it the same
per-database posture the bootstrap establishes for a governed database: the
database-level `REVOKE`/`GRANT` set, `public` owned by `selves_owner`, and the
`CREATE` grant removed from `PUBLIC`. Without the database-level `CREATE` grant
to `selves_owner`, the migration estate cannot run against it at all.

**Step 3 — restore.** Restore as a principal able to set ownership to
`selves_owner`. Use `ON_ERROR_STOP` so a partial restore fails loudly:

```bash
docker compose exec -T postgres \
  psql -U selves -d <target> -X -q -v ON_ERROR_STOP=1 -f /path/to/backup.sql
```

**Step 4 — migrations.** Apply only what is genuinely newer:

```bash
npm run migrate -w server
```

The restored `pgmigrations` ledger already records everything the dump captured.

> **Do not migrate from zero before restoring a dump.** That produces an empty
> schema, not a recovery.
>
> **Do not bootstrap application data as a substitute for restoring it.** The
> bootstrap creates roles, not accounts, Selves, or Artifacts.

**Step 5 — verification.** Mandatory. See §5.

> **A restore is not accepted merely because `psql` exited zero.**

---

## 5. Post-recovery verification

Compare the restored database against what the source is known to have had. Each
item is mechanically checkable, and each is asserted by
`server/test/backup-and-recovery.test.ts`:

| # | Check | Expected |
|---|---|---|
| 1 | Authoritative row counts | match the source |
| 2 | `pgmigrations` ledger | identical set of migration names |
| 3 | Table and function sets across `public`, `auth`, `domain`, `proj` | identical **names**, not merely counts |
| 4 | RLS policies | identical set of `schema.table.policy` names |
| 5 | RLS-enabled tables | identical set — including tables enabled with **no** policy |
| 6 | Object ownership | every object owned by `selves_owner`; the set of non-owner objects is **empty** |
| 7 | `selves_app` direct table privilege | **none**, in any schema |
| 8 | `key_grants` withheld columns | still unreadable by `selves_app` |
| 9 | Projection authority | `proj` USAGE + `proj.outbox_depth()` EXECUTE held by **`selves_worker` only** |

Checks 6–9 are the ones that make this a recovery of *authority*. A restore that
passes 1–5 and fails any of 6–9 has produced a populated database with a broken
security boundary, which is worse than an obvious failure.

---

## 6. What this document does not claim

- **No RPO.** There is no backup schedule, so there is no recovery-point
  objective to state.
- **No RTO.** There is no deployed database, no measured restore time on real
  data volumes, and no operator process to time.
- **No retention policy, no offsite copy, no managed backup provider.**
- **No deployment requirement.** Recording a procedure does not make backup
  posture a deployment gate; it is not one, and must not become one by inference.

Only local development and test databases exist today, and
[decision 0004](./decisions/0004-auth-active-self.md) records them as expressly
disposable. Its standing condition remains live and is the trigger for revisiting
this section:

> Before any environment holds non-disposable data, an upgrade-path acceptance
> criterion must be added to the then-current phase.

---

## 7. Migration failure and repair

### Pending migration fails before commit — nothing to repair

`node-pg-migrate` runs **all pending migrations in a single transaction**
(`single-transaction` defaults to `true`; the committed `migrate` scripts pass no
flag to change it), and PostgreSQL DDL is transactional. No migration in the
current estate opts out — there is no `no_transaction` directive and no
`CONCURRENTLY` index build anywhere in the 29 committed migrations.

**A failed migration run therefore leaves zero partial state**, and the ledger
does not advance. The remedy is to fix the migration and run it again. This is
proven, not assumed: the recovery test drives a deliberately invalid migration
against a disposable database and asserts that the preceding migration's table is
absent and that `pgmigrations` recorded neither file.

> **This guarantee is a property of the current estate, not of PostgreSQL
> migrations in general.** Any future migration that opts out of the wrapping
> transaction — a concurrent index build, for example — requires an explicit
> recovery review before it is accepted, because it can leave partial state that
> nothing rolls back.

### Migration commits and is later found defective — forward repair

**The ratified strategy is forward repair. Production `down` migrations are not
the remedy.**

- Preserve the committed migration as historical fact.
- Author a **new forward migration** that corrects it.
- Test from zero **and** from the affected state.
- Apply it.

`down` sections remain in the migration files and are useful for disposable
development work. **Their existence is not production rollback authority.**

### Why `down` is not the production remedy

Four classes of `down` migration in this estate are unsafe or lossy:

| Class | Example | Consequence |
|---|---|---|
| **Data-destroying** | the first migration's down drops `selves` and `accounts` | rolling back across a table-creating migration is data loss, not a revert |
| **Security-weakening** | the RLS-policy migration's down drops six policies and disables RLS on three tables | leaves the database **populated and unprotected** — worse than either endpoint |
| **Privilege-rewidening** | the `key_grants` revocation's down restores the prior column grant | silently reopens the capability register to `selves_app` |
| **Semantically lossy** | function-replacing downs restore an earlier body | an older body may not understand rows created under the newer shape |

The second and third are the decisive ones: **a `down` can leave the system in a
state that is neither the old one nor the new one, but strictly less safe than
both.**

---

## 8. Destructive operations

```bash
npm run db:reset -w server
```

**This is destructive.** It runs `docker compose down -v`, which removes the
`selves_pgdata` volume and therefore **every database stored in it** — dev and
test alike. There is no confirmation prompt and no automatic backup.

It is correct for its purpose: rebuilding a disposable local substrate from
zero. Take a dump first if the databases hold anything you intend to keep.

Related commands and what they do **not** do: `db:down` stops the container and
**keeps** the volume; `db:up` starts it. Only `db:reset` destroys data.
