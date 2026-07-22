-- Up Migration

-- Artifact — "what remains (the settled record)" (AGENTS.md §4). Content only.
-- Capability records (Key grants) live in a separate table (invariant 12), so
-- Artifact data and capabilities are never conflated.
--
-- payload_type carries the frozen enum, but this table restricts it two ways:
--   * artifacts_text_only: the vertical slice implements ONLY 'text'. photo /
--     poll / gift gain mechanics (and this CHECK relaxes) in later phases; no
--     mechanics are invented for them now.
--   * 'key' is structurally excluded — a Key is a capability, never an
--     Artifact row. The CHECK = 'text' enforces this a fortiori today.
CREATE TABLE artifacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_self_id uuid NOT NULL REFERENCES selves (id),
  payload_type   payload_type NOT NULL,
  text_body      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_text_only CHECK (payload_type = 'text'),
  CONSTRAINT artifacts_text_body_present CHECK (length(btrim(text_body)) > 0)
);

-- Query path: the Vault lists a Self's own protected Artifacts (invariant 13).
CREATE INDEX artifacts_author_self_id_idx ON artifacts (author_self_id);

-- Down Migration
DROP TABLE artifacts;
