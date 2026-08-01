// P10-S9 — bootstrap authentication gate logic (R2). Pure: no React, no DOM.
//
// The committed login surface is POST /auth/session with body { secret }.
// auth.issue_session resolves the account in-DB from the credential hash, so
// there is no account identifier to send: one credential field, one act, which
// is what R2 requires rather than something the client argues its way into.
//
// Classification is deliberately blunt. 204 authenticates; every other status
// is one undifferentiated failure. R2 forbids an error taxonomy, so the client
// never distinguishes 400 from 401 from 403 in what it presents — and a
// transport failure is that same single failure, not a fifth case.
//
// This is explicitly non-shippable bootstrap authentication (R2).

import { sendAccount, type Transport } from '../api/transport.ts';

export type AttemptResult = 'authenticated' | 'failed';

/** 204 is success; everything else is the single failure. */
export function classifyAttempt(status: number): AttemptResult {
  return status === 204 ? 'authenticated' : 'failed';
}

export interface GateState {
  readonly secret: string;
  readonly failed: boolean;
}

export const initialGate: GateState = { secret: '', failed: false };

export const withSecret = (state: GateState, secret: string): GateState => ({ ...state, secret });

/** A new submission clears the prior failure and preserves the secret. There is
 *  no separate retry affordance: this act IS the retry. */
export const onSubmit = (state: GateState): GateState => ({ ...state, failed: false });

/** Failure retains the secret. Clearing it would force a human to retype a
 *  credential after a transport failure they cannot distinguish from a wrong
 *  secret — which the undifferentiated failure state makes worse, not better.
 *  Retention is not remember-me: the value lives only in gate state, is never
 *  persisted, and ceases to exist when the gate does. */
export const onFailure = (state: GateState): GateState => ({ ...state, failed: true });

/** The full authentication act. Nothing is stored: the server's cookie is the
 *  session (R2), and the client persists no authentication state anywhere. */
export async function authenticate(transport: Transport, secret: string): Promise<AttemptResult> {
  try {
    const res = await sendAccount(transport, {
      method: 'POST',
      path: '/auth/session',
      body: { secret },
    });
    return classifyAttempt(res.status);
  } catch {
    return 'failed'; // transport failure is the same single failure
  }
}
