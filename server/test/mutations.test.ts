import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makeAuthz, actingCtx, accountCtx, newAccount, newSelf } from './helpers/authz.ts';
import type { AuthorizationService } from '../src/authz/service.ts';

// P6-E — domain mutation semantics proven through the REAL AuthorizationService
// over a selves_app connection (the DEFINER write boundary). Fixtures use a
// superuser pool to create authoritative rows; every mutation runs the real
// state machine. This suite covers the transition matrix, per-actor
// authorization, the account/Self authorization split, self/sibling addressing,
// recipient freeze, the interval snapshot + floor, bounded-list validation, and
// non-race idempotency. Concurrency races live in mutations-race.test.ts.

let h: ReturnType<typeof makeAuthz>;
let su: pg.Pool;
let service: AuthorizationService;

beforeAll(() => {
  h = makeAuthz();
  su = h.su;
  service = h.service;
});
afterAll(() => h.end());

/** SQLSTATE of a rejected service call, or undefined if it resolved. */
async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

interface Scene {
  account: string;
  sender: string;
  recipient: string;
  sibling: string;
  other: string;
  stranger: string;
}

/** A fresh account with three Selves (sender/recipient/sibling) plus a stranger
 *  on a separate account. Fresh per test, so slot caps never collide. */
async function scene(): Promise<Scene> {
  const account = await newAccount(su);
  const sender = await newSelf(su, account, 1, 'sender');
  const recipient = await newSelf(su, account, 2, 'recipient');
  const sibling = await newSelf(su, account, 3, 'sibling');
  const other = await newAccount(su);
  const stranger = await newSelf(su, other, 1, 'stranger');
  return { account, sender, recipient, sibling, other, stranger };
}

async function stateOf(placementId: string): Promise<string> {
  const { rows } = await su.query<{ state: string }>('SELECT state FROM public.placements WHERE id = $1', [placementId]);
  return rows[0]!.state;
}
async function snapshotOf(placementId: string): Promise<number | null> {
  const { rows } = await su.query<{ d: number | null }>(
    'SELECT departure_interval_seconds AS d FROM public.placements WHERE id = $1',
    [placementId],
  );
  return rows[0]!.d;
}
async function recipientCount(placementId: string): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM public.placement_recipients WHERE placement_id = $1',
    [placementId],
  );
  return rows[0]!.n;
}
/** Backdate so the interval floor has elapsed while the time-order CHECK holds. */
async function elapseFloor(placementId: string): Promise<void> {
  await su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [placementId],
  );
}

async function draftWithRecipient(s: Scene): Promise<{ art: string; plc: string }> {
  const art = await service.createArtifact(actingCtx(s.sender), 'a letter');
  const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
  await service.addRecipient(actingCtx(s.sender), plc, s.recipient);
  return { art, plc };
}
async function departing(s: Scene, intervalSeconds?: number): Promise<{ art: string; plc: string }> {
  if (intervalSeconds !== undefined) await service.setDepartureInterval(accountCtx(s.account), intervalSeconds);
  const { art, plc } = await draftWithRecipient(s);
  await service.beginDeparture(actingCtx(s.sender), plc);
  return { art, plc };
}

describe('create_artifact / create_placement_draft (sender = author, ruling 5)', () => {
  it('the acting Self authors its own text Artifact', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'hello');
    const { rows } = await su.query('SELECT author_self_id, payload_type FROM public.artifacts WHERE id = $1', [art]);
    expect(rows[0]).toMatchObject({ author_self_id: s.sender, payload_type: 'text' });
  });
  it('empty body is rejected structurally (23514 -> 400)', async () => {
    const s = await scene();
    expect(await code(() => service.createArtifact(actingCtx(s.sender), '   '))).toBe('23514');
  });
  it('the sender must be the Artifact author (a non-author sees PT404)', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'mine');
    expect(await code(() => service.createPlacementDraft(actingCtx(s.stranger), art))).toBe('PT404');
    expect(await code(() => service.createPlacementDraft(actingCtx(s.sibling), art))).toBe('PT404');
  });
  it('an absent artifact is PT404', async () => {
    const s = await scene();
    expect(
      await code(() => service.createPlacementDraft(actingCtx(s.sender), '00000000-0000-0000-0000-000000000000')),
    ).toBe('PT404');
  });
  it('the author places its own artifact', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'mine');
    const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
    expect(await stateOf(plc)).toBe('draft');
  });
});

