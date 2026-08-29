import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { makeAuthz, actingCtx, accountCtx, newAccount, newSelf, type AuthzHarness } from './helpers/authz.ts';
import { createLocalObjectStorage } from '../src/storage/local-object-storage.ts';
import { createObjectAccessIssuer, type ObjectAccessIssuer } from '../src/storage/object-access.ts';
import type { ObjectAuthorization, ObjectStorage } from '../src/storage/object-storage.ts';
import {
  failureReason,
  makeCallLedger,
  manualClock,
  placeTestObject,
  recordingAuthorization,
  testBindingResolver,
  type CallLedger,
  type ManualClock,
  type TestBindingResolver,
} from './helpers/object-storage.ts';

// P12-D — the MANDATORY Phase 12 proof, executed against REAL PostgreSQL.
//
// The property under proof (Gate 1 Q1): object download authorization is
// SUBORDINATE to the existing authoritative Artifact-read decision at issuance
// time. Loss of a revocable read ground prevents issuance of a NEW download
// authorization — and does not, and must not be claimed to, erase bytes already
// disclosed or an authorization already issued.
//
// EVIDENCE CLASS: RUNTIME for the issuance decisions (the real
// AuthorizationService over a selves_app connection, the real C3 acting-Self
// context, the real RLS policies, the real domain.* DEFINER write boundary) and
// DATABASE for the authoritative revocation record. The storage driver is the
// deterministic local implementation; Phase 12 selects no provider.
//
// The opaque test object is NOT an Artifact payload. `photo` remains a
// non-creatable payload; the Artifact under test is an ordinary text Artifact,
// and its text body is never carried through the byte plane.

let h: AuthzHarness;
let su: pg.Pool;

beforeAll(() => {
  h = makeAuthz();
  su = h.su;
});
afterAll(() => h.end());

interface Scene {
  account: string;
  grantor: string; // slot 1 — authors the Artifact, issues and revokes the Key
  grantee: string; // slot 2 — holds the revocable ground
  third: string; //   slot 3 — a sibling with no ground
  stranger: string; // a Self on another account
}

async function scene(): Promise<Scene> {
  const account = await newAccount(su);
  const grantor = await newSelf(su, account, 1, 'grantor');
  const grantee = await newSelf(su, account, 2, 'grantee');
  const third = await newSelf(su, account, 3, 'third');
  const other = await newAccount(su);
  const stranger = await newSelf(su, other, 1, 'stranger');
  return { account, grantor, grantee, third, stranger };
}

/** Move a departing placement past the server-enforced departure floor. */
async function elapseFloor(placementId: string): Promise<void> {
  await su.query(
    "UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1",
    [placementId],
  );
}

/** Drive a real Key transmission to Settled — the ratified revocable ground. */
async function settleKey(s: Scene, resource: string): Promise<void> {
  await h.service.setDepartureInterval(accountCtx(s.account), 5);
  const kp = await h.service.createKeyPlacementDraft(actingCtx(s.grantor), resource);
  await h.service.addRecipient(actingCtx(s.grantor), kp, s.grantee);
  await h.service.beginDeparture(actingCtx(s.grantor), kp);
  await elapseFloor(kp);
  await h.service.settlePlacement(actingCtx(s.grantor), kp);
}

/** The authoritative grant row for a (grantee, resource) pair. */
async function grantRow(
  grantee: string,
  resource: string,
): Promise<{ n: number; granted_at: Date | null; revoked_at: Date | null }> {
  const { rows } = await su.query<{ n: number; granted_at: Date | null; revoked_at: Date | null }>(
    `SELECT count(*)::int n, min(granted_at) granted_at, max(revoked_at) revoked_at
       FROM public.key_grants WHERE grantee_self_id = $1 AND protected_resource_id = $2`,
    [grantee, resource],
  );
  return rows[0]!;
}

