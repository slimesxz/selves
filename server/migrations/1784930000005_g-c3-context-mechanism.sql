-- Up Migration
--
-- P8 G — C3 acting-Self context mechanism (decision 0009 §§2–3, ratifying 0008
-- R4-B). The acting Self is established by an owner-run SECURITY DEFINER setter,
-- gated on the existing session fact, and written to an owner-owned context store
-- on which selves_app holds NO privilege. Policies (step I) obtain the acting Self
-- through an owner-run STABLE helper. Context is bound to BOTH pg_backend_pid() and
-- the establishing transaction's xid8; absent or mismatched context denies.
--
-- Runs as selves_migrate with current_user=selves_owner, so every object below is
-- owned by selves_owner.

-- ── the context store ─────────────────────────────────────────────────────────
-- One OPERATIONAL row per backend, replaced in place — never a history (0009 §3.2):
-- no append, no set_at column, no archival, no trigger writing elsewhere. Table
-- size is bounded by ~max_connections. backend_pid is the PK (the only indexed
-- column); txid and acting_self are unindexed so UPDATEs are HOT-eligible. An
-- explicitly lowered fillfactor leaves in-page headroom for HOT chains, and
-- per-table aggressive autovacuum keeps the tiny, very hot table's dead tuples
-- bounded (0009 §3.3).
CREATE TABLE domain.acting_self_context (
  backend_pid integer PRIMARY KEY,
  txid        xid8    NOT NULL,
  acting_self uuid    NOT NULL
) WITH (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor  = 0,
  autovacuum_vacuum_threshold     = 25,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold    = 25
);

-- selves_app is granted NOTHING on the store. Enable RLS with no policy as
-- defense in depth, so a future accidental grant still fails closed. The setter
-- and helper run as selves_owner and bypass this (unforced) RLS by ownership.
ALTER TABLE domain.acting_self_context ENABLE ROW LEVEL SECURITY;

-- ── the setter (the door) ─────────────────────────────────────────────────────
-- Establishes the acting Self for the current transaction. Trust chain (0009 §2,
-- R4-B): anchor = the auth.sessions fact (selves_app cannot forge it — no direct
-- privilege on auth.sessions); trusted writer = this DEFINER function; the
-- contained role cannot write the store directly; lifetime = the establishing
-- (backend, xid) only.
--
-- p_session_token is the session token HASH, passed ONLY as a bind parameter — it
-- never appears in statement text (0009 §3.4).
--
-- Order of checks:
--   1. Assign the current transaction's xid (pg_current_xact_id) up front.
--   2. WRITE-ONCE: if a context row for this backend already carries THIS xid, a
--      second establishment is injected re-pointing → RAISE (never overwrite,
--      never a silent no-op). Replacement is permitted only across transactions
--      (a stored row whose xid differs) (0009 §3.1).
--   3. Authenticate the session → account. On failure: opaque 28000.
--   4. Validate the requested Self belongs to that account (selection, not sibling
--      authority). On failure: the SAME opaque 28000 — no credential oracle.
--   5. Fix the exact requested Self, replacing any stale (different-xid) row.
CREATE FUNCTION domain.set_acting_self(p_session_token bytea, p_requested_self uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_backend      integer := pg_catalog.pg_backend_pid();
  v_xid          xid8    := pg_catalog.pg_current_xact_id();  -- assigns the tx xid
  v_existing_xid xid8;
  v_account      uuid;
BEGIN
  -- (2) write-once within the same (backend, xid)
  SELECT c.txid INTO v_existing_xid
    FROM domain.acting_self_context c WHERE c.backend_pid = v_backend;
  IF FOUND AND v_existing_xid = v_xid THEN
    RAISE EXCEPTION 'acting-self context already established for this transaction'
      USING ERRCODE = 'PT409';
  END IF;

  -- (3) session -> account (opaque on failure)
  v_account := auth.authenticate_session(p_session_token);
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'context establishment failed' USING ERRCODE = '28000';
  END IF;

  -- (4) requested Self must belong to that account — SAME opaque failure, no oracle
  IF NOT EXISTS (
    SELECT 1 FROM public.selves s WHERE s.id = p_requested_self AND s.account_id = v_account
  ) THEN
    RAISE EXCEPTION 'context establishment failed' USING ERRCODE = '28000';
  END IF;

  -- (5) fix the exact acting Self; replace only a stale (cross-transaction) row
  INSERT INTO domain.acting_self_context (backend_pid, txid, acting_self)
  VALUES (v_backend, v_xid, p_requested_self)
  ON CONFLICT (backend_pid) DO UPDATE
    SET txid = EXCLUDED.txid, acting_self = EXCLUDED.acting_self;
END $fn$;

-- ── the lookup helper (policy-facing) ─────────────────────────────────────────
-- Returns the acting Self ONLY if a stored row matches BOTH the current backend
-- AND the current transaction's xid8. Absent context, a stale row (different xid),
-- or no assigned xid (a read-only transaction that never established context) all
-- yield NULL → every policy keyed on this denies (equality with NULL is not true).
-- pg_current_xact_id_if_assigned() returns NULL rather than assigning an xid, so a
-- read that forgot to establish context fails closed instead of silently matching.
CREATE FUNCTION domain.current_acting_self()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT c.acting_self
    FROM domain.acting_self_context c
   WHERE c.backend_pid = pg_catalog.pg_backend_pid()
     AND c.txid = pg_catalog.pg_current_xact_id_if_assigned();
$fn$;

REVOKE EXECUTE ON FUNCTION
  domain.set_acting_self(bytea, uuid),
  domain.current_acting_self()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  domain.set_acting_self(bytea, uuid),
  domain.current_acting_self()
TO selves_app;

-- Down Migration
DROP FUNCTION domain.current_acting_self();
DROP FUNCTION domain.set_acting_self(bytea, uuid);
DROP TABLE domain.acting_self_context;
