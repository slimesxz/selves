// P10-S13 — the client's first mutation boundary. Pure: no React, no DOM, no
// module-level fetch; the transport is injected.
//
// Two Self-scoped POSTs against the frozen surface, in the order the committed
// substrate requires. `domain.create_placement_draft` reads the Artifact's
// author and raises PT404 when it is absent or not the acting Self, so a draft
// cannot exist without an authoritative Artifact id obtained first.
//
// Classification runs through the committed `outcomeOf`, so no second 401/403
// mapping is defined here. Everything that is not an authorization outcome and
// not a well-formed 2xx is one `failed` — 400, 404, 409, 500, a malformed body,
// and a transport throw alike. The first slice exposes no server-status
// taxonomy, and the reasons.ts mapping is deliberately not mirrored: 404 is
// already indistinguishable between absent and unauthorized by design.

import { sendSelf, type Transport } from '../api/transport.ts';
import { outcomeOf } from '../auth/session.ts';

export const ARTIFACTS_PATH = '/artifacts';
export const PLACEMENTS_PATH = '/placements';

export type CreateOutcome =
  | { readonly kind: 'created'; readonly id: string }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed' };

const FAILED: CreateOutcome = { kind: 'failed' };

async function post(
  transport: Transport,
  actingSelfId: string,
  path: string,
  body: unknown,
): Promise<CreateOutcome> {
  try {
    const res = await sendSelf(transport, { method: 'POST', path, body, actingSelf: actingSelfId });
    const outcome = outcomeOf(res.status);
    if (outcome.kind === 'unauthenticated') return { kind: 'session-expired' };
    if (outcome.kind === 'forbidden') return { kind: 'forbidden' };
    if (outcome.kind !== 'ok') return FAILED;
    const parsed: unknown = await res.json();
    const id = (parsed as { id?: unknown }).id;
    // A 2xx whose body carries no id is not a creation: nothing is invented.
    return typeof id === 'string' && id.length > 0 ? { kind: 'created', id } : FAILED;
  } catch {
    return FAILED;
  }
}

export const createArtifact = (
  transport: Transport,
  actingSelfId: string,
  text: string,
): Promise<CreateOutcome> => post(transport, actingSelfId, ARTIFACTS_PATH, { text });

export const createPlacementDraft = (
  transport: Transport,
  actingSelfId: string,
  artifactId: string,
): Promise<CreateOutcome> => post(transport, actingSelfId, PLACEMENTS_PATH, { artifactId });