async function authoritativeRowCounts(): Promise<Record<string, number>> {
  const { rows } = await su.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM public.artifacts)            AS artifacts,
            (SELECT count(*)::int FROM public.placements)           AS placements,
            (SELECT count(*)::int FROM public.placement_recipients) AS placement_recipients,
            (SELECT count(*)::int FROM public.key_grants)           AS key_grants,
            (SELECT count(*)::int FROM public.outbox_events)        AS outbox_events`,
  );
  return rows[0]!;
}

interface Rig {
  readonly issuer: ObjectAccessIssuer;
  readonly storage: ObjectStorage;
  readonly binding: TestBindingResolver;
  readonly ledger: CallLedger;
  readonly mc: ManualClock;
}

/** The ratified boundary, composed exactly as createObjectAccessIssuer requires,
 *  over the REAL AuthorizationService. Production composes nothing. */
function rig(): Rig {
  const mc = manualClock();
  const ledger = makeCallLedger();
  const binding = testBindingResolver(ledger);
  const storage = createLocalObjectStorage({ clock: mc.clock });
  const issuer = createObjectAccessIssuer({
    authorization: recordingAuthorization(h.service, ledger),
    binding,
    storage,
    clock: mc.clock,
  });
  return { issuer, storage, binding, ledger, mc };
}

describe('P12-D object download authorization is subordinate to authoritative Artifact read', () => {
  it('P12-D — loss of the revocable Artifact-read ground prevents issuance of a new download authorization', async () => {
    const s = await scene();
    const r = rig();

    // ── 1. an authoritative text Artifact, authored through the real surface ──
    const artifactId = await h.service.createArtifact(actingCtx(s.grantor), 'the protected text');
    const { rows: artifactRows } = await su.query<{ payload_type: string; author_self_id: string }>(
      'SELECT payload_type, author_self_id FROM public.artifacts WHERE id = $1',
      [artifactId],
    );
    expect(artifactRows[0]).toEqual({ payload_type: 'text', author_self_id: s.grantor });

    // ── 2. recipient access through a ratified REVOCABLE ground (the Key) ─────
    await settleKey(s, artifactId);
    expect((await grantRow(s.grantee, artifactId)).revoked_at).toBeNull();
    expect((await h.service.readArtifact(actingCtx(s.grantee), artifactId)).ok).toBe(true);

    // ── 3. an opaque test object, bound to that Artifact by TEST APPARATUS ────
    // No production path creates this binding; production ships no resolver.
    const secretBytes = new Uint8Array([0xbe, 0xef, 0x01, 0x02]);
    const key = await placeTestObject(r.storage, r.mc.clock, secretBytes);
    r.binding.bind(artifactId, key);

    // ── 4. request download authorization while access is live ───────────────
    const issued = await r.issuer.issueDownloadAuthorization(actingCtx(s.grantee), artifactId);

    // ── 5. it is issued, bounded, and usable ─────────────────────────────────
    expect(issued.ok).toBe(true);
    const liveAuth: ObjectAuthorization = (issued as { ok: true; value: ObjectAuthorization }).value;
    expect(liveAuth.mode).toBe('read');
    expect(liveAuth.expiresAt.getTime() - r.mc.nowMs()).toBe(300_000);
    const retrieved = await r.storage.get(liveAuth);
    expect(Array.from(retrieved)).toEqual([0xbe, 0xef, 0x01, 0x02]);

    // ── 6. revoke the ground through the existing authoritative lifecycle ─────
    await h.service.revokeKey(actingCtx(s.grantor), s.grantee, artifactId);

    // ── 7. PostgreSQL records the revocation, preserving the history ──────────
    const after = await grantRow(s.grantee, artifactId);
    expect(after.n).toBe(1); // the grant row is preserved, not deleted
    expect(after.granted_at).not.toBeNull(); // issuance history intact
    expect(after.revoked_at).not.toBeNull(); // revocation recorded
    // and the authoritative read decision itself now denies
    expect((await h.service.readArtifact(actingCtx(s.grantee), artifactId)).ok).toBe(false);

    // ── 8-9. a NEW download authorization is not issued ──────────────────────
    const afterRevocation = await r.issuer.issueDownloadAuthorization(actingCtx(s.grantee), artifactId);
    expect(afterRevocation).toEqual({ ok: false });

    // ── 10. bytes already retrieved remain available to their holder ─────────
    // Nothing in this system claims to reach back and erase them.
    expect(Array.from(retrieved)).toEqual([0xbe, 0xef, 0x01, 0x02]);

    // ── 11. the ALREADY-ISSUED authorization still redeems while unexpired ───
    // This is the honest residual window. Phase 12 does not claim reliable
    // revocation of an authorization issued before revocation.
    const redeemedAfterRevocation = await r.storage.get(liveAuth);
    expect(Array.from(redeemedAfterRevocation)).toEqual([0xbe, 0xef, 0x01, 0x02]);

    // ── 12. and it fails once its bounded lifetime elapses ───────────────────
    // The short lifetime is what bounds the residual exposure.
    r.mc.advanceSeconds(300);
    expect(r.mc.nowMs()).toBe(liveAuth.expiresAt.getTime());
    expect(await failureReason(() => r.storage.get(liveAuth))).toBe('expired');
    // and no replacement can be obtained
    expect(await r.issuer.issueDownloadAuthorization(actingCtx(s.grantee), artifactId)).toEqual({ ok: false });
  });
});

describe('P12-D issuance ordering — PostgreSQL decides before any binding lookup', () => {
  it('a denied Artifact read causes ZERO binding lookups', async () => {
    const s = await scene();
    const r = rig();
    const artifactId = await h.service.createArtifact(actingCtx(s.grantor), 'private');
    const key = await placeTestObject(r.storage, r.mc.clock, new Uint8Array([1]));
    r.binding.bind(artifactId, key); // a binding EXISTS; the denial must not reach it

    const result = await r.issuer.issueDownloadAuthorization(actingCtx(s.stranger), artifactId);

    expect(result).toEqual({ ok: false });
    expect(r.binding.lookupCount()).toBe(0);
    expect(r.ledger.events).toEqual(['readArtifact']);
  });

  it('an allowed read consults the binding only afterwards, in that order', async () => {
    const s = await scene();
    const r = rig();
    const artifactId = await h.service.createArtifact(actingCtx(s.grantor), 'mine');
    const key = await placeTestObject(r.storage, r.mc.clock, new Uint8Array([2]));
    r.binding.bind(artifactId, key);

    expect((await r.issuer.issueDownloadAuthorization(actingCtx(s.grantor), artifactId)).ok).toBe(true);
    expect(r.ledger.events).toEqual(['readArtifact', 'objectFor']);
    expect(r.binding.lookupCount()).toBe(1);
  });
});

describe('P12-D denial is uniform and discloses nothing', () => {
  it('an AUTHORIZED Artifact with no bound object returns the identical opaque result', async () => {
    const s = await scene();
    const r = rig();
    const artifactId = await h.service.createArtifact(actingCtx(s.grantor), 'unbound');
    // the author is unambiguously authorized to read it
    expect((await h.service.readArtifact(actingCtx(s.grantor), artifactId)).ok).toBe(true);

    const result = await r.issuer.issueDownloadAuthorization(actingCtx(s.grantor), artifactId);
    expect(result).toEqual({ ok: false }); // identical to an authorization denial
    expect(r.binding.lookupCount()).toBe(1); // the lookup ran; it simply found nothing
  });

  it('a stranger, a ground-less sibling, and an absent Artifact are all indistinguishable', async () => {
    const s = await scene();
    const r = rig();
    const artifactId = await h.service.createArtifact(actingCtx(s.grantor), 'private');
    const key = await placeTestObject(r.storage, r.mc.clock, new Uint8Array([3]));
    r.binding.bind(artifactId, key);

    expect(await r.issuer.issueDownloadAuthorization(actingCtx(s.stranger), artifactId)).toEqual({ ok: false });
    expect(await r.issuer.issueDownloadAuthorization(actingCtx(s.third), artifactId)).toEqual({ ok: false });
    expect(
      await r.issuer.issueDownloadAuthorization(actingCtx(s.grantor), '00000000-0000-0000-0000-000000000000'),
    ).toEqual({ ok: false });
    // none of the three passed the authoritative decision, so none of the three
    // reached the binding at all
    expect(r.binding.lookupCount()).toBe(0);
  });
});

describe('P12-D storage activity manufactures no authoritative fact', () => {
  it('placing bytes and issuing a download authorization change no authoritative row count', async () => {
    const s = await scene();
    const r = rig();
    const artifactId = await h.service.createArtifact(actingCtx(s.grantor), 'counted');

    const before = await authoritativeRowCounts();

    const key = await placeTestObject(r.storage, r.mc.clock, new Uint8Array([9, 9, 9]));
    r.binding.bind(artifactId, key);
    const issued = await r.issuer.issueDownloadAuthorization(actingCtx(s.grantor), artifactId);
    expect(issued.ok).toBe(true);
    await r.storage.get((issued as { ok: true; value: ObjectAuthorization }).value);

    const after = await authoritativeRowCounts();

    // No Artifact, Placement, recipient row, Key grant, or outbox event was
    // created by uploading bytes, issuing a capability, or downloading.
    expect(after).toEqual(before);
  });
});
