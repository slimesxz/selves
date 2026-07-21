/**
 * Selves state.
 * Placement = the decision of who receives something.
 * Visibility law: a placement is visible to a Self iff it authored it or is named as a recipient.
 * Rings are derived at read time from placement history. Never stored. Never chosen.
 */

import { useState, useEffect } from 'react';
import {
  Self,
  Placement,
  Connection,
  Notification,
  Poll,
  Reply,
  DerivedRing,
  PayloadType,
  KeyGrant,
  Introduction
} from '../types';
import {
  SEED_SELVES,
  SEED_PLACEMENTS,
  SEED_CONNECTIONS,
  SEED_NOTIFICATIONS,
  SEED_POLLS
} from '../data';

// Storage that degrades to memory if localStorage is unavailable.
const mem: { [k: string]: string } = {};
const store = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return mem[key] ?? null; }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { mem[key] = value; }
  },
  clear() {
    try { window.localStorage.clear(); } catch { Object.keys(mem).forEach(k => delete mem[k]); }
  }
};

const load = <T,>(key: string, fallback: T): T => {
  const saved = store.get(key);
  if (!saved) return fallback;
  try { return JSON.parse(saved) as T; } catch { return fallback; }
};

export type FeedFilter = 'All' | 'Sent' | 'Received' | 'Vault';

