-- Up Migration
--
-- P8 J — Stage-1 C3 binding (decision 0008-C §3 / standing DEFINER-authority rule).
--
-- The R1 Stage-1 fact functions previously accepted a CALLER-SUPPLIED p_acting_self
-- and were selves_app-executable, making them arbitrary-Self relationship oracles
-- (and existence/authorship oracles) reachable without any authenticated context.
-- They are rebound to the trusted C3 context: the acting Self is obtained from
-- domain.current_acting_self(); the caller-selected authority argument is removed.
-- The resource id remains an argument (permitted by the standing rule).
--
-- FAIL CLOSED: with no trusted context (current_acting_self() IS NULL), the function
-- exposes NO fact — not existence, authorship, sender, state, recipient, or Key.
--
-- R1 INDEPENDENCE PRESERVED: the functions still execute as selves_owner and their
-- table reads remain RLS-exempt by ownership; only the identity PROVENANCE changes
-- from an unauthenticated argument to authenticated C3 context. AuthorizationService
-- still does not read its decision through the RLS mirror. Compatibility precondition
-- (established in step I): every legitimate caller runs inside the C3-bearing
-- withRepeatableRead transaction, so current_acting_self() is set before these run.
--
-- Runs as selves_migrate with current_user=selves_owner.

DROP FUNCTION domain.artifact_facts(uuid, uuid);
DROP FUNCTION domain.placement_facts(uuid, uuid);

-- ── domain.artifact_facts(p_artifact_id) ──────────────────────────────────────
CREATE FUNCTION domain.artifact_facts(p_artifact_id uuid)
RETURNS TABLE (
  present               boolean,
  author_self_id        uuid,
  any_settled_recipient boolean,
  any_recipient         boolean,
  has_active_for_target boolean,
  has_revoked_for_target boolean,
  has_active_elsewhere  boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self();
BEGIN
  IF v_self IS NULL THEN
    -- fail closed: reveal nothing without trusted context
    RETURN QUERY SELECT false, NULL::uuid, false, false, false, false, false;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT
      EXISTS (SELECT 1 FROM public.artifacts a WHERE a.id = p_artifact_id),
      (SELECT a.author_self_id FROM public.artifacts a WHERE a.id = p_artifact_id),
      COALESCE((
        SELECT bool_or(p.state = 'settled')
          FROM public.placements p
          JOIN public.placement_recipients pr ON pr.placement_id = p.id
         WHERE p.artifact_id = p_artifact_id AND pr.recipient_self_id = v_self), false),
      COALESCE((
        SELECT count(*) > 0
          FROM public.placements p
          JOIN public.placement_recipients pr ON pr.placement_id = p.id
         WHERE p.artifact_id = p_artifact_id AND pr.recipient_self_id = v_self), false),
      COALESCE((
        SELECT bool_or(k.revoked_at IS NULL AND k.protected_resource_id = p_artifact_id)
          FROM public.key_grants k WHERE k.grantee_self_id = v_self), false),
      COALESCE((
        SELECT bool_or(k.revoked_at IS NOT NULL AND k.protected_resource_id = p_artifact_id)
          FROM public.key_grants k WHERE k.grantee_self_id = v_self), false),
      COALESCE((
        SELECT bool_or(k.revoked_at IS NULL AND k.protected_resource_id <> p_artifact_id)
          FROM public.key_grants k WHERE k.grantee_self_id = v_self), false);
END $fn$;

-- ── domain.placement_facts(p_placement_id) ────────────────────────────────────
CREATE FUNCTION domain.placement_facts(p_placement_id uuid)
RETURNS TABLE (
  present        boolean,
  sender_self_id uuid,
  state          text,
  recipient_row  boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self();
BEGIN
  IF v_self IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, false;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT
      EXISTS (SELECT 1 FROM public.placements p WHERE p.id = p_placement_id),
      (SELECT p.sender_self_id FROM public.placements p WHERE p.id = p_placement_id),
      (SELECT p.state::text     FROM public.placements p WHERE p.id = p_placement_id),
      EXISTS (
        SELECT 1 FROM public.placement_recipients pr
         WHERE pr.placement_id = p_placement_id AND pr.recipient_self_id = v_self);
END $fn$;

REVOKE EXECUTE ON FUNCTION domain.artifact_facts(uuid), domain.placement_facts(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION domain.artifact_facts(uuid), domain.placement_facts(uuid) TO selves_app;

-- Down Migration
DROP FUNCTION domain.placement_facts(uuid);
DROP FUNCTION domain.artifact_facts(uuid);

CREATE FUNCTION domain.artifact_facts(p_acting_self uuid, p_artifact_id uuid)
RETURNS TABLE (
  present               boolean,
  author_self_id        uuid,
  any_settled_recipient boolean,
  any_recipient         boolean,
  has_active_for_target boolean,
  has_revoked_for_target boolean,
  has_active_elsewhere  boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT
    EXISTS (SELECT 1 FROM public.artifacts a WHERE a.id = p_artifact_id),
    (SELECT a.author_self_id FROM public.artifacts a WHERE a.id = p_artifact_id),
    COALESCE((SELECT bool_or(p.state = 'settled') FROM public.placements p JOIN public.placement_recipients pr ON pr.placement_id = p.id WHERE p.artifact_id = p_artifact_id AND pr.recipient_self_id = p_acting_self), false),
    COALESCE((SELECT count(*) > 0 FROM public.placements p JOIN public.placement_recipients pr ON pr.placement_id = p.id WHERE p.artifact_id = p_artifact_id AND pr.recipient_self_id = p_acting_self), false),
    COALESCE((SELECT bool_or(k.revoked_at IS NULL AND k.protected_resource_id = p_artifact_id) FROM public.key_grants k WHERE k.grantee_self_id = p_acting_self), false),
    COALESCE((SELECT bool_or(k.revoked_at IS NOT NULL AND k.protected_resource_id = p_artifact_id) FROM public.key_grants k WHERE k.grantee_self_id = p_acting_self), false),
    COALESCE((SELECT bool_or(k.revoked_at IS NULL AND k.protected_resource_id <> p_artifact_id) FROM public.key_grants k WHERE k.grantee_self_id = p_acting_self), false);
$fn$;

CREATE FUNCTION domain.placement_facts(p_acting_self uuid, p_placement_id uuid)
RETURNS TABLE (present boolean, sender_self_id uuid, state text, recipient_row boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT
    EXISTS (SELECT 1 FROM public.placements p WHERE p.id = p_placement_id),
    (SELECT p.sender_self_id FROM public.placements p WHERE p.id = p_placement_id),
    (SELECT p.state::text     FROM public.placements p WHERE p.id = p_placement_id),
    EXISTS (SELECT 1 FROM public.placement_recipients pr WHERE pr.placement_id = p_placement_id AND pr.recipient_self_id = p_acting_self);
$fn$;

REVOKE EXECUTE ON FUNCTION domain.artifact_facts(uuid, uuid), domain.placement_facts(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION domain.artifact_facts(uuid, uuid), domain.placement_facts(uuid, uuid) TO selves_app;
