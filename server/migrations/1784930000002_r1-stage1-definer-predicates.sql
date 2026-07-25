-- Up Migration
--
-- P8 R1 (decision records 0008 R1 / 0009) — Stage-1 predicate reads move behind
-- SECURITY DEFINER.
--
-- The decider must not read through the mirror (0008 R1): RLS is an enforcement
-- mirror of the AuthorizationService, so the Stage-1 facts that FEED the decision
-- must not themselves be RLS-filtered, or the mirror becomes an input to the thing
-- it reflects. These two functions compute the exact Stage-1 fact set as
-- selves_owner, RLS-exempt by ownership, so the taxonomy survives intact once RLS
-- is later enabled on the ontology tables (R2: zero reason-exactness assertions
-- change). They also let the key_grants grantee-fact read leave selves_app, which
-- is the precondition R5 revokes on.
--
-- The fact set is byte-for-byte the set previously computed in
-- src/authz/predicates.repo.ts (whose Phase-7 byte-identity R1 releases):
--   artifact_facts  → present, author_self_id, any_settled_recipient, any_recipient,
--                     has_active_for_target, has_revoked_for_target, has_active_elsewhere
--   placement_facts → present, sender_self_id, state, recipient_row
--
-- Each is actor- and resource-scoped (bound parameters, equality only — F3); no
-- cross-Self or cross-recipient superset is loaded. Owner-owned, SECURITY DEFINER,
-- SET search_path='', fully qualified; EXECUTE revoked from PUBLIC and granted only
-- to selves_app (domain-mutations pattern). They run inside the caller's
-- REPEATABLE READ transaction: DEFINER changes the execution role, not the snapshot,
-- so Stage-1 and the Stage-3 protected read still observe one snapshot (0005).
--
-- Runs as selves_migrate with current_user=selves_owner, so both functions are
-- owned by selves_owner.

-- ── domain.artifact_facts ─────────────────────────────────────────────────────
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
    -- (a) existence + authorship
    EXISTS (SELECT 1 FROM public.artifacts a WHERE a.id = p_artifact_id),
    (SELECT a.author_self_id FROM public.artifacts a WHERE a.id = p_artifact_id),
    -- (b) recipient ground, state-resolved, across every placement carrying it.
    --     bool_or over zero rows is NULL → COALESCE to false (repo's `=== true`).
    COALESCE((
      SELECT bool_or(p.state = 'settled')
        FROM public.placements p
        JOIN public.placement_recipients pr ON pr.placement_id = p.id
       WHERE p.artifact_id = p_artifact_id AND pr.recipient_self_id = p_acting_self
    ), false),
    COALESCE((
      SELECT count(*) > 0
        FROM public.placements p
        JOIN public.placement_recipients pr ON pr.placement_id = p.id
       WHERE p.artifact_id = p_artifact_id AND pr.recipient_self_id = p_acting_self
    ), false),
    -- (c) Key ground — actor-scoped only, so a Key to a DIFFERENT resource is seen
    --     (has_active_elsewhere) and classified KEY_WRONG_RESOURCE, not ignored.
    COALESCE((
      SELECT bool_or(k.revoked_at IS NULL AND k.protected_resource_id = p_artifact_id)
        FROM public.key_grants k WHERE k.grantee_self_id = p_acting_self
    ), false),
    COALESCE((
      SELECT bool_or(k.revoked_at IS NOT NULL AND k.protected_resource_id = p_artifact_id)
        FROM public.key_grants k WHERE k.grantee_self_id = p_acting_self
    ), false),
    COALESCE((
      SELECT bool_or(k.revoked_at IS NULL AND k.protected_resource_id <> p_artifact_id)
        FROM public.key_grants k WHERE k.grantee_self_id = p_acting_self
    ), false);
$fn$;

-- ── domain.placement_facts ────────────────────────────────────────────────────
CREATE FUNCTION domain.placement_facts(p_acting_self uuid, p_placement_id uuid)
RETURNS TABLE (
  present        boolean,
  sender_self_id uuid,
  state          text,
  recipient_row  boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT
    EXISTS (SELECT 1 FROM public.placements p WHERE p.id = p_placement_id),
    (SELECT p.sender_self_id FROM public.placements p WHERE p.id = p_placement_id),
    (SELECT p.state::text     FROM public.placements p WHERE p.id = p_placement_id),
    EXISTS (
      SELECT 1 FROM public.placement_recipients pr
       WHERE pr.placement_id = p_placement_id AND pr.recipient_self_id = p_acting_self
    );
$fn$;

REVOKE EXECUTE ON FUNCTION
  domain.artifact_facts(uuid, uuid),
  domain.placement_facts(uuid, uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  domain.artifact_facts(uuid, uuid),
  domain.placement_facts(uuid, uuid)
TO selves_app;

-- Down Migration
DROP FUNCTION domain.placement_facts(uuid, uuid);
DROP FUNCTION domain.artifact_facts(uuid, uuid);
