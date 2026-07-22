-- Up Migration

-- Transactional outbox. In Phase 9 a settlement will append an event here in
-- the SAME transaction that settles the Placement, and an idempotent worker
-- will derive Graph/Signal/Prism projections from settled facts only. This
-- phase creates the minimal outbox contract — an ordered, append-only event log
-- with a processed marker — and nothing worker-specific:
--   * a monotonic bigint identity gives insertion order for the worker;
--   * processed_at NULL = unprocessed; attempts supports at-least-once retries.
-- Retry/backoff/dead-letter refinement and the unprocessed-poll index are
-- deferred to Phase 9 (no worker exists yet — invariant 13, no speculative
-- indexes). event_type stays free text until the event vocabulary is ruled;
-- a premature enum would churn.
CREATE TABLE outbox_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type  text NOT NULL,
  payload     jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  CONSTRAINT outbox_events_type_present CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT outbox_events_attempts_nonneg CHECK (attempts >= 0)
);

-- Down Migration
DROP TABLE outbox_events;
