/**
 * Seed data. Correspondents are other people's Selves — inert, no simulation.
 * Every placement is addressed to visible recipients (or to no one: Vault).
 */

import { Self, Placement, Connection, Notification, Poll } from './types';

export const SEED_SELVES: Self[] = [
  // The operator's Selves
  {
    id: 'self_user_aether',
    userId: 'user_1',
    name: 'Aether',
    color: '#14b8a6',
    icon: 'Shield',
    bio: 'Philosophical examiner. Focused on identity decentralization and digital architecture.',
    graphPosition: { x: 300, y: 250 },
    createdAt: '2026-07-01T12:00:00Z'
  },
  {
    id: 'self_user_scribe',
    userId: 'user_1',
    name: 'Scribe',
    color: '#ef4444',
    icon: 'BookOpen',
    bio: 'Drafts, poetry, and raw reflections. A private repository for unfinished thought.',
    graphPosition: { x: 450, y: 350 },
    createdAt: '2026-07-02T15:30:00Z'
  },
  // Correspondents (other people's Selves)
  {
    id: 'self_c_curator',
    userId: 'user_curator',
    name: 'The Curator',
    color: '#f59e0b',
    icon: 'Library',
    bio: 'Archiving early Web fragments. Deep collector of rare digital records.',
    graphPosition: { x: 180, y: 150 },
    createdAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'self_c_zerosum',
    userId: 'user_zerosum',
    name: 'Zero_Sum',
    color: '#9ca3af',
    icon: 'Terminal',
    bio: 'Digital minimalist. Emits raw terminal logs and structured thoughts. No sentimentality.',
    graphPosition: { x: 600, y: 180 },
    createdAt: '2025-05-12T10:00:00Z'
  },
  {
    id: 'self_c_hespera',
    userId: 'user_hespera',
    name: 'Hespera',
    color: '#8b5cf6',
    icon: 'Moon',
    bio: 'Visual composer. Transcribing the aesthetic landscape of dark operating systems.',
    graphPosition: { x: 250, y: 450 },
    createdAt: '2026-03-14T23:55:00Z'
  },
  {
    id: 'self_c_aletheia',
    userId: 'user_aletheia',
    name: 'Aletheia',
    color: '#10b981',
    icon: 'Compass',
    bio: 'Dialectical searcher. Seeking absolute trust networks.',
    graphPosition: { x: 550, y: 480 },
    createdAt: '2026-01-10T08:15:00Z'
  }
];

export const SEED_CONNECTIONS: Connection[] = [
  {
    id: 'conn_1',
    fromSelfId: 'self_user_aether',
    toSelfId: 'self_c_curator',
    status: 'connected',
    revealedDecision: { connectionExists: true, context: true, identity: true },
    createdAt: '2026-07-02T10:00:00Z'
  },
  {
    id: 'conn_2',
    fromSelfId: 'self_c_curator',
    toSelfId: 'self_user_aether',
    status: 'connected',
    revealedDecision: { connectionExists: true, context: true, identity: true },
    createdAt: '2026-07-02T10:05:00Z'
  },
  {
    id: 'conn_3',
    fromSelfId: 'self_user_aether',
    toSelfId: 'self_c_zerosum',
    status: 'connected',
    revealedDecision: { connectionExists: true, context: false, identity: false },
    createdAt: '2026-07-03T11:00:00Z'
  },
  {
    id: 'conn_4',
    fromSelfId: 'self_c_zerosum',
    toSelfId: 'self_user_aether',
    status: 'connected',
    revealedDecision: { connectionExists: true, context: false, identity: false },
    createdAt: '2026-07-03T11:15:00Z'
  },
  {
    id: 'conn_5',
    fromSelfId: 'self_user_scribe',
    toSelfId: 'self_c_hespera',
    status: 'connected',
    revealedDecision: { connectionExists: true, context: true, identity: true },
    createdAt: '2026-07-04T18:00:00Z'
  },
  {
    id: 'conn_6',
    fromSelfId: 'self_c_hespera',
    toSelfId: 'self_user_scribe',
    status: 'connected',
    revealedDecision: { connectionExists: true, context: true, identity: true },
    createdAt: '2026-07-04T18:10:00Z'
  },
  {
    id: 'conn_7',
    fromSelfId: 'self_user_scribe',
    toSelfId: 'self_c_aletheia',
    status: 'pending',
    revealedDecision: { connectionExists: true, context: false, identity: false },
    createdAt: '2026-07-06T09:00:00Z'
  }
];

