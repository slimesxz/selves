-- Up Migration
--
-- P10-S2 — the account departure-interval getter (R4 item 4, as recorded in
-- 0012 §35 ruling 8 and the accepted S2 opening packet). Account-bound and
-- Self-INDEPENDENT, the exact authority class of the ratified setter
-- domain.set_departure_interval (P8 L / 0006 A1): the account is derived
-- exclusively in-database from the presented session token; the function
-- accepts no acting Self, no Self id, no account id, and no caller-supplied
-- authority identifier (0010 §2). Failure is the setter's opaque PT404.
-- selves_app gains no direct accounts read path — EXECUTE on this function is
-- its only route to the value.

CREATE FUNCTION domain.get_departure_interval(p_session_token bytea)
RETURNS smallint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_account uuid; v_seconds smallint;
BEGIN
  v_account := auth.authenticate_session(p_session_token);   -- account-authenticated, Self-independent
  IF v_account IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT departure_interval_seconds INTO v_seconds FROM public.accounts WHERE id = v_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  RETURN v_seconds;
END $fn$;

REVOKE EXECUTE ON FUNCTION domain.get_departure_interval(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION domain.get_departure_interval(bytea) TO selves_app;

-- Down Migration
-- Restore the exact prior state: the function (and with it every EXECUTE
-- grant on it) ceases to exist; no other object or privilege was touched.

DROP FUNCTION domain.get_departure_interval(bytea);
