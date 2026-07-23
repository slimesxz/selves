import './helpers/env';
import { describe, expect, it } from 'vitest';
import {
  createAuthorizationService, decideArtifact, decidePlacement,
} from '../src/authz/service.ts';
import type { ArtifactFacts, PlacementFacts, PredicatesRepo } from '../src/authz/predicates.repo.ts';
import type { DomainRepo } from '../src/authz/domain.repo.ts';
import type { Tx, TxPool } from '../src/db.ts';
import { actingCtx, capturingSink } from './helpers/authz.ts';

// P5-D — INVARIANT_FAILURE (Gate 1 §5/§9, addendum §2). Impossible authoritative
// states are NOT manufactured by corrupting the real DB (its constraints make
// them impossible); they are injected by a test-only repository double that
// returns an impossible fact tuple to the REAL AuthorizationService. The service
// classifies them invariant_failure (a DISTINCT internal reason), fails closed,
// and performs NO protected read.

const OK_ARTIFACT: ArtifactFacts = {
  present: true,
  authorSelfId: 'author-1',
  anySettledRecipient: false,
  anyRecipient: false,
  hasActiveForTarget: false,
  hasRevokedForTarget: false,
  hasActiveElsewhere: false,
};

describe('decideArtifact — invariant failures (pure)', () => {
  it('present artifact with null author is invariant_failure, not a policy deny', () => {
    const facts: ArtifactFacts = { ...OK_ARTIFACT, authorSelfId: null };
    expect(decideArtifact(facts, 'someone').kind).toBe('invariant_failure');
  });
  it('a normal unrelated actor is unsupported (contrast — a real, supported deny)', () => {
    expect(decideArtifact(OK_ARTIFACT, 'someone-else')).toEqual({ kind: 'unsupported' });
  });
});

describe('decidePlacement — invariant failures (pure)', () => {
  const base: PlacementFacts = { present: true, senderSelfId: 'sender-1', state: 'settled', recipientRow: false };
  it('present placement with null sender is invariant_failure', () => {
    expect(decidePlacement({ ...base, senderSelfId: null }, 'x').kind).toBe('invariant_failure');
  });
  it('present placement with null state is invariant_failure', () => {
    expect(decidePlacement({ ...base, state: null }, 'x').kind).toBe('invariant_failure');
  });
  it('a state outside the ratified enum is invariant_failure (impossible in the real DB)', () => {
    expect(decidePlacement({ ...base, state: 'archived' }, 'x').kind).toBe('invariant_failure');
  });
});

// A transaction handle whose use would throw — proving neither the predicate
// double nor any protected read touches the database on the failure path.
const throwingTx: Tx = {
  query: async () => {
    throw new Error('tx must not be used on the invariant-failure path');
  },
};
const fakeTxPool: TxPool = {
  withRepeatableRead: (fn) => fn(throwingTx),
};

describe('service fails closed on invariant_failure with no protected read', () => {
  it('readArtifact denies (opaque) and never enters the domain repo', async () => {
    let domainCalls = 0;
    const impossiblePredicates: PredicatesRepo = {
      async artifactFacts() {
        return { ...OK_ARTIFACT, authorSelfId: null }; // impossible tuple
      },
      async placementFacts() {
        throw new Error('unused');
      },
    };
    const spyDomain: DomainRepo = {
      async readArtifact() {
        domainCalls += 1;
        return null;
      },
      async readPlacement() {
        domainCalls += 1;
        return null;
      },
      async listOwnedArtifacts() {
        return [];
      },
      async listReadablePlacements() {
        return [];
      },
      async listRecipientsOfAuthoredPlacement() {
        return [];
      },
    };
    const cap = capturingSink();
    const service = createAuthorizationService({
      txPool: fakeTxPool,
      predicates: impossiblePredicates,
      domain: spyDomain,
      sink: cap.sink,
    });

    const r = await service.readArtifact(actingCtx('actor-1'), 'art-1');
    expect(r.ok).toBe(false); // fail closed — same opaque deny as any other
    expect(domainCalls).toBe(0); // no protected read
    expect(cap.events.at(-1)!.outcome.kind).toBe('invariant_failure'); // distinct internal reason
  });
});
