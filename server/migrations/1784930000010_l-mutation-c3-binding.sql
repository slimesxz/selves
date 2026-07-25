-- Up Migration
--
-- P8 L — mutation C3 binding (decision 0008-C §5 / Scope B / standing DEFINER rule).
--
-- Every domain mutation trusted a CALLER-SUPPLIED p_acting_self (the caller's mere
-- claim of identity), authenticated by nothing — a T2 adversary with the selves_app
-- credential and a known Self UUID could forge/settle/revoke as that Self. The
-- acting identity now comes from the trusted C3 context (domain.current_acting_self());
-- the caller-selected authority argument is removed. Every semantic check
-- (authorship, sender, lifecycle, recorded grantorship, exact-resource Key law) is
-- preserved verbatim — only the actor's provenance changes. No context → PT404
-- (fail closed; the mutation transaction establishes context first — see db.ts).
--
-- set_departure_interval is account-authenticated and Self-INDEPENDENT by its
-- ratified contract (the account route carries no acting Self). Per 0008-C §5 it is
-- bound to the SESSION (account derived from auth.authenticate_session), NOT to an
-- acting Self — this preserves Self-independence and changes no behavior (the
-- account route already holds the session), while removing the caller-supplied
-- account authority.
--
-- Runs as selves_migrate with current_user=selves_owner. Signatures change, so each
-- function is DROP+CREATE; the Down section restores the exact prior signatures.

DROP FUNCTION domain.create_artifact(uuid, text);
DROP FUNCTION domain.create_placement_draft(uuid, uuid);
DROP FUNCTION domain.add_recipient(uuid, uuid, uuid);
DROP FUNCTION domain.remove_recipient(uuid, uuid, uuid);
DROP FUNCTION domain.begin_departure(uuid, uuid);
DROP FUNCTION domain.cancel_placement(uuid, uuid);
DROP FUNCTION domain.settle_placement(uuid, uuid);
DROP FUNCTION domain.set_departure_interval(uuid, integer);
DROP FUNCTION domain.create_key_placement_draft(uuid, uuid);
DROP FUNCTION domain.revoke_key(uuid, uuid, uuid);

