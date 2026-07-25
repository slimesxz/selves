-- Up Migration
--
-- P9-B — outbox delivery-state delta (decision 0011 Q11 / B.3).
--
-- Terminal failure becomes a DISTINCT state: processed_at IS NULL no longer
-- conflates "pending" with "permanently failed". failed_at is the terminal
-- dead-letter marker; the CHECK forbids an event ever being both delivered and
-- dead. The claim predicate everywhere (index, claim query, outbox_depth) is:
--
--   processed_at IS NULL AND failed_at IS NULL
--
-- The partial index below matches that predicate EXACTLY (0011 Q11) and is the
-- unprocessed-poll index 0003 explicitly deferred to Phase 9. attempts counts
-- FAILED application attempts; last_error records the most recent failure. A
-- dead-lettered event is never deleted; revival (clearing failed_at, resetting
-- attempts) is owner-run SQL under selves_migrate SET ROLE only (0011 B.3) —
-- no login role holds a recovery path.
--
-- RLS posture unchanged: outbox_events remains RLS-enabled with no policy (R6,
-- P8-D); no login role holds any privilege on it. Runs as selves_migrate with
-- current_user=selves_owner.

ALTER TABLE public.outbox_events
  ADD COLUMN last_error text,
  ADD COLUMN failed_at  timestamptz;

ALTER TABLE public.outbox_events
  ADD CONSTRAINT outbox_events_terminal_exclusive
    CHECK (processed_at IS NULL OR failed_at IS NULL);

CREATE INDEX outbox_events_unclaimed
  ON public.outbox_events (id)
  WHERE processed_at IS NULL AND failed_at IS NULL;

-- Down Migration
DROP INDEX public.outbox_events_unclaimed;
ALTER TABLE public.outbox_events DROP CONSTRAINT outbox_events_terminal_exclusive;
ALTER TABLE public.outbox_events DROP COLUMN failed_at;
ALTER TABLE public.outbox_events DROP COLUMN last_error;
