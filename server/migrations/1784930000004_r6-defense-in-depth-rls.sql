-- Up Migration
--
-- P8 R6 (decision records 0008 R6 / 0009) — defense-in-depth RLS enables.
--
-- selves_app already holds NO direct privilege on any of these tables (proven by
-- authz-privileges and auth-schema). Enabling RLS therefore grants nothing and
-- changes no current behavior; it makes a FUTURE accidental table grant fail
-- closed (zero rows) instead of leaking. All legitimate access continues through
-- the SECURITY DEFINER functions owned by selves_owner, which bypass this
-- (unforced) RLS by ownership.
--
-- Enable, with NO application policy, on:
--   * auth.account_credentials   (credential register; DEFINER-only)
--   * auth.sessions              (session register; DEFINER-only)
--   * public.accounts            (app holds nothing; DEFINER-mediated)
--   * public.outbox_events       (Phase-9 projection substrate; app holds nothing)
--
-- Deliberately NOT enabled on public.pgmigrations: the absence of any grant is
-- already the control, and the ledger is read by the migration tooling, not the
-- application (0008 R6). selves_worker receives NO Phase-8 privilege change; it
-- remains CONNECT-only. No FORCE ROW LEVEL SECURITY anywhere (R8).
--
-- Runs as selves_migrate with current_user=selves_owner.

ALTER TABLE auth.account_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events     ENABLE ROW LEVEL SECURITY;

-- Down Migration
ALTER TABLE public.outbox_events     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts          DISABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions            DISABLE ROW LEVEL SECURITY;
ALTER TABLE auth.account_credentials DISABLE ROW LEVEL SECURITY;
