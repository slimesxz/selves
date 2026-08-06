// P10-E1 — binding 11, isolated. Constructed, not run.
//
// ONE BINDING. ONE PROPOSITION:
//
//   activating PrismFloor's Continue control invokes the production
//   `onContinue` prop exactly once for one constitutional occasion.
//
// Invocation itself is the constitutional object. The E2 execution observed the
// downstream consequence — Continue reached Correspondences — and that did not
// isolate this object. Nothing here infers invocation from navigation.
//
// MOUNT. Unlike E2, this experiment does not mount `App`. It mounts the
// production `PrismFloor` directly, through the committed P10-V1 harness, with
// the production `onContinue` prop supplied as a recording function. No
// substitute component, no compatibility wrapper, no implementation variation,
// and no dependency beyond the minimum `PrismFloor` requires to render.
//
// RECORDING MECHANISM. The recorder counts PRODUCTION CALLBACK INVOCATIONS AND
// NOTHING ELSE: a closure incremented inside the supplied prop. It cannot
// observe, and does not count, React renders. That is what separates the
// constitutional occasion from development rendering.
//
// STRICTMODE. Retained through the committed harness. Mounting under StrictMode
// may render the component more than once in development; rendering is not
// invocation, no assertion below concerns render count, and duplicate
// development rendering can therefore never become evidence.
//
// OUT OF SCOPE, AND ABSENT. No navigation, no Correspondences, no routing, no
// transport, no fetch, no server, no state transition after invocation, no
// Back, no binding 21, no binding 12, and no downstream production consequence.
// Everything after the callback fires is outside this experiment.
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import PrismFloor from '../../src/prism/PrismFloor.tsx';
import { mount, type Mounted } from '../harness/mount.ts';

/** The minimum `PrismFloor` needs to render: one Self, active, with a count. */
const SELVES = [{ id: 'self-wren', name: 'Wren', slot: 1 }];
const ACTIVE = SELVES[0]!;
const ARTIFACT_COUNT = 2;

let app: Mounted | null = null;

afterEach(async () => {
  if (app !== null) await app.unmount();
  app = null;
});

describe('binding 11, isolated', () => {
  it('binding 11 — activating Continue invokes the supplied `onContinue` prop, once for one occasion', async () => {
    // The recording mechanism: production callback invocations only.
    let invocations = 0;
    const onContinue = (): void => {
      invocations += 1;
    };

    const mounted = await mount(
      createElement(PrismFloor, {
        selves: SELVES,
        activeSelfId: ACTIVE.id,
        artifactCount: ARTIFACT_COUNT,
        onContinue,
      }),
    );
    app = mounted;

    // BEFORE ACTIVATION — no invocation. Mounting, and any duplicate
    // development rendering it performs, invokes nothing.
    expect(invocations).toBe(0);

    const cont = [...mounted.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue',
    );
    expect(cont, 'the floor renders its Continue control').toBeDefined();

    // EXACTLY ONE ACTIVATION.
    await mounted.step(() => {
      cont!.click();
    });

    // AFTER ACTIVATION — one constitutional occasion, one recorded invocation.
    expect(invocations).toBe(1);
  });
});
