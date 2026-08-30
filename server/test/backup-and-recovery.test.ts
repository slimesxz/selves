// P13-G — recovery evidence (decision 0015 Gate 1 C.9; P13-G rulings J.1–J.6,
// the backup/restore contracts, the equivalence floor, and the failed-migration
// atomicity requirement).
//
// The governing principle under proof:
//
//   Recovery must restore AUTHORITY, not merely data. A recovered database is
//   valid only when its data, ownership, privileges, RLS posture, DEFINER
//   boundary, and migration ledger are restored together.
//
// So these cases do not merely assert that rows came back. They assert that the
// restored database still denies what the source denied: selves_app holds no
// direct table privilege, the key_grants columns stay withheld, the projection
// schema stays confined to the worker principal, and every object is owned by
// selves_owner — because ownership is what makes the DEFINER boundary and the
// RLS exemption work at all.
//
// SOURCE-DATABASE WRITE POSTURE: selves_test is never written by this file, and
// no DDL touches it. Recovery needs authoritative fixture rows, and after the
// global setup selves_test holds none deterministically, so the ratified second
// option is taken: a disposable SOURCE database and a disposable RESTORE TARGET,
// both created and dropped here. A third disposable database isolates the
// failed-migration probe. selves_test is not read as a source either — it does
// not need to be.
//
// The dump never reaches host disk or any reporter: it is written inside the
// database container, counted there, restored there, and deleted there.
import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import pg from 'pg';
import { newAccount, newSelf, newTextArtifact } from './helpers/db-fixtures.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(here, '..');
const COMPOSE = resolve(SERVER_ROOT, '..', 'docker-compose.yml');

// A bounded, non-personal suffix so parallel or interrupted executions cannot
// collide on a scratch database name. Twelve hex characters keeps every
// identifier far inside PostgreSQL's 63-byte limit.
const SUFFIX = randomBytes(6).toString('hex');
const SRC_DB = `p13g_src_${SUFFIX}`;
const DST_DB = `p13g_dst_${SUFFIX}`;
const MIG_DB = `p13g_mig_${SUFFIX}`;
const DUMP_PATH = `/tmp/p13g_${SUFFIX}.sql`;

/** Run a command inside the database container. The container's own client is
 *  used deliberately: the host client is an older major and would refuse to dump
 *  this server. Nothing is echoed — output is returned, never logged. */
function inContainer(argv: string[], env: Record<string, string> = {}): string {
  const envFlags = Object.keys(env).flatMap((name) => ['-e', name]);
  return execFileSync(
    'docker',
    ['compose', '-f', COMPOSE, 'exec', '-T', ...envFlags, 'postgres', ...argv],
    { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 },
  );
}

/** Superuser SQL against a named database, over the container socket. */
const sql = (db: string, statement: string): string =>
  inContainer(['psql', '-U', 'selves', '-d', db, '-X', '-q', '-t', '-A', '-c', statement]);

const scalar = (db: string, statement: string): string => sql(db, statement).trim();

/** A host pool against a scratch database, reusing the committed superuser URL
 *  shape with only the database name substituted. */
function poolFor(db: string): pg.Pool {
  const base = process.env.TEST_DATABASE_URL!;
  return new pg.Pool({ connectionString: base.replace(/\/[^/?]+(\?|$)/, `/${db}$1`) });
}

/** The migrate connection string for a scratch database — the committed
 *  selves_migrate posture (role=selves_owner) with the database swapped. */
const migrateUrlFor = (db: string): string =>
  process.env.TEST_MIGRATE_DATABASE_URL!.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

/** Create a disposable database carrying the same per-database posture the
 *  bootstrap establishes for a governed database. Both halves are required and
 *  both are replicated from the committed bootstrap rather than invented:
 *
 *    roles.sql          database-level REVOKE/GRANT (selves_owner needs CREATE
 *                       ON DATABASE, or the migration estate cannot run)
 *    schema-owner.sql   public-schema ownership and the PUBLIC CREATE revoke
 *
 *  Nothing here touches a governed database; the bootstrap's own allowlist is
 *  untouched and this posture is applied only to the disposable target. */
