-- P4-A — per-database public-schema ownership. Run as SUPERUSER, connected to
-- the target governed database (the public schema is database-local). Makes
-- selves_owner the owner so migrations (as selves_migrate SET ROLE selves_owner)
-- can manage it, and removes the implicit CREATE grant from PUBLIC.
\set ON_ERROR_STOP on
ALTER SCHEMA public OWNER TO selves_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
