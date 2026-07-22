-- Up Migration
--
-- P4-B — Authentication infrastructure. Lives in a dedicated `auth` schema so
-- the seven authoritative `public` tables (the ontology) are physically separate
-- from auth infra. Runs as selves_migrate with current_user=selves_owner, so
-- every object is owned by selves_owner.
--
-- EXCLUSIVE WRITE BOUNDARY: no callable role holds direct INSERT/UPDATE/DELETE on
-- these tables. Every mutation flows through a SECURITY DEFINER function owned by
-- selves_owner (search_path='' + fully-qualified names). The only direct table
-- grant is selves_app's column-scoped SELECT on public.selves.
--
-- STABLE SERIALIZATION: issuance and every credential active-state transition take
-- FOR NO KEY UPDATE on the stable public.accounts row (a replaceable credential
-- row cannot be a serialization point).

CREATE SCHEMA auth;

-- ── credentials ──────────────────────────────────────────────────────────────
-- id-keyed (not account-keyed) so rotation keeps historical rows. one_active
-- guarantees at most one active credential per account.
CREATE TABLE auth.account_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts (id),
  credential_hash bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz NULL,
  CONSTRAINT account_credentials_hash_len       CHECK (octet_length(credential_hash) = 32),   -- SHA-256
  CONSTRAINT account_credentials_created_finite  CHECK (isfinite(created_at)),
  CONSTRAINT account_credentials_disabled_finite CHECK (disabled_at IS NULL OR isfinite(disabled_at)),
  CONSTRAINT account_credentials_disabled_after_created
    CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);
CREATE UNIQUE INDEX account_credentials_hash_key   ON auth.account_credentials (credential_hash);
CREATE UNIQUE INDEX account_credentials_one_active ON auth.account_credentials (account_id) WHERE disabled_at IS NULL;
CREATE INDEX        account_credentials_acct_idx   ON auth.account_credentials (account_id);

-- ── sessions ─────────────────────────────────────────────────────────────────
-- Lifetime is exactly 604800 elapsed seconds (make_interval(secs=>...)), NOT
-- seven calendar days; enforced by trigger. Identity/lifetime immutable; revoke
-- one-way. No last_seen (Presence avoidance).
CREATE TABLE auth.sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (id),
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,          -- filled/validated by trigger to created_at + 604800s
  revoked_at timestamptz NULL,
  CONSTRAINT sessions_token_hash_len       CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_created_finite       CHECK (isfinite(created_at)),
  CONSTRAINT sessions_expires_finite       CHECK (isfinite(expires_at)),
  CONSTRAINT sessions_revoked_finite       CHECK (revoked_at IS NULL OR isfinite(revoked_at)),
  CONSTRAINT sessions_revoked_after_created CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE UNIQUE INDEX sessions_token_hash_key ON auth.sessions (token_hash);
CREATE INDEX        sessions_acct_idx       ON auth.sessions (account_id);

-- ── trigger functions (SECURITY INVOKER; search_path='') ─────────────────────
CREATE FUNCTION auth.tg_sessions_set_expiry() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NEW.created_at + pg_catalog.make_interval(secs => 604800);
  ELSIF NEW.expires_at <> NEW.created_at + pg_catalog.make_interval(secs => 604800) THEN
    RAISE EXCEPTION 'session lifetime must be exactly 604800s from created_at' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;

CREATE FUNCTION auth.tg_sessions_guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id OR NEW.token_hash <> OLD.token_hash
     OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'session identity/lifetime is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'revocation is one-way and final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;

CREATE FUNCTION auth.tg_credentials_guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id
     OR NEW.credential_hash <> OLD.credential_hash OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'credential identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
    RAISE EXCEPTION 'disablement is one-way and final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER sessions_set_expiry     BEFORE INSERT ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION auth.tg_sessions_set_expiry();
CREATE TRIGGER sessions_guard_update   BEFORE UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION auth.tg_sessions_guard_update();
CREATE TRIGGER credentials_guard_update BEFORE UPDATE ON auth.account_credentials
  FOR EACH ROW EXECUTE FUNCTION auth.tg_credentials_guard_update();