function createScratch(db: string): void {
  sql('postgres', `CREATE DATABASE ${db}`);
  sql('postgres', `REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
  sql(
    'postgres',
    `GRANT CONNECT ON DATABASE ${db} TO selves_migrate, selves_app, selves_worker, selves_bootstrap, selves_operator`,
  );
  sql('postgres', `GRANT CONNECT, CREATE ON DATABASE ${db} TO selves_owner`);
  sql(db, 'ALTER SCHEMA public OWNER TO selves_owner');
  sql(db, 'REVOKE CREATE ON SCHEMA public FROM PUBLIC');
}

const dropScratch = (db: string): void => {
  try {
    sql('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  } catch {
    // Cleanup is best-effort per database so one failure cannot strand the rest.
  }
};

/** node-pg-migrate, resolved by module resolution rather than a physical path
 *  (the P10-H1 layout-independent mechanism). */
const migrateBin = (): string =>
  execFileSync(process.execPath, ['-e', "process.stdout.write(require.resolve('node-pg-migrate/bin/node-pg-migrate'))"], {
    encoding: 'utf8',
    cwd: SERVER_ROOT,
  });

interface Posture {
  tables: string;
  functions: string;
  policies: string;
  rlsTables: string;
  nonOwnerObjects: string;
  ledger: string;
  accounts: string;
  selves: string;
  artifacts: string;
}

/** The security-relevant shape of a database, read the same way from source and
 *  target so the comparison is structural rather than incidental. */
function posture(db: string): Posture {
  const q = (s: string): string => scalar(db, s);
  return {
    // Named sets, not bare counts, wherever the security property is set-valued.
    tables: q(
      `SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ',' ORDER BY n.nspname, c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='r' AND n.nspname IN ('public','auth','domain','proj')`,
    ),
    functions: q(
      `SELECT coalesce(string_agg(n.nspname||'.'||p.proname, ',' ORDER BY n.nspname, p.proname), '')
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','auth','domain','proj')`,
    ),
    policies: q(
      `SELECT coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname, ',' ORDER BY schemaname, tablename, policyname), '')
         FROM pg_policies`,
    ),
    rlsTables: q(
      `SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ',' ORDER BY n.nspname, c.relname), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relrowsecurity AND n.nspname IN ('public','auth','domain','proj')`,
    ),
    // Ownership is part of the security boundary: anything not owned by
    // selves_owner is a recovery defect, so the expected answer is the empty set.
    nonOwnerObjects: q(
      `SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ',' ORDER BY 1), '')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','auth','domain','proj')
          AND c.relkind IN ('r','v')
          AND pg_get_userbyid(c.relowner) <> 'selves_owner'`,
    ),
    ledger: q('SELECT coalesce(string_agg(name, $$,$$ ORDER BY name), $$$$) FROM pgmigrations'),
    accounts: q('SELECT count(*) FROM public.accounts'),
    selves: q('SELECT count(*) FROM public.selves'),
    artifacts: q('SELECT count(*) FROM public.artifacts'),
  };
}

let dumpText = '';
let sourcePosture: Posture;

beforeAll(() => {
  createScratch(SRC_DB);
  // Migrate the source from zero as the committed migrate principal.
  execFileSync(process.execPath, [migrateBin(), 'up', '-d', 'P13G_URL'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, P13G_URL: migrateUrlFor(SRC_DB) },
    stdio: 'pipe',
  });
}, 120_000);

afterAll(() => {
  // Unconditional: this runs whether the cases passed, failed, or threw during
  // setup, so a failing assertion cannot strand a scratch database.
  try {
    inContainer(['rm', '-f', DUMP_PATH]);
  } catch {
    /* the dump may never have been created */
  }
  for (const db of [SRC_DB, DST_DB, MIG_DB]) dropScratch(db);
}, 120_000);

