-- Runs once, on first initialization of the Postgres data volume.
-- Provisions the isolated test database used by integration tests.
-- DATABASE CREATION ONLY. No tables, no schema — those belong to migrations.
CREATE DATABASE selves_test OWNER selves;
