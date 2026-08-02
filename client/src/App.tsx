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
import Correspondences from './correspondences/Correspondences.tsx';
import { readCorrespondences } from './correspondences/read.ts';
import { onContinue, onReadResolved, onReturn, prismSurface, type Surface } from './correspondences/surface.ts';
import { fetchArtifactCount } from './prism/count.ts';
import PrismFloor from './prism/PrismFloor.tsx';
import { onCountRequested, onCountResolved, presentsFloor } from './prism/state.ts';
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
  const [surface, setSurface] = useState<Surface>(prismSurface);

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
    // Start of request: clear any count retained from a previously active Self,
    // so one Self's fact cannot render beside another Self's name.
    setArtifactCount(onCountRequested(activeSelfId).artifactCount);
    void (async () => {
      const count = await fetchArtifactCount(browserTransport, activeSelfId);
      if (cancelled) return;
      // Completion: an authoritative count is recorded; no authoritative count
      // releases the Self into selection. sessionStorage is not touched.
      const next = onCountResolved(activeSelfId, count);
      setActiveSelfId(next.activeSelfId);
      setArtifactCount(next.artifactCount);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSelfId]);

  // Continue's first behavior (P10-S12): the all-or-none Correspondences read
  // runs when — and only when — the surface has just been opened and its state
  // is still pending. One attempt per deliberate human act. Never on focus, on
  // an interval, by polling, by background refresh, or automatically retried;
  // returning to the Prism floor and activating Continue again is the ruled
  // re-attempt path.
  useEffect(() => {
    if (surface.kind !== 'correspondences' || surface.state.kind !== 'pending') return;
    if (activeSelfId === null) return;
    let cancelled = false;
    void (async () => {
      const read = await readCorrespondences(browserTransport, activeSelfId);
      if (cancelled) return;
      // 401 and 403 are not unavailability: they belong to the existing
      // session-expired and forbidden transitions.
      if (read.kind === 'session-expired') {
        onSessionExpired(sessionStorageOrNull());
        setOutcome({ kind: 'unauthenticated' });
        setSurface(onReturn());
        return;
      }
      if (read.kind === 'forbidden') {
        setActiveSelfId(null);
        setSurface(onReturn());
        return;
      }
      setSurface({ kind: 'correspondences', state: onReadResolved(read, activeSelfId, selves) });
    })();
    return () => {
      cancelled = true;
    };
  }, [surface, activeSelfId, selves]);

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

  if (surface.kind === 'correspondences') {
    return <Correspondences state={surface.state} onReturn={() => setSurface(onReturn())} />;
  }

  if (presentsFloor({ activeSelfId, artifactCount })) {
    return (
      <PrismFloor
        selves={selves}
        activeSelfId={activeSelfId!}
        artifactCount={artifactCount!}
        onContinue={() => setSurface(onContinue())}
      />
    );
  }

  return <main />;
}
