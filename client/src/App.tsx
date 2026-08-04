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
//
// P10-S12.1 — a Self-scoped 401 or 403 has one meaning and one disposition,
// whichever read produced it. Every 403 from every Self-scoped read reaches the
// single `forbidden` call site below, which settles through `onForbidden` and
// nothing resembling it; every 401 reaches `onSessionExpired` and the gate. A
// surface
// decides what it renders afterwards. It does not decide whether the active
// Self is forgotten, whether the persisted id survives, or whether
// re-verification happens.
import { useCallback, useEffect, useState } from 'react';
import { sendAccount, type Transport } from './api/transport.ts';
import AuthGate from './auth/AuthGate.tsx';
import { outcomeOf, presentsGate, type Outcome } from './auth/session.ts';
import Correspondences from './correspondences/Correspondences.tsx';
import { readCorrespondences } from './correspondences/read.ts';
import {
  onCompose,
  onContinue,
  onLeaveComposer,
  onReadResolved,
  onReturn,
  prismSurface,
  type Surface,
} from './correspondences/surface.ts';
import { performSend } from './composer/act.ts';
import Composer from './composer/Composer.tsx';
import { performAdd } from './composer/recipient-add.ts';
import { performRemove } from './composer/recipient-remove.ts';
import { performDeparture } from './composer/departure.ts';
import { noDeparture, permitsDeparture, type DepartureState } from './composer/departure-state.ts';
import { performCancellation } from './composer/cancellation.ts';
import { permitsCancellation } from './composer/cancellation-state.ts';
import { deriveCandidates, noRecipients, type RecipientState } from './composer/recipient-state.ts';
import { onReopenDraft, retain, type RetainedDraft } from './composer/retained-draft.ts';
import { initialComposer, withText, type ComposerState } from './composer/state.ts';
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
import { settleForbidden } from './self/forbidden.ts';
import { loadSelves } from './self/load.ts';
import SelfSwitcher from './self/SelfSwitcher.tsx';
import { parseSelves, type SelfSummary } from './self/selves.ts';

const browserTransport: Transport = (url, init) => fetch(url, init);

