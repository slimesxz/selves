-- Up Migration
--
-- P7-C — the Key lifecycle mutation surface (decision 0007). All writes stay
-- behind the exclusive SECURITY DEFINER boundary (0004/0006): every function is
-- owned by selves_owner, SET search_path='', fully qualified; selves_app gains
-- only EXECUTE. Runs as selves_migrate with current_user=selves_owner.
--
-- Grant creation is NOT a standalone mutation — it is produced by the Key-aware
-- settle_placement, atomically with the Placement's settlement (R10/R14). The one
-- new standalone Key mutation is revoke_key. create_key_placement_draft opens the
-- Key transmission; add_recipient / begin_departure / settle_placement gain
-- additive Key-specific gates while the text path is unchanged.
--
-- Error signalling uses the ratified custom SQLSTATEs (ruling 7 / R13):
--   PT404 → 404 (unauthorized OR absent — indistinguishable, non-leakage);
--   PT409 → 409 (authorized actor, wrong state / conflict / collision);
--   PT400 → 400 (self-as-Key-recipient; other malformed input).
-- A settlement collision surfaces as 23505 (unique_violation) → 409 (mapped).

-- ── create_key_placement_draft ────────────────────────────────────────────────
-- Opens a Key transmission: an ordinary draft Placement carrying the 'key'
-- payload, artifact_id NULL, protected_resource_id = the exact governed Artifact.
-- Grantor authority is AUTHORSHIP (R4): the acting Self must author the protected
-- resource. A non-author or an absent resource are indistinguishable → PT404.
CREATE FUNCTION domain.create_key_placement_draft(p_acting_self uuid, p_protected_resource uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_author uuid; v_id uuid;
BEGIN
  SELECT author_self_id INTO v_author FROM public.artifacts WHERE id = p_protected_resource;
  IF NOT FOUND OR v_author <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.placements (sender_self_id, payload_type, artifact_id, protected_resource_id)
  VALUES (p_acting_self, 'key', NULL, p_protected_resource)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- ── add_recipient (CREATE OR REPLACE — Key-aware) ─────────────────────────────
-- Sender-only, draft-only (unchanged). Text: any explicit Self, idempotent
-- (Phase-6 behaviour verbatim). Key (R5/R6/R13): exactly one recipient, never the
-- sender. Self-as-Key-recipient → PT400 (rejected during composition, not left to
-- the key_grants_no_self_grant CHECK at settlement). A second, DIFFERENT Key
-- recipient → PT409; re-adding the SAME grantee is idempotent.
CREATE OR REPLACE FUNCTION domain.add_recipient(p_acting_self uuid, p_placement_id uuid, p_recipient_self uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_payload public.payload_type;
BEGIN
  SELECT sender_self_id, state, payload_type INTO v_sender, v_state, v_payload
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_state <> 'draft' THEN
    RAISE EXCEPTION 'recipients are editable only while draft' USING ERRCODE = 'PT409';
  END IF;
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
  VALUES (p_placement_id, p_recipient_self)
  ON CONFLICT DO NOTHING;
END $fn$;

-- ── begin_departure (CREATE OR REPLACE — payload-aware cardinality) ───────────
-- Sender-only, draft → departing; snapshots the account interval (unchanged).
-- Text requires ≥1 recipient (ruling 4); Key requires EXACTLY one (R5).
CREATE OR REPLACE FUNCTION domain.begin_departure(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_payload public.payload_type;
        v_recipients integer; v_interval smallint;
BEGIN
  SELECT sender_self_id, state, payload_type INTO v_sender, v_state, v_payload
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_state <> 'draft' THEN
    RAISE EXCEPTION 'only a draft may depart' USING ERRCODE = 'PT409';
  END IF;
  SELECT count(*) INTO v_recipients
  FROM public.placement_recipients WHERE placement_id = p_placement_id;
  IF v_payload = 'key' THEN
    IF v_recipients <> 1 THEN
      RAISE EXCEPTION 'a Key Placement departs with exactly one recipient' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    IF v_recipients < 1 THEN
      RAISE EXCEPTION 'a departure requires at least one recipient' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  SELECT a.departure_interval_seconds INTO v_interval
  FROM public.accounts a JOIN public.selves s ON s.account_id = a.id
  WHERE s.id = p_acting_self;
  UPDATE public.placements
  SET state = 'departing', departing_at = pg_catalog.now(), departure_interval_seconds = v_interval
  WHERE id = p_placement_id AND state = 'draft';
END $fn$;

-- ── settle_placement (CREATE OR REPLACE — Key-aware; grant creation) ──────────
-- Sender-only, departing → settled behind the interval floor; idempotent on an
-- already-settled Placement (unchanged for text). For a Key Placement, settlement
-- and the key_grants INSERT are ONE atomic transaction (R10): the sole recipient
-- becomes the grantee of a grant binding (grantor=sender, grantee, protected
-- resource). If an active grant for that triple already exists the unique index
-- refuses the insert (23505) and the WHOLE transaction rolls back — the Placement
-- stays 'departing' and 23505 maps to 409. Kept a single-statement DEFINER
-- function so the Phase-9 outbox INSERT attaches inside this same transaction.
CREATE OR REPLACE FUNCTION domain.settle_placement(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_departing timestamptz;
        v_interval smallint; v_payload public.payload_type; v_protected uuid; v_grantee uuid;
BEGIN
  SELECT sender_self_id, state, departing_at, departure_interval_seconds, payload_type, protected_resource_id
  INTO v_sender, v_state, v_departing, v_interval, v_payload, v_protected
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_state = 'settled' THEN
    RETURN;  -- idempotent
  END IF;
  IF v_state <> 'departing' THEN
    RAISE EXCEPTION 'only a departing placement may settle' USING ERRCODE = 'PT409';
  END IF;
  IF v_interval IS NULL
     OR pg_catalog.now() < v_departing + pg_catalog.make_interval(secs => v_interval) THEN
    RAISE EXCEPTION 'the departure interval has not elapsed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.placements
  SET state = 'settled', settled_at = pg_catalog.now()
  WHERE id = p_placement_id AND state = 'departing';
  -- Key payload: establish the capability atomically with settlement.
  IF v_payload = 'key' THEN
    SELECT recipient_self_id INTO v_grantee
    FROM public.placement_recipients WHERE placement_id = p_placement_id;
    -- 23505 here (an active grant for the triple already exists) rolls back the
    -- settlement UPDATE above with it — neither persists (R10).
    INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id)
    VALUES (v_sender, v_grantee, v_protected);
  END IF;
  -- Phase 9: INSERT INTO public.outbox_events (...) attaches HERE, same transaction.
END $fn$;

-- ── revoke_key ────────────────────────────────────────────────────────────────
-- The one new standalone Key mutation. Addressed publicly by (grantee, protected
-- resource) under the verified acting grantor; key_grants.id is never exposed or
-- required (R7 addendum). Revocation authority binds to the RECORDED grantor
-- (grantor_self_id = p_acting_self), never a dynamic re-check of current Artifact
-- authorship (R7). Prospective and idempotent; a revoked grant is terminal (R8).
--
-- Active lookup PRECEDES historical-idempotency lookup so revoked history can
-- never shadow a later active re-grant:
--   * revoke exactly the active row for the triple, if any (the UPDATE ... WHERE
--     revoked_at IS NULL is also the compare-and-swap that makes concurrent
--     revokes single-winner);
--   * else, if a revoked historical row for that same recorded grantor/grantee/
--     resource exists, succeed idempotently and mutate nothing;
--   * else (no grant belongs to the acting grantor — includes a foreign actor
--     probing a real pair) → PT404, never idempotent success.
CREATE FUNCTION domain.revoke_key(p_acting_self uuid, p_grantee uuid, p_protected_resource uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  UPDATE public.key_grants
  SET revoked_at = pg_catalog.now()
  WHERE grantor_self_id = p_acting_self
    AND grantee_self_id = p_grantee
    AND protected_resource_id = p_protected_resource
    AND revoked_at IS NULL;
  IF FOUND THEN
    RETURN;  -- revoked exactly the active grant
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.key_grants
    WHERE grantor_self_id = p_acting_self
      AND grantee_self_id = p_grantee
      AND protected_resource_id = p_protected_resource
  ) THEN
    RETURN;  -- idempotent: a revoked grant of this grantor exists; mutate nothing
  END IF;
  RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
END $fn$;

-- ── grants: exclusive EXECUTE on the two NEW functions (auth-migration pattern).
-- The CREATE OR REPLACE functions retain their Phase-6 EXECUTE grants.
REVOKE EXECUTE ON FUNCTION
  domain.create_key_placement_draft(uuid, uuid),
  domain.revoke_key(uuid, uuid, uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  domain.create_key_placement_draft(uuid, uuid),
  domain.revoke_key(uuid, uuid, uuid)
TO selves_app;

-- Down Migration

DROP FUNCTION domain.revoke_key(uuid, uuid, uuid);
DROP FUNCTION domain.create_key_placement_draft(uuid, uuid);

-- Restore the Phase-6 (P6-B) bodies of the three replaced functions.
CREATE OR REPLACE FUNCTION domain.add_recipient(p_acting_self uuid, p_placement_id uuid, p_recipient_self uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state;
BEGIN
  SELECT sender_self_id, state INTO v_sender, v_state
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_state <> 'draft' THEN
    RAISE EXCEPTION 'recipients are editable only while draft' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.placement_recipients (placement_id, recipient_self_id)
  VALUES (p_placement_id, p_recipient_self)
  ON CONFLICT DO NOTHING;
END $fn$;

CREATE OR REPLACE FUNCTION domain.begin_departure(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_recipients integer; v_interval smallint;
BEGIN
  SELECT sender_self_id, state INTO v_sender, v_state
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_state <> 'draft' THEN
    RAISE EXCEPTION 'only a draft may depart' USING ERRCODE = 'PT409';
  END IF;
  SELECT count(*) INTO v_recipients
  FROM public.placement_recipients WHERE placement_id = p_placement_id;
  IF v_recipients < 1 THEN
    RAISE EXCEPTION 'a departure requires at least one recipient' USING ERRCODE = 'PT409';
  END IF;
  SELECT a.departure_interval_seconds INTO v_interval
  FROM public.accounts a JOIN public.selves s ON s.account_id = a.id
  WHERE s.id = p_acting_self;
  UPDATE public.placements
  SET state = 'departing', departing_at = pg_catalog.now(), departure_interval_seconds = v_interval
  WHERE id = p_placement_id AND state = 'draft';
END $fn$;

CREATE OR REPLACE FUNCTION domain.settle_placement(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state; v_departing timestamptz; v_interval smallint;
BEGIN
  SELECT sender_self_id, state, departing_at, departure_interval_seconds
  INTO v_sender, v_state, v_departing, v_interval
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_state = 'settled' THEN
    RETURN;
  END IF;
  IF v_state <> 'departing' THEN
    RAISE EXCEPTION 'only a departing placement may settle' USING ERRCODE = 'PT409';
  END IF;
  IF v_interval IS NULL
     OR pg_catalog.now() < v_departing + pg_catalog.make_interval(secs => v_interval) THEN
    RAISE EXCEPTION 'the departure interval has not elapsed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.placements
  SET state = 'settled', settled_at = pg_catalog.now()
  WHERE id = p_placement_id AND state = 'departing';
END $fn$;
