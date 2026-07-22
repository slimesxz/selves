-- Up Migration

-- Key grant — a capability record, distinct from Artifact content (invariant
-- 12). "The Vault is an intentional-access backstage. Access is granted by Key
-- only" (AGENTS.md §3.10). A Key is an ongoing capability, not settled content
-- (AGENTS.md §5): it is revoked PROSPECTIVELY, never expired.
--
-- Invariant 7: every grant carries its grantor, grantee, protected resource,
-- grant time, and revocation time explicitly. revoked_at NULL = active;
-- setting it ends FUTURE access while preserving the historical record (the row
-- is never deleted; a re-grant is a new row).
--
-- Invariant 8: NO expiration. There is deliberately no expiry column — timed
-- key expiration is a quarantined open question and nothing is designed for it,
-- not even a nullable column "for later".
CREATE TABLE key_grants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_self_id       uuid NOT NULL REFERENCES selves (id),
  grantee_self_id       uuid NOT NULL REFERENCES selves (id),
  protected_resource_id uuid NOT NULL REFERENCES artifacts (id),
  granted_at            timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,
  CONSTRAINT key_grants_no_self_grant CHECK (grantor_self_id <> grantee_self_id),
  CONSTRAINT key_grants_revoke_after_grant
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- At most one ACTIVE grant per (grantor, grantee, resource); any number of
-- historical revoked grants may coexist. Declared explicitly per ruling D4.
CREATE UNIQUE INDEX key_grants_one_active
  ON key_grants (grantor_self_id, grantee_self_id, protected_resource_id)
  WHERE revoked_at IS NULL;

-- Query paths (invariant 13): authorization asks "does this grantee hold an
-- active Key to this resource?" — served by grantee and resource lookups.
CREATE INDEX key_grants_grantee_self_id_idx ON key_grants (grantee_self_id);
CREATE INDEX key_grants_protected_resource_id_idx ON key_grants (protected_resource_id);

-- Down Migration
DROP TABLE key_grants;