export default function App() {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [selves, setSelves] = useState<SelfSummary[]>([]);
  const [activeSelfId, setActiveSelfId] = useState<string | null>(null);
  const [artifactCount, setArtifactCount] = useState<number | null>(null);
  const [surface, setSurface] = useState<Surface>(prismSurface);
  // P10-S14 — ONE authoritative Composer state. The composed text lives inside
  // it, never beside it: the text rendered, the text submitted, the text
  // preserved after a failure, and the text a retry would reuse are the same
  // field, so they cannot drift apart on an irreversible write path.
  const [composerState, setComposerState] = useState<ComposerState>(initialComposer);
  // P10-S15 — recipient state has ONE authoritative home, and it is here rather
  // than inside ComposerState: the committed `created` shape is not widened to
  // carry recipients. Candidates, the add request, the successful update, and
  // retry all read from this one value, so no second or optimistic list exists.
  const [recipientState, setRecipientState] = useState<RecipientState>(noRecipients);
  // P10-S16 — the retained draft. Leaving the Composer used to discard the only
  // client reference to a durable Placement row; this is the mechanism that
  // keeps it reachable for the rest of the page session. One value, written on
  // a permitted leave and restored on a guarded reopen.
  const [retainedDraft, setRetainedDraft] = useState<RetainedDraft | null>(null);
  // P10-S17 — departure lifecycle state, separate from the draft's own. A
  // Placement that has departed is no longer correctable, and the joint
  // settlement below is what makes the client stop describing it as such at the
  // same instant it stops being true.
  const [departureState, setDepartureState] = useState<DepartureState>(noDeparture);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = sessionStorageOrNull();
      const loaded = await loadSelves(browserTransport);
      if (cancelled) return;
      if (loaded.kind === 'unauthenticated') {
        setOutcome({ kind: 'unauthenticated' });
        onSessionExpired(store); // no active-Self assertion survives an invalid session
        return;
      }
      if (loaded.kind !== 'listed') {
        setOutcome({ kind: 'transport-failure' });
        return;
      }
      setOutcome({ kind: 'ok' });
      setSelves(loaded.selves);
      // The ONLY call site of restore, and it is inside this one-time effect.
      setActiveSelfId(restore(store, loaded.selves));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // P10-S12.3 — successful authentication establishes authoritative Self state.
  // Setting the outcome to `ok` is not enough: the mount effect above is keyed
  // on [] and cannot re-run within a page load, so without this the Self list
  // stays empty and the human lands on the empty shell after authenticating.
  // The load runs once per authentication act — an explicit human act under
  // R12 — and never calls restore: the gate is reached only on 401 (R2/P10-M5),
  // both 401 paths discard the persisted id first, and keeping restore at one
  // call site is what leaves the P10-S11 loop proof untouched.
  const authenticated = useCallback(async () => {
    const loaded = await loadSelves(browserTransport);
    if (loaded.kind === 'unauthenticated') return; // the gate stays; no loop is started
    setOutcome({ kind: 'ok' });
    if (loaded.kind === 'listed') setSelves(loaded.selves);
  }, []);

  // 401 — the session is no longer valid. One disposition, whichever read
  // produced it: discard the assertion and present the gate (R2, P10-M5).
  const sessionExpired = useCallback(() => {
    onSessionExpired(sessionStorageOrNull());
    setActiveSelfId(null);
    setOutcome({ kind: 'unauthenticated' });
    setSurface(prismSurface);
  }, []);

  // 403 — a valid session asserting a Self it may no longer act as. R3's ruled
  // transition: discard the persisted id and re-verify EXACTLY ONCE. Every
  // Self-scoped read reaches this one call site; no surface approximates it.
  //
  // P10-S12.2 — settleForbidden does not reject, so the transition completes
  // whether the one attempt returned a response or threw. Where it returns no
  // authoritative list the shell has no surface to present: that empty result
  // is a stated Phase-10 limitation, not a designed state, and nothing here
  // manufactures an authentication failure to escape it.
  const forbidden = useCallback(async () => {
    const settled = await settleForbidden(sessionStorageOrNull(), async () => {
      const res = await sendAccount(browserTransport, { method: 'GET', path: '/auth/selves' });
      // The single re-verification may itself find no session. That is a 401
      // and belongs to the 401 transition, never to a second forbidden pass.
      if (outcomeOf(res.status).kind === 'unauthenticated') {
        sessionExpired();
        return [];
      }
      // A non-auth failure yields no list. There is no retry: onForbidden
      // re-verifies once and returns whatever the one answer was.
      return res.ok ? parseSelves(await res.json()) : [];
    });
    setSelves(settled.selves);
    setActiveSelfId(settled.activeSelfId);
    setSurface(settled.surface);
  }, [sessionExpired]);

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
      const outcome = await fetchArtifactCount(browserTransport, activeSelfId);
      if (cancelled) return;
      // An authorization outcome is not an unknown count and never becomes one.
      if (outcome.kind === 'session-expired') return sessionExpired();
      if (outcome.kind === 'forbidden') return void forbidden();
      // Completion: an authoritative count is recorded; no authoritative count
      // releases the Self into selection. sessionStorage is not touched.
      const next = onCountResolved(activeSelfId, outcome.kind === 'count' ? outcome.count : null);
      setActiveSelfId(next.activeSelfId);
      setArtifactCount(next.artifactCount);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSelfId, sessionExpired, forbidden]);

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
      // 401 and 403 are not unavailability: they route to the same authoritative
      // transitions every other Self-scoped read routes to (P10-S12.1).
      if (read.kind === 'session-expired') return sessionExpired();
      if (read.kind === 'forbidden') return void forbidden();
      setSurface({ kind: 'correspondences', state: onReadResolved(read, activeSelfId, selves) });
    })();
    return () => {
      cancelled = true;
    };
  }, [surface, activeSelfId, selves, sessionExpired, forbidden]);

  if (outcome !== null && presentsGate(outcome)) {
    return <AuthGate transport={browserTransport} onAuthenticated={() => void authenticated()} />;
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
    // Compose sits beside the projection, not inside it: it annotates,
    // selects, and enters no counterpart group, and Correspondences itself is
    // untouched by it.
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setComposerState(initialComposer); // the Composer opens empty
            setRecipientState(noRecipients); // and with no recipients carried in
            setDepartureState(noDeparture); // and with no lifecycle state carried in
            setSurface(onCompose(surface.state));
          }}
        >
          Compose
        </button>
        {retainedDraft === null ? null : (
          <button type="button" onClick={() => setSurface(onReopenDraft(surface, retainedDraft))}>
            Resume draft
          </button>
        )}
        <Correspondences state={surface.state} onReturn={() => setSurface(onReturn())} />
      </>
    );
  }

  if (surface.kind === 'composer' && activeSelfId !== null) {
    // A reopened surface carries the exact retained value; restore it into the
    // live state rather than rebuilding anything from it.
    const live: ComposerState =
      surface.draft === null
        ? composerState
        : { kind: 'created', artifactId: surface.draft.artifactId, placementId: surface.draft.placementId };
    const liveRecipients = surface.draft === null ? recipientState : surface.draft.recipients;
    return (
      <Composer
        state={live}
        onTextChange={(text) => setComposerState(withText(live, text))}
        onSend={() =>
          performSend(
            {
              transport: browserTransport,
              actingSelfId: activeSelfId,
              apply: setComposerState,
              // The concrete authoritative transitions, not approximations.
              dispositions: { onSessionExpired: sessionExpired, onForbidden: forbidden },
            },
            live,
          )
        }
        onReturn={() => {
          const left = onLeaveComposer(surface, live, liveRecipients);
          if (left === surface) return; // a pending mutation refuses departure
          if (live.kind === 'created') {
            setRetainedDraft(retain(live.artifactId, live.placementId, liveRecipients, surface.from));
          }
          setComposerState(live);
          setRecipientState(liveRecipients);
          setSurface(left);
        }}
        recipients={
          live.kind === 'created'
            ? {
                state: liveRecipients,
                candidates: deriveCandidates(selves, activeSelfId),
                known: deriveCandidates(selves, activeSelfId).filter((c) =>
                  liveRecipients.recipients.includes(c.id),
                ),
                onAdd: (candidateId) =>
                  void performAdd(
                    {
                      transport: browserTransport,
                      actingSelfId: activeSelfId,
                      placementId: live.placementId,
                      apply: setRecipientState,
                      // The concrete authoritative transitions, not approximations.
                      dispositions: { onSessionExpired: sessionExpired, onForbidden: forbidden },
                    },
                    liveRecipients,
                    candidateId,
                  ),
                onRemove: (targetId) =>
                  void performRemove(
                    {
                      transport: browserTransport,
                      actingSelfId: activeSelfId,
                      placementId: live.placementId,
                      apply: setRecipientState,
                      dispositions: { onSessionExpired: sessionExpired, onForbidden: forbidden },
                    },
                    liveRecipients,
                    targetId,
                  ),
              }
            : undefined
        }
        departure={
          live.kind === 'created'
            ? {
                state: departureState,
                // The SAME authoritative predicate the boundary uses; the
                // control never offers what startDeparture would refuse.
                eligible: permitsDeparture(live, liveRecipients, departureState),
                onDepart: () =>
                  void performDeparture(
                    {
                      transport: browserTransport,
                      actingSelfId: activeSelfId,
                      // One joint result: departed state and the extinguished
                      // retained draft arrive together, never as two setters
                      // that could disagree.
                      apply: (settlement) => {
                        setDepartureState(settlement.departure);
                        setRetainedDraft(settlement.retainedDraft);
                      },
                      dispositions: { onSessionExpired: sessionExpired, onForbidden: forbidden },
                    },
                    live,
                    liveRecipients,
                    departureState,
                    retainedDraft,
                  ),
              }
            : undefined
        }
        cancellation={
          live.kind === 'created'
            ? {
                // The SAME authoritative predicate the boundary uses, over the
                // SAME one lifecycle value the departure bundle carries.
                eligible: permitsCancellation(departureState),
                onCancel: () =>
                  void performCancellation(
                    {
                      transport: browserTransport,
                      actingSelfId: activeSelfId,
                      // One joint result: the cancelled lifecycle and the null
                      // retained draft arrive together, never as two setters
                      // that could disagree.
                      apply: (settlement) => {
                        setDepartureState(settlement.lifecycle);
                        setRetainedDraft(settlement.retainedDraft);
                      },
                      dispositions: { onSessionExpired: sessionExpired, onForbidden: forbidden },
                    },
                    departureState,
                    retainedDraft,
                  ),
              }
            : undefined
        }
      />
    );
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
