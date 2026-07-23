-- Up Migration
--
-- P6-B — the domain mutation surface (decision 0006). Extends the exclusive
-- SECURITY DEFINER write boundary ratified in 0004 to the ontology tables. NO
-- login role holds direct INSERT/UPDATE/DELETE on any table; every mutation flows
-- through a SECURITY DEFINER function owned by selves_owner (search_path='', fully
-- qualified). selves_app gains only EXECUTE on these functions. All state-machine
-- locking lives inside the functions (SELECT ... FOR UPDATE on the stable
-- placement row), invoked as single statements through the app's plain Queryable
-- — so the Phase-5 mechanical-boundary positive locks (pg / raw-pool importers)
-- are untouched.
--
-- These functions live in a NEW hardened `domain` schema (ruling 8), never in
-- `auth` — the auth inventory stays fixed at 11 (0004).
--
-- Error signalling uses custom SQLSTATEs mapped to the ratified split (ruling 7):
--   PT404 → 404 (unauthorized OR absent — indistinguishable, non-leakage);
--   PT409 → 409 (authorized actor, wrong state / conflict / floor not elapsed);
--   PT400 → 400 (malformed input).
-- Table CHECK/FK violations (23514 / 23503) surface structurally and map to 400.
-- Runs as selves_migrate with current_user=selves_owner, so every object below is
-- owned by selves_owner.

CREATE SCHEMA domain;