-- ── callable functions (SECURITY DEFINER; owner=selves_owner; search_path='') ──

-- Verify a presented session token (read-only). NULL for absent/revoked/expired.
CREATE FUNCTION auth.authenticate_session(p_token_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' STABLE AS $fn$
DECLARE v_account uuid;
BEGIN
  SELECT s.account_id INTO v_account FROM auth.sessions s
   WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > pg_catalog.now();
  RETURN v_account;
END $fn$;

-- Login: resolve account from the credential, LOCK the account, re-verify the
-- credential under the lock, then insert the session.
CREATE FUNCTION auth.issue_session(p_credential_hash bytea, p_token_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_account uuid; v_session uuid;
BEGIN
  SELECT ac.account_id INTO v_account FROM auth.account_credentials ac
   WHERE ac.credential_hash = p_credential_hash AND ac.disabled_at IS NULL;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  PERFORM 1 FROM public.accounts WHERE id = v_account FOR NO KEY UPDATE;          -- stable serialization point
  PERFORM 1 FROM auth.account_credentials
   WHERE credential_hash = p_credential_hash AND disabled_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  INSERT INTO auth.sessions (account_id, token_hash) VALUES (v_account, p_token_hash) RETURNING id INTO v_session;
  RETURN v_session;
END $fn$;

-- Logout: revoke exactly the session bearing this token hash. Idempotent.
-- 1 = revoked now; 0 = unknown or already revoked (indistinguishable).
CREATE FUNCTION auth.revoke_session(p_token_hash bytea) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v int;
BEGIN
  UPDATE auth.sessions SET revoked_at = pg_catalog.now()
   WHERE token_hash = p_token_hash AND revoked_at IS NULL;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $fn$;

-- Enrollment: account + initial Self (slot 1) + first credential, atomically.
-- p_account_id is the operator-recorded, nonsecret reference. Returns credential_id.
CREATE FUNCTION auth.enroll_account(p_account_id uuid, p_self_name text, p_credential_hash bytea)
RETURNS TABLE (account_id uuid, self_id uuid, credential_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_self uuid; v_cred uuid;
BEGIN
  INSERT INTO public.accounts (id) VALUES (p_account_id);
  INSERT INTO public.selves (account_id, self_slot, name) VALUES (p_account_id, 1, p_self_name) RETURNING id INTO v_self;
  INSERT INTO auth.account_credentials (account_id, credential_hash) VALUES (p_account_id, p_credential_hash) RETURNING id INTO v_cred;
  account_id := p_account_id; self_id := v_self; credential_id := v_cred;
  RETURN NEXT;
END $fn$;

-- Rotation: compare-and-swap against the expected active credential id. One winner;
-- a stale expectation fails with 40001 and no mutation. No automatic retry.
CREATE FUNCTION auth.rotate_credential(p_account uuid, p_expected_active_id uuid, p_new_hash bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_active_id uuid; v_id uuid;
BEGIN
  PERFORM 1 FROM public.accounts WHERE id = p_account FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'no_data_found'; END IF;
  SELECT id INTO v_active_id FROM auth.account_credentials WHERE account_id = p_account AND disabled_at IS NULL;
  IF v_active_id IS NULL OR v_active_id <> p_expected_active_id THEN
    RAISE EXCEPTION 'rotation precondition failed: active credential changed' USING ERRCODE = '40001';
  END IF;
  UPDATE auth.account_credentials SET disabled_at = pg_catalog.now() WHERE id = v_active_id;
  INSERT INTO auth.account_credentials (account_id, credential_hash) VALUES (p_account, p_new_hash) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- Ordinary disablement: disable the active credential; does NOT revoke sessions.
CREATE FUNCTION auth.disable_credential(p_account uuid)
RETURNS TABLE (credentials_disabled integer, already_disabled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v int;
BEGIN
  PERFORM 1 FROM public.accounts WHERE id = p_account FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'no_data_found'; END IF;
  UPDATE auth.account_credentials SET disabled_at = pg_catalog.now()
   WHERE account_id = p_account AND disabled_at IS NULL;
  GET DIAGNOSTICS v = ROW_COUNT;
  credentials_disabled := v; already_disabled := (v = 0);
  RETURN NEXT;
END $fn$;

-- Ambiguous-enrollment recovery: narrowly confined. Requires the account to hold
-- exactly ONE historical credential and for it to be active. One-winner (a second
-- concurrent recovery sees >1 credential row and fails). Not a blind rotation.
CREATE FUNCTION auth.recover_enrollment_credential(p_account uuid, p_new_hash bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_total int; v_active_id uuid; v_id uuid;
BEGIN
  PERFORM 1 FROM public.accounts WHERE id = p_account FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'no_data_found'; END IF;
  SELECT count(*) INTO v_total FROM auth.account_credentials WHERE account_id = p_account;
  IF v_total <> 1 THEN
    RAISE EXCEPTION 'recovery requires exactly one historical credential, found %', v_total USING ERRCODE = 'check_violation';
  END IF;
  SELECT id INTO v_active_id FROM auth.account_credentials WHERE account_id = p_account AND disabled_at IS NULL;
  IF v_active_id IS NULL THEN
    RAISE EXCEPTION 'recovery requires the sole credential to be active' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE auth.account_credentials SET disabled_at = pg_catalog.now() WHERE id = v_active_id;
  INSERT INTO auth.account_credentials (account_id, credential_hash) VALUES (p_account, p_new_hash) RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- Compromise containment (operator only): atomically disable the active credential
-- AND revoke every unrevoked session. Structured result; errors on unknown account.
CREATE FUNCTION auth.contain_account(p_account uuid)
RETURNS TABLE (credentials_disabled integer, sessions_revoked integer, already_contained boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_cred int; v_sess int;
BEGIN
  PERFORM 1 FROM public.accounts WHERE id = p_account FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'no_data_found'; END IF;
  UPDATE auth.account_credentials SET disabled_at = pg_catalog.now()
   WHERE account_id = p_account AND disabled_at IS NULL;
  GET DIAGNOSTICS v_cred = ROW_COUNT;
  UPDATE auth.sessions SET revoked_at = pg_catalog.now()
   WHERE account_id = p_account AND revoked_at IS NULL;
  GET DIAGNOSTICS v_sess = ROW_COUNT;
  credentials_disabled := v_cred; sessions_revoked := v_sess;
  already_contained := (v_cred = 0 AND v_sess = 0);
  RETURN NEXT;
END $fn$;

-- ── grants: schema usage, the single direct read, exclusive EXECUTE ───────────
GRANT USAGE ON SCHEMA auth TO selves_app, selves_bootstrap, selves_operator;
GRANT USAGE ON SCHEMA public TO selves_app;
GRANT SELECT (id, account_id, name, self_slot) ON public.selves TO selves_app;

-- EXECUTE: revoke the PUBLIC default, grant only the approved role per function.
REVOKE EXECUTE ON FUNCTION
  auth.tg_sessions_set_expiry(), auth.tg_sessions_guard_update(), auth.tg_credentials_guard_update(),
  auth.authenticate_session(bytea), auth.issue_session(bytea, bytea), auth.revoke_session(bytea),
  auth.enroll_account(uuid, text, bytea), auth.rotate_credential(uuid, uuid, bytea),
  auth.disable_credential(uuid), auth.recover_enrollment_credential(uuid, bytea),
  auth.contain_account(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  auth.authenticate_session(bytea), auth.issue_session(bytea, bytea), auth.revoke_session(bytea)
TO selves_app;
GRANT EXECUTE ON FUNCTION
  auth.enroll_account(uuid, text, bytea), auth.rotate_credential(uuid, uuid, bytea),
  auth.disable_credential(uuid), auth.recover_enrollment_credential(uuid, bytea)
TO selves_bootstrap;
GRANT EXECUTE ON FUNCTION auth.contain_account(uuid) TO selves_operator;

-- Down Migration
REVOKE SELECT (id, account_id, name, self_slot) ON public.selves FROM selves_app;
REVOKE USAGE ON SCHEMA public FROM selves_app;
DROP SCHEMA auth CASCADE;