describe('P13-G backup form and contents', () => {
  it('the ratified backup principal produces a dump carrying the whole security posture and no credential material', async () => {
    // Authoritative fixture rows, created in the DISPOSABLE source. selves_test
    // is never written.
    const src = poolFor(SRC_DB);
    try {
      const account = await newAccount(src);
      const self = await newSelf(src, account, 1, 'p13g-recovery');
      await newTextArtifact(src, self, 'p13g recovery fixture');
    } finally {
      await src.end();
    }
    sourcePosture = posture(SRC_DB);
    expect(sourcePosture.accounts).toBe('1');
    expect(sourcePosture.artifacts).toBe('1');

    // The ratified principal (J.2): selves_migrate assuming selves_owner, using
    // the container's own client because the host client is an older major.
    inContainer(
      ['sh', '-c', `pg_dump -U selves_migrate -d ${SRC_DB} > ${DUMP_PATH}`],
      { PGOPTIONS: '-c role=selves_owner' },
    );
    dumpText = inContainer(['cat', DUMP_PATH]);

    // Ownership and privileges travel with the dump — the reason --no-owner is
    // prohibited rather than merely discouraged.
    expect(dumpText).toContain('OWNER TO selves_owner');
    expect(dumpText.split('OWNER TO').length - 1).toBeGreaterThan(40);
    expect(dumpText.split('SECURITY DEFINER').length - 1).toBeGreaterThan(30);
    expect(dumpText.split('CREATE POLICY').length - 1).toBe(6);
    expect(dumpText.split('ENABLE ROW LEVEL SECURITY').length - 1).toBe(10);

    // A database dump carries no role and no credential material. This is what
    // makes the globals dump both unnecessary and prohibited.
    expect(dumpText).not.toContain('CREATE ROLE');
    expect(dumpText).not.toContain('SCRAM-SHA-256');
  }, 180_000);

  it('a globals dump WOULD carry role credential material, which is why it is prohibited', () => {
    // Counted, never printed. The prohibition rests on an observed fact rather
    // than on caution.
    const verifiers = Number(
      inContainer(['sh', '-c', 'pg_dumpall -U selves --globals-only | grep -c "SCRAM-SHA-256"']).trim(),
    );
    expect(verifiers).toBeGreaterThanOrEqual(6);
  }, 120_000);
});

describe('P13-G restore equivalence floor', () => {
  it('restoring into a fresh database reproduces data, ledger, schema surface, ownership and RLS posture', () => {
    createScratch(DST_DB);
    inContainer(['sh', '-c', `psql -U selves -d ${DST_DB} -X -q -v ON_ERROR_STOP=1 -f ${DUMP_PATH}`]);

    const restored = posture(DST_DB);

    // Authoritative data fidelity.
    expect(restored.accounts).toBe(sourcePosture.accounts);
    expect(restored.selves).toBe(sourcePosture.selves);
    expect(restored.artifacts).toBe(sourcePosture.artifacts);

    // Migration-ledger fidelity — so a restore is NOT followed by
    // migrate-from-zero, only by anything genuinely newer.
    expect(restored.ledger).toBe(sourcePosture.ledger);
    expect(restored.ledger.length).toBeGreaterThan(0);

    // Named structural sets, not counts.
    expect(restored.tables).toBe(sourcePosture.tables);
    expect(restored.functions).toBe(sourcePosture.functions);
    expect(restored.policies).toBe(sourcePosture.policies);
    expect(restored.rlsTables).toBe(sourcePosture.rlsTables);

    // Ownership is authority: the expected answer is the empty set.
    expect(restored.nonOwnerObjects).toBe('');
    expect(sourcePosture.nonOwnerObjects).toBe('');
  }, 180_000);

  it('the restored database still DENIES what the source denied', () => {
    const denies = (db: string): Record<string, string> => ({
      // selves_app holds no direct table privilege anywhere.
      appTables: scalar(
        db,
        `SELECT coalesce(string_agg(n.nspname||'.'||c.relname, ',' ORDER BY 1), '')
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='r' AND n.nspname IN ('public','auth','domain','proj')
            AND has_table_privilege('selves_app', c.oid, 'SELECT')`,
      ),
      // The withheld key_grants columns stay withheld.
      keyGrantCols: scalar(
        db,
        `SELECT coalesce(string_agg(a.attname, ',' ORDER BY a.attname), '')
           FROM pg_attribute a
          WHERE a.attrelid = 'public.key_grants'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('selves_app', a.attrelid, a.attnum, 'SELECT')`,
      ),
      // Projection authority stays confined to the ratified worker principal.
      projExec: scalar(
        db,
        `SELECT coalesce(string_agg(r.rolname, ',' ORDER BY r.rolname), '')
           FROM pg_roles r
          WHERE r.rolcanlogin AND NOT r.rolsuper
            AND has_schema_privilege(r.rolname, 'proj', 'USAGE')
            AND has_function_privilege(r.rolname, 'proj.outbox_depth()', 'EXECUTE')`,
      ),
    });

    const before = denies(SRC_DB);
    const after = denies(DST_DB);

    expect(after).toEqual(before);
    expect(after.appTables, 'selves_app gained direct table read through recovery').toBe('');
    expect(after.keyGrantCols, 'key_grants columns became readable through recovery').toBe('');
    expect(after.projExec, 'projection authority widened through recovery').toBe('selves_worker');
  }, 120_000);
});

