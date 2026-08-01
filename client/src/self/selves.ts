// P10-S10 — the account's Selves and their presentation (R1; §39's
// name-uniqueness finding). Pure: no React, no DOM, no fetch.
//
// R1 fixes the source: Selves come exclusively from GET /auth/selves, the
// authenticated account's own. There is no directory, no foreign-Self
// resolution, and no client Self creation — this module derives, never invents.
//
// §39 records that two Selves on one account may share a name: names are
// non-unique free text with no handle, registry, or collision rule. So a name
// alone cannot always identify a Self, and the label is where that is resolved.

/** The wire shape of GET /auth/selves. Declared here because the client cannot
 *  import server code; the server's own SelfSummary is the authority for it. */
export interface SelfSummary {
  id: string;
  name: string;
  slot: number;
}

/** A presentation artifact, not an identity record. `slot` is deliberately NOT
 *  carried through: an unused coordinate travelling beside a label invites a
 *  later consumer to read a storage position as identity, which is exactly what
 *  the collision-only rule declines to render in the first place. */
export interface LabeledSelf {
  id: string;
  label: string;
}

/** Labels the whole list at once, because whether a name needs disambiguating
 *  is a property of the set, not of the entry — a per-item formatter would push
 *  that computation onto every caller.
 *
 *  A name shared by more than one Self yields slot-bearing labels for exactly
 *  those Selves. Every distinct name is rendered as-is. */
export function labelSelves(selves: SelfSummary[]): LabeledSelf[] {
  const counts = new Map<string, number>();
  for (const self of selves) counts.set(self.name, (counts.get(self.name) ?? 0) + 1);
  return selves.map((self) => ({
    id: self.id,
    label: (counts.get(self.name) ?? 0) > 1 ? `${self.name} (${self.slot})` : self.name,
  }));
}

/** Reads the authoritative list out of a response payload. Anything that is not
 *  a well-formed entry is dropped rather than repaired: a malformed payload
 *  yields fewer Selves, never a fabricated one. */
export function parseSelves(payload: unknown): SelfSummary[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (entry): entry is SelfSummary =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as SelfSummary).id === 'string' &&
      typeof (entry as SelfSummary).name === 'string' &&
      typeof (entry as SelfSummary).slot === 'number',
  );
}
