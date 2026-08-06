// P10-E5 — recipient management, mounted. Constructed, not run.
//
// SCOPE. Bindings 36 and 45 are constructed here. Bindings 35, 37, 38, 42, 43,
// and 44 are HALTED and are not constructed; the construction report states the
// dependency and the limitation for each.
//
// WHY THE OTHER SIX ARE ABSENT. Every App-level recipient object requires the
// Composer to hold a `created` draft, and production reaches that state only
// through the two-stage creation act — whose mounted bindings are the Group V
// residue (30–34), ruled UNASSIGNABLE for want of authoritative wording and
// excluded from the mounted inventory. They are not closed, so under the E5
// gate they may not be traversed as mechanism without a ruling. Five of the six
// additionally name production wiring — "App supplies", "App applies", "the
// real App call site supplies" — which App-level observation reaches only as a
// downstream consequence under the binding-11 precedent.
//
// MOUNTED SUBJECT. Bindings 36 and 45 name a MOUNTED CONTROL invoking a
// supplied act. That is the binding-11 shape, and the gate authorizes a
// narrower production component where the wording names its direct callback and
// App-level observation would reach only a downstream consequence. This file
// therefore mounts the production `Composer` directly, through the committed
// P10-V1 harness, with the recipient acts supplied as recording functions. No
// wrapper replaces the component, no provider is substituted, no compatibility
// renderer is introduced, and StrictMode remains retained.
//
// The recording mechanism counts PRODUCTION CALLBACK INVOCATIONS AND THEIR
// ARGUMENTS ONLY. It cannot observe renders, state, routing, or requests.
//
// E4 REMAINS OUTSIDE THE MOUNTED INVENTORY under the Group V disposition.
// BINDINGS 24 AND 27 REMAIN OPEN and are not exercised.
// E1, E2, and the closed part of E3 are not reopened; no transition of theirs is
// traversed here, because this file mounts no App and performs no navigation.
// NO CLASS B PROPOSITION IS CONSTRUCTED: there is no transport in this file at
// all, no network, no backend, and no server observation.
//
// StrictMode duplicate development rendering is development semantics: renders
// are never counted, and no assertion depends on render count.
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import Composer from '../../src/composer/Composer.tsx';
import { mount, type Mounted } from '../harness/mount.ts';

/** The completed draft the recipient controls are presented for. */
const DRAFT = { kind: 'created', artifactId: 'artifact-1', placementId: 'placement-1' } as const;

/** TWO eligible candidates with distinct ids and distinct labels. Two are
 *  required: with one control the construct could not distinguish "invokes the
 *  act with the activated candidate's id" from "invokes it with the only id it
 *  has". */
const CANDIDATES = [
  { id: 'self-ora', label: 'Ora' },
  { id: 'self-kite', label: 'Kite' },
];
const ADDED = CANDIDATES[1]!; // the SECOND candidate is activated

/** TWO already-known recipients, for the same reason on the removal side. Their
 *  ids and labels are distinct from each other and from the candidates above,
 *  so no control's identity can be satisfied by coincidence. */
const KNOWN = [
  { id: 'self-wren', label: 'Wren' },
  { id: 'self-lark', label: 'Lark' },
];
const REMOVED = KNOWN[1]!; // the SECOND known recipient is removed

const buttons = (app: Mounted): HTMLButtonElement[] =>
  [...app.container.querySelectorAll('button')] as HTMLButtonElement[];

const byLabel = (app: Mounted, label: string): HTMLButtonElement | undefined =>
  buttons(app).find((b) => b.getAttribute('aria-label') === label);

let app: Mounted | null = null;

afterEach(async () => {
  if (app !== null) await app.unmount();
  app = null;
});

describe('E5 — recipient management, mounted controls', () => {
  // BINDING 36 — accepted wording:
  //   "The mounted candidate control invokes that act."
  // Accepted scope, as corrected at the P10-S15 acceptance: "the element-level
  // form closed in P10-S15; the mounted-DOM form remains open." This construct
  // addresses the mounted-DOM form and nothing else. It observes invocation
  // directly and infers nothing from recipient state, rendered membership, or
  // any request — there is no transport here to produce one.
  it('binding 36 — the mounted candidate control invokes the supplied recipient-add act', async () => {
    const added: string[] = [];
    const onAdd = (candidateId: string): void => {
      added.push(candidateId);
    };

    const mounted = await mount(
      createElement(Composer, {
        state: DRAFT,
        onTextChange: () => {},
        onSend: () => {},
        onReturn: () => {},
        recipients: {
          state: { kind: 'idle', recipients: [] },
          candidates: CANDIDATES,
          onAdd,
        },
      }),
    );
    app = mounted;

    // BEFORE ACTIVATION — no invocation. Mounting, and any duplicate
    // development rendering it performs, invokes nothing.
    expect(added).toEqual([]);

    // Both candidate controls are present, so the activated one is a choice.
    for (const candidate of CANDIDATES) {
      expect(
        byLabel(mounted, `Add recipient ${candidate.label}`),
        `the candidate control for ${candidate.label} is rendered`,
      ).toBeDefined();
    }

    // EXACTLY ONE ACTIVATION, of the SECOND candidate.
    const activated = byLabel(mounted, `Add recipient ${ADDED.label}`);
    await mounted.step(() => {
      activated!.click();
    });

    // AFTER — one invocation, carrying the activated candidate's id.
    expect(added).toEqual([ADDED.id]);
  });

  // BINDING 45 — accepted wording:
  //   "The mounted Remove control invokes the removal act."
  // Accepted scope: "New at the mounted-DOM boundary; the element-level form
  // closed here." This construct addresses the mounted-DOM form only. Removal
  // is offered solely for recipients the client already holds, so the known set
  // is supplied and the control's identity is what is observed.
  it('binding 45 — the mounted Remove control invokes the supplied removal act', async () => {
    const removed: string[] = [];
    const onRemove = (targetId: string): void => {
      removed.push(targetId);
    };

    const mounted = await mount(
      createElement(Composer, {
        state: DRAFT,
        onTextChange: () => {},
        onSend: () => {},
        onReturn: () => {},
        recipients: {
          state: { kind: 'idle', recipients: KNOWN.map((k) => k.id) },
          candidates: [],
          onAdd: () => {},
          onRemove,
          known: KNOWN,
        },
      }),
    );
    app = mounted;

    // BEFORE ACTIVATION — no invocation.
    expect(removed).toEqual([]);

    // Both removal controls are present, so the activated one is a choice.
    for (const known of KNOWN) {
      expect(
        byLabel(mounted, `Remove recipient ${known.label}`),
        `the removal control for ${known.label} is rendered`,
      ).toBeDefined();
    }

    // EXACTLY ONE ACTIVATION, of the SECOND known recipient.
    const activated = byLabel(mounted, `Remove recipient ${REMOVED.label}`);
    await mounted.step(() => {
      activated!.click();
    });

    // AFTER — one invocation, carrying that recipient's id.
    expect(removed).toEqual([REMOVED.id]);
  });
});
