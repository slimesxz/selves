import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { appTestPool, superuserPool } from './helpers/auth.ts';
import { expectPgError } from './helpers/db.ts';
import {
  makeAuthz, actingCtx, accountCtx, newAccount, newSelf, capturingSink,
} from './helpers/authz.ts';
import type { AuthorizationService } from '../src/authz/service.ts';
import type { DecisionSink, Outcome } from '../src/authz/reasons.ts';

// P8 R5 (decision 0008 R5 / 0009) — the capability register is invisible to the
// application role. selves_app holds no column grant on public.key_grants and RLS
// is enabled with NO application policy. The register is unreadable by the app at
// the privilege layer; RLS is defense-in-depth so a future accidental grant still
// fails closed. The capability nevertheless still authorizes reads, because the
// grantee-fact read moved into the owner-run domain.artifact_facts (R1), which
// bypasses this unforced RLS by ownership.

let app: pg.Pool;
let su: pg.Pool;

beforeAll(() => {
  app = appTestPool();
  su = superuserPool();
});
afterAll(async () => {
  await Promise.all([app.end(), su.end()]);
});

describe('P8 R5 key_grants register invisibility', () => {
  it('key_grants has RLS enabled and no policy (defense in depth)', async () => {
    const { rows: rls } = await su.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.key_grants'::regclass",
    );
    expect(rls[0]!.relrowsecurity, 'key_grants RLS enabled').toBe(true);
    expect(rls[0]!.relforcerowsecurity, 'key_grants NOT forced (R8)').toBe(false);
    const { rows: pol } = await su.query<{ n: number }>(
      "SELECT count(*)::int n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'key_grants'",
    );
    expect(pol[0]!.n, 'no application policy on key_grants').toBe(0);
  });

  it('selves_app cannot read key_grants even when an active grant row exists (42501)', async () => {
    // Seed a real active grant via the superuser (bypasses RLS); the app is still blind.
    const account = await newAccount(su);
    const grantor = await newSelf(su, account, 1, 'r5-grantor');
    const grantee = await newSelf(su, account, 2, 'r5-grantee');
    const { rows: art } = await su.query<{ id: string }>(
      "INSERT INTO public.artifacts (author_self_id, payload_type, text_body) VALUES ($1, 'text', 'x') RETURNING id",
      [grantor],
    );
    await su.query(
      'INSERT INTO public.key_grants (grantor_self_id, grantee_self_id, protected_resource_id) VALUES ($1, $2, $3)',
      [grantor, grantee, art[0]!.id],
    );
    // The register is invisible to the app at the privilege layer.
    await expectPgError(() => app.query('SELECT * FROM public.key_grants'), '42501');
    await expectPgError(() => app.query('SELECT grantee_self_id FROM public.key_grants'), '42501');
    await expectPgError(
      () => app.query('SELECT 1 FROM public.key_grants WHERE grantee_self_id = $1', [grantee]),
      '42501',
    );
  });
});

describe('P8 R5 — the capability still authorizes despite register invisibility', () => {
  let h: ReturnType<typeof makeAuthz>;
  let su2: pg.Pool;
  let service: AuthorizationService;
  let events: { operation: string; outcome: Outcome<string> }[];
  let sink: DecisionSink;

  beforeAll(() => {
    const cap = capturingSink();
    sink = cap.sink;
    events = cap.events;
    h = makeAuthz(sink);
    su2 = h.su;
    service = h.service;
  });
  afterAll(() => h.end());

  async function elapseFloor(id: string): Promise<void> {
    await su2.query("UPDATE public.placements SET created_at = now() - interval '2 min', departing_at = now() - interval '90 sec' WHERE id = $1", [id]);
  }

  it('an active Key still grants the read (KEY_VALID) through the owner-run predicate', async () => {
    const account = await newAccount(su2);
    const grantor = await newSelf(su2, account, 1, 'grantor');
    const grantee = await newSelf(su2, account, 2, 'grantee');
    const R = await service.createArtifact(actingCtx(grantor), 'secret');
    await service.setDepartureInterval(accountCtx(account), 5);
    const kp = await service.createKeyPlacementDraft(actingCtx(grantor), R);
    await service.addRecipient(actingCtx(grantor), kp, grantee);
    await service.beginDeparture(actingCtx(grantor), kp);
    await elapseFloor(kp);
    await service.settlePlacement(actingCtx(grantor), kp);

    events.length = 0;
    expect((await service.readArtifact(actingCtx(grantee), R)).ok).toBe(true);
    const allow = events.filter((e) => e.operation === 'readArtifact').at(-1);
    expect(allow?.outcome).toEqual({ kind: 'allow', ground: 'KEY_VALID' });
  });
});
