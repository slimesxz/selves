// P10-S14 — the rendered Composer. A projection only, and deliberately
// hook-free: every constitutional decision lives in state.ts, create.ts, act.ts,
// and surface.ts, and this component holds no state of its own.
//
// Hook-freedom is ruled rather than stylistic. The client runner has no DOM
// implementation installed, so a component that owned its own state could not be
// invoked at all and none of its bindings could be proven. Held at arm's length
// like this, the element tree can be produced directly, the Send control found,
// and its handler fired — which is the entire proof surface available before
// Segment 10.E.
//
// Editing is offered ONLY while composing. After a successful Artifact stage a
// Placement-stage failure retains the authoritative artifact id, and a retry
// then issues only the Placement request — so an edit would change what is
// rendered while changing nothing that is sent. The failed state therefore shows
// the preserved text and offers no edit affordance.
//
// No return is offered while creating: the two-stage attempt is irreversible in
// its second half, and the surface transition refuses to leave it regardless of
// what is rendered here.

import { nextRequest, type ComposerState } from './state.ts';
import type { RecipientCandidate, RecipientState } from './recipient-state.ts';

/** P10-S15 — the recipient bundle is OPTIONAL by ruling, not by preference.
 *  Required props would break three prior cases outside the single authorized
 *  compatibility edit, so the component has two lawful public shapes: with the
 *  bundle the completed draft exposes recipient add; without it the completed
 *  draft keeps its P10-S14 return-only form. Both are exercised. */
export interface RecipientBundle {
  readonly state: RecipientState;
  readonly candidates: readonly RecipientCandidate[];
  readonly onAdd: (candidateId: string) => void;
}

export default function Composer({
  state,
  onTextChange,
  onSend,
  onReturn,
  recipients,
}: {
  state: ComposerState;
  onTextChange: (text: string) => void;
  onSend: () => void;
  onReturn: () => void;
  recipients?: RecipientBundle;
}) {
  if (state.kind === 'created') {
    return (
      <main>
        <p role="status">Draft created</p>
        {recipients
          ? recipients.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-label={`Add recipient ${candidate.label}`}
                onClick={() => recipients.onAdd(candidate.id)}
              >
                {candidate.label}
              </button>
            ))
          : null}
        {recipients?.state.kind === 'failed' ? <p role="status">Not added.</p> : null}
        <button type="button" onClick={onReturn}>
          Back
        </button>
      </main>
    );
  }

  if (state.kind === 'creating') {
    return (
      <main>
        <p>{state.text}</p>
        <p role="status">Creating.</p>
      </main>
    );
  }

  const sendable = nextRequest(state) !== null;
  return (
    <main>
      {state.kind === 'composing' ? (
        <textarea
          aria-label="Write"
          value={state.text}
          onChange={(event) => onTextChange(event.target.value)}
        />
      ) : (
        <p>{state.text}</p>
      )}
      {state.kind === 'failed' ? <p role="status">Not created.</p> : null}
      {sendable ? (
        <button type="button" onClick={onSend}>
          Send
        </button>
      ) : null}
      <button type="button" onClick={onReturn}>
        Back
      </button>
    </main>
  );
}
