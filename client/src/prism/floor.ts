// P10-S11 — the Prism floor derivation (R6, 0012:436). Pure: no React, no DOM,
// no fetch.
//
// Governed by six rulings transmitted with complete operative text and
// UNFILED under committed P10-J6; they are reproduced in this sub-step's
// completion report and carried to the Segment 10.C closure filing.
//
// R6 admits exactly three elements — active Self name, authored Artifact
// count, Continue — and the derivation returns exactly three, always. The
// count element is present whatever its value, because an authoritative zero
// renders as 0 and is not suppressed: conditioning presence on value would
// make absence itself carry the count and would make R6's cardinality vary
// with data.
//
// The name derives from the authoritative SelfSummary and never from
// labelSelves, which is the switcher's presentation projection (P10-T3).
// Where a peer carries the same name the derivation returns the bare
// authoritative name and disambiguates nothing — no slot, no id, no
// descriptor. That non-repair is ruled, and the gap stands referred to a
// future schema or identity-model ruling.

import type { SelfSummary } from '../self/selves.ts';

export type FloorElement =
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'artifactCount'; readonly value: number }
  | { readonly kind: 'continue' };

/** Takes the authoritative list AND the active id — not the active Self alone.
 *  An absence needs a populated input to be observable: with one Self in scope
 *  there is no same-named peer and nothing is proven. With the full list, the
 *  same-name case shows the returned name is the bare authoritative name even
 *  where a peer shares it.
 *
 *  Membership of `activeSelfId` in `selves` is guaranteed at the call site by
 *  the restore path, which discards an id absent from the returned set. If it
 *  is absent anyway the name is empty rather than substituted: no placeholder
 *  and no invented value. */
export function derivePrismFloor(
  selves: SelfSummary[],
  activeSelfId: string,
  artifactCount: number,
): FloorElement[] {
  const active = selves.find((self) => self.id === activeSelfId);
  return [
    { kind: 'name', value: active?.name ?? '' },
    { kind: 'artifactCount', value: artifactCount },
    { kind: 'continue' },
  ];
}
