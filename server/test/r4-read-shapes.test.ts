// P10-S1 — R4 read-shape acceptance (decision 0012 §35: F1, F2, F3; R4 as
// amended by P10-M1; P10-M2). Exercises the ground-conditional projection and
// the two-SELECT split through the REAL AuthorizationService over selves_app,
// with fixtures driven through the real state machine wherever a snapshot is
// required (beginDeparture writes it; the su rewind only moves clocks).
import './helpers/env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  makeAuthz,
  actingCtx,
  newAccount,
  newSelf,
  type AuthzHarness,
} from './helpers/authz.ts';
import {
  PLACEMENT_COLS_AUTHOR,
  PLACEMENT_COLS_RECIPIENT,
} from '../src/authz/domain.repo.ts';
import type { Placement } from '@selves/domain';

let h: AuthzHarness;
let accX: string; // the author's account (for the F3 snapshot-vs-config proof)
let A: string; // author Self (account X, slot 1)
let SIB: string; // sibling Self (account X, slot 2)
let R: string; // recipient Self (account Y)
let U: string; // unrelated Self (account Z)
let art1: string; // text artifact carried by P1
let res: string; // protected resource behind KP
let P1: string; // A -> R, settled (snapshot 30)
let P2: string; // A -> A, settled (self-addressed; F1)
let P3: string; // A -> R, departing (snapshot 30)
let P4: string; // A, draft (no snapshot)
let KP: string; // key placement A -> R, settled

const rewind = (id: string) =>
  h.su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [id],
  );

beforeAll(async () => {
  h = makeAuthz();
  accX = await newAccount(h.su);
  A = await newSelf(h.su, accX, 1, 'author');
  SIB = await newSelf(h.su, accX, 2, 'sibling');
  const accY = await newAccount(h.su);
  R = await newSelf(h.su, accY, 1, 'recipient');
  const accZ = await newAccount(h.su);
  U = await newSelf(h.su, accZ, 1, 'unrelated');
  const s = h.service;

  art1 = await s.createArtifact(actingCtx(A), 'p1 body');
  P1 = await s.createPlacementDraft(actingCtx(A), art1);
  await s.addRecipient(actingCtx(A), P1, R);
  await s.beginDeparture(actingCtx(A), P1);
  await rewind(P1);
  await s.settlePlacement(actingCtx(A), P1);

  const art2 = await s.createArtifact(actingCtx(A), 'p2 body');
  P2 = await s.createPlacementDraft(actingCtx(A), art2);
  await s.addRecipient(actingCtx(A), P2, A); // self-addressed (0006 Q6)
  await s.beginDeparture(actingCtx(A), P2);
  await rewind(P2);
  await s.settlePlacement(actingCtx(A), P2);

  const art3 = await s.createArtifact(actingCtx(A), 'p3 body');
  P3 = await s.createPlacementDraft(actingCtx(A), art3);
  await s.addRecipient(actingCtx(A), P3, R);
  await s.beginDeparture(actingCtx(A), P3); // left departing

  const art4 = await s.createArtifact(actingCtx(A), 'p4 body');
  P4 = await s.createPlacementDraft(actingCtx(A), art4); // left draft

  res = await s.createArtifact(actingCtx(A), 'protected body');
  KP = await s.createKeyPlacementDraft(actingCtx(A), res);
  await s.addRecipient(actingCtx(A), KP, R);
  await s.beginDeparture(actingCtx(A), KP);
  await rewind(KP);
  await s.settlePlacement(actingCtx(A), KP);
});

afterAll(async () => {
  await h.end();
});

const ids = (rows: Placement[]) => rows.map((p) => p.id as string).sort();

describe('grant plumbing (the grant is not the boundary)', () => {
  it('selves_app holds SELECT on exactly the three ruled columns', async () => {
    const { rows } = await h.su.query<{ a: boolean; b: boolean; c: boolean }>(
      `SELECT has_column_privilege('selves_app', 'public.placements', 'payload_type', 'SELECT') AS a,
              has_column_privilege('selves_app', 'public.placements', 'protected_resource_id', 'SELECT') AS b,
              has_column_privilege('selves_app', 'public.placements', 'departure_interval_seconds', 'SELECT') AS c`,
    );
    expect(rows[0]).toEqual({ a: true, b: true, c: true });
  });
});

describe('static projection proof (P10-M1)', () => {
  it('the recipient column list never names departure_interval_seconds; the author list is recipient + exactly that column', () => {
    expect(PLACEMENT_COLS_RECIPIENT).not.toContain('departure_interval_seconds');
    expect(PLACEMENT_COLS_AUTHOR).toBe(
      `${PLACEMENT_COLS_RECIPIENT}, departure_interval_seconds`,
    );
  });
});

describe('F1 — self-addressed placement in the split', () => {
  it('a settled placement the actor both authored and received appears exactly once, under the author column list', async () => {
    const list = await h.service.listReadablePlacements(actingCtx(A));
    const p2rows = list.filter((p) => (p.id as string) === P2);
    expect(p2rows).toHaveLength(1);
    expect(Object.hasOwn(p2rows[0]!, 'departureIntervalSeconds')).toBe(true);
    expect(p2rows[0]!.departureIntervalSeconds).toBe(30);
  });
});

