import './helpers/env';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { actingCtx, newAccount, newArtifact, newPlacement, newSelf } from './helpers/authz.ts';
import { makeInstrumentedAuthz, makeLedger, type Ledger } from './helpers/ledger.ts';
import type { AuthzHarness } from './helpers/authz.ts';

// P5-D — read ordering (Gate 1 §12, addendum §2). The injected ledger proves,
// per request: every predicate-input read precedes the decision; on ALLOW the
// protected repo/query run only after the decision; on DENY no protected repo
// entry or protected-result query runs at all.

let h: AuthzHarness | undefined;
afterEach(async () => {
  await h?.end();
  h = undefined;
});

function run(l: Ledger): AuthzHarness {
  h = makeInstrumentedAuthz(l);
  return h;
}

describe('read ordering', () => {
  it('allow: predicate-input → decision:allow → protected-repo-entry → protected-result-query', async () => {
    const l = makeLedger();
    const harness = run(l);
    const acct = await newAccount(harness.su);
    const author = await newSelf(harness.su, acct, 1);
    const art = await newArtifact(harness.su, author);

    const r = await harness.service.readArtifact(actingCtx(author), art);
    expect(r.ok).toBe(true);
    expect(l.events).toEqual([
      'predicate-input',
      'decision:allow',
      'protected-repo-entry',
      'protected-result-query',
    ]);
  });

  it('deny (unauthorized-existing): stops at the decision — no protected read', async () => {
    const l = makeLedger();
    const harness = run(l);
    const acctA = await newAccount(harness.su);
    const author = await newSelf(harness.su, acctA, 1, 'author');
    const acctB = await newAccount(harness.su);
    const stranger = await newSelf(harness.su, acctB, 1, 'stranger');
    const art = await newArtifact(harness.su, author);

    const r = await harness.service.readArtifact(actingCtx(stranger), art);
    expect(r.ok).toBe(false);
    expect(l.events).toEqual(['predicate-input', 'decision:unsupported']);
    expect(l.events).not.toContain('protected-repo-entry');
    expect(l.events).not.toContain('protected-result-query');
  });

  it('deny (absent): stops at the decision — no protected read', async () => {
    const l = makeLedger();
    const harness = run(l);
    const acct = await newAccount(harness.su);
    const who = await newSelf(harness.su, acct, 1);

    const r = await harness.service.readPlacement(actingCtx(who), randomUUID());
    expect(r.ok).toBe(false);
    expect(l.events).toEqual(['predicate-input', 'decision:absent']);
  });

  it('deny (ordinary): recipient before settlement stops at the decision', async () => {
    const l = makeLedger();
    const harness = run(l);
    const acctA = await newAccount(harness.su);
    const author = await newSelf(harness.su, acctA, 1, 'author');
    const acctB = await newAccount(harness.su);
    const rcpt = await newSelf(harness.su, acctB, 1, 'rcpt');
    const art = await newArtifact(harness.su, author);
    const placement = await newPlacement(harness.su, { sender: author, artifact: art, state: 'departing', recipients: [rcpt] });

    const r = await harness.service.readPlacement(actingCtx(rcpt), placement);
    expect(r.ok).toBe(false);
    expect(l.events).toEqual(['predicate-input', 'decision:ordinary_deny']);
  });
});
