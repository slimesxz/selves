-- Up Migration

-- Placement — "who receives it (ground truth); the atomic action" (AGENTS.md
-- §4). Exactly one sender Self (invariant 3: single NOT NULL column). The
-- lifecycle is the ratified state machine (AGENTS.md §5, ruling D1 Option A):
--   draft -> departing -> settled
--                      \-> cancelled   (terminal, reached only from departing)
--
-- Timestamp columns witness each transition and are held coherent with `state`
-- by a declarative CHECK. Phase 3 owns terminal immutability and the
-- state/timestamp coherence; forward-transition orchestration and cancel-vs-
-- settle locking are Phase 6.
CREATE TABLE placements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_self_id uuid NOT NULL REFERENCES selves (id),
  artifact_id    uuid NOT NULL REFERENCES artifacts (id),
  state          placement_state NOT NULL DEFAULT 'draft',
  created_at     timestamptz NOT NULL DEFAULT now(),
  departing_at   timestamptz,
  settled_at     timestamptz,
  cancelled_at   timestamptz,
  -- Each state pins exactly which transition timestamps are / are not set.
  -- cancelled requires departing_at (it is reachable only from departing) and
  -- forbids settled_at (settle and cancel are mutually exclusive outcomes).
  CONSTRAINT placements_state_timestamps CHECK (
    CASE state
      WHEN 'draft'     THEN departing_at IS NULL AND settled_at IS NULL AND cancelled_at IS NULL
      WHEN 'departing' THEN departing_at IS NOT NULL AND settled_at IS NULL AND cancelled_at IS NULL
      WHEN 'settled'   THEN departing_at IS NOT NULL AND settled_at IS NOT NULL AND cancelled_at IS NULL
      WHEN 'cancelled' THEN departing_at IS NOT NULL AND settled_at IS NULL AND cancelled_at IS NOT NULL
    END
  ),
  CONSTRAINT placements_time_order CHECK (
    (departing_at IS NULL OR departing_at >= created_at)
    AND (settled_at IS NULL OR settled_at >= departing_at)
    AND (cancelled_at IS NULL OR cancelled_at >= departing_at)
  )
);

-- Query paths (invariant 13): a sender retrieves its own Placements; join to
-- the placed Artifact.
CREATE INDEX placements_sender_self_id_idx ON placements (sender_self_id);
CREATE INDEX placements_artifact_id_idx ON placements (artifact_id);

-- Recipients are EXPLICIT rows, never a Ring or a Zone (invariant 4). No ring
-- or zone column exists anywhere in the schema. Composite PK: a Self appears
-- at most once per Placement.
CREATE TABLE placement_recipients (
  placement_id      uuid NOT NULL REFERENCES placements (id) ON DELETE CASCADE,
  recipient_self_id uuid NOT NULL REFERENCES selves (id),
  added_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (placement_id, recipient_self_id)
);

-- Query path (invariant 13): retrieve Placements addressed to a recipient Self.
CREATE INDEX placement_recipients_recipient_self_id_idx
  ON placement_recipients (recipient_self_id);

-- ── Invariant 6: settled/departing recipient history is not silently rewritten.
-- Ruling D1 amendment: the recipient set is frozen from DEPARTING onward, not
-- only at settled. After Send, the only permitted act is full cancellation;
-- recipients may be added/removed ONLY while the Placement is in draft.
--
-- Declarative CHECK constraints cannot see the parent's state or compare OLD to
-- NEW, so this cross-row invariant is enforced by a trigger. A trigger is an
-- enforcement mechanism that raises, not a comment.
--
-- A draft Placement deleted with ON DELETE CASCADE removes its recipient rows;
-- during that cascade the parent is gone (state lookup returns NULL) and the
-- delete is allowed. Non-draft parents are not deletable (see the placement
-- guard below), so a cascade can never originate from a frozen Placement.
CREATE FUNCTION freeze_recipients_after_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_state placement_state;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT state INTO parent_state FROM placements WHERE id = OLD.placement_id;
    -- NULL => parent removed by a draft cascade: allow.
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

CREATE TRIGGER trg_freeze_recipients
  BEFORE INSERT OR UPDATE OR DELETE ON placement_recipients
  FOR EACH ROW EXECUTE FUNCTION freeze_recipients_after_draft();

-- ── Invariant 5: settled Placement history is not silently rewritten.
--   * UPDATE of a settled or cancelled Placement is rejected — terminal states
--     are immutable ("cannot be recalled", AGENTS.md §5). Phase 6 settlement is
--     idempotent by conditioning its UPDATE on state='departing', so it never
--     needs to touch an already-settled row.
--   * DELETE is permitted ONLY while draft; a Placement that has left draft is
--     an auditable historical fact and cannot be deleted (this also guarantees
--     the recipient cascade above only ever fires for draft parents).
CREATE FUNCTION guard_placement_mutation() RETURNS trigger
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

CREATE TRIGGER trg_guard_placement_mutation
  BEFORE UPDATE OR DELETE ON placements
  FOR EACH ROW EXECUTE FUNCTION guard_placement_mutation();

-- Down Migration
DROP TRIGGER trg_guard_placement_mutation ON placements;
DROP FUNCTION guard_placement_mutation();
DROP TRIGGER trg_freeze_recipients ON placement_recipients;
DROP FUNCTION freeze_recipients_after_draft();
DROP TABLE placement_recipients;
DROP TABLE placements;