export function useSelvesState() {
  const [selves, setSelves] = useState<Self[]>(() => load('selves_v2_selves', SEED_SELVES));
  const [currentSelfId, setCurrentSelfId] = useState<string>(() => store.get('selves_v2_current') || 'self_user_aether');
  const [placements, setPlacements] = useState<Placement[]>(() => load('selves_v2_placements', SEED_PLACEMENTS));
  const [connections, setConnections] = useState<Connection[]>(() => load('selves_v2_connections', SEED_CONNECTIONS));
  const [keyGrants, setKeyGrants] = useState<KeyGrant[]>(() => load('selves_v2_keygrants', []));
  const [polls, setPolls] = useState<Poll[]>(() => load('selves_v2_polls', SEED_POLLS));
  const [introductions, setIntroductions] = useState<Introduction[]>(() => load('selves_v2_intros', []));
  const [notifications, setNotifications] = useState<Notification[]>(() => load('selves_v2_notifs', SEED_NOTIFICATIONS));
  const [bookmarks, setBookmarks] = useState<{ [selfId: string]: string[] }>(() => load('selves_v2_bookmarks', {}));

  const [feedFilter, setFeedFilter] = useState<FeedFilter>('All');
  const [inspectedSelfId, setInspectedSelfId] = useState<string | null>(null);
  const [activeVisualSignals, setActiveVisualSignals] = useState<
    { id: string; fromX: number; fromY: number; toX: number; toY: number }[]
  >([]);

  useEffect(() => {
    store.set('selves_v2_selves', JSON.stringify(selves));
    store.set('selves_v2_current', currentSelfId);
    store.set('selves_v2_placements', JSON.stringify(placements));
    store.set('selves_v2_connections', JSON.stringify(connections));
    store.set('selves_v2_keygrants', JSON.stringify(keyGrants));
    store.set('selves_v2_polls', JSON.stringify(polls));
    store.set('selves_v2_intros', JSON.stringify(introductions));
    store.set('selves_v2_notifs', JSON.stringify(notifications));
    store.set('selves_v2_bookmarks', JSON.stringify(bookmarks));
  }, [selves, currentSelfId, placements, connections, keyGrants, polls, introductions, notifications, bookmarks]);

  const currentSelf = selves.find(s => s.id === currentSelfId) || selves[0];
  const isOwn = (s: Self) => s.userId === 'user_1';

  // Pulse animation along an edge (signal in motion — the only graph animation kept).
  const triggerVisualSignal = (fromSelfId: string, toSelfId: string) => {
    const fromSelf = selves.find(s => s.id === fromSelfId);
    const toSelf = selves.find(s => s.id === toSelfId);
    if (!fromSelf || !toSelf) return;
    const signalId = `sig_${Date.now()}_${Math.random()}`;
    setActiveVisualSignals(prev => [
      ...prev,
      {
        id: signalId,
        fromX: fromSelf.graphPosition.x,
        fromY: fromSelf.graphPosition.y,
        toX: toSelf.graphPosition.x,
        toY: toSelf.graphPosition.y
      }
    ]);
    setTimeout(() => {
      setActiveVisualSignals(prev => prev.filter(s => s.id !== signalId));
    }, 1500);
  };

  // CREATE SELF — constitutional maximum of 3.
  const createSelf = (name: string, color: string, icon: string, bio: string) => {
    const userSelves = selves.filter(isOwn);
    if (userSelves.length >= 3) {
      return { success: false, error: 'Constitutional constraint: a person may maintain no more than three Selves.' };
    }
    const newSelfId = `self_user_${Date.now()}`;
    const count = userSelves.length;
    const newSelf: Self = {
      id: newSelfId,
      userId: 'user_1',
      name,
      color,
      icon,
      bio,
      graphPosition: { x: 300 + count * 120, y: 250 + count * 80 },
      createdAt: new Date().toISOString()
    };
    setSelves(prev => [...prev, newSelf]);
    setCurrentSelfId(newSelfId);
    return { success: true, selfId: newSelfId };
  };

  // SWITCH — instant.
  const switchSelf = (selfId: string) => {
    const target = selves.find(s => s.id === selfId);
    if (target && isOwn(target)) setCurrentSelfId(selfId);
  };

  /**
   * PLACEMENT — the atomic action.
   * From: currentSelf. To: named recipients (visible people). Empty recipients = Vault.
   */
  const createPlacement = (
    content: string,
    recipientSelfIds: string[],
    payloadType: PayloadType = 'text',
    payloadData?: Placement['payloadData']
  ) => {
    const newPlacement: Placement = {
      id: `place_${Date.now()}`,
      selfId: currentSelfId,
      recipientSelfIds,
      content,
      payloadType,
      payloadData,
      createdAt: new Date().toISOString(),
      replies: []
    };
    setPlacements(prev => [newPlacement, ...prev]);
    recipientSelfIds.forEach(rid => triggerVisualSignal(currentSelfId, rid));

    // A key payload IS a grant: sending a key grants access to each recipient.
    if (payloadType === 'key') {
      const grantType = payloadData?.keyGrantType || 'permanent';
      const newGrants: KeyGrant[] = recipientSelfIds.map(rid => ({
        id: `grant_${Date.now()}_${rid}`,
        requesterSelfId: rid,
        granterSelfId: currentSelfId,
        type: grantType,
        status: 'granted',
        createdAt: new Date().toISOString()
      }));
      setKeyGrants(prev => [...newGrants, ...prev]);
      recipientSelfIds.forEach(rid =>
        sendNotification(rid, 'Key Received', `${currentSelf.name} sent you a ${grantType} key to their private correspondence.`, 'system')
      );
    }

    return newPlacement.id;
  };

  const createPollPlacement = (question: string, optionsTexts: string[], recipientSelfIds: string[]) => {
    const pollId = `poll_${Date.now()}`;
    const newPoll: Poll = {
      id: pollId,
      question,
      options: optionsTexts.map((text, i) => ({ id: `opt_${Date.now()}_${i}`, text, votes: 0 })),
      voterSelfIds: {},
      createdAt: new Date().toISOString()
    };
    setPolls(prev => [...prev, newPoll]);
    createPlacement(question, recipientSelfIds, 'poll', { pollId });
  };

  const addReply = (placementId: string, content: string, asSelfId: string = currentSelfId) => {
    const author = selves.find(s => s.id === asSelfId);
    if (!author) return;
    const newReply: Reply = {
      id: `reply_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      placementId,
      selfId: asSelfId,
      asSelfName: author.name,
      asSelfColor: author.color,
      asSelfIcon: author.icon,
      content,
      createdAt: new Date().toISOString()
    };
    setPlacements(prev =>
      prev.map(p => (p.id === placementId ? { ...p, replies: [...p.replies, newReply] } : p))
    );
  };

  // KEY REQUEST — asks another Self for access; they resolve it.
  const requestKey = (toSelfId: string, type: 'timed' | 'permanent') => {
    if (toSelfId === currentSelfId) return { success: false, error: 'Cannot request a key from yourself.' };
    const existing = keyGrants.find(
      g => g.requesterSelfId === currentSelfId && g.granterSelfId === toSelfId && g.status === 'pending'
    );
    if (existing) return { success: false, error: 'A pending key request already exists.' };

    const newGrant: KeyGrant = {
      id: `grant_${Date.now()}`,
      requesterSelfId: currentSelfId,
      granterSelfId: toSelfId,
      type,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    setKeyGrants(prev => [newGrant, ...prev]);
    triggerVisualSignal(currentSelfId, toSelfId);
    sendNotification(
      toSelfId,
      'Key Requested',
      `${currentSelf.name} is requesting a ${type} key to your private correspondence.`,
      'key_request',
      { grantId: newGrant.id, requesterSelfId: currentSelfId, type }
    );
    return { success: true };
  };

  const resolveKeyGrant = (grantId: string, status: 'granted' | 'declined') => {
    const grant = keyGrants.find(g => g.id === grantId);
    if (!grant) return;
    setKeyGrants(prev => prev.map(g => (g.id === grantId ? { ...g, status } : g)));
    if (status === 'granted') triggerVisualSignal(grant.granterSelfId, grant.requesterSelfId);
    sendNotification(
      grant.requesterSelfId,
      status === 'granted' ? 'Key Granted' : 'Key Declined',
      status === 'granted'
        ? `${currentSelf.name} granted you a ${grant.type} key.`
        : `${currentSelf.name} declined your key request.`,
      'system'
    );
  };

  // INTRODUCTIONS
  const proposeIntroduction = (selfAId: string, selfBId: string) => {
    if (selfAId === selfBId) return { success: false, error: 'Cannot introduce a Self to itself.' };
    const newIntro: Introduction = {
      id: `intro_${Date.now()}`,
      introducerSelfId: currentSelfId,
      selfAId,
      selfBId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    setIntroductions(prev => [newIntro, ...prev]);
    sendNotification(selfAId, 'Introduction Proposed', `${currentSelf.name} proposed an introduction with another Self.`, 'introduction', { introId: newIntro.id, otherSelfId: selfBId });
    sendNotification(selfBId, 'Introduction Proposed', `${currentSelf.name} proposed an introduction with another Self.`, 'introduction', { introId: newIntro.id, otherSelfId: selfAId });
    return { success: true };
  };

  const resolveIntroduction = (introId: string, _targetSelfId: string, accept: boolean) => {
    const intro = introductions.find(i => i.id === introId);
    if (!intro) return;
    if (!accept) {
      setIntroductions(prev => prev.map(i => (i.id === introId ? { ...i, status: 'declined' } : i)));
      sendNotification(intro.introducerSelfId, 'Introduction Declined', 'The introduction between the Selves was declined.', 'system');
      return;
    }
    setIntroductions(prev => prev.map(i => (i.id === introId ? { ...i, status: 'accepted' } : i)));
    setConnections(prev => [
      ...prev,
      {
        id: `conn_intro_${Date.now()}_1`,
        fromSelfId: intro.selfAId,
        toSelfId: intro.selfBId,
        status: 'connected',
        revealedDecision: { connectionExists: true, context: false, identity: false },
        createdAt: new Date().toISOString()
      },
      {
        id: `conn_intro_${Date.now()}_2`,
        fromSelfId: intro.selfBId,
        toSelfId: intro.selfAId,
        status: 'connected',
        revealedDecision: { connectionExists: true, context: false, identity: false },
        createdAt: new Date().toISOString()
      }
    ]);
    triggerVisualSignal(intro.selfAId, intro.selfBId);
    sendNotification(intro.introducerSelfId, 'Introduction Completed', 'The introduction you proposed was completed. The Selves are now connected.', 'system');
    const selfAName = selves.find(s => s.id === intro.selfAId)?.name || 'a Self';
    const selfBName = selves.find(s => s.id === intro.selfBId)?.name || 'a Self';
    sendNotification(intro.selfAId, 'New Connection', `You are now connected to ${selfBName} via introduction.`, 'system');
    sendNotification(intro.selfBId, 'New Connection', `You are now connected to ${selfAName} via introduction.`, 'system');
  };

  // BOUNDED DISCLOSURE — reveal controls per connection.
  const setBoundedDisclosure = (
    connectionId: string,
    field: 'connectionExists' | 'context' | 'identity',
    value: boolean
  ) => {
    setConnections(prev =>
      prev.map(c =>
        c.id === connectionId
          ? { ...c, revealedDecision: { ...c.revealedDecision, [field]: value } }
          : c
      )
    );
  };

  const updateGraphPosition = (selfId: string, x: number, y: number) => {
    setSelves(prev => prev.map(s => (s.id === selfId ? { ...s, graphPosition: { x, y } } : s)));
  };

  const toggleBookmark = (placementId: string) => {
    setBookmarks(prev => {
      const list = prev[currentSelfId] || [];
      const updated = list.includes(placementId) ? list.filter(id => id !== placementId) : [...list, placementId];
      return { ...prev, [currentSelfId]: updated };
    });
  };

  const voteInPoll = (pollId: string, optionId: string) => {
    setPolls(prev =>
      prev.map(p => {
        if (p.id !== pollId) return p;
        if (p.voterSelfIds[currentSelfId]) return p;
        return {
          ...p,
          options: p.options.map(opt => (opt.id === optionId ? { ...opt, votes: opt.votes + 1 } : opt)),
          voterSelfIds: { ...p.voterSelfIds, [currentSelfId]: optionId }
        };
      })
    );
    const placement = placements.find(pl => pl.payloadType === 'poll' && pl.payloadData?.pollId === pollId);
    if (placement) triggerVisualSignal(currentSelfId, placement.selfId);
  };

  // CONNECTIONS — no ring parameter. A connection is a connection.
  const initiateConnection = (toSelfId: string) => {
    if (toSelfId === currentSelfId) return { success: false, error: 'Cannot connect to yourself.' };
    const existing = connections.find(
      c =>
        (c.fromSelfId === currentSelfId && c.toSelfId === toSelfId) ||
        (c.fromSelfId === toSelfId && c.toSelfId === currentSelfId)
    );
    if (existing) {
      if (existing.status === 'connected') return { success: false, error: 'Already connected to this Self.' };
      if (existing.status === 'pending') return { success: false, error: 'A pending invitation already exists.' };
    }
    const newConn: Connection = {
      id: `conn_${Date.now()}`,
      fromSelfId: currentSelfId,
      toSelfId,
      status: 'pending',
      revealedDecision: { connectionExists: true, context: true, identity: false },
      createdAt: new Date().toISOString()
    };
    setConnections(prev => [...prev, newConn]);
    triggerVisualSignal(currentSelfId, toSelfId);
    sendNotification(toSelfId, 'Connection Invitation', `${currentSelf.name} invited you to connect.`, 'connection', {
      connectionId: newConn.id,
      fromSelfId: currentSelfId
    });
    return { success: true };
  };

  const acceptConnection = (connectionId: string, _targetSelfId: string) => {
    setConnections(prev => prev.map(c => (c.id === connectionId ? { ...c, status: 'connected' as const } : c)));
    const connection = connections.find(c => c.id === connectionId);
    if (connection) {
      setConnections(prev => {
        const reverseExists = prev.some(
          c => c.fromSelfId === connection.toSelfId && c.toSelfId === connection.fromSelfId
        );
        if (reverseExists) return prev;
        return [
          ...prev,
          {
            id: `conn_rev_${Date.now()}`,
            fromSelfId: connection.toSelfId,
            toSelfId: connection.fromSelfId,
            status: 'connected',
            revealedDecision: { connectionExists: true, context: true, identity: true },
            createdAt: new Date().toISOString()
          }
        ];
      });
      triggerVisualSignal(connection.toSelfId, connection.fromSelfId);
      sendNotification(
        connection.fromSelfId,
        'Connection Accepted',
        `${selves.find(s => s.id === connection.toSelfId)?.name} accepted your connection.`,
        'system'
      );
    }
  };

  const declineConnection = (connectionId: string) => {
    setConnections(prev => prev.map(c => (c.id === connectionId ? { ...c, status: 'declined' as const } : c)));
  };

  const sendNotification = (
    selfId: string,
    title: string,
    message: string,
    type: Notification['type'],
    data?: any
  ) => {
    const newNotif: Notification = {
      id: `notif_${Date.now()}_${Math.random()}`,
      selfId,
      title,
      message,
      type,
      data,
      read: false,
      createdAt: new Date().toISOString()
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const markNotificationAsRead = (notifId: string) => {
    setNotifications(prev => prev.map(n => (n.id === notifId ? { ...n, read: true } : n)));
  };

  /**
   * VISIBILITY LAW — recipients are ground truth.
   * Visible iff: you wrote it, or you were named as a recipient, or you hold a
   * granted key to the author's private (recipient-less) correspondence.
   */
  const getVisiblePlacements = (): Placement[] => {
    return placements.filter(placement => {
      if (placement.selfId === currentSelfId) return true;
      if (placement.recipientSelfIds.includes(currentSelfId)) return true;
      if (placement.recipientSelfIds.length === 0) {
        // Vault: visible only through an explicit key.
        const grant = keyGrants.find(
          g => g.requesterSelfId === currentSelfId && g.granterSelfId === placement.selfId && g.status === 'granted'
        );
        return !!grant;
      }
      return false;
    });
  };

  /**
   * DERIVED RING — an annotation, computed from placement history.
   * How often has `fromId` placed things with `toId` as a named recipient?
   * 0 -> null (no pattern yet) | 1–2 -> Open | 3–5 -> Orbit | 6+ -> Inner.
   * Never stored. Never chosen. The audience is truth; the ring is annotation.
   */
  const deriveRing = (fromId: string, toId: string): DerivedRing | null => {
    const volume = placements.filter(
      p => p.selfId === fromId && p.recipientSelfIds.includes(toId)
    ).length;
    if (volume === 0) return null;
    if (volume <= 2) return 'Open';
    if (volume <= 5) return 'Orbit';
    return 'Inner';
  };

  /** Correspondence volume between two Selves, both directions. Drives edge weight. */
  const correspondenceVolume = (aId: string, bId: string): number => {
    return placements.filter(
      p =>
        (p.selfId === aId && p.recipientSelfIds.includes(bId)) ||
        (p.selfId === bId && p.recipientSelfIds.includes(aId))
    ).length;
  };

  const hasKey = (holderId: string, granterId: string): boolean =>
    keyGrants.some(g => g.requesterSelfId === holderId && g.granterSelfId === granterId && g.status === 'granted');

  const getActiveSelfNotifications = (): Notification[] => notifications.filter(n => n.selfId === currentSelfId);

  const factoryReset = () => {
    store.clear();
    setSelves(SEED_SELVES);
    setCurrentSelfId('self_user_aether');
    setPlacements(SEED_PLACEMENTS);
    setConnections(SEED_CONNECTIONS);
    setKeyGrants([]);
    setPolls(SEED_POLLS);
    setIntroductions([]);
    setNotifications(SEED_NOTIFICATIONS);
    setBookmarks({});
    setFeedFilter('All');
    setInspectedSelfId(null);
  };

  return {
    selves,
    currentSelfId,
    currentSelf,
    placements,
    connections,
    keyGrants,
    polls,
    introductions,
    notifications,
    bookmarks,
    feedFilter,
    inspectedSelfId,
    activeVisualSignals,
    setFeedFilter,
    setInspectedSelfId,
    createSelf,
    switchSelf,
    createPlacement,
    createPollPlacement,
    addReply,
    requestKey,
    resolveKeyGrant,
    proposeIntroduction,
    resolveIntroduction,
    setBoundedDisclosure,
    updateGraphPosition,
    toggleBookmark,
    voteInPoll,
    initiateConnection,
    acceptConnection,
    declineConnection,
    getVisiblePlacements,
    getActiveSelfNotifications,
    markNotificationAsRead,
    deriveRing,
    correspondenceVolume,
    hasKey,
    factoryReset
  };
}