describe('transition matrix — valid forward transitions', () => {
  it('draft -> departing -> settled (after the floor)', async () => {
    const s = await scene();
    const { plc } = await departing(s, 5);
    expect(await stateOf(plc)).toBe('departing');
    await elapseFloor(plc);
    await service.settlePlacement(actingCtx(s.sender), plc);
    expect(await stateOf(plc)).toBe('settled');
  });
  it('draft -> departing -> cancelled', async () => {
    const s = await scene();
    const { plc } = await departing(s);
    await service.cancelPlacement(actingCtx(s.sender), plc);
    expect(await stateOf(plc)).toBe('cancelled');
  });
});

describe('transition matrix — invalid transitions (author, wrong state -> PT409)', () => {
  it('settle or cancel a draft is PT409', async () => {
    const s = await scene();
    const { plc } = await draftWithRecipient(s);
    expect(await code(() => service.settlePlacement(actingCtx(s.sender), plc))).toBe('PT409');
    expect(await code(() => service.cancelPlacement(actingCtx(s.sender), plc))).toBe('PT409');
  });
  it('begin_departure on a departing placement is PT409', async () => {
    const s = await scene();
    const { plc } = await departing(s);
    expect(await code(() => service.beginDeparture(actingCtx(s.sender), plc))).toBe('PT409');
  });
  it('begin_departure with zero recipients is PT409 (ruling 4)', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'x');
    const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
    expect(await code(() => service.beginDeparture(actingCtx(s.sender), plc))).toBe('PT409');
  });
  it('any transition on a settled placement is PT409', async () => {
    const s = await scene();
    const { plc } = await departing(s, 5);
    await elapseFloor(plc);
    await service.settlePlacement(actingCtx(s.sender), plc);
    expect(await code(() => service.cancelPlacement(actingCtx(s.sender), plc))).toBe('PT409');
    expect(await code(() => service.beginDeparture(actingCtx(s.sender), plc))).toBe('PT409');
  });
  it('any transition on a cancelled placement is PT409', async () => {
    const s = await scene();
    const { plc } = await departing(s);
    await service.cancelPlacement(actingCtx(s.sender), plc);
    expect(await code(() => service.settlePlacement(actingCtx(s.sender), plc))).toBe('PT409');
    expect(await code(() => service.beginDeparture(actingCtx(s.sender), plc))).toBe('PT409');
  });
});

describe('per-actor authorization — only the sender drives transitions', () => {
  it('recipient, sibling, and stranger cannot begin/cancel/settle (PT404)', async () => {
    const s = await scene();
    const { plc } = await departing(s, 5);
    await elapseFloor(plc);
    for (const actor of [s.recipient, s.sibling, s.stranger]) {
      expect(await code(() => service.beginDeparture(actingCtx(actor), plc))).toBe('PT404');
      expect(await code(() => service.cancelPlacement(actingCtx(actor), plc))).toBe('PT404');
      expect(await code(() => service.settlePlacement(actingCtx(actor), plc))).toBe('PT404');
    }
    expect(await stateOf(plc)).toBe('departing'); // untouched by non-senders
  });
  it('a non-sender cannot add or remove recipients (PT404)', async () => {
    const s = await scene();
    const { plc } = await draftWithRecipient(s);
    for (const actor of [s.recipient, s.sibling, s.stranger]) {
      expect(await code(() => service.addRecipient(actingCtx(actor), plc, s.sibling))).toBe('PT404');
      expect(await code(() => service.removeRecipient(actingCtx(actor), plc, s.recipient))).toBe('PT404');
    }
    expect(await recipientCount(plc)).toBe(1);
  });
});

describe('recipient addressing (ruling 6) — self and sibling are valid recipients', () => {
  it('the sending Self may address itself and a sibling; receipt confers no authority', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'x');
    const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
    await service.addRecipient(actingCtx(s.sender), plc, s.sender); // self-addressing
    await service.addRecipient(actingCtx(s.sender), plc, s.sibling); // sibling-addressing
    expect(await recipientCount(plc)).toBe(2);
    await service.beginDeparture(actingCtx(s.sender), plc); // >=1 recipient satisfied
    expect(await stateOf(plc)).toBe('departing');
    // the addressed sibling gains no power to drive the placement
    expect(await code(() => service.cancelPlacement(actingCtx(s.sibling), plc))).toBe('PT404');
  });
  it('an unknown recipient Self is rejected structurally (23503 -> 400)', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'x');
    const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
    expect(
      await code(() => service.addRecipient(actingCtx(s.sender), plc, '00000000-0000-0000-0000-000000000000')),
    ).toBe('23503');
  });
  it('add/remove recipient are idempotent while draft', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'x');
    const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
    await service.addRecipient(actingCtx(s.sender), plc, s.recipient);
    await service.addRecipient(actingCtx(s.sender), plc, s.recipient); // idempotent
    expect(await recipientCount(plc)).toBe(1);
    await service.removeRecipient(actingCtx(s.sender), plc, s.recipient);
    await service.removeRecipient(actingCtx(s.sender), plc, s.recipient); // idempotent
    expect(await recipientCount(plc)).toBe(0);
  });
});

