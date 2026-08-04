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
import type { DepartureState } from './departure-state.ts';

/** P10-S15 — the recipient bundle is OPTIONAL by ruling, not by preference.
 *  Required props would break three prior cases outside the single authorized
 *  compatibility edit, so the component has two lawful public shapes: with the
 *  bundle the completed draft exposes recipient add; without it the completed
 *  draft keeps its P10-S14 return-only form. Both are exercised. */
export interface RecipientBundle {
  readonly state: RecipientState;
  readonly candidates: readonly RecipientCandidate[];
  readonly onAdd: (candidateId: string) => void;
  /** P10-S16 — Rule B: removal is offered only for recipients the client
   *  already holds. There is no list of recipients it does not hold, so an
   *  unknown-recipient removal has no control and no request path. */
  readonly onRemove?: (targetId: string) => void;
  /** Labels for known recipients, so removal controls can name whom they drop
   *  rather than showing an internal id. */
  readonly known?: readonly RecipientCandidate[];
}

/** P10-S17 — the departure bundle is OPTIONAL by ruling. Required props would
 *  conflict with prior valid invocations and force unassigned compatibility
 *  edits. With it, an eligible completed draft exposes Depart and the departing
 *  presentation is available; without it the P10-S16 presentation is preserved
 *  exactly. Both are public forms and both are exercised. */
export interface DepartureBundle {
  readonly state: DepartureState;
  /** Derived from the SAME authoritative predicate the boundary uses. */
  readonly eligible: boolean;
  readonly onDepart: () => void;
}

/** P10-S18 — the cancellation bundle is OPTIONAL by ruling. Required props would
 *  invalidate prior correct Composer callers and force compatibility edits this
 *  slice is not assigned to make. It carries no lifecycle value of its own: the
 *  lifecycle is read from the departure bundle, because there is one
 *  authoritative lifecycle and the component may not hold a second. */
export interface CancellationBundle {
  /** Derived from the SAME authoritative predicate the boundary uses. */
  readonly eligible: boolean;
  readonly onCancel: () => void;
}

export default function Composer({
  state,
  onTextChange,
  onSend,
  onReturn,
  recipients,
  departure,
  cancellation,
}: {
  state: ComposerState;
  onTextChange: (text: string) => void;
  onSend: () => void;
  onReturn: () => void;
  recipients?: RecipientBundle;
  departure?: DepartureBundle;
  cancellation?: CancellationBundle;
}) {
  // Cancelled is terminal: it presents what happened and offers no correction,
  // no reopen, no departure, no cancellation, and no settlement.
  if (departure?.state.kind === 'cancelled') {
    return (
      <main>
        <p role="status">Cancelled</p>
        <button type="button" onClick={onReturn}>
          Back
        </button>
      </main>
    );
  }

  // Departed is a lifecycle state, not a draft: it presents what happened and
  // offers correction of neither recipients nor the draft. Cancel appears only
  // when the authoritative predicate permits it and a caller supplied the
  // bundle; its absence leaves the P10-S17 presentation exactly as it was.
  if (departure?.state.kind === 'departed' || departure?.state.kind === 'cancelling-pending' ||
      departure?.state.kind === 'cancellation-failed') {
    return (
      <main>
        <p role="status">Departing</p>
        {departure.state.kind === 'cancelling-pending' ? <p role="status">Cancelling.</p> : null}
        {departure.state.kind === 'cancellation-failed' ? <p role="status">Not cancelled.</p> : null}
        {cancellation && cancellation.eligible ? (
          <button type="button" onClick={cancellation.onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="button" onClick={onReturn}>
          Back
        </button>
      </main>
    );
  }

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
        {recipients?.known?.map((known) => (
          <button
            key={`remove-${known.id}`}
            type="button"
            aria-label={`Remove recipient ${known.label}`}
            onClick={() => recipients.onRemove?.(known.id)}
          >
            {`Remove ${known.label}`}
          </button>
        ))}
        {recipients?.state.kind === 'failed' ? <p role="status">Not added.</p> : null}
        {recipients?.state.kind === 'remove-failed' ? <p role="status">Not removed.</p> : null}
        {recipients?.state.kind === 'removing' ? <p role="status">Removing.</p> : null}
        {recipients?.state.kind === 'adding' ? <p role="status">Adding.</p> : null}
        {departure?.state.kind === 'departing-pending' ? <p role="status">Departing.</p> : null}
        {departure?.state.kind === 'departure-failed' ? <p role="status">Not departed.</p> : null}
        {departure && departure.eligible && departure.state.kind !== 'departing-pending' ? (
          <button type="button" onClick={departure.onDepart}>
            Depart
          </button>
        ) : null}
        {/* Return is withheld while any recipient mutation is unsettled. The
            surface transition refuses to leave regardless; omitting the control
            keeps the presentation honest about that. */}
        {recipients && (recipients.state.kind === 'adding' || recipients.state.kind === 'removing') ? null : (
          <button type="button" onClick={onReturn}>
            Back
          </button>
        )}
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
