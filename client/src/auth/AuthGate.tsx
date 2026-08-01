// P10-S9 — the rendered authentication gate. A projection only: every
// constitutional decision lives in gate.ts and session.ts, and nothing here
// may acquire logic (0012 §43). One credential field, one explicit act.
import { useState, type FormEvent } from 'react';
import type { Transport } from '../api/transport.ts';
import { authenticate, initialGate, onFailure, onSubmit, withSecret, type GateState } from './gate.ts';

export default function AuthGate({
  transport,
  onAuthenticated,
}: {
  transport: Transport;
  onAuthenticated: () => void;
}) {
  const [state, setState] = useState<GateState>(initialGate);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const submitting = onSubmit(state); // clears the prior failure, keeps the secret
    setState(submitting);
    const result = await authenticate(transport, submitting.secret);
    if (result === 'authenticated') onAuthenticated();
    else setState(onFailure(submitting));
  }

  return (
    <form onSubmit={submit}>
      <input
        type="password"
        aria-label="Secret"
        value={state.secret}
        onChange={(event) => setState(withSecret(state, event.target.value))}
      />
      <button type="submit">Authenticate</button>
      {state.failed ? <p role="status">Authentication failed.</p> : null}
    </form>
  );
}
