-- Up Migration
--
-- P8 R5 (decision records 0008 R5 / 0009) — remove direct application read of the
-- capability register entirely.
--
-- Once R1 moved the Stage-1 grantee-fact computation into the owner-run
-- domain.artifact_facts function, selves_app has no remaining legitimate reason to
-- read public.key_grants directly (verified: the only src reference is a comment;
-- every mutation flows through DEFINER functions owned by selves_owner). The
-- capability register therefore becomes invisible to the application role: not
-- merely non-listable, but absent from direct application visibility.
--
--   1. REVOKE the entire Phase-5 column grant (grantee_self_id, protected_resource_id,
--      revoked_at) — after this selves_app holds nothing on key_grants.
--   2. ENABLE ROW LEVEL SECURITY with NO application policy — defense in depth, so a
--      future accidental grant still fails closed (zero rows) rather than leaking.
--
-- The owner-run readers are unaffected: domain.artifact_facts (Stage-1 KEY facts)
-- and the Key mutations run as selves_owner, which bypasses this (unforced) RLS and
-- needs no table grant. This is a pure narrowing (Phase 8 only narrows).
--
-- Runs as selves_migrate with current_user=selves_owner.

REVOKE SELECT (grantee_self_id, protected_resource_id, revoked_at)
  ON public.key_grants FROM selves_app;

ALTER TABLE public.key_grants ENABLE ROW LEVEL SECURITY;
-- No application SELECT policy is created: the register is invisible to selves_app.

-- Down Migration
ALTER TABLE public.key_grants DISABLE ROW LEVEL SECURITY;

GRANT SELECT (grantee_self_id, protected_resource_id, revoked_at)
  ON public.key_grants TO selves_app;
