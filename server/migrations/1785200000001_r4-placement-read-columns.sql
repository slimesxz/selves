-- Up Migration
--
-- P10-S1 — R4 read-shape column grant (decision 0012 §35; R4 as amended by
-- P10-M1). Widens selves_app's column-scoped SELECT on public.placements by
-- EXACTLY the three ruled fields:
--   * payload_type            — exposed on any placement the actor may read;
--   * protected_resource_id   — exposed on any placement the actor may read
--                               (the R8 revoke address, P10-M2);
--   * departure_interval_seconds — author-only at the READ PROJECTION.
--
-- The grant is plumbing, not the authorization boundary (P10-M1): author-only
-- exposure of departure_interval_seconds is enforced by the ground-conditional
-- projection in the domain repo — the recipient SELECT never names the column.
-- Row visibility remains governed by the Phase-8 RLS policies; no predicate,
-- policy, or row boundary changes here. Privilege-only migration.

GRANT SELECT (payload_type, protected_resource_id, departure_interval_seconds)
  ON public.placements TO selves_app;

-- Down Migration
-- Restore the exact prior grant surface by revoking only the three columns.

REVOKE SELECT (payload_type, protected_resource_id, departure_interval_seconds)
  ON public.placements FROM selves_app;
