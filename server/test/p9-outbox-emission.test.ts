import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makeAuthz, actingCtx, accountCtx, newAccount, newSelf, withEstablishedContext } from './helpers/authz.ts';
import type { AuthorizationService } from '../src/authz/service.ts';

// P9-F — outbox emission semantics (decision 0011 Q2, Q13, B.4).
//
// Emission lives ONLY inside domain.settle_placement's settled branch, behind a
// POSITIVE ENUMERATION of ratified emitting payload types. This suite proves:
// the settled text Placement emits exactly one 'placement_settled' event whose
// payload is only the placement pointer; emission and settlement share ONE
// transaction (rollback reverts both, commit persists both — neither divergence
// is constructible); a Key Placement's full lifecycle to settlement emits
// NOTHING (Q2 positive assertion) while still producing its capability grant;
// and every non-settlement act (draft, recipient edits, departure, cancel,
// revocation, interval setting) emits nothing.

let h: ReturnType<typeof makeAuthz>;
let su: pg.Pool;
let service: AuthorizationService;

beforeAll(() => {
  h = makeAuthz();
  su = h.su;
  service = h.service;
});
afterAll(() => h.end());

interface Scene {
  account: string;
  sender: string;
  recipient: string;
}

async function scene(): Promise<Scene> {
  const account = await newAccount(su);
  const sender = await newSelf(su, account, 1, 'sender');
  const recipient = await newSelf(su, account, 2, 'recipient');
  return { account, sender, recipient };
}

async function eventsFor(placementId: string): Promise<{ event_type: string; payload: Record<string, unknown> }[]> {
  const { rows } = await su.query<{ event_type: string; payload: Record<string, unknown> }>(
    "SELECT event_type, payload FROM public.outbox_events WHERE payload ->> 'placement_id' = $1 ORDER BY id",
    [placementId],
  );
  return rows;
}

async function outboxCount(): Promise<number> {
  const { rows } = await su.query<{ n: number }>('SELECT count(*)::int AS n FROM public.outbox_events');
  return rows[0]!.n;
}

async function stateOf(placementId: string): Promise<string> {
  const { rows } = await su.query<{ state: string }>('SELECT state FROM public.placements WHERE id = $1', [placementId]);
  return rows[0]!.state;
}

/** Backdate so the interval floor has elapsed while the time-order CHECK holds. */
async function elapseFloor(placementId: string): Promise<void> {
  await su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [placementId],
  );
}

/** Draft -> departing (floor elapsed) text Placement through the real service. */
async function departingText(s: Scene): Promise<string> {
  const art = await service.createArtifact(actingCtx(s.sender), 'a letter');
  const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
  await service.addRecipient(actingCtx(s.sender), plc, s.recipient);
  await service.beginDeparture(actingCtx(s.sender), plc);
  await elapseFloor(plc);
  return plc;
}

describe('P9 emission — settled text Placement (Q13)', () => {
  it('settlement emits exactly one placement_settled event whose payload is only the placement pointer', async () => {
    const s = await scene();
    const plc = await departingText(s);
    await service.settlePlacement(actingCtx(s.sender), plc);

    const events = await eventsFor(plc);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('placement_settled');
    // The payload is a pointer, never a data carrier: exactly one key.
    expect(Object.keys(events[0]!.payload)).toEqual(['placement_id']);
    expect(events[0]!.payload['placement_id']).toBe(plc);
  });

  it('idempotent re-settle does not emit a second event', async () => {
    const s = await scene();
    const plc = await departingText(s);
    await service.settlePlacement(actingCtx(s.sender), plc);
    await service.settlePlacement(actingCtx(s.sender), plc); // idempotent
    expect(await eventsFor(plc)).toHaveLength(1);
  });

  it('emission shares the settlement transaction: rollback reverts both, commit persists both', async () => {
    const s = await scene();
    const plc = await departingText(s);

    // Rolled-back settlement (withEstablishedContext always rolls back): the
    // Placement stays departing AND no event persists. Were emission a separate
    // transaction, an orphan event would survive this rollback.
    await withEstablishedContext(h.appPool, s.sender, async (c) => {
      await c.query('SELECT domain.settle_placement($1)', [plc]);
    });
    expect(await stateOf(plc)).toBe('departing');
    expect(await eventsFor(plc)).toHaveLength(0);

    // Committed settlement: both effects appear together.
    await service.settlePlacement(actingCtx(s.sender), plc);
    expect(await stateOf(plc)).toBe('settled');
    expect(await eventsFor(plc)).toHaveLength(1);
  });
});

