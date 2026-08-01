// P10-S8 — the client Vitest substrate prerequisite (0012 §43; decision 0001
// §5, whose deferral condition is now met). Infrastructure only: this file
// proves the substrate EXECUTES and adds no Segment 10.C feature.
//
// The assertion is deliberately narrow. Its value is dependency isolation, not
// coverage: a bare `expect(1).toBe(1)` would prove a runner runs even on a
// substrate unable to resolve any client module. Importing the real App.tsx
// proves that TSX and ESM resolve through the client's OWN Vite pipeline — the
// property every later feature test depends on — so a resolution failure
// surfaces here, where only the substrate is at stake, rather than inside
// P10-S9 where it would be entangled with feature work.
//
// Per §43's binding abstraction rule, this pins constitutionally stable
// substrate behavior only. It does not render App, require a DOM, or inspect
// markup, layout, styling, copy, or composition — all of which evolve through
// 10.D and 10.E and must never be fossilized by a test.
import { describe, expect, it } from 'vitest';
import App from '../src/App.tsx';

describe('P10-S8 client Vitest substrate', () => {
  it('the client Vitest substrate resolves App.tsx through the client Vite pipeline', () => {
    expect(typeof App).toBe('function');
  });
});
