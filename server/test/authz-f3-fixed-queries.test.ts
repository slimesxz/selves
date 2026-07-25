import './helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type pg from 'pg';
import { makeAuthz, actingCtx, newAccount, newSelf } from './helpers/authz.ts';
import type { AuthorizationService } from '../src/authz/service.ts';

// P8 F3 (decision 0008 F3 / 0009) — no user-controlled expression reaches a policed
// predicate. Every selves_app query against a policed table uses fixed SQL and bound
// parameters compared by equality; no user-supplied expression, operator, pattern,
// cast, ordering fragment, or predicate fragment is interpolated. This is the
// principal T1 control and stands regardless of how R4 resolved. It is enforced two
// ways: a source invariant over the query-issuing modules, and a runtime proof that
// adversarial parameter values are treated as data, never as SQL.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

describe('P8 F3 — fixed-query source invariant', () => {
  // The ONLY module that issues direct SQL against a policed table (artifacts,
  // placements, placement_recipients) as selves_app. Its only template
  // interpolations are two STATIC column-list constants — never a dynamic value.
  const ALLOWED_INTERPOLATIONS = new Set(['ARTIFACT_COLS', 'PLACEMENT_COLS']);

  it('domain.repo.ts interpolates only static column-list constants into SQL', () => {
    const src = read('authz/domain.repo.ts');
    const tokens = [...src.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]!.trim());
    // there IS interpolation (the column lists), and every token is allow-listed
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(ALLOWED_INTERPOLATIONS.has(t), `interpolated token ${t} must be a static column-list constant`).toBe(true);
    }
    // the interpolated constants are themselves plain string literals (no nested
    // interpolation could smuggle a dynamic fragment through them)
    for (const name of ALLOWED_INTERPOLATIONS) {
      const def = new RegExp(`const ${name}\\b[^;]*;`, 's').exec(src)?.[0] ?? '';
      expect(def, `${name} is defined`).not.toBe('');
      expect(def.includes('${'), `${name} definition contains no interpolation`).toBe(false);
    }
  });

  it('the bound-parameter caller modules interpolate NOTHING into their queries', () => {
    // predicates/mutations/auth reach the database only through DEFINER function
    // calls with bound parameters — they must contain no template interpolation at
    // all. Any future ${...} here returns to chamber (F3).
    for (const rel of ['authz/predicates.repo.ts', 'authz/mutations.repo.ts', 'auth/queries.ts']) {
      const src = read(rel);
      expect(src.includes('${'), `${rel} contains no string interpolation`).toBe(false);
    }
  });

  it('every policed-table query compares bound parameters by equality (no interpolated predicate)', () => {
    const src = read('authz/domain.repo.ts');
    // Each remaining WHERE fragment against a policed column is "<col> = $N" — bound,
    // equality. (listReadablePlacements now carries no WHERE: RLS filters it.)
    for (const frag of ['id = $1', 'author_self_id = $1', 'pr.placement_id = $1', 'p.sender_self_id = $2']) {
      expect(src.includes(frag), `expected bound equality fragment: ${frag}`).toBe(true);
    }
    // The RLS-blocked inline recipient subquery was removed from the list read.
    expect(src.includes('r.recipient_self_id = $1'), 'no inline recipient subquery remains').toBe(false);
  });
});

describe('P8 F3 — runtime proof: adversarial parameter values are data, never SQL', () => {
  let h: ReturnType<typeof makeAuthz>;
  let su: pg.Pool;
  let service: AuthorizationService;

  beforeAll(() => {
    h = makeAuthz();
    su = h.su;
    service = h.service;
  });
  afterAll(() => h.end());

  it('a SQL-injection payload in a text parameter is stored literally (no execution)', async () => {
    const account = await newAccount(su);
    const self = await newSelf(su, account, 1, 'f3-author');
    const payload = "Robert'); DROP TABLE public.artifacts; --";

    const id = await service.createArtifact(actingCtx(self), payload);
    const got = await service.readArtifact(actingCtx(self), id);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.textBody).toBe(payload); // stored verbatim as data

    // the table it tried to drop is intact
    const { rows } = await su.query<{ reg: string | null }>("SELECT to_regclass('public.artifacts')::text AS reg");
    expect(rows[0]!.reg).toBe('artifacts');
  });

  it('a SQL-injection payload in an id parameter is bound (rejected as invalid uuid, nothing executed)', async () => {
    const account = await newAccount(su);
    const self = await newSelf(su, account, 1, 'f3-reader');
    const evil = "'; DROP TABLE public.placements; --";

    // The value flows to a bound $N compared against a uuid column: it is cast as
    // DATA, so it fails 22P02 (invalid uuid) — it is never parsed as SQL.
    await expect(service.readArtifact(actingCtx(self), evil)).rejects.toMatchObject({ code: '22P02' });

    // the table it tried to drop is intact
    const { rows } = await su.query<{ reg: string | null }>("SELECT to_regclass('public.placements')::text AS reg");
    expect(rows[0]!.reg).toBe('placements');
  });
});
