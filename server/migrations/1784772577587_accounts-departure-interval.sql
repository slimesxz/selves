-- Up Migration
--
-- P6-B — the account-level departure interval (decision 0006, ruling 3; charter
-- §5 as amended). This is a DESCRIPTIVE account setting, not a behavioral policy
-- (§6 Test 3) and not a new ontological object: the ontology stays Self → Signal
-- → Artifact → Placement → Graph. The user sets it; the server is authoritative
-- over its value; it is bounded to the closed list {5,10,30,60}s, default 30. It
-- is snapshotted onto each Placement at begin_departure (next migration) so a
-- later change never affects an in-progress departure.
--
-- Runs as selves_migrate with current_user=selves_owner (the accounts table's
-- owner), so the column is added by the owner. NO grant is created here: the
-- interval is read and written ONLY inside the domain.begin_departure and
-- domain.set_departure_interval DEFINER functions, which run as selves_owner (the
-- accounts owner). selves_app therefore needs — and receives — no direct
-- privilege on accounts; the ratified "nothing at all on accounts" matrix holds.

ALTER TABLE public.accounts
  ADD COLUMN departure_interval_seconds smallint NOT NULL DEFAULT 30
    CONSTRAINT accounts_departure_interval_bounded
      CHECK (departure_interval_seconds IN (5, 10, 30, 60));

-- Down Migration
ALTER TABLE public.accounts DROP COLUMN departure_interval_seconds;
