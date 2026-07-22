/**
 * Selves — core ontology.
 * Self -> Signal -> Artifact -> Placement -> Graph
 * Recipients are ground truth. Rings are derived annotations, never stored, never chosen.
 */

export interface Self {
  id: string;
  userId: string; // 'user_1' = the operator's own Selves; anything else = a correspondent
  name: string;
  color: string;
  icon: string;
  bio: string;
  graphPosition: { x: number; y: number };
  createdAt: string;
}

/**
 * Ring is a DERIVED label only. It is computed from placement history at render
 * time and never persisted or user-assigned. 'Vault' = recipient-less (private).
 */
export type DerivedRing = 'Vault' | 'Open' | 'Orbit' | 'Inner';

/** Closed payload set. Text is always present; the others ride alongside it. */
export type PayloadType = 'text' | 'photo' | 'poll' | 'gift' | 'key';

export interface Placement {
  id: string;
  selfId: string;              // authoring Self (From)
  recipientSelfIds: string[];  // visible people (To). Empty = Vault (private to author).
  content: string;
  payloadType: PayloadType;
  payloadData?: {
    mediaUrl?: string;
    pollId?: string;
    giftName?: string;
    giftSymbol?: string;
    keyGrantType?: 'timed' | 'permanent';
  };
  createdAt: string;
  replies: Reply[];
}

export interface Reply {
  id: string;
  placementId: string;
  selfId: string;
  asSelfName: string;
  asSelfColor: string;
  asSelfIcon: string;
  content: string;
  createdAt: string;
}

export interface Connection {
  id: string;
  fromSelfId: string;
  toSelfId: string;
  status: 'pending' | 'connected' | 'declined';
  createdAt: string;
}

/** Key access: explicit grant into a Self's private correspondence. */
export interface KeyGrant {
  id: string;
  requesterSelfId: string;
  granterSelfId: string;
  type: 'timed' | 'permanent';
  expiresAt?: string;
  status: 'pending' | 'granted' | 'declined';
  createdAt: string;
}

export interface Poll {
  id: string;
  question: string;
  options: { id: string; text: string; votes: number }[];
  voterSelfIds: { [selfId: string]: string };
  createdAt: string;
}

