// P10-E6 — lifecycle, mounted. Constructed, not run.
//
// SCOPE. Bindings 50, 57, and 64 are constructed here. Bindings 49, 51, 52, 56,
// 58, 59, 63, 65, 66, and 69 are HALTED and are not constructed; the
// construction report states each ground.
//
// WHY THE OTHER TEN ARE ABSENT — TWO INDEPENDENT GROUNDS.
//
// (1) ROUTE. Every App-level lifecycle object requires a departed Placement,
// and production reaches departure only from a created draft holding AT LEAST
// ONE RECIPIENT — `permitsDeparture` refuses a draft with none. Reaching a
// recipient at App level traverses the recipient-add path, whose App-level
// bindings 35, 37, and 38 are OPEN. P10-CT authorized mechanism-only traversal
// of the CREATION transition and of nothing else, so that route may not be
// taken by implication. The dependency is named, not traversed.
//
// (2) WIRING. Bindings 49, 56, and 63 name what App SUPPLIES; binding 52 names
// application "through the hook-bound call site". Mounted observation reaches
// only downstream consequence there, and the binding-11 precedent governs.
//
// BINDING 69 is halted on ground (1) for both of its clauses; the report states
// the clause analysis.
//
// MOUNTED SUBJECT. Bindings 50, 57, and 64 name a MOUNTED CONTROL invoking a
// supplied act — the binding-11, binding-36, and binding-45 shape. This file
// therefore mounts the production `Composer` directly, through the committed
// P10-V1 harness, with the lifecycle acts supplied as recording functions. No
// wrapper replaces the component, no provider is substituted, no compatibility
// renderer is introduced, and StrictMode remains retained.
//
// The recorders observe PRODUCTION CALLBACK INVOCATION ONLY. They cannot see
// which parent supplied the callback, App-level state application, transport
// behavior, downstream lifecycle state, settlement, routing, or server
// behavior.
//
// NO CREATION TRAVERSAL OCCURS HERE. This file mounts no App, performs no
// navigation, and issues no request, so P10-CT is not relied upon at all.
// BINDINGS 24 AND 27 REMAIN OPEN and are not exercised.
// NO CLASS B PROPOSITION IS CONSTRUCTED: there is no transport in this file,
// no network, no backend, and no server observation.
//
// StrictMode duplicate development rendering is development semantics: renders
// are never counted and no assertion depends on render count.
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import Composer from '../../src/composer/Composer.tsx';
import type { DepartureState } from '../../src/composer/departure-state.ts';
import { mount, type Mounted } from '../harness/mount.ts';

/** The completed draft the lifecycle controls are presented for. */
const DRAFT = { kind: 'created', artifactId: 'artifact-1', placementId: 'placement-1' } as const;

/** One held recipient: `permitsDeparture` requires at least one, and the
 *  departure bundle's `eligible` flag is supplied here rather than derived —
 *  deriving it is App's act and is not this file's object. */
const RECIPIENTS = { kind: 'idle', recipients: ['self-ora'] } as const;

/** The three lifecycle states the three controls are presented in. Each control
 *  is rendered in a DIFFERENT production state, so no case can activate another
 *  case's control by accident. */
const IDLE: DepartureState = { kind: 'idle' };
const DEPARTED: DepartureState = {
  kind: 'departed',
  placementId: DRAFT.placementId,
  artifactId: DRAFT.artifactId,
  recipients: ['self-ora'],
};

const base = {
  state: DRAFT,
  onTextChange: () => {},
  onSend: () => {},
  onReturn: () => {},
  recipients: { state: RECIPIENTS, candidates: [], onAdd: () => {} },
};

const buttons = (app: Mounted): HTMLButtonElement[] =>
  [...app.container.querySelectorAll('button')] as HTMLButtonElement[];

const labels = (app: Mounted): string[] => buttons(app).map((b) => b.textContent ?? '');

const control = (app: Mounted, label: string): HTMLButtonElement | undefined =>
  buttons(app).find((b) => b.textContent === label);

let app: Mounted | null = null;

afterEach(async () => {
  if (app !== null) await app.unmount();
  app = null;
});

