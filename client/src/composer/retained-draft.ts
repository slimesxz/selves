// P10-S16 — the retained draft. Synchronous, transport-free, callback-free.
//
// The stranded-row window this closes was real: before P10-S16 a human could
// create a draft, add a recipient, return to Correspondences, and lose the
// client's only reference to a durable server row — a Placement with a
// recipient, unreachable by anything in the client and unsendable. Retention is
// the mechanism that removes that; a rendered control alone never could.
//
// What is retained is the completed Placement, not the composition. The
// composing session ended when the Artifact was created, so no Artifact Text is
// carried: the Text is the server-side Artifact's, and duplicating it here would
// create a second copy of a value the server already holds authoritatively,
// while refetching it would be a read-after-reopen. A reopened draft is a
// draft-management surface, not a text editor.
//
// One value, one hand-off in each direction. While the Composer is open the live
// values in the shell are authoritative; on a PERMITTED leave this value is
// created from those exact values; after leave it is authoritative; on reopen it
// is restored exactly. There are never two copies kept in step by convention.

import type { CorrespondencesState, Surface } from '../correspondences/surface.ts';
import type { RecipientState } from './recipient-state.ts';

export interface RetainedDraft {
  /** The exact identifiers produced by the completed draft-creation sequence. */
  readonly artifactId: string;
  readonly placementId: string;
  readonly recipients: RecipientState;
  readonly from: CorrespondencesState;
}

/** Builds the one retained value from the exact completed draft-management
 *  inputs. It copies no identifier into a second independently maintained place
 *  and derives no recipient list of its own. */
export function retain(
  artifactId: string,
  placementId: string,
  recipients: RecipientState,
  from: CorrespondencesState,
): RetainedDraft {
  return { artifactId, placementId, recipients, from };
}

/** Reopening is guarded HERE rather than by whether a control renders. With no
 *  retained draft the exact same surface is returned — the same object, not an
 *  equal one, so a reconstruction that silently altered the surface would be
 *  visible. With a retained draft the Composer surface carries that exact
 *  value; nothing is rebuilt and nothing is read. */
export function onReopenDraft(surface: Surface, retainedDraft: RetainedDraft | null): Surface {
  if (retainedDraft === null) return surface;
  return { kind: 'composer', from: retainedDraft.from, draft: retainedDraft };
}
