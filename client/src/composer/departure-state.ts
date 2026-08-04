// P10-S17 — departure state. Synchronous, transport-free, callback-free.
//
// Departure is the first client act that moves a Placement out of the state
// where it can be corrected. Everything the last two sub-steps built — recipient
// add, recipient removal, retained draft, guarded reopen — stops applying the
// instant the server writes `departing`, because the committed freeze trigger
// makes the recipient set immutable from that point. So this module's job is to
// make the client's representation change at exactly the same moment, and never
// to describe a Placement as still correctable once it is not.
//
// A separate state rather than a widened ComposerState. That is the smaller
// change, not merely the tidier one: the committed `created` variant is pinned
// by exact-equality assertions in two accepted test files, and widening it would
// force compatibility edits this sub-step is not assigned.
//
// The recipient set carried into `departed` is a FROZEN snapshot of what the
// client knew at the boundary. It is never re-read, and the client infers
// nothing from it about what the server holds.
//
// Nothing here invents time. The server snapshots the account's departure
// interval onto the Placement when departure begins; this slice does not read
// that authoritative value, does not display it, and derives no countdown from
// it or from the local clock. Settlement and cancellation are likewise never
// inferred — a Placement that has departed is departing, and nothing more is
// claimed.

import type { RecipientState } from './recipient-state.ts';
import type { RetainedDraft } from './retained-draft.ts';
import type { ComposerState } from './state.ts';

export interface DepartingPendingState {
  readonly kind: 'departing-pending';
  readonly placementId: string;
  readonly artifactId: string;
  readonly recipients: readonly string[];
}

export interface CancellingPendingState {
  readonly kind: 'cancelling-pending';
  readonly placementId: string;
  readonly artifactId: string;
  readonly recipients: readonly string[];
}

export interface SettlingPendingState {
  readonly kind: 'settling-pending';
  readonly placementId: string;
  readonly artifactId: string;
  readonly recipients: readonly string[];
}

/** P10-S18 — this union is the Placement lifecycle as the client holds it, and
 *  it is the ONE authority for both departure and cancellation eligibility.
 *
 *  It carries the cancellation kinds rather than a second parallel value, and
 *  that is not tidiness. Two values describing one lifecycle can disagree: a
 *  cancellation value reading `cancelled` beside a departure value reset to
 *  `idle` would let `permitsDeparture` below answer true, and the client would
 *  issue a departure request for a Placement its own terminal law says can never
 *  depart again. The server would refuse it — the row is no longer `draft` — but
 *  a client that asks is already wrong.
 *
 *  Because `permitsDeparture` is written as a positive whitelist, every kind
 *  added here is refused by construction. No cancellation-specific exception
 *  exists, and none is needed for whatever lifecycle kind comes next. */
export type DepartureState =
  | { readonly kind: 'idle' }
  | DepartingPendingState
  | {
      readonly kind: 'departure-failed';
      readonly placementId: string;
      readonly artifactId: string;
      readonly recipients: readonly string[];
    }
  | {
      readonly kind: 'departed';
      readonly placementId: string;
      readonly artifactId: string;
      readonly recipients: readonly string[];
    }
  | CancellingPendingState
  | {
      readonly kind: 'cancellation-failed';
      readonly placementId: string;
      readonly artifactId: string;
      readonly recipients: readonly string[];
    }
  /** Terminal. The committed transition is `departing → cancelled`, never back
   *  to `draft`, so nothing leaves this kind and the same Placement can neither
   *  depart again nor have its recipients corrected. */
  | {
      readonly kind: 'cancelled';
      readonly placementId: string;
      readonly artifactId: string;
      readonly recipients: readonly string[];
    }
  | SettlingPendingState
  | {
      readonly kind: 'settlement-failed';
      readonly placementId: string;
      readonly artifactId: string;
      readonly recipients: readonly string[];
    }
  /** Terminal, and the end of the lifecycle. The recipient boundary has been
   *  crossed and the Placement cannot be recalled. Nothing leaves this kind:
   *  it can neither depart, nor cancel, nor settle again. The server would in
   *  fact answer 204 to a repeated settlement — its function returns early on
   *  an already-settled row — so terminality here is the client's own rule
   *  rather than a server rejection, and that asymmetry is recorded rather
   *  than smoothed over. */
  | {
      readonly kind: 'settled';
      readonly placementId: string;
      readonly artifactId: string;
      readonly recipients: readonly string[];
    };

export const noDeparture: DepartureState = { kind: 'idle' };

/** The ONE authoritative eligibility rule. Every startability decision — the
 *  orchestration boundary and any control's visibility alike — reads this and
 *  nothing else, so a control can never offer what the boundary would refuse. */
export function permitsDeparture(
  composer: ComposerState,
  recipients: RecipientState,
  departure: DepartureState,
): boolean {
  if (composer.kind !== 'created') return false;
  if (recipients.recipients.length < 1) return false;
  if (recipients.kind === 'adding' || recipients.kind === 'removing') return false;
  return departure.kind === 'idle' || departure.kind === 'departure-failed';
}

export function onDepartureRequested(
  composer: Extract<ComposerState, { readonly kind: 'created' }>,
  recipients: RecipientState,
): DepartingPendingState {
  return {
    kind: 'departing-pending',
    placementId: composer.placementId,
    artifactId: composer.artifactId,
    recipients: [...recipients.recipients],
  };
}

/** Success and failure both settle through ONE result carrying both effects.
 *  Splitting them into independent setters would leave their simultaneity
 *  unproven, and simultaneity is the whole content of the exclusivity rule: a
 *  Placement must never be representable as retained draft and departing at the
 *  same instant. */
export interface DepartureSettlement {
  readonly departure: DepartureState;
  readonly retainedDraft: RetainedDraft | null;
}

/** Departed, and the retained draft extinguished in the same value. */
export function onDeparted(pending: DepartingPendingState): DepartureSettlement {
  return {
    departure: {
      kind: 'departed',
      placementId: pending.placementId,
      artifactId: pending.artifactId,
      recipients: pending.recipients,
    },
    retainedDraft: null,
  };
}

/** Failed, and the draft left exactly as correctable as it was. Nothing is
 *  frozen, nothing is cleared, and no lifecycle state is inferred — a 409 tells
 *  the client that its act did not take, not what the server now holds. */
export function onDepartureFailed(
  pending: DepartingPendingState,
  retainedDraft: RetainedDraft | null,
): DepartureSettlement {
  return {
    departure: {
      kind: 'departure-failed',
      placementId: pending.placementId,
      artifactId: pending.artifactId,
      recipients: pending.recipients,
    },
    retainedDraft,
  };
}

/** 401 or 403: the acting Self is no longer authoritative, so the attempt is
 *  abandoned rather than failed, and the draft is not retained under it. */
export function onAuthorizationLost(): DepartureSettlement {
  return { departure: noDeparture, retainedDraft: null };
}
