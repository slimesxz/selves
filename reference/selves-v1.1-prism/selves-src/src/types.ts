/**
 * Selves — object model, v1.0.1.
 *
 * Under evaluation (not frozen): Selves has TWO enduring objects, not one.
 *   - Self          — the atomic IDENTITY.  You return to it; it accumulates.
 *   - Correspondence — the atomic RELATIONSHIP. It persists, grows, is revisited.
 * Placement is the atomic ACTION — the irreversible act that extends a
 * correspondence (never itself an enduring object). Artifact is the residue a
 * placement leaves INSIDE a correspondence.
 *
 * The structure is a branch, not a pipeline:
 *   Self ├─ Correspondence ─ [Placement → Artifact]
 *        ├─ Correspondence ─ [Placement → Artifact]
 *        └─ Correspondence(self) = Vault
 *
 * This build does not prejudge which enduring object is "home". It makes both
 * first-class and records what the hand reaches for first.
 *
 * Governing lens: the software is always one step behind the human.
 */

export type SelfId = string;
export type PersonId = string;
export type CorrespondenceId = string;

/** A Self — atomic identity. Assigned no personality; character emerges from use. */
export interface Self {
  id: SelfId;
  name: string;
  handle: string;
  avatar: string;
  accent: string; // closed-set palette
  label: string; // private self-label, in your voice, visible only to you
}

/** The other end of a correspondence: another person, or yourself (Vault). */
export interface Correspondent {
  id: PersonId;
  name: string;
  /** "self" = a correspondence with yourself → Vault. */
  kind: "person" | "self";
  /** True once an introduction has been accepted. */
  connected: boolean;
}

/** A placement's residue. Signals stop; artifacts remain, inside a correspondence. */
export interface Artifact {
  id: string;
  /** "out" = you placed it; "in" = it was placed to you (the returned half). */
  direction: "out" | "in";
  body: string;
  placedAt: string; // ISO; drives recency-fade
  /** Pending until a first-contact introduction is accepted. */
  pending?: boolean;
}

/**
 * A Correspondence — atomic relationship. The enduring object a placement
 * extends. Belongs to exactly one Self. Holds many artifacts, both directions.
 */
export interface Correspondence {
  id: CorrespondenceId;
  selfId: SelfId;
  with: Correspondent;
  /** Vault = correspondence whose other end is yourself. Not "private" — kept. */
  vault: boolean;
  artifacts: Artifact[];
}
