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
  Poll,
  DerivedRing,
  PayloadType,
  KeyGrant
} from '../types';
import {
  SEED_SELVES,
  SEED_PLACEMENTS,
  SEED_CONNECTIONS,
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

export type FeedFilter = 'Sent' | 'Vault';

export function useSelvesState() {
  const [selves, setSelves] = useState<Self[]>(() => load('selves_v2_selves', SEED_SELVES));
  const [currentSelfId, setCurrentSelfId] = useState<string>(() => store.get('selves_v2_current') || 'self_user_aether');
  const [placements, setPlacements] = useState<Placement[]>(() => load('selves_v2_placements', SEED_PLACEMENTS));
  const [connections, setConnections] = useState<Connection[]>(() => load('selves_v2_connections', SEED_CONNECTIONS));
  const [keyGrants, setKeyGrants] = useState<KeyGrant[]>(() => load('selves_v2_keygrants', []));
  const [polls, setPolls] = useState<Poll[]>(() => load('selves_v2_polls', SEED_POLLS));
  const [bookmarks, setBookmarks] = useState<{ [selfId: string]: string[] }>(() => load('selves_v2_bookmarks', {}));

  const [feedFilter, setFeedFilter] = useState<FeedFilter>('Sent');
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
    store.set('selves_v2_bookmarks', JSON.stringify(bookmarks));
  }, [selves, currentSelfId, placements, connections, keyGrants, polls, bookmarks]);

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
      createdAt: new Date().toISOString()
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
    return { success: true };
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
      createdAt: new Date().toISOString()
    };
    setConnections(prev => [...prev, newConn]);
    triggerVisualSignal(currentSelfId, toSelfId);
    return { success: true };
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

  const factoryReset = () => {
    store.clear();
    setSelves(SEED_SELVES);
    setCurrentSelfId('self_user_aether');
    setPlacements(SEED_PLACEMENTS);
    setConnections(SEED_CONNECTIONS);
    setKeyGrants([]);
    setPolls(SEED_POLLS);
    setBookmarks({});
    setFeedFilter('Sent');
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
    requestKey,
    updateGraphPosition,
    toggleBookmark,
    voteInPoll,
    initiateConnection,
    getVisiblePlacements,
    deriveRing,
    correspondenceVolume,
    hasKey,
    factoryReset
  };
}
