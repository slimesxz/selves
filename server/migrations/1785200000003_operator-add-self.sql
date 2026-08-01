-- Up Migration
--
-- P10-S5 — operator-side additional-Self provisioning (P10-N3 ruling,
-- decision 0012 §39). Trusted operator tooling only: EXECUTE to
-- selves_bootstrap, never to selves_app, and no production HTTP path reaches
-- it. The function's only authoritative write is one row in public.selves for
-- an existing account at an operator-named slot; it creates no account,
-- credential, session, or key, mutates no other Self, and touches no
-- active-Self state (none is persisted). auth.enroll_account is untouched and
-- continues to create slot 1 directly.
--
-- Validity stays schema-owned (§39): selves_slot_range CHECK (self_slot
-- BETWEEN 1 AND 3) rejects an out-of-range coordinate and selves_name_present
-- rejects a blank name — neither is duplicated here. The three-Self maximum is
-- structural (the slot domain plus selves_one_per_slot), so no count rule
-- exists. Occupied-slot detection is the UNIQUE constraint itself, via
-- ON CONFLICT DO NOTHING: under two racing operator calls for the same
-- (account_id, self_slot) exactly one INSERT writes a row and the other
-- returns no row and raises PT409 — no duplicate, no overwrite, and no caller
-- observes success after another won the slot.

CREATE FUNCTION auth.add_self(p_account uuid, p_slot smallint, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM 1 FROM public.accounts WHERE id = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.selves (account_id, self_slot, name)
  VALUES (p_account, p_slot, p_name)
  ON CONFLICT (account_id, self_slot) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'slot occupied' USING ERRCODE = 'PT409'; END IF;
  RETURN v_id;
END $fn$;

REVOKE EXECUTE ON FUNCTION auth.add_self(uuid, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.add_self(uuid, smallint, text) TO selves_bootstrap;

-- Down Migration
-- Drops only the added function; every EXECUTE grant on it ceases with it and
-- no other object or privilege was touched.

DROP FUNCTION auth.add_self(uuid, smallint, text);
