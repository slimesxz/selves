-- Up Migration
--
-- P9-C — transactional-outbox emission inside domain.settle_placement
-- (decision 0011 Q2, Q13, B.4, C3).
--
-- The settlement function is DROP+CREATEd with ONE addition: the outbox INSERT
-- at the attachment point 0006 reserved ("kept a SINGLE-statement DEFINER
-- function so the transactional-outbox INSERT can later attach INSIDE this same
-- function/transaction with no redesign"). Emission shares the settlement
-- transaction: settlement-without-event and event-without-settlement are both
-- impossible by construction. The availability coupling is DELIBERATELY
-- accepted (0011 B.4): if the INSERT fails, settlement rolls back and the
-- sender receives an error.
--
-- The emission predicate is a POSITIVE ENUMERATION of ratified emitting payload
-- types (Q2) — default-deny, never a negative exclusion of Key. A settled Key
-- Placement emits nothing, structurally. 'placement_settled' is the sole event
-- type in the ratified vocabulary (Q13; the 0003 free-text deferral is closed).
-- The payload carries only the placement id: the worker derives from the
-- AUTHORITATIVE row, never from the payload.
--
-- C3: v_payload is renamed v_payload_type (it holds a payload TYPE), so the
-- enumeration guard reads alike at its three ruled sites (emission here;
-- derivation guard in proj.process_outbox; derivation predicate in
-- proj.rebuild_graph). Every semantic check is otherwise preserved verbatim
-- from the P8-L body. Runs as selves_migrate with current_user=selves_owner.

DROP FUNCTION domain.settle_placement(uuid);

CREATE FUNCTION domain.settle_placement(p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid := domain.current_acting_self(); v_sender uuid; v_state public.placement_state;
        v_departing timestamptz; v_interval smallint; v_payload_type public.payload_type; v_protected uuid; v_grantee uuid;
BEGIN
  IF v_self IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  SELECT sender_self_id, state, departing_at, departure_interval_seconds, payload_type, protected_resource_id
  INTO v_sender, v_state, v_departing, v_interval, v_payload_type, v_protected
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> v_self THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404'; END IF;
  IF v_state = 'settled' THEN RETURN; END IF;
  IF v_state <> 'departing' THEN RAISE EXCEPTION 'only a departing placement may settle' USING ERRCODE = 'PT409'; END IF;
  IF v_interval IS NULL OR pg_catalog.now() < v_departing + pg_catalog.make_interval(secs => v_interval) THEN
    RAISE EXCEPTION 'the departure interval has not elapsed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.placements SET state = 'settled', settled_at = pg_catalog.now()
  WHERE id = p_placement_id AND state = 'departing';
  -- Phase-9 emission (Q2/Q13): POSITIVE ENUMERATION of ratified emitting
  -- payload types. Default-deny: a payload type absent from this list emits
  -- nothing until a ruling adds it. 'key' is not enumerated — a Key
  -- Placement's settlement emits nothing (charter law 4).
  IF v_payload_type IN ('text') THEN
    INSERT INTO public.outbox_events (event_type, payload)
    VALUES ('placement_settled',
            pg_catalog.jsonb_build_object('placement_id', p_placement_id));
  END IF;
  IF v_payload_type = 'key' THEN
    SELECT recipient_self_id INTO v_grantee FROM public.placement_recipients WHERE placement_id = p_placement_id;
    INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id)
    VALUES (v_sender, v_grantee, v_protected);
  END IF;
END $fn$;

REVOKE EXECUTE ON FUNCTION domain.settle_placement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION domain.settle_placement(uuid) TO selves_app;

-- Down Migration — restore the exact P8-L body (no emission, v_payload name).
DROP FUNCTION domain.settle_placement(uuid);

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
    INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES (v_sender, v_grantee, v_protected);
  END IF;
END $fn$;

REVOKE EXECUTE ON FUNCTION domain.settle_placement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION domain.settle_placement(uuid) TO selves_app;
