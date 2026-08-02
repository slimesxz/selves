// P10-S9/P10-S10 — the app shell. It determines session presence once on load,
// presents the authentication gate on 401 and on nothing else (R2, P10-M5), and
// otherwise presents Self selection until a Self is deliberately chosen.
//
// The load-time request is what makes R2 satisfiable at all: the gate "appears
// only after a 401", so some request must produce one. Under R12 that fetch is
// permitted because page load is navigation — it is not polling, not
// background refresh, and not focus revalidation. It runs once, and P10-S10
// consumes the response it already made rather than issuing a second.
//
// No auto-selection: a one-Self account is offered the same choice as a
// three-Self account. A restored choice is one the human already made in this
// tab, and only after it re-verifies against the returned list.
//
// With a Self active the shell presents the Prism floor once its authoritative
// count is known. Until then, and where no authoritative count is obtained, it
// renders nothing: the honest absence of a surface, not a designed empty state
// and not a placeholder (P10-C2). Nothing is substituted for an unknown count.
import { useEffect, useState } from 'react';
import { sendAccount, type Transport } from './api/transport.ts';
import AuthGate from './auth/AuthGate.tsx';
import { outcomeOf, presentsGate, type Outcome } from './auth/session.ts';
import { fetchArtifactCount } from './prism/count.ts';
import PrismFloor from './prism/PrismFloor.tsx';
import {
  onSessionExpired,
  presentsSelection,
  remember,
  restore,
  sessionStorageOrNull,
} from './self/active.ts';
import SelfSwitcher from './self/SelfSwitcher.tsx';
import { parseSelves, type SelfSummary } from './self/selves.ts';

const browserTransport: Transport = (url, init) => fetch(url, init);

export default function App() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [selves, setSelves] = useState<SelfSummary[]>([]);
  const [activeSelfId, setActiveSelfId] = useState<string | null>(null);
  const [artifactCount, setArtifactCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = sessionStorageOrNull();
      try {
        const res = await sendAccount(browserTransport, { method: 'GET', path: '/auth/selves' });
        if (cancelled) return;
        const next = outcomeOf(res.status);
        setOutcome(next);
        if (next.kind === 'unauthenticated') {
          onSessionExpired(store); // no active-Self assertion survives an invalid session
          return;
        }
        if (next.kind !== 'ok') return;
        const listed = parseSelves(await res.json());
        if (cancelled) return;
        setSelves(listed);
        setActiveSelfId(restore(store, listed));
      } catch {
        if (!cancelled) setOutcome({ kind: 'transport-failure' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The count is fetched when the Prism mounts for a VERIFIED active Self —
  // this effect runs only once activeSelfId holds a value that survived
  // restore's re-verification — and on explicit navigation to that surface.
  // Never on focus, on an interval, by polling, by background refresh, or
  // attached to the account-scoped /auth/selves request above.
  useEffect(() => {
    if (activeSelfId === null) return;
    let cancelled = false;
    void (async () => {
      const count = await fetchArtifactCount(browserTransport, activeSelfId);
      if (!cancelled) setArtifactCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSelfId]);

  if (outcome !== null && presentsGate(outcome)) {
    return <AuthGate transport={browserTransport} onAuthenticated={() => setOutcome({ kind: 'ok' })} />;
  }

  if (outcome?.kind === 'ok' && selves.length > 0 && presentsSelection(activeSelfId)) {
    return (
      <SelfSwitcher
        selves={selves}
        onSelect={(selfId) => {
          remember(sessionStorageOrNull(), selfId);
          setActiveSelfId(selfId);
        }}
      />
    );
  }

  if (activeSelfId !== null && artifactCount !== null) {
    return <PrismFloor selves={selves} activeSelfId={activeSelfId} artifactCount={artifactCount} />;
  }

  return <main />;
}