describe('P13-G failed-migration atomicity', () => {
  it('a migration that fails mid-run leaves no change and does not advance the ledger', () => {
    createScratch(MIG_DB);
    // The failure fixture lives in a TEMPORARY directory outside the tracked
    // migration estate: no production migration file is added as a fixture.
    const dir = mkdtempSync(join(tmpdir(), 'p13g-mig-'));
    try {
      writeFileSync(
        join(dir, '1900000000001_p13g-marker.sql'),
        '-- Up Migration\nCREATE TABLE public.p13g_marker (id integer);\n\n-- Down Migration\nDROP TABLE public.p13g_marker;\n',
      );
      writeFileSync(
        join(dir, '1900000000002_p13g-fails.sql'),
        '-- Up Migration\nSELECT 1 FROM public.p13g_absent_relation;\n\n-- Down Migration\nSELECT 1;\n',
      );

      let failed = false;
      try {
        execFileSync(process.execPath, [migrateBin(), 'up', '-m', dir, '-d', 'P13G_URL'], {
          cwd: SERVER_ROOT,
          env: { ...process.env, P13G_URL: migrateUrlFor(MIG_DB) },
          stdio: 'pipe',
        });
      } catch {
        failed = true;
      }
      expect(failed, 'the invalid migration must fail the run').toBe(true);

      // The first migration's transactional change is absent: node-pg-migrate
      // wraps the whole pending set in one transaction (single-transaction
      // defaults to true and no committed migration opts out), and PostgreSQL
      // DDL is transactional, so a failed run leaves ZERO partial state.
      expect(scalar(MIG_DB, "SELECT to_regclass('public.p13g_marker') IS NULL")).toBe('t');

      // And the ledger did not advance for either file.
      const ledger = scalar(
        MIG_DB,
        `SELECT coalesce(string_agg(name, ',' ORDER BY name), '') FROM pgmigrations WHERE name LIKE '%p13g%'`,
      );
      expect(ledger).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('P13-G recovery hygiene', () => {
  it('no dump artifact is left behind, and no dump content reaches the repository', () => {
    // The dump exists only inside the container for the life of this file, and
    // afterAll removes it. Nothing was ever written to host disk.
    expect(dumpText.length).toBeGreaterThan(0);
    inContainer(['rm', '-f', DUMP_PATH]);
    const present = inContainer(['sh', '-c', `test -f ${DUMP_PATH} && echo yes || echo no`]).trim();
    expect(present).toBe('no');
  }, 120_000);
});
