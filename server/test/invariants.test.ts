import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PG,
  expectPgError,
  newAccount,
  newDraftPlacement,
  newSelf,
  newTextArtifact,
  resetTables,
  testPool,
} from './helpers/db';

const pool = testPool();
beforeEach(async () => { await resetTables(pool); });
afterAll(async () => { await pool.end(); });

describe('invariant 1 — a Self belongs to one account', () => {
  it('rejects a Self with a null account', async () => {
    await expectPgError(
      () => pool.query("INSERT INTO selves (account_id, self_slot, name) VALUES (NULL, 1, 'x')"),
      PG.notNull,
    );
  });
});

describe('invariant 2 — maximum 3 Selves per account', () => {
  it('allows three Selves, rejects a fourth slot', async () => {
    const account = await newAccount(pool);
    await newSelf(pool, account, 1);
    await newSelf(pool, account, 2);
    await newSelf(pool, account, 3);
    // slot 4 fails the range CHECK
    await expectPgError(() => newSelf(pool, account, 4), PG.check);
  });

  it('rejects two Selves in the same slot (no race can exceed the cap)', async () => {
    const account = await newAccount(pool);
    await newSelf(pool, account, 1);
    await expectPgError(() => newSelf(pool, account, 1), PG.unique);
  });
});

describe('invariants 11 & 12 — frozen payload; artifact vs capability', () => {
  it('rejects a non-text artifact payload (slice implements only text)', async () => {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    await expectPgError(
      () => pool.query(
        "INSERT INTO artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'photo', 'x')",
        [self],
      ),
      PG.check,
    );
  });

  it('rejects a key as an artifact row (a Key is a capability, never content)', async () => {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    await expectPgError(
      () => pool.query(
        "INSERT INTO artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'key', 'x')",
        [self],
      ),
      PG.check,
    );
  });
});

describe('invariant 3 & state coherence — Placement', () => {
  it('rejects a Placement with no sender Self', async () => {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, self);
    await expectPgError(
      () => pool.query('INSERT INTO placements (sender_self_id, artifact_id) VALUES (NULL, $1)', [artifact]),
      PG.notNull,
    );
  });

  it('rejects a settled Placement with no settled_at (state/timestamp coherence)', async () => {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, self);
    await expectPgError(
      () => pool.query(
        "INSERT INTO placements (sender_self_id, artifact_id, state, departing_at) VALUES ($1, $2, 'settled', now())",
        [self, artifact],
      ),
      PG.check,
    );
  });

  it('rejects a draft Placement that carries a departing timestamp', async () => {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, self);
    await expectPgError(
      () => pool.query(
        "INSERT INTO placements (sender_self_id, artifact_id, state, departing_at) VALUES ($1, $2, 'draft', now())",
        [self, artifact],
      ),
      PG.check,
    );
  });

  it('rejects a cancelled Placement with no cancelled_at', async () => {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, self);
    await expectPgError(
      () => pool.query(
        "INSERT INTO placements (sender_self_id, artifact_id, state, departing_at) VALUES ($1, $2, 'cancelled', now())",
        [self, artifact],
      ),
      PG.check,
    );
  });

  it('rejects a cancelled Placement that also carries settled_at (settle and cancel are exclusive)', async () => {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, self);
    await expectPgError(
      () => pool.query(
        "INSERT INTO placements (sender_self_id, artifact_id, state, departing_at, cancelled_at, settled_at) VALUES ($1, $2, 'cancelled', now(), now(), now())",
        [self, artifact],
      ),
      PG.check,
    );
  });
});

describe('invariant 5 — settled Placement history is immutable', () => {
  async function settledPlacement(): Promise<string> {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, self);
    const placement = await newDraftPlacement(pool, self, artifact);
    await pool.query("UPDATE placements SET state = 'departing', departing_at = now() WHERE id = $1", [placement]);
    await pool.query("UPDATE placements SET state = 'settled', settled_at = now() WHERE id = $1", [placement]);
    return placement;
  }

  it('rejects any UPDATE of a settled Placement', async () => {
    const placement = await settledPlacement();
    await expectPgError(
      () => pool.query("UPDATE placements SET settled_at = now() WHERE id = $1", [placement]),
      PG.check,
    );
  });

  it('rejects DELETE of a settled Placement', async () => {
    const placement = await settledPlacement();
    await expectPgError(
      () => pool.query('DELETE FROM placements WHERE id = $1', [placement]),
      PG.check,
    );
  });
});

