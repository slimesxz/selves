import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makeAuthz, actingCtx, accountCtx, newAccount, newSelf, capturingSink, withEstablishedContext } from './helpers/authz.ts';
import type { AuthorizationService } from '../src/authz/service.ts';
import type { DecisionSink, Outcome } from '../src/authz/reasons.ts';

// P7-E — R3 is a STRUCTURAL invariant (decision 0007, audit point 3). A Key
// Placement carries artifact_id = NULL, so it can never satisfy the Phase-5
// RECIPIENT_SETTLED artifact-read predicate for its protected Artifact. The sole
// revocable read path is KEY_VALID through key_grants.
//
// P8 R1 (decision 0008 R1 / 0009) moved the Stage-1 fact computation behind the
// owner-run domain.artifact_facts function, and expressly RELEASED the Phase-7
// byte-identity of predicates.repo.ts (a Phase-7-scoped guarantee discharged at
// 58d5a4f). The structural invariant that byte-identity protected is re-proven
// here directly at the new predicate boundary, which is stronger than a file
// comparison: domain.artifact_facts resolves the recipient ground by joining on
// p.artifact_id, and a Key Placement carries artifact_id = NULL, so it can never
// contribute anySettledRecipient / anyRecipient for the protected Artifact.

describe('R3 — domain.artifact_facts gives a Key Placement no recipient ground (structural)', () => {
  let h: ReturnType<typeof makeAuthz>;
  let su: pg.Pool;
  let app: pg.Pool;
  let service: AuthorizationService;

  beforeAll(() => {
    h = makeAuthz();
    su = h.su;
    app = h.appPool;
    service = h.service;
  });
  afterAll(() => h.end());

  async function elapseFloor(id: string): Promise<void> {
    await su.query("UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1", [id]);
  }

  it('a settled Key Placement (artifact_id NULL) contributes no recipient ground for its protected Artifact', async () => {
    const account = await newAccount(su);
    const grantor = await newSelf(su, account, 1, 'grantor');
    const grantee = await newSelf(su, account, 2, 'grantee');
    const R = await service.createArtifact(actingCtx(grantor), 'secret');

    await service.setDepartureInterval(accountCtx(account), 5);
    const kp = await service.createKeyPlacementDraft(actingCtx(grantor), R);
    await service.addRecipient(actingCtx(grantor), kp, grantee);
    await service.beginDeparture(actingCtx(grantor), kp);
    await elapseFloor(kp);
    await service.settlePlacement(actingCtx(grantor), kp);

    // the settled Key Placement holds NO content artifact_id …
    expect((await su.query<{ artifact_id: string | null }>(
      'SELECT artifact_id FROM public.placements WHERE id = $1', [kp])).rows[0]!.artifact_id).toBeNull();

    // … so the Stage-1 recipient ground for R is empty, though the grant is active:
    // the sole revocable read path is KEY_VALID, never RECIPIENT_SETTLED (R3).
    // P8 J: artifact_facts derives the acting Self from C3 context (single-arg).
    const f = (await withEstablishedContext(app, grantee, (c) => c.query<{
      any_settled_recipient: boolean; any_recipient: boolean; has_active_for_target: boolean;
    }>('SELECT * FROM domain.artifact_facts($1)', [R]))).rows[0]!;
    expect(f.any_settled_recipient).toBe(false);
    expect(f.any_recipient).toBe(false);
    expect(f.has_active_for_target).toBe(true);
  });
});

describe('R3 — the grantee has no RECIPIENT_SETTLED path; the sole read path is KEY_VALID', () => {
  let h: ReturnType<typeof makeAuthz>;
  let su: pg.Pool;
  let service: AuthorizationService;
  let events: { operation: string; outcome: Outcome<string> }[];
  let sink: DecisionSink;

  beforeAll(() => {
    const cap = capturingSink();
    sink = cap.sink;
    events = cap.events;
    h = makeAuthz(sink);
    su = h.su;
    service = h.service;
  });
  afterAll(() => h.end());

  async function elapseFloor(id: string): Promise<void> {
    await su.query("UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1", [id]);
  }

  it('the settled read decides on KEY_VALID (not RECIPIENT_SETTLED), and revocation removes it', async () => {
    const account = await newAccount(su);
    const grantor = await newSelf(su, account, 1, 'grantor');
    const grantee = await newSelf(su, account, 2, 'grantee');
    const R = await service.createArtifact(actingCtx(grantor), 'secret');

    await service.setDepartureInterval(accountCtx(account), 5);
    const kp = await service.createKeyPlacementDraft(actingCtx(grantor), R);
    await service.addRecipient(actingCtx(grantor), kp, grantee);
    await service.beginDeparture(actingCtx(grantor), kp);
    await elapseFloor(kp);
    await service.settlePlacement(actingCtx(grantor), kp);

    // structural precondition: the Key Placement holds NO content artifact_id, and
    // the grantee IS its explicit recipient on a SETTLED placement — the exact
    // shape that would trigger RECIPIENT_SETTLED if it pointed at the artifact.
    const row = (await su.query<{ artifact_id: string | null; state: string }>(
      'SELECT artifact_id, state FROM public.placements WHERE id = $1', [kp])).rows[0]!;
    expect(row.artifact_id).toBeNull();
    expect(row.state).toBe('settled');
    const rec = (await su.query<{ n: number }>(
      'SELECT count(*)::int n FROM public.placement_recipients WHERE placement_id = $1 AND recipient_self_id = $2', [kp, grantee])).rows[0]!;
    expect(rec.n).toBe(1);

    // the allow ground for the grantee's read is KEY_VALID
    events.length = 0;
    expect((await service.readArtifact(actingCtx(grantee), R)).ok).toBe(true);
    const allow = events.filter((e) => e.operation === 'readArtifact').at(-1);
    expect(allow?.outcome).toEqual({ kind: 'allow', ground: 'KEY_VALID' });

    // revocation removes the read entirely — proving the path was the revocable
    // capability, NOT a RECIPIENT_SETTLED ground (which revocation cannot touch).
    await service.revokeKey(actingCtx(grantor), grantee, R);
    events.length = 0;
    expect((await service.readArtifact(actingCtx(grantee), R)).ok).toBe(false);
    // the settled Key Placement and its recipient row still exist, yet access is gone
    expect((await su.query('SELECT state FROM public.placements WHERE id = $1', [kp])).rows[0].state).toBe('settled');
    expect((await su.query('SELECT count(*)::int n FROM public.placement_recipients WHERE placement_id = $1', [kp])).rows[0].n).toBe(1);
  });
});
