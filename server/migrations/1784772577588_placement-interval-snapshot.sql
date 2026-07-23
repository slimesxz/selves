-- Up Migration
--
-- P6-B — the per-Placement departure-interval SNAPSHOT (decision 0006, ruling 3).
-- The interval in force is copied onto the Placement at begin_departure and is
-- thereafter immutable, so a later change to the account setting cannot alter an
-- in-progress departure. The column is:
--   * NULL while draft (no departure has begun);
--   * written EXACTLY ONCE, only during the draft → departing transition;
--   * immutable under every subsequent mutation (settle, cancel, anything else).
--
-- Enforcement is by the guard trigger, exactly as the ruling directs ("extend the
-- freeze trigger if needed"). No coherence CHECK is added, so the column stays
-- nullable and the write-once rule is expressed as a transition constraint — this
-- also means existing rows and existing test fixtures (which advance state via
-- direct UPDATE without an interval) remain valid and unchanged.
--
-- In production, begin_departure is the ONLY path to 'departing' (no login role
-- holds direct DML), so every real departing/settled Placement carries a non-NULL
-- snapshot; settle_placement reads it to enforce the interval floor.

ALTER TABLE public.placements
  ADD COLUMN departure_interval_seconds smallint
    CONSTRAINT placements_departure_interval_bounded
      CHECK (departure_interval_seconds IS NULL OR departure_interval_seconds IN (5, 10, 30, 60));

-- ── Both placement triggers are made HERMETIC (SET search_path='' + fully
-- qualified names), matching the auth-trigger pattern. This is required because
-- the P6 domain.* DEFINER functions run with search_path='' and fire these
-- triggers; an unqualified type/table reference (e.g. `placement_state`,
-- `placements`) cannot resolve under an empty search_path. The trigger LOGIC is
-- unchanged; only qualification/hermeticity is added — plus the interval
-- write-once/immutability clause in the guard.

-- freeze_recipients_after_draft: identical logic, now hermetic and qualified.
CREATE OR REPLACE FUNCTION freeze_recipients_after_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  parent_state public.placement_state;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT state INTO parent_state FROM public.placements WHERE id = OLD.placement_id;
    -- NULL => parent removed by a draft cascade: allow.
    IF parent_state IS NOT NULL AND parent_state <> 'draft' THEN
      RAISE EXCEPTION
        'recipients are frozen once a placement leaves draft (placement %, state %)',
        OLD.placement_id, parent_state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  ELSE
    SELECT state INTO parent_state FROM public.placements WHERE id = NEW.placement_id;
    IF parent_state IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION
        'recipients are frozen once a placement leaves draft (placement %, state %)',
        NEW.placement_id, parent_state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

-- guard_placement_mutation: prior behavior preserved verbatim (delete only while
-- draft; terminal states immutable), now hermetic, PLUS the interval write-once/
-- immutability rule. A change to departure_interval_seconds is permitted solely
-- when it goes from NULL to a value as part of the draft → departing transition;
-- every other change is rejected.
CREATE OR REPLACE FUNCTION guard_placement_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION
        'placement % is not deletable once it has left draft (state %)',
        OLD.id, OLD.state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  ELSE
    IF OLD.state IN ('settled', 'cancelled') THEN
      RAISE EXCEPTION
        'placement % is terminal and immutable (state %)', OLD.id, OLD.state
        USING ERRCODE = 'check_violation';
    END IF;
    -- Interval snapshot: written once at departure, immutable thereafter.
    IF NEW.departure_interval_seconds IS DISTINCT FROM OLD.departure_interval_seconds THEN
      IF NOT (OLD.departure_interval_seconds IS NULL
              AND OLD.state = 'draft'
              AND NEW.state = 'departing') THEN
        RAISE EXCEPTION
          'departure_interval_seconds is snapshotted once at departure and is immutable thereafter (placement %)',
          OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

-- Down Migration
-- Restore the original Phase-3 trigger functions (non-hermetic, unqualified, no
-- interval clause), then drop the column.
CREATE OR REPLACE FUNCTION freeze_recipients_after_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_state placement_state;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT state INTO parent_state FROM placements WHERE id = OLD.placement_id;
    IF parent_state IS NOT NULL AND parent_state <> 'draft' THEN
      RAISE EXCEPTION
        'recipients are frozen once a placement leaves draft (placement %, state %)',
        OLD.placement_id, parent_state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  ELSE
    SELECT state INTO parent_state FROM placements WHERE id = NEW.placement_id;
    IF parent_state IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION
        'recipients are frozen once a placement leaves draft (placement %, state %)',
        NEW.placement_id, parent_state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION guard_placement_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION
        'placement % is not deletable once it has left draft (state %)',
        OLD.id, OLD.state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  ELSE
    IF OLD.state IN ('settled', 'cancelled') THEN
      RAISE EXCEPTION
        'placement % is terminal and immutable (state %)', OLD.id, OLD.state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

ALTER TABLE public.placements DROP COLUMN departure_interval_seconds;
