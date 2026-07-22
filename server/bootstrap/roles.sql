-- P4-A — Selves managed-role convergence. Run as SUPERUSER (bootstrap principal).
--
-- Idempotent + convergent: on every run, every security-relevant attribute,
-- the membership graph, and all role-level config are normalized to the exact
-- approved state. Passwords arrive via psql \getenv (container env), never argv,
-- history, or tracked files; the SERVER generates the SCRAM verifier
-- (password_encryption=scram-sha-256). Selves code implements no SCRAM.
--
-- The six managed roles and the sole permitted membership edge:
--   selves_owner (NOLOGIN object owner) <- selves_migrate  (INHERIT FALSE, SET TRUE, ADMIN FALSE)
--   selves_app / selves_worker / selves_bootstrap / selves_operator : no privileged membership.

\set ON_ERROR_STOP on
\getenv governed SELVES_GOVERNED_DATABASES
\getenv mig_pw   SELVES_MIGRATE_PASSWORD
\getenv app_pw   SELVES_APP_PASSWORD
\getenv wrk_pw   SELVES_WORKER_PASSWORD
\getenv bst_pw   SELVES_BOOTSTRAP_PASSWORD
\getenv opr_pw   SELVES_OPERATOR_PASSWORD

-- psql does NOT interpolate :'var' inside dollar-quoted (DO $$ ... $$) bodies, so
-- stash the governed list in a session GUC the DO blocks can read via current_setting.
SELECT set_config('selves.governed', :'governed', false);

-- 0. Resolve + validate the EXACT governed allowlist BEFORE any mutation.
--    Fails closed on empty, duplicate, missing, or template targets.
DO $$
DECLARE names text[]; d text; raw text := current_setting('selves.governed');
BEGIN
  IF btrim(raw) = '' THEN
    RAISE EXCEPTION 'SELVES_GOVERNED_DATABASES is empty';
  END IF;
  SELECT array_agg(btrim(x)) INTO names FROM unnest(string_to_array(raw, ',')) AS x;
  IF EXISTS (SELECT 1 FROM unnest(names) AS x WHERE x = '') THEN
    RAISE EXCEPTION 'governed list contains an empty name: %', raw;
  END IF;
  IF (SELECT count(*) FROM unnest(names)) <> (SELECT count(DISTINCT x) FROM unnest(names) AS x) THEN
    RAISE EXCEPTION 'governed list contains duplicates: %', raw;
  END IF;
  FOREACH d IN ARRAY names LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = d AND NOT datistemplate) THEN
      RAISE EXCEPTION 'governed database "%" does not exist or is a template', d;
    END IF;
    RAISE NOTICE 'governed target: %', d;
  END LOOP;
END $$;

-- 1. Ensure the six managed roles exist (attributes normalized in step 2).
DO $$
DECLARE roles text[] := ARRAY['selves_owner','selves_migrate','selves_app',
                              'selves_worker','selves_bootstrap','selves_operator'];
        r text;
BEGIN
  FOREACH r IN ARRAY roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I', r);
    END IF;
  END LOOP;
END $$;

-- 2. Normalize EVERY security-relevant attribute (convergent). selves_owner is a
--    NOLOGIN object owner with no usable password and CONNECTION LIMIT 0.
ALTER ROLE selves_owner     NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 0  VALID UNTIL 'infinity' PASSWORD NULL;
ALTER ROLE selves_migrate   LOGIN   NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE selves_app       LOGIN   NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE selves_worker    LOGIN   NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE selves_bootstrap LOGIN   NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT -1 VALID UNTIL 'infinity';
ALTER ROLE selves_operator  LOGIN   NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT -1 VALID UNTIL 'infinity';

-- 3. Login-role passwords — SERVER-side SCRAM verifier (no SCRAM in app code).
SET password_encryption = 'scram-sha-256';
ALTER ROLE selves_migrate   PASSWORD :'mig_pw';
ALTER ROLE selves_app       PASSWORD :'app_pw';
ALTER ROLE selves_worker    PASSWORD :'wrk_pw';
ALTER ROLE selves_bootstrap PASSWORD :'bst_pw';
ALTER ROLE selves_operator  PASSWORD :'opr_pw';

-- 4. Grantor-aware membership convergence: remove EVERY membership row touching a
--    managed role (as roleid OR member, under ANY grantor, CASCADE for dependents),
--    then re-assert the single approved edge with exact options.
DO $$
DECLARE managed text[] := ARRAY['selves_owner','selves_migrate','selves_app',
                               'selves_worker','selves_bootstrap','selves_operator'];
        m record;
BEGIN
  FOR m IN
    SELECT gr.rolname AS grp, mr.rolname AS mem, gt.rolname AS grantor
    FROM pg_auth_members am
    JOIN pg_roles gr ON gr.oid = am.roleid
    JOIN pg_roles mr ON mr.oid = am.member
    JOIN pg_roles gt ON gt.oid = am.grantor
    WHERE gr.rolname = ANY(managed) OR mr.rolname = ANY(managed)
  LOOP
    EXECUTE format('REVOKE %I FROM %I GRANTED BY %I CASCADE', m.grp, m.mem, m.grantor);
  END LOOP;
  -- grantor becomes current_user (the bootstrap superuser) = the permitted grantor.
  EXECUTE 'GRANT selves_owner TO selves_migrate WITH INHERIT FALSE, SET TRUE';
END $$;

-- 5. Clear role-level config in BOTH scopes: global and per-governed-database.
DO $$
DECLARE roles text[] := ARRAY['selves_owner','selves_migrate','selves_app',
                             'selves_worker','selves_bootstrap','selves_operator'];
        names text[]; r text; d text;
BEGIN
  SELECT array_agg(btrim(x)) INTO names FROM unnest(string_to_array(current_setting('selves.governed'), ',')) AS x;
  FOREACH r IN ARRAY roles LOOP
    EXECUTE format('ALTER ROLE %I RESET ALL', r);                         -- global scope
    FOREACH d IN ARRAY names LOOP
      EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', r, d);     -- per-db scope
    END LOOP;
  END LOOP;
END $$;

-- 6. Database-level privileges for each EXACT governed database (named).
DO $$
DECLARE names text[]; d text;
BEGIN
  SELECT array_agg(btrim(x)) INTO names FROM unnest(string_to_array(current_setting('selves.governed'), ',')) AS x;
  FOREACH d IN ARRAY names LOOP
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', d);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO selves_migrate, selves_app, selves_worker, selves_bootstrap, selves_operator', d);
    EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO selves_owner', d);
  END LOOP;
END $$;
