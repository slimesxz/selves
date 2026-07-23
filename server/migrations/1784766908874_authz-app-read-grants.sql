-- Up Migration
--
-- P5-B — the EXACT column-scoped read privileges selves_app needs for the
-- Phase-5 authorization predicates and protected reads (decision record 0005).
-- Privilege-only: no schema object is created, altered, or dropped. Runs as
-- selves_migrate with current_user=selves_owner (the tables' owner), so the
-- grants are made by their owner.
--
-- Every granted column is consumed by an approved predicate-input read (Stage 1)
-- or protected read (Stage 3):
--   * artifacts / placements: all columns — predicate inputs plus the protected
--     read that legitimately returns the record to an authorized caller.
--   * placement_recipients: all columns — the author-only recipient list, plus
--     the recipient-row presence check.
--   * key_grants: a STRICT SUBSET — predicate input ONLY (a Key is never
--     returned as a domain surface in Phase 5). id, grantor_self_id, and
--     granted_at are deliberately WITHHELD (invariant 16 minimization); a probe
--     as selves_app for any withheld column must fail with 42501.
--
-- USAGE ON SCHEMA public was already granted to selves_app in the auth migration;
-- it is not restated here.

GRANT SELECT (id, author_self_id, payload_type, text_body, created_at)
  ON public.artifacts TO selves_app;

GRANT SELECT (id, sender_self_id, artifact_id, state, created_at, departing_at, settled_at, cancelled_at)
  ON public.placements TO selves_app;

GRANT SELECT (placement_id, recipient_self_id, added_at)
  ON public.placement_recipients TO selves_app;

GRANT SELECT (grantee_self_id, protected_resource_id, revoked_at)
  ON public.key_grants TO selves_app;

-- Down Migration
REVOKE SELECT (grantee_self_id, protected_resource_id, revoked_at)
  ON public.key_grants FROM selves_app;

REVOKE SELECT (placement_id, recipient_self_id, added_at)
  ON public.placement_recipients FROM selves_app;

REVOKE SELECT (id, sender_self_id, artifact_id, state, created_at, departing_at, settled_at, cancelled_at)
  ON public.placements FROM selves_app;

REVOKE SELECT (id, author_self_id, payload_type, text_body, created_at)
  ON public.artifacts FROM selves_app;
