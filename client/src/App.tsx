// P10-S9 — the app shell. It determines session presence once on load and
// presents the authentication gate on 401 and on nothing else (R2, P10-M5).
//
// The load-time request is what makes R2 satisfiable at all: the gate "appears
// only after a 401", so some request must produce one. Under R12 that fetch is
// permitted because page load is navigation — it is not polling, not
// background refresh, and not focus revalidation. It runs once.
//
// GET /auth/selves is used solely as the session probe. Its payload is not read
// and no Self is rendered or selected here; Self selection is P10-S10's.
//
// When the session is present there is no surface yet, so the shell renders
// nothing. That is the honest absence of a surface, not a designed empty state
// and not a placeholder (P10-C2).
import { useEffect, useState } from 'react';
import { sendAccount, type Transport } from './api/transport.ts';
import AuthGate from './auth/AuthGate.tsx';
import { outcomeOf, presentsGate, type Outcome } from './auth/session.ts';

const browserTransport: Transport = (url, init) => fetch(url, init);

export default function App() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await sendAccount(browserTransport, { method: 'GET', path: '/auth/selves' });
        if (!cancelled) setOutcome(outcomeOf(res.status));
      } catch {
        if (!cancelled) setOutcome({ kind: 'transport-failure' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (outcome !== null && presentsGate(outcome)) {
    return <AuthGate transport={browserTransport} onAuthenticated={() => setOutcome({ kind: 'ok' })} />;
  }
  return <main />;
}
