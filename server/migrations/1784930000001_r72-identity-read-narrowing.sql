-- Up Migration
--
-- P8 R7.2 (decision records 0008 R7 / 0009) — identity-read narrowing.
--
-- Unrestricted `account_id → Self` readability on public.selves is the sibling
-- map: a single unfiltered column that links a person's Selves to one another
-- (0008 R7). R7.2 is the immediate, R4-independent narrowing that removes that
-- surface from the application role NOW, ahead of the Phase 8-B policy posture.
--
-- The two account-scoped identity reads the app performs — selfOwnedByAccount
-- (the per-request ownership check) and listSelves (the ratified Self switcher) —
-- move behind owner-run SECURITY DEFINER functions taking the VERIFIED ACCOUNT as
-- a parameter (the same req.account authentication context the auth subsystem
-- uses; never an acting Self, never a client claim). Both run as selves_owner,
-- so they read public.selves as its owner and require no selves_app table grant.
--
-- After this migration NO direct selves read survives for selves_app: both reads
-- are now DEFINER-mediated, and the Phase-8 substrate has no cross-account
-- recipient-display-by-name read that would require a surviving column. Every
-- previously granted selves column is therefore revoked. This is a pure
-- narrowing (0008 §1 / 0009 §5: Phase 8 only narrows).
--
-- R7.1: NO RLS policy is created on public.selves here; selves is the substrate
-- that establishes identity context and its policy posture is remanded to Phase
-- 8-B (0008 R7.1/R7.3). This migration touches privileges and DEFINER functions
-- only; it does not enable RLS on public.selves.
--
-- Runs as selves_migrate with current_user=selves_owner, so both functions are
-- owned by selves_owner. Convention follows domain-mutations (P6-B): domain
-- schema, SECURITY DEFINER, SET search_path = '', fully-qualified names, EXECUTE
-- revoked from PUBLIC then granted only to selves_app.

-- ── domain.self_owned_by_account ──────────────────────────────────────────────
-- Is this Self owned by this account? Account-scoped boolean; the authority is
-- the authenticated account (first parameter), never an acting Self. Replaces the
-- app's direct `SELECT 1 FROM public.selves WHERE id=$1 AND account_id=$2`.
CREATE FUNCTION domain.self_owned_by_account(p_account uuid, p_self uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.selves WHERE id = p_self AND account_id = p_account
  );
$fn$;

-- ── domain.list_account_selves ────────────────────────────────────────────────
-- The account's own Selves, deterministically ordered by slot — supports the
-- ratified Self switcher. Account-scoped; returns only the columns the switcher
-- displays (id, name) plus the ordering slot. Replaces the app's direct
-- `SELECT id, name, self_slot FROM public.selves WHERE account_id=$1 ...`.
CREATE FUNCTION domain.list_account_selves(p_account uuid)
RETURNS TABLE (id uuid, name text, self_slot smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT s.id, s.name, s.self_slot
    FROM public.selves s
   WHERE s.account_id = p_account
   ORDER BY s.self_slot;
$fn$;

REVOKE EXECUTE ON FUNCTION
  domain.self_owned_by_account(uuid, uuid),
  domain.list_account_selves(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  domain.self_owned_by_account(uuid, uuid),
  domain.list_account_selves(uuid)
TO selves_app;

-- ── narrow: remove every direct selves read from selves_app ───────────────────
-- Both identity reads are now DEFINER-mediated; no direct selves read survives
-- for the app role. Revoke the entire Phase-4 column grant.
REVOKE SELECT (id, account_id, name, self_slot) ON public.selves FROM selves_app;

-- Down Migration
-- Restore the exact Phase-4 column grant, then drop the DEFINER functions.
GRANT SELECT (id, account_id, name, self_slot) ON public.selves TO selves_app;

DROP FUNCTION domain.list_account_selves(uuid);
DROP FUNCTION domain.self_owned_by_account(uuid, uuid);
