// The domain WRITE surface: each method is a thin call into one hardened
// `domain.*` SECURITY DEFINER function (decision 0006). Like the predicate and
// domain read repos, this module is INTERNAL — value-importable only by
// authz/service.ts (enforced by the import-graph test) — so no handler can issue
// a mutation around an authorization decision.
//
// A DEFINER function is a single autocommit statement that does its own
// state-machine locking (SELECT ... FOR UPDATE on the stable placement row), so
// mutations run on the plain Queryable (the app pool), NOT the REPEATABLE READ
// TxPool used for reads, and NOT the raw pool binding. That keeps the Phase-5
// mechanical-boundary positive locks (pg / raw-pool importers) unchanged.
//
// These methods do not classify failures: the function's SQLSTATE (PT404 / PT409
// / PT400, or a structural 23xxx) propagates unchanged so the route adapter can
// apply the ratified split mapping (reasons.mapMutationError). Authorization is
// bound to the acting Self the service was handed from the verified Phase-4
// context; the function binds every write to it.
import type { Queryable } from '../db.ts';

export interface MutationsRepo {
  /** Create a text Artifact authored by the acting Self. Returns its id. */
  createArtifact(db: Queryable, actingSelf: string, textBody: string): Promise<string>;
  /** Create a draft Placement (sender = acting Self = Artifact author). Returns id. */
  createPlacementDraft(db: Queryable, actingSelf: string, artifactId: string): Promise<string>;
  /** Add an explicit recipient while draft (idempotent). */
  addRecipient(db: Queryable, actingSelf: string, placementId: string, recipientSelf: string): Promise<void>;
  /** Remove an explicit recipient while draft (idempotent). */
  removeRecipient(db: Queryable, actingSelf: string, placementId: string, recipientSelf: string): Promise<void>;
  /** draft -> departing: requires >=1 recipient; snapshots the account interval. */
  beginDeparture(db: Queryable, actingSelf: string, placementId: string): Promise<void>;
  /** departing -> cancelled (idempotent on already-cancelled). */
  cancelPlacement(db: Queryable, actingSelf: string, placementId: string): Promise<void>;
  /** departing -> settled behind the server-enforced interval floor (idempotent). */
  settlePlacement(db: Queryable, actingSelf: string, placementId: string): Promise<void>;
  /** Set the ACCOUNT-level departure interval. Account-scoped: authority is the
   *  authenticated account id, NOT the acting Self (the interval is an account
   *  setting). No acting Self is accepted or resolved here. */
  setDepartureInterval(db: Queryable, accountId: string, seconds: number): Promise<void>;
}

export function createMutationsRepo(): MutationsRepo {
  return {
    async createArtifact(db, actingSelf, textBody) {
      const { rows } = await db.query<{ id: string }>(
        'SELECT domain.create_artifact($1, $2) AS id',
        [actingSelf, textBody],
      );
      return rows[0]!.id;
    },

    async createPlacementDraft(db, actingSelf, artifactId) {
      const { rows } = await db.query<{ id: string }>(
        'SELECT domain.create_placement_draft($1, $2) AS id',
        [actingSelf, artifactId],
      );
      return rows[0]!.id;
    },

    async addRecipient(db, actingSelf, placementId, recipientSelf) {
      await db.query('SELECT domain.add_recipient($1, $2, $3)', [actingSelf, placementId, recipientSelf]);
    },

    async removeRecipient(db, actingSelf, placementId, recipientSelf) {
      await db.query('SELECT domain.remove_recipient($1, $2, $3)', [actingSelf, placementId, recipientSelf]);
    },

    async beginDeparture(db, actingSelf, placementId) {
      await db.query('SELECT domain.begin_departure($1, $2)', [actingSelf, placementId]);
    },

    async cancelPlacement(db, actingSelf, placementId) {
      await db.query('SELECT domain.cancel_placement($1, $2)', [actingSelf, placementId]);
    },

    async settlePlacement(db, actingSelf, placementId) {
      await db.query('SELECT domain.settle_placement($1, $2)', [actingSelf, placementId]);
    },

    async setDepartureInterval(db, accountId, seconds) {
      await db.query('SELECT domain.set_departure_interval($1, $2)', [accountId, seconds]);
    },
  };
}