describe('recipient freeze per state', () => {
  it('recipients are frozen once departing (PT409), and while terminal', async () => {
    const s = await scene();
    const { plc } = await departing(s, 5);
    expect(await code(() => service.addRecipient(actingCtx(s.sender), plc, s.sibling))).toBe('PT409');
    expect(await code(() => service.removeRecipient(actingCtx(s.sender), plc, s.recipient))).toBe('PT409');
    await service.cancelPlacement(actingCtx(s.sender), plc);
    expect(await code(() => service.addRecipient(actingCtx(s.sender), plc, s.sibling))).toBe('PT409');
    expect(await recipientCount(plc)).toBe(1);
  });
});

describe('departure interval — account setting, snapshot, floor, bounded list', () => {
  it('accepts only the bounded list {5,10,30,60}; others are PT400', async () => {
    const s = await scene();
    for (const v of [5, 10, 30, 60]) {
      await service.setDepartureInterval(accountCtx(s.account), v);
      const { rows } = await su.query('SELECT departure_interval_seconds d FROM public.accounts WHERE id = $1', [s.account]);
      expect(rows[0].d).toBe(v);
    }
    for (const bad of [0, 1, 7, 15, 45, 61, 3600]) {
      expect(await code(() => service.setDepartureInterval(accountCtx(s.account), bad))).toBe('PT400');
    }
  });
  it('begin_departure snapshots the account interval; a later change does not move it', async () => {
    const s = await scene();
    const { plc } = await departing(s, 10);
    expect(await snapshotOf(plc)).toBe(10);
    await service.setDepartureInterval(accountCtx(s.account), 60); // change mid-departure
    expect(await snapshotOf(plc)).toBe(10); // snapshot immutable
    // the floor still uses the snapshot (10s), not the new account value
    expect(await code(() => service.settlePlacement(actingCtx(s.sender), plc))).toBe('PT409'); // not elapsed
    await elapseFloor(plc);
    await service.settlePlacement(actingCtx(s.sender), plc);
    expect(await stateOf(plc)).toBe('settled');
  });
  it('a premature settle (floor not elapsed) is PT409; after the floor it settles', async () => {
    const s = await scene();
    const { plc } = await departing(s, 5);
    expect(await code(() => service.settlePlacement(actingCtx(s.sender), plc))).toBe('PT409');
    await elapseFloor(plc);
    await service.settlePlacement(actingCtx(s.sender), plc);
    expect(await stateOf(plc)).toBe('settled');
  });
});

describe('idempotency (non-race)', () => {
  it('a second settle is a no-op success and does not move settled_at', async () => {
    const s = await scene();
    const { plc } = await departing(s, 5);
    await elapseFloor(plc);
    await service.settlePlacement(actingCtx(s.sender), plc);
    const t1 = (await su.query('SELECT settled_at FROM public.placements WHERE id = $1', [plc])).rows[0].settled_at;
    await service.settlePlacement(actingCtx(s.sender), plc); // idempotent
    const t2 = (await su.query('SELECT settled_at FROM public.placements WHERE id = $1', [plc])).rows[0].settled_at;
    expect(t2).toEqual(t1);
  });
  it('a second cancel is a no-op success', async () => {
    const s = await scene();
    const { plc } = await departing(s);
    await service.cancelPlacement(actingCtx(s.sender), plc);
    expect(await code(() => service.cancelPlacement(actingCtx(s.sender), plc))).toBeUndefined();
    expect(await stateOf(plc)).toBe('cancelled');
  });
  it('settle absent placement is PT404', async () => {
    const s = await scene();
    expect(
      await code(() => service.settlePlacement(actingCtx(s.sender), '00000000-0000-0000-0000-000000000000')),
    ).toBe('PT404');
  });
});

describe('set_departure_interval is account-scoped, never Self-resolved', () => {
  it('a SELF id supplied where the account is expected does not resolve to an account (PT404)', async () => {
    const s = await scene();
    // accountCtx wraps whatever id it is given; passing a Self id must NOT be
    // resolved back to that Self's account — it is simply an unknown account.
    expect(await code(() => service.setDepartureInterval(accountCtx(s.sender), 30))).toBe('PT404');
    // the real account is untouched
    const { rows } = await su.query('SELECT departure_interval_seconds d FROM public.accounts WHERE id = $1', [s.account]);
    expect(rows[0].d).toBe(30); // still the default
  });
});
