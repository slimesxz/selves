// P10-V1 — the mounted harness. Construction only.
//
// This module renders. It proves nothing. Harness construction establishes
// capability, not evidence, and evidence begins only when the chamber
// separately authorizes a verification execution.
//
// The mount mirrors the production entry point exactly. `client/src/main.tsx`
// does:
//
//   createRoot(document.getElementById('root')!).render(
//     <StrictMode><App /></StrictMode>,
//   )
//
// so this creates a container, roots it, and renders the element inside
// StrictMode. Nothing else is interposed: no provider, no wrapper, no test
// renderer, no compatibility layer.
//
// StrictMode is retained as ruled at P10-F3. Its intentional duplicate
// development invocation is constitutional development semantics — not
// implementation error, and not evidence. It is never disabled to simplify
// observation, and assertions written against this harness state dependency,
// transition, and production consequence rather than literal development
// invocation count.
//
// `createElement` is used instead of JSX so this file stays `.ts`. No React
// type declarations are installed inside this repository, and keeping the
// harness out of JSX keeps it independent of where those declarations are
// found.

import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export interface Mounted {
  /** The rooted container, for querying what the mounted tree rendered. */
  readonly container: HTMLElement;
  /** Run work inside `act`, so effects and updates flush before it returns. */
  readonly step: (work: () => void | Promise<void>) => Promise<void>;
  /** Unmount inside `act`, so cleanup runs, then detach the container. */
  readonly unmount: () => Promise<void>;
}

/** The element type is derived from `createElement` itself rather than imported
 *  by name, so the harness compiles the same way whether React's declarations
 *  are resolvable or absent — see the substrate finding reported with this
 *  gate. */
export async function mount(element: Parameters<typeof createElement>[2]): Promise<Mounted> {
  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);

  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(StrictMode, null, element));
  });

  return {
    container,
    step: async (work) => {
      await act(async () => {
        await work();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}
