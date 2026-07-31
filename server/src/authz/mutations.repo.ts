// The domain WRITE surface: each method is a thin call into one hardened
// `domain.*` SECURITY DEFINER function (decision 0006). Like the predicate and
// domain read repos, this module is INTERNAL — value-importable only by
// authz/service.ts (enforced by the import-graph test) — so no handler can issue
// a mutation around an authorization decision.
//
// P8 L (Scope B / 8-C §5): the acting Self is NO LONGER a caller-supplied argument.
// Each acting-Self mutation runs inside a READ COMMITTED transaction (the Tx handed
// in) in which the service has already established C3 context; the DEFINER function
// derives its acting Self from current_acting_self(). set_departure_interval is
// account-authenticated and Self-independent, so it carries the session token hash
// (the DEFINER function resolves the account) and runs as a single autocommit
// statement on the plain Queryable.
//
// These methods do not classify failures: the function's SQLSTATE (PT404 / PT409 /
// PT400 / 28000, or a structural 23xxx) propagates unchanged so the route adapter
// can apply the ratified split mapping (reasons.mapMutationError).
import type { Queryable } from '../db.ts';

export interface MutationsRepo {
  /** Create a text Artifact authored by the C3 acting Self. Returns its id. */
  createArtifact(q: Queryable, textBody: string): Promise<string>;
  /** Create a draft Placement (sender = C3 acting Self = Artifact author). Returns id. */
  createPlacementDraft(q: Queryable, artifactId: string): Promise<string>;
  /** Add an explicit recipient while draft (idempotent). */
  addRecipient(q: Queryable, placementId: string, recipientSelf: string): Promise<void>;
  /** Remove an explicit recipient while draft (idempotent). */
  removeRecipient(q: Queryable, placementId: string, recipientSelf: string): Promise<void>;
  /** draft -> departing: requires >=1 recipient; snapshots the account interval. */
  beginDeparture(q: Queryable, placementId: string): Promise<void>;
  /** departing -> cancelled (idempotent on already-cancelled). */
  cancelPlacement(q: Queryable, placementId: string): Promise<void>;
  /** departing -> settled behind the server-enforced interval floor (idempotent). */
  settlePlacement(q: Queryable, placementId: string): Promise<void>;
  /** Set the ACCOUNT-level departure interval. Account-authenticated and
   *  Self-independent: the DEFINER function derives the account from the session
   *  token hash. No acting Self is involved. */
  setDepartureInterval(q: Queryable, sessionTokenHash: Buffer, seconds: number): Promise<void>;
  /** Account-bound getter (R4 item 4): the mirror of the setter's authority
   *  class — session-derived account, no acting Self, no authority id. */
  getDepartureInterval(q: Queryable, sessionTokenHash: Buffer): Promise<number>;
  /** Open a Key transmission over the exact protected Artifact (C3 acting Self must
   *  author it). Returns its id. */
  createKeyPlacementDraft(q: Queryable, protectedResourceId: string): Promise<string>;
  /** Prospectively revoke the capability addressed by (grantee, protected resource)
   *  under the C3 acting grantor. Idempotent; never exposes key_grants.id. */
  revokeKey(q: Queryable, granteeSelf: string, protectedResourceId: string): Promise<void>;
}

export function createMutationsRepo(): MutationsRepo {
  return {
    async createArtifact(q, textBody) {
      const { rows } = await q.query<{ id: string }>('SELECT domain.create_artifact($1) AS id', [textBody]);
      return rows[0]!.id;
    },

    async createPlacementDraft(q, artifactId) {
      const { rows } = await q.query<{ id: string }>('SELECT domain.create_placement_draft($1) AS id', [artifactId]);
      return rows[0]!.id;
    },

    async addRecipient(q, placementId, recipientSelf) {
      await q.query('SELECT domain.add_recipient($1, $2)', [placementId, recipientSelf]);
    },

    async removeRecipient(q, placementId, recipientSelf) {
      await q.query('SELECT domain.remove_recipient($1, $2)', [placementId, recipientSelf]);
    },

    async beginDeparture(q, placementId) {
      await q.query('SELECT domain.begin_departure($1)', [placementId]);
    },

    async cancelPlacement(q, placementId) {
      await q.query('SELECT domain.cancel_placement($1)', [placementId]);
    },

    async settlePlacement(q, placementId) {
      await q.query('SELECT domain.settle_placement($1)', [placementId]);
    },

    async getDepartureInterval(q, sessionTokenHash) {
      const { rows } = await q.query<{ seconds: number }>(
        'SELECT domain.get_departure_interval($1) AS seconds',
        [sessionTokenHash],
      );
      return rows[0]!.seconds;
    },
    async setDepartureInterval(q, sessionTokenHash, seconds) {
      await q.query('SELECT domain.set_departure_interval($1, $2)', [sessionTokenHash, seconds]);
    },

    async createKeyPlacementDraft(q, protectedResourceId) {
      const { rows } = await q.query<{ id: string }>('SELECT domain.create_key_placement_draft($1) AS id', [protectedResourceId]);
      return rows[0]!.id;
    },

    async revokeKey(q, granteeSelf, protectedResourceId) {
      await q.query('SELECT domain.revoke_key($1, $2)', [granteeSelf, protectedResourceId]);
    },
  };
}