describe('E6 — lifecycle, mounted controls', () => {
  // BINDING 50 — accepted wording:
  //   "the mounted Depart control invokes it"
  // Accepted scope: "new; the element-level form closed in case 11." This
  // construct addresses the mounted-DOM form only. It observes invocation
  // directly and infers nothing from lifecycle state, requests, or settlement —
  // there is no transport here to produce any.
  it('binding 50 — the mounted Depart control invokes the supplied departure act', async () => {
    let departs = 0;
    const onDepart = (): void => {
      departs += 1;
    };

    const mounted = await mount(
      createElement(Composer, {
        ...base,
        departure: { state: IDLE, eligible: true, onDepart },
      }),
    );
    app = mounted;

    // BEFORE ACTIVATION — no invocation. Mounting, and any duplicate
    // development rendering, invokes nothing.
    expect(departs).toBe(0);

    // The Depart control is rendered, and it is the lifecycle control present:
    // neither Cancel nor Settle is offered in this production state, so the
    // activation below cannot be of another lifecycle act.
    const depart = control(mounted, 'Depart');
    expect(depart, 'the Depart control is rendered').toBeDefined();
    expect(labels(mounted)).not.toContain('Cancel');
    expect(labels(mounted)).not.toContain('Settle');

    // EXACTLY ONE ACTIVATION.
    await mounted.step(() => {
      depart!.click();
    });

    expect(departs).toBe(1);
  });

  // BINDING 57 — accepted wording:
  //   "mounted Cancel invokes it"
  // Accepted scope: "new; the element-level form closed in case 11." Mounted-DOM
  // form only. Cancel is presented from the departed lifecycle state and only
  // when the supplied eligibility permits it.
  it('binding 57 — the mounted Cancel control invokes the supplied cancellation act', async () => {
    let cancels = 0;
    let settles = 0;
    const onCancel = (): void => {
      cancels += 1;
    };

    const mounted = await mount(
      createElement(Composer, {
        ...base,
        departure: { state: DEPARTED, eligible: false, onDepart: () => {} },
        cancellation: { eligible: true, onCancel },
        // Supplied but NOT eligible, so Settle is absent and the activation
        // below cannot reach the settlement act.
        settlement: {
          eligible: false,
          onSettle: () => {
            settles += 1;
          },
        },
      }),
    );
    app = mounted;

    expect(cancels).toBe(0);
    expect(settles).toBe(0);

    const cancel = control(mounted, 'Cancel');
    expect(cancel, 'the Cancel control is rendered').toBeDefined();
    expect(labels(mounted)).not.toContain('Settle');
    expect(labels(mounted)).not.toContain('Depart');

    await mounted.step(() => {
      cancel!.click();
    });

    // The cancellation act, and only it, was invoked.
    expect(cancels).toBe(1);
    expect(settles).toBe(0);
  });

  // BINDING 64 — accepted wording:
  //   "mounted Settle invokes it"
  // Mounted-DOM form only. Settle is presented from the departed lifecycle
  // state and only when the supplied eligibility permits it. Whether that
  // eligibility is authoritative is the blind-settlement condition and is NOT
  // this case's object.
  it('binding 64 — the mounted Settle control invokes the supplied settlement act', async () => {
    let settles = 0;
    let cancels = 0;
    const onSettle = (): void => {
      settles += 1;
    };

    const mounted = await mount(
      createElement(Composer, {
        ...base,
        departure: { state: DEPARTED, eligible: false, onDepart: () => {} },
        // Supplied but NOT eligible, so Cancel is absent and the activation
        // below cannot reach the cancellation act.
        cancellation: {
          eligible: false,
          onCancel: () => {
            cancels += 1;
          },
        },
        settlement: { eligible: true, onSettle },
      }),
    );
    app = mounted;

    expect(settles).toBe(0);
    expect(cancels).toBe(0);

    const settle = control(mounted, 'Settle');
    expect(settle, 'the Settle control is rendered').toBeDefined();
    expect(labels(mounted)).not.toContain('Cancel');
    expect(labels(mounted)).not.toContain('Depart');

    await mounted.step(() => {
      settle!.click();
    });

    // The settlement act, and only it, was invoked.
    expect(settles).toBe(1);
    expect(cancels).toBe(0);
  });
});
