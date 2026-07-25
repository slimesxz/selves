-- Up Migration
--
-- P9-B — the proj schema and the graph_edges projection (decision 0011 Q4–Q7,
-- Q9, C1).
--
-- proj is a NEW selves_owner-owned schema for projection tables and worker
-- functions (Q9): auth stays fixed at its ruled DEFINER inventory, domain stays
-- purely the ontology-mutation surface.
--
-- graph_edges is the author-side Graph mirror (Q4): one row per
-- (sender, recipient) pair derived exclusively from SETTLED, positively
-- enumerated (non-Key) Placements. EXISTENCE ONLY (Q5): no counts, no
-- first/last timestamps, no recency, no column reserved for any of them —
-- counts feed the quarantined ring-threshold math and recency is the raw
-- material of Presence. NO provenance (Q7): no contributing placement ids;
-- rebuild from authoritative records makes provenance redundant.
--
-- C1 — NO foreign keys from projection to authoritative tables: the columns are
-- plain uuid NOT NULL. A FK would let projection rows constrain authoritative
-- mutation (inverting "authoritative tables decide; projections reflect") and
-- would make a table that must be destroyable and rebuildable at will into one
-- other tables must respect. Referential integrity is supplied by derivation —
-- both write paths (worker apply, rebuild) join against authoritative rows, so
-- an orphan edge is unconstructible.
--
-- No sender <> recipient CHECK: self-addressed Placements are a ratified
-- positive case (0006 ruling 6), so a reflexive edge is legitimate.
--
-- Posture (Q6): RLS enabled with NO policy, zero grants — in Phase 9 no login
-- role reads this table at all. The ratified read semantics (visible only to
-- the account owning the Self it describes, only through that Self's own acting
-- context, never cross-sibling) arrive with Phase 10's read surface.
--
-- selves_worker gains USAGE on proj only — it still holds ZERO table privileges;
-- its sole reach is EXECUTE on the P9-D functions. Runs as selves_migrate with
-- current_user=selves_owner.

CREATE SCHEMA proj;

CREATE TABLE proj.graph_edges (
  sender_self_id    uuid NOT NULL,
  recipient_self_id uuid NOT NULL,
  PRIMARY KEY (sender_self_id, recipient_self_id)
);

ALTER TABLE proj.graph_edges ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA proj TO selves_worker;

-- Down Migration
REVOKE USAGE ON SCHEMA proj FROM selves_worker;
DROP SCHEMA proj CASCADE;