CREATE FUNCTION domain.create_artifact(p_text_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_id uuid;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.artifacts (author_self_id, payload_type, text_body)
  VALUES (v_self, 'text', p_text_body) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE FUNCTION domain.create_placement_draft(p_artifact_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_author uuid; v_id uuid;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT author_self_id INTO v_author FROM public.artifacts WHERE id = p_artifact_id;
  IF NOT FOUND OR v_author <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.placements (sender_self_id, artifact_id) VALUES (v_self, p_artifact_id) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE FUNCTION domain.add_recipient(p_placement_id uuid, p_recipient_self uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_sender uuid; v_state public.placement_state; v_payload public.payload_type;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT sender_self_id, state, payload_type INTO v_sender, v_state, v_payload
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state <> 'draft' THEN RAISE EXCEPTION 'recipients are editable only while draft' USING ERRCODE = 'PT409'; END IF;
  IF v_payload = 'key' THEN
    IF p_recipient_self = v_sender THEN
      RAISE EXCEPTION 'the sender may not be its own Key recipient' USING ERRCODE = 'PT400';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.placement_recipients
      WHERE placement_id = p_placement_id AND recipient_self_id <> p_recipient_self
    ) THEN
      RAISE EXCEPTION 'a Key Placement has exactly one recipient' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  INSERT INTO public.placement_recipients (placement_id, recipient_self_id)
  VALUES (p_placement_id, p_recipient_self) ON CONFLICT DO NOTHING;
END $fn$;

CREATE FUNCTION domain.remove_recipient(p_placement_id uuid, p_recipient_self uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_sender uuid; v_state public.placement_state;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT sender_self_id, state INTO v_sender, v_state
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state <> 'draft' THEN RAISE EXCEPTION 'recipients are editable only while draft' USING ERRCODE = 'PT409'; END IF;
  DELETE FROM public.placement_recipients
  WHERE placement_id = p_placement_id AND recipient_self_id = p_recipient_self;
END $fn$;

CREATE FUNCTION domain.begin_departure(p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_sender uuid; v_state public.placement_state;
        v_payload public.payload_type; v_recipients integer; v_interval smallint;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT sender_self_id, state, payload_type INTO v_sender, v_state, v_payload
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state <> 'draft' THEN RAISE EXCEPTION 'only a draft may depart' USING ERRCODE = 'PT409'; END IF;
  SELECT count(*) INTO v_recipients FROM public.placement_recipients WHERE placement_id = p_placement_id;
  IF v_payload = 'key' THEN
    IF v_recipients <> 1 THEN RAISE EXCEPTION 'a Key Placement departs with exactly one recipient' USING ERRCODE = 'PT409'; END IF;
  ELSE
    IF v_recipients < 1 THEN RAISE EXCEPTION 'a departure requires at least one recipient' USING ERRCODE = 'PT409'; END IF;
  END IF;
  SELECT a.departure_interval_seconds INTO v_interval
  FROM public.accounts a JOIN public.selves s ON s.account_id = a.id WHERE s.id = v_self;
  UPDATE public.placements
  SET state = 'departing', departing_at = pg_catalog.now(), departure_interval_seconds = v_interval
  WHERE id = p_placement_id AND state = 'draft';
END $fn$;

CREATE FUNCTION domain.cancel_placement(p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_sender uuid; v_state public.placement_state;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT sender_self_id, state INTO v_sender, v_state
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state = 'cancelled' THEN RETURN; END IF;
  IF v_state <> 'departing' THEN RAISE EXCEPTION 'only a departing placement may be cancelled' USING ERRCODE = 'PT409'; END IF;
  UPDATE public.placements SET state = 'cancelled', cancelled_at = pg_catalog.now()
  WHERE id = p_placement_id AND state = 'departing';
END $fn$;

CREATE FUNCTION domain.settle_placement(p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_sender uuid; v_state public.placement_state;
        v_departing timestamptz; v_interval smallint; v_payload public.payload_type; v_protected uuid; v_grantee uuid;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT sender_self_id, state, departing_at, departure_interval_seconds, payload_type, protected_resource_id
  INTO v_sender, v_state, v_departing, v_interval, v_payload, v_protected
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state = 'settled' THEN RETURN; END IF;
  IF v_state <> 'departing' THEN RAISE EXCEPTION 'only a departing placement may settle' USING ERRCODE = 'PT409'; END IF;
  IF v_interval IS NULL OR pg_catalog.now() < v_departing + pg_catalog.make_interval(secs => v_interval) THEN
    RAISE EXCEPTION 'the departure interval has not elapsed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.placements SET state = 'settled', settled_at = pg_catalog.now()
  WHERE id = p_placement_id AND state = 'departing';
  IF v_payload = 'key' THEN
    SELECT recipient_self_id INTO v_grantee FROM public.placement_recipients WHERE placement_id = p_placement_id;
    INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id)
    VALUES (v_sender, v_grantee, v_protected);
  END IF;
END $fn$;

CREATE FUNCTION domain.set_departure_interval(p_session_token bytea, p_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_account uuid;
BEGIN
  IF p_seconds NOT IN (5, 10, 30, 60) THEN
    RAISE EXCEPTION 'interval must be one of 5, 10, 30, 60 seconds' USING ERRCODE = 'PT400';
  END IF;
  v_account := auth.authenticate_session(p_session_token);   -- account-authenticated, Self-independent
  IF v_account IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  UPDATE public.accounts SET departure_interval_seconds = p_seconds WHERE id = v_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
END $fn$;

CREATE FUNCTION domain.create_key_placement_draft(p_protected_resource uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_author uuid; v_id uuid;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT author_self_id INTO v_author FROM public.artifacts WHERE id = p_protected_resource;
  IF NOT FOUND OR v_author <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.placements (sender_self_id, payload_type, artifact_id, protected_resource_id)
  VALUES (v_self, 'key', NULL, p_protected_resource) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE FUNCTION domain.revoke_key(p_grantee uuid, p_protected_resource uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self();
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  UPDATE public.key_grants SET revoked_at = pg_catalog.now()
  WHERE grantor_self_id = v_self AND grantee_self_id = p_grantee
    AND protected_resource_id = p_protected_resource AND revoked_at IS NULL;
  IF FOUND THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.key_grants
    WHERE grantor_self_id = v_self AND grantee_self_id = p_grantee AND protected_resource_id = p_protected_resource
  ) THEN RETURN; END IF;
  RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
END $fn$;

REVOKE EXECUTE ON FUNCTION
  domain.create_artifact(text), domain.create_placement_draft(uuid),
  domain.add_recipient(uuid, uuid), domain.remove_recipient(uuid, uuid),
  domain.begin_departure(uuid), domain.cancel_placement(uuid), domain.settle_placement(uuid),
  domain.set_departure_interval(bytea, integer),
  domain.create_key_placement_draft(uuid), domain.revoke_key(uuid, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  domain.create_artifact(text), domain.create_placement_draft(uuid),
  domain.add_recipient(uuid, uuid), domain.remove_recipient(uuid, uuid),
  domain.begin_departure(uuid), domain.cancel_placement(uuid), domain.settle_placement(uuid),
  domain.set_departure_interval(bytea, integer),
  domain.create_key_placement_draft(uuid), domain.revoke_key(uuid, uuid)
TO selves_app;

-- Down Migration — restore the exact caller-supplied-identity signatures/bodies.
DROP FUNCTION domain.create_artifact(text);
DROP FUNCTION domain.create_placement_draft(uuid);
DROP FUNCTION domain.add_recipient(uuid, uuid);
DROP FUNCTION domain.remove_recipient(uuid, uuid);
DROP FUNCTION domain.begin_departure(uuid);
DROP FUNCTION domain.cancel_placement(uuid);
DROP FUNCTION domain.settle_placement(uuid);
DROP FUNCTION domain.set_departure_interval(bytea, integer);
DROP FUNCTION domain.create_key_placement_draft(uuid);
DROP FUNCTION domain.revoke_key(uuid, uuid);

CREATE FUNCTION domain.create_artifact(p_acting_self uuid, p_text_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.artifacts (author_self_id, payload_type, text_body)
  VALUES (p_acting_self, 'text', p_text_body) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE FUNCTION domain.create_placement_draft(p_acting_self uuid, p_artifact_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_author uuid; v_id uuid;
BEGIN
  SELECT author_self_id INTO v_author FROM public.artifacts WHERE id = p_artifact_id;
  IF NOT FOUND OR v_author <> p_acting_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.placements (sender_self_id, artifact_id) VALUES (p_acting_self, p_artifact_id) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE FUNCTION domain.add_recipient(p_acting_self uuid, p_placement_id uuid, p_recipient_self uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_payload public.payload_type;
BEGIN
  SELECT sender_self_id, state, payload_type INTO v_sender, v_state, v_payload
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state <> 'draft' THEN RAISE EXCEPTION 'recipients are editable only while draft' USING ERRCODE = 'PT409'; END IF;
  IF v_payload = 'key' THEN
    IF p_recipient_self = v_sender THEN RAISE EXCEPTION 'the sender may not be its own Key recipient' USING ERRCODE = 'PT400'; END IF;
    IF EXISTS (SELECT 1 FROM public.placement_recipients WHERE placement_id = p_placement_id AND recipient_self_id <> p_recipient_self) THEN
      RAISE EXCEPTION 'a Key Placement has exactly one recipient' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  INSERT INTO public.placement_recipients (placement_id, recipient_self_id)
  VALUES (p_placement_id, p_recipient_self) ON CONFLICT DO NOTHING;
END $fn$;

CREATE FUNCTION domain.remove_recipient(p_acting_self uuid, p_placement_id uuid, p_recipient_self uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state;
BEGIN
  SELECT sender_self_id, state INTO v_sender, v_state FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state <> 'draft' THEN RAISE EXCEPTION 'recipients are editable only while draft' USING ERRCODE = 'PT409'; END IF;
  DELETE FROM public.placement_recipients WHERE placement_id = p_placement_id AND recipient_self_id = p_recipient_self;
END $fn$;

CREATE FUNCTION domain.begin_departure(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_payload public.payload_type; v_recipients integer; v_interval smallint;
BEGIN
  SELECT sender_self_id, state, payload_type INTO v_sender, v_state, v_payload
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state <> 'draft' THEN RAISE EXCEPTION 'only a draft may depart' USING ERRCODE = 'PT409'; END IF;
  SELECT count(*) INTO v_recipients FROM public.placement_recipients WHERE placement_id = p_placement_id;
  IF v_payload = 'key' THEN
    IF v_recipients <> 1 THEN RAISE EXCEPTION 'a Key Placement departs with exactly one recipient' USING ERRCODE = 'PT409'; END IF;
  ELSE
    IF v_recipients < 1 THEN RAISE EXCEPTION 'a departure requires at least one recipient' USING ERRCODE = 'PT409'; END IF;
  END IF;
  SELECT a.departure_interval_seconds INTO v_interval
  FROM public.accounts a JOIN public.selves s ON s.account_id = a.id WHERE s.id = p_acting_self;
  UPDATE public.placements SET state = 'departing', departing_at = pg_catalog.now(), departure_interval_seconds = v_interval
  WHERE id = p_placement_id AND state = 'draft';
END $fn$;

CREATE FUNCTION domain.cancel_placement(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state;
BEGIN
  SELECT sender_self_id, state INTO v_sender, v_state FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state = 'cancelled' THEN RETURN; END IF;
  IF v_state <> 'departing' THEN RAISE EXCEPTION 'only a departing placement may be cancelled' USING ERRCODE = 'PT409'; END IF;
  UPDATE public.placements SET state = 'cancelled', cancelled_at = pg_catalog.now() WHERE id = p_placement_id AND state = 'departing';
END $fn$;

CREATE FUNCTION domain.settle_placement(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_departing timestamptz; v_interval smallint;
        v_payload public.payload_type; v_protected uuid; v_grantee uuid;
BEGIN
  SELECT sender_self_id, state, departing_at, departure_interval_seconds, payload_type, protected_resource_id
  INTO v_sender, v_state, v_departing, v_interval, v_payload, v_protected
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state = 'settled' THEN RETURN; END IF;
  IF v_state <> 'departing' THEN RAISE EXCEPTION 'only a departing placement may settle' USING ERRCODE = 'PT409'; END IF;
  IF v_interval IS NULL OR pg_catalog.now() < v_departing + pg_catalog.make_interval(secs => v_interval) THEN
    RAISE EXCEPTION 'the departure interval has not elapsed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.placements SET state = 'settled', settled_at = pg_catalog.now() WHERE id = p_placement_id AND state = 'departing';
  IF v_payload = 'key' THEN
    SELECT recipient_self_id INTO v_grantee FROM public.placement_recipients WHERE placement_id = p_placement_id;
    INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES (v_sender, v_grantee, v_protected);
  END IF;
END $fn$;

CREATE FUNCTION domain.set_departure_interval(p_account uuid, p_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF p_seconds NOT IN (5, 10, 30, 60) THEN RAISE EXCEPTION 'interval must be one of 5, 10, 30, 60 seconds' USING ERRCODE = 'PT400'; END IF;
  UPDATE public.accounts SET departure_interval_seconds = p_seconds WHERE id = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
END $fn$;

CREATE FUNCTION domain.create_key_placement_draft(p_acting_self uuid, p_protected_resource uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_author uuid; v_id uuid;
BEGIN
  SELECT author_self_id INTO v_author FROM public.artifacts WHERE id = p_protected_resource;
  IF NOT FOUND OR v_author <> p_acting_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.placements (sender_self_id, payload_type, artifact_id, protected_resource_id)
  VALUES (p_acting_self, 'key', NULL, p_protected_resource) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE FUNCTION domain.revoke_key(p_acting_self uuid, p_grantee uuid, p_protected_resource uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  UPDATE public.key_grants SET revoked_at = pg_catalog.now()
  WHERE grantor_self_id = p_acting_self AND grantee_self_id = p_grantee
    AND protected_resource_id = p_protected_resource AND revoked_at IS NULL;
  IF FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.key_grants WHERE grantor_self_id = p_acting_self AND grantee_self_id = p_grantee AND protected_resource_id = p_protected_resource) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
END $fn$;

REVOKE EXECUTE ON FUNCTION
  domain.create_artifact(uuid, text), domain.create_placement_draft(uuid, uuid),
  domain.add_recipient(uuid, uuid, uuid), domain.remove_recipient(uuid, uuid, uuid),
  domain.begin_departure(uuid, uuid), domain.cancel_placement(uuid, uuid), domain.settle_placement(uuid, uuid),
  domain.set_departure_interval(uuid, integer),
  domain.create_key_placement_draft(uuid, uuid), domain.revoke_key(uuid, uuid, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  domain.create_artifact(uuid, text), domain.create_placement_draft(uuid, uuid),
  domain.add_recipient(uuid, uuid, uuid), domain.remove_recipient(uuid, uuid, uuid),
  domain.begin_departure(uuid, uuid), domain.cancel_placement(uuid, uuid), domain.settle_placement(uuid, uuid),
  domain.set_departure_interval(uuid, integer),
  domain.create_key_placement_draft(uuid, uuid), domain.revoke_key(uuid, uuid, uuid)
TO selves_app;
