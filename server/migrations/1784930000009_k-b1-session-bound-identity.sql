-- Up Migration
--
-- P8 K — 8-B b1: session-bound identity functions (decision 0008-C §4 / standing
-- DEFINER-authority rule).
--
-- R7.2 moved the two account-scoped identity reads behind DEFINER functions, but
-- those functions trusted a CALLER-SUPPLIED p_account — a caller-selected authority
-- selector. The chamber rejected account-UUID secrecy as the boundary: the account
-- authority must derive from the authenticated session fact, not from an argument.
--
-- The functions are rebound to the existing protected session substrate: the
-- account is resolved in-DB via auth.authenticate_session(p_session_token). No
-- second authentication mechanism is introduced. The caller-supplied p_account is
-- removed, so no foreign account can be aimed by supplying its UUID.
--
--   * self_owned_by_account(p_session_token, p_self) → boolean
--   * list_account_selves(p_session_token)          → (id, name, self_slot)
--
-- Non-oracular failure: an invalid/expired/revoked session yields
-- authenticate_session()=NULL → account_id = NULL matches no row → boolean false /
-- zero rows, indistinguishable from "not owned" / "empty". The token hash travels
-- ONLY as a bind parameter (established credential-propagation secrecy).
--
-- Runs as selves_migrate with current_user=selves_owner.

DROP FUNCTION domain.self_owned_by_account(uuid, uuid);
DROP FUNCTION domain.list_account_selves(uuid);

CREATE FUNCTION domain.self_owned_by_account(p_session_token bytea, p_self uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.selves s
     WHERE s.id = p_self
       AND s.account_id = auth.authenticate_session(p_session_token)
  );
$fn$;

CREATE FUNCTION domain.list_account_selves(p_session_token bytea)
RETURNS TABLE (id uuid, name text, self_slot smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT s.id, s.name, s.self_slot
    FROM public.selves s
   WHERE s.account_id = auth.authenticate_session(p_session_token)
   ORDER BY s.self_slot;
$fn$;

REVOKE EXECUTE ON FUNCTION
  domain.self_owned_by_account(bytea, uuid),
  domain.list_account_selves(bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  domain.self_owned_by_account(bytea, uuid),
  domain.list_account_selves(bytea)
TO selves_app;

-- Down Migration — restore the R7.2 account-parameter signatures exactly.
DROP FUNCTION domain.self_owned_by_account(bytea, uuid);
DROP FUNCTION domain.list_account_selves(bytea);

CREATE FUNCTION domain.self_owned_by_account(p_account uuid, p_self uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.selves WHERE id = p_self AND account_id = p_account
  );
$fn$;

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
