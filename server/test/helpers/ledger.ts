import './env';
import { appTestPool, superuserPool } from './auth.ts';
import { appTxPool } from '../../src/db.ts';
import { createAuthorizationService } from '../../src/authz/service.ts';
import { createPredicatesRepo } from '../../src/authz/predicates.repo.ts';
import { createDomainRepo } from '../../src/authz/domain.repo.ts';
import type { PredicatesRepo } from '../../src/authz/predicates.repo.ts';
import type { DomainRepo } from '../../src/authz/domain.repo.ts';
import type { DecisionSink } from '../../src/authz/reasons.ts';
import type { AuthzHarness } from './authz.ts';

// Test-only read-ordering instrumentation, wired purely through DEPENDENCY
// INJECTION (Gate 1 §12): decorators wrap the real repos and a ledger sink
// records the decision. No global mutable ledger, no env-gated production
// recorder, no production hook — production composes the plain repos + NoopSink.
// The decorators are pass-through and cannot change any authorization outcome.

export interface Ledger {
  readonly events: string[];
}
export function makeLedger(): Ledger {
  return { events: [] };
}

export function recordingPredicates(real: PredicatesRepo, l: Ledger): PredicatesRepo {
  return {
    async artifactFacts(tx, actingSelf, id) {
      (l.events as string[]).push('predicate-input');
      return real.artifactFacts(tx, actingSelf, id);
    },
    async placementFacts(tx, actingSelf, id) {
      (l.events as string[]).push('predicate-input');
      return real.placementFacts(tx, actingSelf, id);
    },
  };
}

export function recordingDomain(real: DomainRepo, l: Ledger): DomainRepo {
  const ev = l.events as string[];
  return {
    async readArtifact(tx, id) {
      ev.push('protected-repo-entry');
      const v = await real.readArtifact(tx, id);
      ev.push('protected-result-query');
      return v;
    },
    async readPlacement(tx, id) {
      ev.push('protected-repo-entry');
      const v = await real.readPlacement(tx, id);
      ev.push('protected-result-query');
      return v;
    },
    listOwnedArtifacts: (tx, a) => real.listOwnedArtifacts(tx, a),
    listReadablePlacements: (tx, a) => real.listReadablePlacements(tx, a),
    listRecipientsOfAuthoredPlacement: (tx, a, id) => real.listRecipientsOfAuthoredPlacement(tx, a, id),
  };
}

export function ledgerSink(l: Ledger): DecisionSink {
  return {
    onDecision(_operation, outcome) {
      (l.events as string[]).push(`decision:${outcome.kind}`);
    },
  };
}

/** The real service, instrumented — same composition production uses, with the
 *  recording decorators substituted in. */
export function makeInstrumentedAuthz(l: Ledger): AuthzHarness {
  const appPool = appTestPool();
  const su = superuserPool();
  const service = createAuthorizationService({
    txPool: appTxPool(appPool),
    predicates: recordingPredicates(createPredicatesRepo(), l),
    domain: recordingDomain(createDomainRepo(), l),
    sink: ledgerSink(l),
  });
  return {
    service,
    appPool,
    su,
    async end() {
      await Promise.all([appPool.end(), su.end()]);
    },
  };
}