describe('F2 — union equals the readable set; RLS remains the boundary', () => {
  // RLS is the sole authorization boundary for both queries; the WHERE clauses
  // narrow within the RLS-produced set by ground and are not the authorization.
  it('author: the union is exactly the authored set (any state)', async () => {
    const list = await h.service.listReadablePlacements(actingCtx(A));
    expect(ids(list)).toEqual([P1, P2, P3, P4, KP].sort());
  });

  it('settled recipient: the union is exactly the settled placements addressed to the actor', async () => {
    const list = await h.service.listReadablePlacements(actingCtx(R));
    expect(ids(list)).toEqual([P1, KP].sort());
  });

  it('author-and-recipient: the single read resolves under AUTHOR precedence', async () => {
    const r = await h.service.readPlacement(actingCtx(A), P2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.departureIntervalSeconds).toBe(30);
  });

  it('recipient of an unsettled placement: not in the union; single read denied', async () => {
    const list = await h.service.listReadablePlacements(actingCtx(R));
    expect(ids(list)).not.toContain(P3);
    const r = await h.service.readPlacement(actingCtx(R), P3);
    expect(r.ok).toBe(false);
  });

  it('sibling Self: empty union', async () => {
    const list = await h.service.listReadablePlacements(actingCtx(SIB));
    expect(list).toEqual([]);
  });

  it('unrelated Self: empty union', async () => {
    const list = await h.service.listReadablePlacements(actingCtx(U));
    expect(list).toEqual([]);
  });

  it('nonexistent placement: in no union; single read denied identically', async () => {
    const ghost = randomUUID();
    const r = await h.service.readPlacement(actingCtx(A), ghost);
    expect(r.ok).toBe(false);
    const list = await h.service.listReadablePlacements(actingCtx(A));
    expect(ids(list)).not.toContain(ghost);
  });

  it('RLS governs the authored query: absent context reads zero rows', async () => {
    const c = await h.appPool.connect();
    try {
      await c.query('BEGIN');
      const all = await c.query('SELECT count(*)::int AS n FROM public.placements');
      expect(all.rows[0].n).toBe(0); // fail-closed boundary, before any WHERE
      const qa = await c.query(
        `SELECT ${PLACEMENT_COLS_AUTHOR} FROM public.placements
          WHERE sender_self_id = domain.current_acting_self()`,
      );
      expect(qa.rows).toHaveLength(0);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('RLS governs the received query: absent context reads zero rows even though its WHERE matches all rows', async () => {
    const c = await h.appPool.connect();
    try {
      await c.query('BEGIN');
      // With no context, current_acting_self() is NULL and IS DISTINCT FROM
      // NULL is true for every row — so zero rows here is RLS alone.
      const qb = await c.query(
        `SELECT ${PLACEMENT_COLS_RECIPIENT} FROM public.placements
          WHERE sender_self_id IS DISTINCT FROM domain.current_acting_self()`,
      );
      expect(qb.rows).toHaveLength(0);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});

describe('P10-M1 — recipient-visible paths never return the interval', () => {
  it('single read as settled recipient: the key is absent (not null) while the snapshot is non-null', async () => {
    const snap = await h.su.query<{ v: number | null }>(
      'SELECT departure_interval_seconds AS v FROM public.placements WHERE id = $1',
      [P1],
    );
    expect(snap.rows[0]!.v).toBe(30); // the value exists; only the projection withholds it
    const r = await h.service.readPlacement(actingCtx(R), P1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.hasOwn(r.value, 'departureIntervalSeconds')).toBe(false);
  });

  it('list as recipient: received rows lack the key', async () => {
    const list = await h.service.listReadablePlacements(actingCtx(R));
    const p1row = list.find((p) => (p.id as string) === P1)!;
    expect(Object.hasOwn(p1row, 'departureIntervalSeconds')).toBe(false);
  });

  it('the same placement read as author shows the snapshot written by beginDeparture, not current account configuration', async () => {
    const r = await h.service.readPlacement(actingCtx(A), P1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.departureIntervalSeconds).toBe(30);
    // F3 trigger (P10-S1 resume amendment 3): the value is the placement
    // snapshot, not live account configuration — change the account setting
    // and prove the departed placement's value does not follow it.
    await h.su.query(
      'UPDATE public.accounts SET departure_interval_seconds = 60 WHERE id = $1',
      [accX],
    );
    const r2 = await h.service.readPlacement(actingCtx(A), P1);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.departureIntervalSeconds).toBe(30); // snapshot, not 60
  });
});

describe('F3 — three states of departureIntervalSeconds', () => {
  it('author before departure: key present with null', async () => {
    const r = await h.service.readPlacement(actingCtx(A), P4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.hasOwn(r.value, 'departureIntervalSeconds')).toBe(true);
      expect(r.value.departureIntervalSeconds).toBeNull();
    }
  });

  it('author after departure: key present with the snapshotted number', async () => {
    const r = await h.service.readPlacement(actingCtx(A), P3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.departureIntervalSeconds).toBe(30);
  });
});

describe('R4 — payload_type and protected_resource_id on readable placements', () => {
  it('text placement, recipient ground: payloadType text, protectedResourceId null', async () => {
    const r = await h.service.readPlacement(actingCtx(R), P1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.payloadType).toBe('text');
      expect(r.value.protectedResourceId).toBeNull();
      expect(r.value.artifactId).toBe(art1);
    }
  });

  it('key placement, grantee (settled recipient): payloadType key, protectedResourceId set, artifactId null, no interval key', async () => {
    const r = await h.service.readPlacement(actingCtx(R), KP);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.payloadType).toBe('key');
      expect(r.value.protectedResourceId).toBe(res);
      expect(r.value.artifactId).toBeNull();
      expect(Object.hasOwn(r.value, 'departureIntervalSeconds')).toBe(false);
    }
  });

  it('key placement, grantor (author): the revoke address plus the snapshot', async () => {
    const r = await h.service.readPlacement(actingCtx(A), KP);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.protectedResourceId).toBe(res);
      expect(r.value.departureIntervalSeconds).toBe(30);
    }
  });
});