export const SEED_POLLS: Poll[] = [
  {
    id: 'poll_1',
    question: 'Should a connection imply that the identity behind it is traceable?',
    options: [
      { id: 'opt_1', text: 'No, absolute decoupling of connection & ID', votes: 2 },
      { id: 'opt_2', text: 'Yes, but only between close correspondents', votes: 0 },
      { id: 'opt_3', text: 'Traceability should be entirely context-specific', votes: 1 }
    ],
    voterSelfIds: {
      'self_c_zerosum': 'opt_1',
      'self_c_curator': 'opt_3',
      'self_c_aletheia': 'opt_1'
    },
    createdAt: '2026-07-05T14:00:00Z'
  }
];

export const SEED_PLACEMENTS: Placement[] = [
  {
    id: 'place_1',
    selfId: 'self_c_zerosum',
    recipientSelfIds: ['self_user_aether'],
    content:
      'RAW INSTANCE: Operating systems structure agency. Social networks commodify sentiment. A person is a set of independent operating parameters. We must build walls around the modules to prevent memory leaks of the soul.',
    payloadType: 'text',
    createdAt: '2026-07-06T22:30:00Z',
    replies: [
      {
        id: 'reply_1',
        placementId: 'place_1',
        selfId: 'self_user_aether',
        asSelfName: 'Aether',
        asSelfColor: '#14b8a6',
        asSelfIcon: 'Shield',
        content: 'Memory leaks of the soul are what the old networks called "profiles." The flattened timeline was the tragedy.',
        createdAt: '2026-07-06T23:15:00Z'
      }
    ]
  },
  {
    id: 'place_2',
    selfId: 'self_c_hespera',
    recipientSelfIds: ['self_user_scribe'],
    content: 'Watched the city sleep. The nodes hum but withhold their coordinates. A serene architecture.',
    payloadType: 'photo',
    payloadData: {
      mediaUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&q=80&w=600'
    },
    createdAt: '2026-07-07T03:45:00Z',
    replies: []
  },
  {
    id: 'place_3',
    selfId: 'self_c_curator',
    recipientSelfIds: ['self_user_aether', 'self_c_zerosum'],
    content:
      'Sending you both a small anchor from the archive. It is weighted. It holds a place for the correspondence we have been building.',
    payloadType: 'gift',
    payloadData: { giftName: 'Obsidian Monolith', giftSymbol: '⬛' },
    createdAt: '2026-07-07T09:12:00Z',
    replies: [
      {
        id: 'reply_2',
        placementId: 'place_3',
        selfId: 'self_user_aether',
        asSelfName: 'Aether',
        asSelfColor: '#14b8a6',
        asSelfIcon: 'Shield',
        content: 'Received. It sits well in the register. Thank you, Curator.',
        createdAt: '2026-07-07T10:00:00Z'
      }
    ]
  },
  {
    id: 'place_4',
    selfId: 'self_c_aletheia',
    recipientSelfIds: ['self_user_aether', 'self_user_scribe', 'self_c_curator'],
    content: 'A question for the correspondents I trust with it.',
    payloadType: 'poll',
    payloadData: { pollId: 'poll_1' },
    createdAt: '2026-07-07T10:30:00Z',
    replies: []
  },
  {
    id: 'place_5',
    selfId: 'self_user_scribe',
    recipientSelfIds: [],
    content: 'Draft, unsent: the register is honest in a way the feed never was. You always know exactly who is holding the letter.',
    payloadType: 'text',
    createdAt: '2026-07-07T04:20:00Z',
    replies: []
  }
];

export const SEED_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif_1',
    selfId: 'self_user_aether',
    title: 'Key Requested',
    message: 'Zero_Sum requested a permanent key to your private correspondence.',
    type: 'key_request',
    data: { requesterSelfId: 'self_c_zerosum', grantType: 'permanent' },
    read: false,
    createdAt: '2026-07-07T10:45:00Z'
  }
];