-- ── create_artifact ───────────────────────────────────────────────────────────
-- The acting Self authors its own text Artifact. author_self_id is bound to the
-- acting Self (never client-supplied). payload_type is fixed 'text' (slice scope;
-- the artifacts CHECK enforces it a fortiori). Empty body → 23514 → 400.
CREATE FUNCTION domain.create_artifact(p_acting_self uuid, p_text_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.artifacts (author_self_id, payload_type, text_body)
  VALUES (p_acting_self, 'text', p_text_body)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- ── create_placement_draft ────────────────────────────────────────────────────
-- Sender must equal the Artifact's author (ruling 5). A non-author or an absent
-- artifact are indistinguishable → PT404 (non-leakage). The new Placement is a
-- draft with zero recipients (permitted while draft; ruling 4).
CREATE FUNCTION domain.create_placement_draft(p_acting_self uuid, p_artifact_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_author uuid; v_id uuid;
BEGIN
  SELECT author_self_id INTO v_author FROM public.artifacts WHERE id = p_artifact_id;
  IF NOT FOUND OR v_author <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO public.placements (sender_self_id, artifact_id)
  VALUES (p_acting_self, p_artifact_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- ── add_recipient ─────────────────────────────────────────────────────────────
-- Sender-only, draft-only. Any explicitly selected Self may be a recipient,
-- including the sending Self itself and sibling Selves (ruling 6) — the FK only
-- requires the recipient to be a real Self (unknown recipient → 23503 → 400).
-- Idempotent: re-adding an existing recipient is a no-op (ON CONFLICT DO NOTHING).
CREATE FUNCTION domain.add_recipient(p_acting_self uuid, p_placement_id uuid, p_recipient_self uuid)
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

-- ── remove_recipient ──────────────────────────────────────────────────────────
-- Sender-only, draft-only. Idempotent: removing an absent recipient is a no-op.
CREATE FUNCTION domain.remove_recipient(p_acting_self uuid, p_placement_id uuid, p_recipient_self uuid)
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
  DELETE FROM public.placement_recipients
  WHERE placement_id = p_placement_id AND recipient_self_id = p_recipient_self;
END $fn$;

-- ── begin_departure ───────────────────────────────────────────────────────────
-- Sender-only, draft → departing. Requires ≥1 explicit recipient (ruling 4).
-- Snapshots the account's CURRENT interval onto the Placement (ruling 3); the
-- guard trigger makes that snapshot immutable thereafter.
CREATE FUNCTION domain.begin_departure(p_acting_self uuid, p_placement_id uuid)
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

-- ── cancel_placement ──────────────────────────────────────────────────────────
-- Sender-only, departing → cancelled. Idempotent on an already-cancelled
-- Placement; any other non-departing state is a conflict. The FOR UPDATE lock is
-- the cancel-vs-settle serialization point: the first to commit wins; the loser,
-- re-reading state under the lock, gets PT409.
CREATE FUNCTION domain.cancel_placement(p_acting_self uuid, p_placement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_sender uuid; v_state public.placement_state;
BEGIN
  SELECT sender_self_id, state INTO v_sender, v_state
  FROM public.placements WHERE id = p_placement_id FOR UPDATE;
  IF NOT FOUND OR v_sender <> p_acting_self THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
  IF v_state = 'cancelled' THEN
    RETURN;  -- idempotent
  END IF;
  IF v_state <> 'departing' THEN
    RAISE EXCEPTION 'only a departing placement may be cancelled' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.placements
  SET state = 'cancelled', cancelled_at = pg_catalog.now()
  WHERE id = p_placement_id AND state = 'departing';
END $fn$;

-- ── settle_placement ──────────────────────────────────────────────────────────
-- Sender-only, departing → settled, gated by the server-enforced interval floor:
-- now() ≥ departing_at + snapshotted interval. Idempotent on an already-settled
-- Placement. A premature settle (floor not elapsed) is a conflict (PT409), not a
-- silent success. Kept a SINGLE-statement DEFINER function so the Phase-9
-- transactional-outbox INSERT can later attach INSIDE this same function/
-- transaction with no redesign.
CREATE FUNCTION domain.settle_placement(p_acting_self uuid, p_placement_id uuid)
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
  -- Phase 9: INSERT INTO public.outbox_events (...) attaches HERE, same transaction.
END $fn$;

-- ── set_departure_interval ────────────────────────────────────────────────────
-- The departure interval is an ACCOUNT-level setting, so its authority is the
-- AUTHENTICATED ACCOUNT — never the acting Self. This function takes the account
-- id directly (the caller supplies req.account, the same verified authentication
-- context the auth subsystem uses); it does NOT accept an acting Self and does NOT
-- resolve the acting-Self header back to an account. Bounded-list validation
-- rejects out-of-list values with PT400 (ruling 3/7). Last-writer-wins for a
-- simple setting; no serialization beyond the single-row update. Does NOT affect
-- any in-progress departure (those carry their own snapshot).
CREATE FUNCTION domain.set_departure_interval(p_account uuid, p_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF p_seconds NOT IN (5, 10, 30, 60) THEN
    RAISE EXCEPTION 'interval must be one of 5, 10, 30, 60 seconds' USING ERRCODE = 'PT400';
  END IF;
  UPDATE public.accounts SET departure_interval_seconds = p_seconds WHERE id = p_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'PT404';
  END IF;
END $fn$;

-- ── grants: schema usage + exclusive EXECUTE (auth-migration pattern) ──────────
GRANT USAGE ON SCHEMA domain TO selves_app;

REVOKE EXECUTE ON FUNCTION
  domain.create_artifact(uuid, text),
  domain.create_placement_draft(uuid, uuid),
  domain.add_recipient(uuid, uuid, uuid),
  domain.remove_recipient(uuid, uuid, uuid),
  domain.begin_departure(uuid, uuid),
  domain.cancel_placement(uuid, uuid),
  domain.settle_placement(uuid, uuid),
  domain.set_departure_interval(uuid, integer)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  domain.create_artifact(uuid, text),
  domain.create_placement_draft(uuid, uuid),
  domain.add_recipient(uuid, uuid, uuid),
  domain.remove_recipient(uuid, uuid, uuid),
  domain.begin_departure(uuid, uuid),
  domain.cancel_placement(uuid, uuid),
  domain.settle_placement(uuid, uuid),
  domain.set_departure_interval(uuid, integer)
TO selves_app;

-- Down Migration
DROP SCHEMA domain CASCADE;
