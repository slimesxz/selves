-- Up Migration
--
-- P8 H — R3 cross-table policy helpers (decision 0008 R3 / 0009 §1, standing law).
--
-- No Phase-8 policy predicate may reference a second table inline. F1 proved that
-- an inline cross-table subquery in a policy is evaluated with the INVOKING role's
-- privileges and is additionally subject to the referenced table's RLS — so under
-- R5's revocation it would raise 42501 (or silently return zero rows) on the reads
-- it must authorize. Every cross-table policy fact therefore goes through an
-- owner-run SECURITY DEFINER STABLE boolean helper, RLS-exempt and privilege-exempt
-- by ownership.
--
-- R3 constraints, obeyed by every helper below:
--   1. No helper accepts a Self as an argument — each obtains the ratified acting
--      Self from the trusted context internally (domain.current_acting_self()). A
--      helper answerable about an arbitrary Self would be an oracle.
--   2. Boolean return only — never a row, set, id, count, or register entry.
--   3. selves_owner-owned, STABLE, SECURITY DEFINER, SET search_path='', fully
--      qualified.
--   4. EXECUTE to selves_app only; REVOKE ALL FROM PUBLIC.
--
-- If current_acting_self() is NULL (no established context), each EXISTS compares a
-- column against NULL and yields false → the helper denies (fail-closed).
--
-- These helpers back the step-I policies; single-table predicates (author =
-- current_acting_self(); a placement's own state) stay inline in the policy and are
-- NOT wrapped here. Runs as selves_migrate with current_user=selves_owner.

-- ── artifacts: settled-recipient ground ───────────────────────────────────────
-- The acting Self is an explicit recipient of a SETTLED placement carrying this
-- Artifact. A Key Placement (artifact_id NULL) can never match — R3 structural.
CREATE FUNCTION domain.artifact_has_settled_recipient(p_artifact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.placements p
      JOIN public.placement_recipients pr ON pr.placement_id = p.id
     WHERE p.artifact_id = p_artifact
       AND p.state = 'settled'
       AND pr.recipient_self_id = domain.current_acting_self()
  );
$fn$;

-- ── artifacts: valid-Key ground ───────────────────────────────────────────────
-- The acting Self holds an active (unrevoked) Key to exactly this Artifact. Reads
-- the capability register as owner, so it works though selves_app has no key_grants
-- access at all (R5). The sole revocable read path (KEY_VALID); revocation removes
-- future authorization prospectively.
CREATE FUNCTION domain.artifact_has_active_key(p_artifact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.key_grants k
     WHERE k.protected_resource_id = p_artifact
       AND k.grantee_self_id = domain.current_acting_self()
       AND k.revoked_at IS NULL
  );
$fn$;

-- ── placements: explicit-recipient ground ─────────────────────────────────────
-- The acting Self is an explicit recipient of this Placement. The settled-state
-- requirement stays inline in the placement policy (the placement's own column).
CREATE FUNCTION domain.placement_has_recipient(p_placement uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.placement_recipients pr
     WHERE pr.placement_id = p_placement
       AND pr.recipient_self_id = domain.current_acting_self()
  );
$fn$;

-- ── placement_recipients: author gate ─────────────────────────────────────────
-- The acting Self authored the parent Placement (author-only recipient list;
-- co-recipient non-disclosure, F5).
CREATE FUNCTION domain.placement_authored_by_acting(p_placement uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.placements p
     WHERE p.id = p_placement
       AND p.sender_self_id = domain.current_acting_self()
  );
$fn$;

REVOKE EXECUTE ON FUNCTION
  domain.artifact_has_settled_recipient(uuid),
  domain.artifact_has_active_key(uuid),
  domain.placement_has_recipient(uuid),
  domain.placement_authored_by_acting(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  domain.artifact_has_settled_recipient(uuid),
  domain.artifact_has_active_key(uuid),
  domain.placement_has_recipient(uuid),
  domain.placement_authored_by_acting(uuid)
TO selves_app;

-- Down Migration
DROP FUNCTION domain.placement_authored_by_acting(uuid);
DROP FUNCTION domain.placement_has_recipient(uuid);
DROP FUNCTION domain.artifact_has_active_key(uuid);
DROP FUNCTION domain.artifact_has_settled_recipient(uuid);