describe('invariant 5 — cancelled Placement is also terminal and immutable', () => {
  async function cancelledPlacement(): Promise<string> {
    const account = await newAccount(pool);
    const self = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, self);
    const placement = await newDraftPlacement(pool, self, artifact);
    await pool.query("UPDATE placements SET state = 'departing', departing_at = now() WHERE id = $1", [placement]);
    await pool.query("UPDATE placements SET state = 'cancelled', cancelled_at = now() WHERE id = $1", [placement]);
    return placement;
  }

  it('rejects any UPDATE of a cancelled Placement', async () => {
    const placement = await cancelledPlacement();
    await expectPgError(
      () => pool.query("UPDATE placements SET cancelled_at = now() WHERE id = $1", [placement]),
      PG.check,
    );
  });

  it('rejects DELETE of a cancelled Placement', async () => {
    const placement = await cancelledPlacement();
    await expectPgError(
      () => pool.query('DELETE FROM placements WHERE id = $1', [placement]),
      PG.check,
    );
  });
});

describe('invariant 6 — recipients frozen from departing onward (D1 amendment)', () => {
  async function setup() {
    const account = await newAccount(pool);
    const sender = await newSelf(pool, account, 1);
    const recipient = await newSelf(pool, account, 2);
    const other = await newSelf(pool, account, 3);
    const artifact = await newTextArtifact(pool, sender);
    const placement = await newDraftPlacement(pool, sender, artifact);
    return { sender, recipient, other, placement };
  }

  it('allows adding and removing recipients while draft', async () => {
    const { placement, recipient } = await setup();
    await pool.query('INSERT INTO placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [placement, recipient]);
    await pool.query('DELETE FROM placement_recipients WHERE placement_id = $1 AND recipient_self_id = $2', [placement, recipient]);
  });

  it('freezes the recipient set once departing (no add, no remove)', async () => {
    const { placement, recipient, other } = await setup();
    await pool.query('INSERT INTO placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [placement, recipient]);
    await pool.query("UPDATE placements SET state = 'departing', departing_at = now() WHERE id = $1", [placement]);

    await expectPgError(
      () => pool.query('INSERT INTO placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [placement, other]),
      PG.check,
    );
    await expectPgError(
      () => pool.query('DELETE FROM placement_recipients WHERE placement_id = $1 AND recipient_self_id = $2', [placement, recipient]),
      PG.check,
    );
  });
});

describe('Placement deletion — only drafts are deletable', () => {
  it('deletes a draft and cascades its recipients', async () => {
    const account = await newAccount(pool);
    const sender = await newSelf(pool, account, 1);
    const recipient = await newSelf(pool, account, 2);
    const artifact = await newTextArtifact(pool, sender);
    const placement = await newDraftPlacement(pool, sender, artifact);
    await pool.query('INSERT INTO placement_recipients (placement_id, recipient_self_id) VALUES ($1, $2)', [placement, recipient]);

    await pool.query('DELETE FROM placements WHERE id = $1', [placement]);
    const { rows } = await pool.query('SELECT 1 FROM placement_recipients WHERE placement_id = $1', [placement]);
    expect(rows).toEqual([]);
  });

  it('refuses to delete a departing Placement', async () => {
    const account = await newAccount(pool);
    const sender = await newSelf(pool, account, 1);
    const artifact = await newTextArtifact(pool, sender);
    const placement = await newDraftPlacement(pool, sender, artifact);
    await pool.query("UPDATE placements SET state = 'departing', departing_at = now() WHERE id = $1", [placement]);
    await expectPgError(() => pool.query('DELETE FROM placements WHERE id = $1', [placement]), PG.check);
  });
});

describe('invariants 7 & 8 — Key capability', () => {
  async function setup() {
    const account = await newAccount(pool);
    const grantor = await newSelf(pool, account, 1);
    const grantee = await newSelf(pool, account, 2);
    const resource = await newTextArtifact(pool, grantor);
    return { grantor, grantee, resource };
  }

  it('rejects a self-grant', async () => {
    const { grantor, resource } = await setup();
    await expectPgError(
      () => pool.query(
        'INSERT INTO key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES ($1, $1, $2)',
        [grantor, resource],
      ),
      PG.check,
    );
  });

  it('rejects revocation earlier than the grant', async () => {
    const { grantor, grantee, resource } = await setup();
    await expectPgError(
      () => pool.query(
        `INSERT INTO key_grants (grantor_self_id, grantee_self_id, protected_resource_id, granted_at, revoked_at)
         VALUES ($1, $2, $3, now(), now() - interval '1 hour')`,
        [grantor, grantee, resource],
      ),
      PG.check,
    );
  });

  it('permits at most one active grant, but re-grant after revocation', async () => {
    const { grantor, grantee, resource } = await setup();
    const insertActive = () => pool.query(
      'INSERT INTO key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES ($1, $2, $3)',
      [grantor, grantee, resource],
    );
    await insertActive();
    // second active grant for the same triple collides on the partial unique index
    await expectPgError(insertActive, PG.unique);
    // revoke the first, preserving history, then a new active grant is allowed
    await pool.query('UPDATE key_grants SET revoked_at = now() WHERE grantor_self_id = $1 AND grantee_self_id = $2 AND protected_resource_id = $3', [grantor, grantee, resource]);
    await insertActive();
    const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM key_grants');
    expect(rows[0]!.n).toBe('2'); // history preserved: one revoked + one active
  });
});
