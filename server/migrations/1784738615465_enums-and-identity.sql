-- Up Migration

-- Frozen payload membership (AGENTS.md §3.9 / §4). This enum declares the
-- closed set; it is never extended without a ruling. Individual tables
-- restrict which members they accept (artifacts implements only 'text' for
-- the vertical slice; 'key' is a capability, never an artifact row).
CREATE TYPE payload_type AS ENUM ('text', 'photo', 'poll', 'gift', 'key');

-- Placement lifecycle. Primary sequence draft -> departing -> settled
-- (AGENTS.md §5). 'cancelled' is the fourth, terminal state reached ONLY
-- from 'departing' (ruling D1, Option A). Labels are lowercase by SQL
-- convention; they map 1:1 to §5's Draft/Departing/Settled/Cancelled.
CREATE TYPE placement_state AS ENUM ('draft', 'departing', 'settled', 'cancelled');

-- One person / login. Authentication columns are deliberately absent here;
-- they arrive in Phase 4. An account is the anchor a Self belongs to.
CREATE TABLE accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A Self belongs to exactly one account (invariant 1: account_id NOT NULL FK).
--
-- The "maximum 3 Selves per user" law (AGENTS.md §3.1) is enforced at the
-- authoritative layer, not the UI (invariant 2), by a slot device:
--   * self_slot is constrained to 1..3, and
--   * UNIQUE(account_id, self_slot) makes a fourth Self impossible.
-- This is fully declarative and race-free: two concurrent inserts competing
-- for the same free slot collide on the unique index and one fails. The slot
-- is an internal cap mechanism only and is never exposed in the UI.
CREATE TABLE selves (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id),
  self_slot  smallint NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT selves_slot_range CHECK (self_slot BETWEEN 1 AND 3),
  CONSTRAINT selves_name_present CHECK (length(btrim(name)) > 0),
  CONSTRAINT selves_one_per_slot UNIQUE (account_id, self_slot)
);

-- Query path: list / switch the Selves of an account (invariant 13).
CREATE INDEX selves_account_id_idx ON selves (account_id);

-- Down Migration
DROP TABLE selves;
DROP TABLE accounts;
DROP TYPE placement_state;
DROP TYPE payload_type;
