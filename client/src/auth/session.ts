// P10-S9 — session outcome and gate presentation (R2 as amended by P10-M5;
// R3 as amended by P10-M6). Pure: no React, no DOM.
//
// The 401/403 separation is constitutional, not stylistic. P10-M6 records that
// routing a 403 to the authentication gate was an error: 401 means no valid
// session and reaches the gate; 403 means a valid session asserting an unowned
// Self and belongs to R3's single re-verification path, which is P10-S10's.
// The two must never collapse into one another.

export type Outcome =
  | { kind: 'ok' }
  | { kind: 'unauthenticated' } // 401 — the only condition that reaches the gate
  | { kind: 'forbidden' } // 403 — R3 re-verification (P10-S10), never the gate
  | { kind: 'rejected'; status: number }
  | { kind: 'transport-failure' };

export function outcomeOf(status: number): Outcome {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 401) return { kind: 'unauthenticated' };
  if (status === 403) return { kind: 'forbidden' };
  return { kind: 'rejected', status };
}

/** R2/P10-M5: the gate appears on 401 and nowhere else. It is not navigable —
 *  no URL reaches it and no control links to it; this predicate is the only
 *  thing that presents it. */
export function presentsGate(outcome: Outcome): boolean {
  return outcome.kind === 'unauthenticated';
}