describe('P9 emission — Key Placement emits nothing (Q2, positive assertion)', () => {
  it('a Key Placement driven through its FULL lifecycle to settlement produces the grant and ZERO outbox rows', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'protected letter');
    const plc = await service.createKeyPlacementDraft(actingCtx(s.sender), art);
    await service.addRecipient(actingCtx(s.sender), plc, s.recipient);
    await service.beginDeparture(actingCtx(s.sender), plc);
    await elapseFloor(plc);

    const before = await outboxCount();
    await service.settlePlacement(actingCtx(s.sender), plc);
    expect(await stateOf(plc)).toBe('settled');

    // The settlement's sole authorization effect exists…
    const { rows: grants } = await su.query(
      'SELECT 1 FROM public.key_grants WHERE grantor_self_id = $1 AND grantee_self_id = $2 AND protected_resource_id = $3 AND revoked_at IS NULL',
      [s.sender, s.recipient, art],
    );
    expect(grants).toHaveLength(1);
    // …and NOTHING was materialized as an event (structural non-emission).
    expect(await eventsFor(plc)).toHaveLength(0);
    expect(await outboxCount()).toBe(before);
  });

  it('revoking a Key emits nothing (Q3)', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'protected letter');
    const plc = await service.createKeyPlacementDraft(actingCtx(s.sender), art);
    await service.addRecipient(actingCtx(s.sender), plc, s.recipient);
    await service.beginDeparture(actingCtx(s.sender), plc);
    await elapseFloor(plc);
    await service.settlePlacement(actingCtx(s.sender), plc);

    const before = await outboxCount();
    await service.revokeKey(actingCtx(s.sender), s.recipient, art);
    expect(await outboxCount()).toBe(before);
  });
});

describe('P9 emission — non-settlement acts emit nothing', () => {
  it('draft creation, recipient edits, and departure emit nothing', async () => {
    const s = await scene();
    const art = await service.createArtifact(actingCtx(s.sender), 'a letter');
    const plc = await service.createPlacementDraft(actingCtx(s.sender), art);
    expect(await eventsFor(plc)).toHaveLength(0);
    await service.addRecipient(actingCtx(s.sender), plc, s.recipient);
    await service.removeRecipient(actingCtx(s.sender), plc, s.recipient);
    await service.addRecipient(actingCtx(s.sender), plc, s.recipient);
    expect(await eventsFor(plc)).toHaveLength(0);
    await service.beginDeparture(actingCtx(s.sender), plc);
    expect(await eventsFor(plc)).toHaveLength(0);
  });

  it('the cancelled loser of cancel-vs-settle leaves no event', async () => {
    const s = await scene();
    const plc = await departingText(s);
    await service.cancelPlacement(actingCtx(s.sender), plc);
    expect(await stateOf(plc)).toBe('cancelled');
    expect(await eventsFor(plc)).toHaveLength(0);
    // A settle attempt on the cancelled Placement conflicts and still emits nothing.
    await expect(service.settlePlacement(actingCtx(s.sender), plc)).rejects.toMatchObject({ code: 'PT409' });
    expect(await eventsFor(plc)).toHaveLength(0);
  });

  it('set_departure_interval emits nothing', async () => {
    const s = await scene();
    const before = await outboxCount();
    await service.setDepartureInterval(accountCtx(s.account), 5);
    expect(await outboxCount()).toBe(before);
  });
});
