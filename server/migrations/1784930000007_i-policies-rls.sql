-- Up Migration
--
-- P8 I — acting-Self-dependent SELECT policies + RLS enablement on the three
-- ontology tables selves_app reads directly (decision 0008 §4.2 held surface / 0009).
--
-- Each policy is explicitly PERMISSIVE (F2): multiple permissive policies OR, so an
-- Artifact is visible if ANY ground holds (author ∪ settled-recipient ∪ valid-Key);
-- a Placement if author ∪ (settled ∧ explicit recipient). A RESTRICTIVE policy
-- would silently intersect the union — never used here.
--
-- No policy references a second table inline (R3 standing law): every cross-table
-- fact goes through an owner-run SECURITY DEFINER STABLE boolean helper, which
-- reads the referenced table as owner (RLS/privilege-exempt) and obtains the acting
-- Self from domain.current_acting_self(). Single-table predicates (author =
-- current_acting_self(); a placement's own state) stay inline.
--
-- current_acting_self() returns NULL when no trusted context is established, so
-- every predicate keyed on it denies (equality/EXISTS against NULL is not true) —
-- fail-closed (F4). Owner-run readers (Stage-1 facts, Stage-3/list reads' helpers,
-- mutations) bypass this unforced RLS by ownership; only selves_app's DIRECT
-- Stage-3/list reads are policed. No FORCE (R8).
--
-- Runs as selves_migrate with current_user=selves_owner.

-- ── artifacts: author ∪ settled-recipient ∪ valid-Key ─────────────────────────
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifacts_read_author ON public.artifacts
  AS PERMISSIVE FOR SELECT TO selves_app
  USING (author_self_id = domain.current_acting_self());

CREATE POLICY artifacts_read_settled_recipient ON public.artifacts
  AS PERMISSIVE FOR SELECT TO selves_app
  USING (domain.artifact_has_settled_recipient(id));

CREATE POLICY artifacts_read_key_valid ON public.artifacts
  AS PERMISSIVE FOR SELECT TO selves_app
  USING (domain.artifact_has_active_key(id));

-- ── placements: author (any state) ∪ (settled ∧ explicit recipient) ───────────
ALTER TABLE public.placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY placements_read_author ON public.placements
  AS PERMISSIVE FOR SELECT TO selves_app
  USING (sender_self_id = domain.current_acting_self());

CREATE POLICY placements_read_settled_recipient ON public.placements
  AS PERMISSIVE FOR SELECT TO selves_app
  USING (state = 'settled' AND domain.placement_has_recipient(id));

-- ── placement_recipients: author of the parent placement (author-only list, F5) ─
ALTER TABLE public.placement_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY precipients_read_author ON public.placement_recipients
  AS PERMISSIVE FOR SELECT TO selves_app
  USING (domain.placement_authored_by_acting(placement_id));

-- Down Migration
DROP POLICY precipients_read_author ON public.placement_recipients;
ALTER TABLE public.placement_recipients DISABLE ROW LEVEL SECURITY;

DROP POLICY placements_read_settled_recipient ON public.placements;
DROP POLICY placements_read_author ON public.placements;
ALTER TABLE public.placements DISABLE ROW LEVEL SECURITY;

DROP POLICY artifacts_read_key_valid ON public.artifacts;
DROP POLICY artifacts_read_settled_recipient ON public.artifacts;
DROP POLICY artifacts_read_author ON public.artifacts;
ALTER TABLE public.artifacts DISABLE ROW LEVEL SECURITY;
