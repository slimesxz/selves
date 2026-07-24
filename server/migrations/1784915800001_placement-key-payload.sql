-- Up Migration
--
-- P7-B — the placement Key-payload shape (decision 0007: R2, R3, R8, R15, R16).
-- A Key is a capability payload carried by an ordinary Placement (Q1 Alt A). It
-- is NEVER an Artifact: the artifacts CHECK exclusion of 'key' stands, and a Key
-- Placement carries no content artifact_id — it names a separate protected
-- resource. This migration adds only the schema shape; the Key-aware mutation
-- functions arrive in P7-C. Runs as selves_migrate with current_user=selves_owner.

-- 1. Payload discriminator. REUSE the frozen payload_type enum
--    (text/photo/poll/gift/key) — do NOT mint a narrowed text|key type (R16).
--    DEFAULT 'text' lets ADD COLUMN NOT NULL apply cleanly and keeps the existing
--    domain.create_placement_draft byte-identical (it sets no payload_type).
ALTER TABLE placements
  ADD COLUMN payload_type          payload_type NOT NULL DEFAULT 'text',
  ADD COLUMN protected_resource_id uuid REFERENCES artifacts (id);

-- 2. A Key Placement has no content Artifact, so artifact_id becomes nullable.
ALTER TABLE placements ALTER COLUMN artifact_id DROP NOT NULL;

-- 3. Slice subset (R16): Phase 7 implements 'text' and 'key' only. photo/poll/gift
--    remain declared in the enum but rejected here, exactly as artifacts_text_only
--    restricts artifacts. The frozen vocabulary is never truncated.
ALTER TABLE placements
  ADD CONSTRAINT placements_payload_implemented CHECK (payload_type IN ('text', 'key'));

-- 4. Mutually exclusive, payload-correct shapes (R2). Because a Key Placement has
--    artifact_id = NULL, it can NEVER satisfy the Phase-5 RECIPIENT_SETTLED
--    predicate for its protected Artifact (that predicate joins on artifact_id) —
--    R3 is thereby STRUCTURAL, not a behavioural patch. The Phase-5 predicate is
--    left byte-identical.
ALTER TABLE placements
  ADD CONSTRAINT placements_payload_shape CHECK (
    CASE payload_type
      WHEN 'text' THEN artifact_id IS NOT NULL AND protected_resource_id IS NULL
      WHEN 'key'  THEN artifact_id IS NULL     AND protected_resource_id IS NOT NULL
      ELSE false
    END
  );

-- 5. Query path (invariant 13): a Key Placement's protected resource.
CREATE INDEX placements_protected_resource_id_idx ON placements (protected_resource_id);

-- 6. payload_type / artifact_id / protected_resource_id are IMMUTABLE from draft
--    creation (R2). guard_placement_mutation already forbids terminal-state
--    UPDATEs and non-draft DELETEs; extend it ADDITIVELY to freeze the payload
--    shape on every UPDATE. Legitimate transitions (begin_departure / cancel /
--    settle) only ever change state + timestamps + the interval snapshot, so
--    NEW = OLD for these three columns and the guard passes.
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
    -- The payload shape is fixed at draft creation and never changes thereafter.
    IF NEW.payload_type <> OLD.payload_type
       OR NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
       OR NEW.protected_resource_id IS DISTINCT FROM OLD.protected_resource_id THEN
      RAISE EXCEPTION
        'placement % payload shape is immutable after draft creation', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.state IN ('settled', 'cancelled') THEN
      RAISE EXCEPTION
        'placement % is terminal and immutable (state %)', OLD.id, OLD.state
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

-- Down Migration

-- Restore the Phase-3 guard body (no payload-shape immutability block).
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

DROP INDEX placements_protected_resource_id_idx;
ALTER TABLE placements DROP CONSTRAINT placements_payload_shape;
ALTER TABLE placements DROP CONSTRAINT placements_payload_implemented;
ALTER TABLE placements ALTER COLUMN artifact_id SET NOT NULL;
ALTER TABLE placements DROP COLUMN protected_resource_id;
ALTER TABLE placements DROP COLUMN payload_type;
