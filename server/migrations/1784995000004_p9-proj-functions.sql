-- Up Migration
--
-- P9-D — the projection worker surface (decision 0011 Q12, B.1, B.2, B.3, B.5,
-- C4, containment ruling).
--
-- Three owner-owned functions. selves_worker's EXECUTE surface is EXACTLY
-- process_outbox(integer) and outbox_depth() — nothing else (Q12).
-- rebuild_graph is granted to NO login role: it TRUNCATEs, and a destructive
-- truncation belongs outside every network-reachable credential; it is invoked
-- via selves_migrate SET ROLE as a deliberate operator action.
--
-- Containment (0011, ruled law): these functions return SCALARS ONLY. No row,
-- payload, recipient identity, Self id, or artifact content crosses the
-- function boundary into the worker process. Cross-account computation lives
-- entirely inside these selves_owner-owned bodies; the worker role holds zero
-- table privileges and cannot establish acting-Self context.
--
-- Runs as selves_migrate with current_user=selves_owner.

-- ── process_outbox ────────────────────────────────────────────────────────────
-- Claims by PREDICATE, never by stored position (B.2): the claim query filters
-- on (processed_at IS NULL AND failed_at IS NULL) and re-evaluates it on every
-- pass — no high-water mark, no cursor, no last-seen id. A late-committing
-- lower id is picked up on a subsequent pass precisely because nothing advanced
-- past it. ORDER BY id is deterministic traversal only; Phase 9 claims no
-- semantic ordering guarantee, and the existence-only edge derivation is
-- commutative and idempotent, so out-of-order and duplicate application are
-- harmless by construction.
--
-- Each event is applied in its own inner block (subtransaction): a failing
-- apply rolls back only that event's derivation, then the handler increments
-- attempts (a count of FAILED attempts), records last_error, and dead-letters
-- at the threshold by setting failed_at (B.3). The queue proceeds past a poison
-- event — no head-of-line blocking. All exceptions count toward dead-lettering,
-- including transient faults — an accepted operational property (C4): rebuild
-- or owner-run revival recovers the effect; authoritative records remain
-- ground truth throughout.
--
-- c_max_attempts is the dead-lettering threshold: OWNER-SIDE, single-sourced,
-- never a parameter (B.5) — the sole occurrence of the literal in the codebase.
-- Resources may be named by the caller; authority may not be (0010 §2).
--
-- The derivation guard re-checks the AUTHORITATIVE row: state='settled' AND the
-- positive enumeration of ratified payload types (Q2/Q13) — a forged or stale
-- event whose placement does not qualify derives nothing (zero rows) and is
-- consumed without effect. The event payload is only a pointer; no derivation
-- reads facts from it.
CREATE FUNCTION proj.process_outbox(p_limit integer, OUT processed integer, OUT failed integer)
RETURNS record LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  c_max_attempts CONSTANT integer := 5;   -- B.5: sole occurrence of the threshold
  v_event RECORD;
  v_placement_id uuid;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'limit must be a positive integer' USING ERRCODE = 'PT400';
  END IF;
  processed := 0;
  failed := 0;
  FOR v_event IN
    SELECT e.id, e.event_type, e.payload, e.attempts
      FROM public.outbox_events e
     WHERE e.processed_at IS NULL
       AND e.failed_at IS NULL
     ORDER BY e.id
     LIMIT p_limit
       FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      IF v_event.event_type <> 'placement_settled' THEN
        RAISE EXCEPTION 'unknown event type';   -- Q13: sole ratified type; default-deny
      END IF;
      v_placement_id := (v_event.payload ->> 'placement_id')::uuid;
      IF v_placement_id IS NULL THEN
        RAISE EXCEPTION 'payload missing placement_id';
      END IF;
      -- Phase-9 derivation (Q2/Q13): POSITIVE ENUMERATION of ratified emitting
      -- payload types. Default-deny: a payload type absent from this list
      -- derives nothing until a ruling adds it.
      INSERT INTO proj.graph_edges (sender_self_id, recipient_self_id)
      SELECT p.sender_self_id, r.recipient_self_id
        FROM public.placements p
        JOIN public.placement_recipients r ON r.placement_id = p.id
       WHERE p.id = v_placement_id
         AND p.state = 'settled'
         AND p.payload_type IN ('text')
      ON CONFLICT DO NOTHING;
      UPDATE public.outbox_events SET processed_at = pg_catalog.now()
       WHERE id = v_event.id;
      processed := processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.outbox_events
         SET attempts   = v_event.attempts + 1,
             last_error = SQLERRM,
             failed_at  = CASE WHEN v_event.attempts + 1 >= c_max_attempts
                               THEN pg_catalog.now() ELSE NULL END
       WHERE id = v_event.id;
      failed := failed + 1;
    END;
  END LOOP;
END $fn$;

-- ── outbox_depth ──────────────────────────────────────────────────────────────
-- Infrastructure telemetry only (0011 B.4 closed classification): queue depth,
-- dead-letter count, oldest-unclaimed age. Scalars; no ids, no payloads.
CREATE FUNCTION proj.outbox_depth(OUT unclaimed bigint, OUT dead bigint, OUT oldest_unclaimed_age interval)
RETURNS record LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT count(*) FILTER (WHERE e.processed_at IS NULL AND e.failed_at IS NULL),
         count(*) FILTER (WHERE e.failed_at IS NOT NULL),
         pg_catalog.now() - min(e.occurred_at) FILTER (WHERE e.processed_at IS NULL AND e.failed_at IS NULL)
    FROM public.outbox_events e;
$fn$;

-- ── rebuild_graph ─────────────────────────────────────────────────────────────
-- Destroys and deterministically recomputes the projection from AUTHORITATIVE
-- records. B.1: rebuild state and delivery state are different facts and must
-- never be written by the same operation — this body reads, writes, and clears
-- NO column of public.outbox_events. Ratified invariant: rebuild and process
-- are independent and composable in any order; after a rebuild, unprocessed
-- events remain unprocessed and idempotent apply converges to identical state.
CREATE FUNCTION proj.rebuild_graph()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  TRUNCATE proj.graph_edges;
  INSERT INTO proj.graph_edges (sender_self_id, recipient_self_id)
  -- Phase-9 derivation (Q2/Q13): POSITIVE ENUMERATION of ratified emitting
  -- payload types. Default-deny: a payload type absent from this list derives
  -- nothing until a ruling adds it.
  SELECT DISTINCT p.sender_self_id, r.recipient_self_id
    FROM public.placements p
    JOIN public.placement_recipients r ON r.placement_id = p.id
   WHERE p.state = 'settled'
     AND p.payload_type IN ('text');
END $fn$;

-- ── grants: worker surface is exactly two functions ───────────────────────────
REVOKE ALL ON FUNCTION
  proj.process_outbox(integer),
  proj.outbox_depth(),
  proj.rebuild_graph()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  proj.process_outbox(integer),
  proj.outbox_depth()
TO selves_worker;

-- rebuild_graph: granted to NO login role (Q12).

-- Down Migration
DROP FUNCTION proj.rebuild_graph();
DROP FUNCTION proj.outbox_depth();
DROP FUNCTION proj.process_outbox(integer);
