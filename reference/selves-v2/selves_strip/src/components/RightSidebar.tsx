/**
 * Right panel — inspector.
 * Shows a Self's record as it stands: correspondence history, derived annotation,
 * key access, bounded disclosure, introductions. Nothing here is a metric.
 */

import React, { useState } from 'react';
import { Self, Connection, KeyGrant, Placement } from '../types';
import { IconRenderer } from './IconRenderer';
import { KeyRound, Link2, GitMerge, Eye, EyeOff, X, ArrowRight } from 'lucide-react';

interface RightSidebarProps {
  currentSelf: Self;
  selves: Self[];
  placements: Placement[];
  inspectedSelfId: string | null;
  setInspectedSelfId: (id: string | null) => void;
  connections: Connection[];
  keyGrants: KeyGrant[];
  setBoundedDisclosure: (connectionId: string, field: 'connectionExists' | 'context' | 'identity', value: boolean) => void;
  requestKey: (toSelfId: string, type: 'timed' | 'permanent') => { success: boolean; error?: string };
  proposeIntroduction: (selfAId: string, selfBId: string) => { success: boolean; error?: string };
  initiateConnection: (toSelfId: string) => { success: boolean; error?: string };
  deriveRing: (fromId: string, toId: string) => string | null;
  hasKey: (holderId: string, granterId: string) => boolean;
}

export function RightSidebar({
  currentSelf,
  selves,
  placements,
  inspectedSelfId,
  setInspectedSelfId,
  connections,
  keyGrants,
  setBoundedDisclosure,
  requestKey,
  proposeIntroduction,
  initiateConnection,
  deriveRing,
  hasKey
}: RightSidebarProps) {
  const [introA, setIntroA] = useState('');
  const [introB, setIntroB] = useState('');
  const [banner, setBanner] = useState('');

  const inspected = inspectedSelfId ? selves.find(s => s.id === inspectedSelfId) : null;

  const flash = (msg: string) => {
    setBanner(msg);
    setTimeout(() => setBanner(''), 2500);
  };

  // Relationship data between currentSelf and inspected.
  const outboundConn = inspected
    ? connections.find(c => c.fromSelfId === currentSelf.id && c.toSelfId === inspected.id)
    : null;
  const isConnected = inspected
    ? connections.some(
        c =>
          c.status === 'connected' &&
          ((c.fromSelfId === currentSelf.id && c.toSelfId === inspected.id) ||
            (c.fromSelfId === inspected.id && c.toSelfId === currentSelf.id))
      )
    : false;

  const sentTo = inspected
    ? placements.filter(p => p.selfId === currentSelf.id && p.recipientSelfIds.includes(inspected.id))
    : [];
  const receivedFrom = inspected
    ? placements.filter(p => p.selfId === inspected.id && p.recipientSelfIds.includes(currentSelf.id))
    : [];

  const derivedOut = inspected ? deriveRing(currentSelf.id, inspected.id) : null;
  const derivedIn = inspected ? deriveRing(inspected.id, currentSelf.id) : null;

  const iHoldKey = inspected ? hasKey(currentSelf.id, inspected.id) : false;
  const theyHoldKey = inspected ? hasKey(inspected.id, currentSelf.id) : false;
  const pendingKeyReq = inspected
    ? keyGrants.some(g => g.requesterSelfId === currentSelf.id && g.granterSelfId === inspected.id && g.status === 'pending')
    : false;

  const handleRequestKey = (type: 'timed' | 'permanent') => {
    if (!inspected) return;
    const res = requestKey(inspected.id, type);
    flash(res.success ? `Key requested from ${inspected.name}.` : res.error || 'Request failed.');
  };

  const handleConnect = () => {
    if (!inspected) return;
    const res = initiateConnection(inspected.id);
    flash(res.success ? `Invitation sent to ${inspected.name}.` : res.error || 'Failed.');
  };

  const handleIntroduce = () => {
    if (!introA || !introB) {
      flash('Choose two Selves to introduce.');
      return;
    }
    const res = proposeIntroduction(introA, introB);
    flash(res.success ? 'Introduction proposed.' : res.error || 'Failed.');
    if (res.success) {
      setIntroA('');
      setIntroB('');
    }
  };

  const others = selves.filter(s => s.id !== currentSelf.id);

  return (
    <aside id="right-column" className="flex flex-col h-full bg-neutral-950 border-l border-neutral-900 overflow-y-auto text-neutral-300">

      <div className="p-3 border-b border-neutral-900 flex items-center justify-between">
        <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">Inspector</span>
        {inspected && (
          <button onClick={() => setInspectedSelfId(null)} className="text-neutral-500 hover:text-white">
            <X size={12} />
          </button>
        )}
      </div>

      {banner && (
        <div className="m-3 p-2 bg-neutral-900 border border-neutral-800 text-neutral-300 text-[9px] font-mono rounded uppercase">
          {banner}
        </div>
      )}

      <div className="flex-1 p-4 space-y-5">

        {!inspected && (
          <div className="p-6 border border-neutral-900 bg-black/40 rounded-lg text-center space-y-2">
            <div className="text-[10px] font-mono text-neutral-500 uppercase">No Self selected</div>
            <p className="text-[10px] text-neutral-600 font-mono leading-relaxed">
              Select a node on the Living Graph to open its record.
            </p>
          </div>
        )}

        {inspected && (
          <>
            {/* Identity card */}
            <div className="p-3 bg-black/40 border border-neutral-900 rounded-lg space-y-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white border"
                  style={{ backgroundColor: inspected.color, borderColor: inspected.color }}
                >
                  <IconRenderer name={inspected.icon} size={18} />
                </div>
                <div>
                  <div className="text-sm font-bold text-neutral-100">{inspected.name}</div>
                  <div className="text-[9px] font-mono text-neutral-500 uppercase">
                    {inspected.userId === 'user_1' ? 'One of your Selves' : 'Correspondent'}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-neutral-400 leading-relaxed italic">"{inspected.bio}"</p>
            </div>

            {inspected.id !== currentSelf.id && (
              <>
                {/* Derived annotation — read-only, explicitly derived */}
                <div className="space-y-1.5">
                  <div className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider">
                    Derived Annotation
                  </div>
                  <div className="p-2.5 bg-black/40 border border-neutral-900 rounded space-y-1.5 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">You → {inspected.name}:</span>
                      <span className="text-neutral-200 uppercase">{derivedOut || '— no pattern yet'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">{inspected.name} → you:</span>
                      <span className="text-neutral-200 uppercase">{derivedIn || '— no pattern yet'}</span>
                    </div>
                    <div className="pt-1.5 border-t border-neutral-900 text-[8px] text-neutral-600 uppercase leading-relaxed">
                      Derived from placement history. Not stored. Not adjustable. The audience is truth; the ring is annotation.
                    </div>
                  </div>
                </div>

                {/* Correspondence record */}
                <div className="space-y-1.5">
                  <div className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider">
                    Correspondence
                  </div>
                  <div className="p-2.5 bg-black/40 border border-neutral-900 rounded space-y-1.5 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Sent to them:</span>
                      <span className="text-neutral-200">{sentTo.length} placement{sentTo.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Received from them:</span>
                      <span className="text-neutral-200">{receivedFrom.length} placement{receivedFrom.length === 1 ? '' : 's'}</span>
                    </div>
                    {receivedFrom[0] && (
                      <div className="pt-1.5 border-t border-neutral-900">
                        <div className="text-[8px] text-neutral-600 uppercase mb-0.5">Most recent from them</div>
                        <div className="text-neutral-400 font-sans leading-relaxed line-clamp-2">
                          {receivedFrom[0].content || `[${receivedFrom[0].payloadType}]`}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Key access */}
                <div className="space-y-1.5">
                  <div className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider flex items-center gap-1">
                    <KeyRound size={10} className="text-red-400" /> Key Access
                  </div>
                  <div className="p-2.5 bg-black/40 border border-neutral-900 rounded space-y-1.5 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">You hold their key:</span>
                      <span className={iHoldKey ? 'text-red-400 font-bold' : 'text-neutral-600'}>{iHoldKey ? 'YES' : 'NO'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">They hold your key:</span>
                      <span className={theyHoldKey ? 'text-red-400 font-bold' : 'text-neutral-600'}>{theyHoldKey ? 'YES' : 'NO'}</span>
                    </div>
                    {!iHoldKey && (
                      <div className="flex items-center gap-1.5 pt-1.5 border-t border-neutral-900">
                        {pendingKeyReq ? (
                          <span className="text-[9px] text-amber-500 uppercase">Request pending…</span>
                        ) : (
                          <>
                            <button
                              onClick={() => handleRequestKey('permanent')}
                              className="px-2 py-0.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[9px] rounded uppercase"
                            >
                              Request permanent
                            </button>
                            <button
                              onClick={() => handleRequestKey('timed')}
                              className="px-2 py-0.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[9px] rounded uppercase"
                            >
                              Request timed
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Connection / bounded disclosure */}
                <div className="space-y-1.5">
                  <div className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider flex items-center gap-1">
                    <Link2 size={10} /> Connection
                  </div>
                  {!isConnected && (
                    <button
                      onClick={handleConnect}
                      className="w-full py-1.5 bg-white hover:bg-neutral-200 text-black text-[10px] font-bold rounded font-mono uppercase transition-colors"
                    >
                      Invite to connect
                    </button>
                  )}
                  {outboundConn && outboundConn.status === 'connected' && (
                    <div className="p-2.5 bg-black/40 border border-neutral-900 rounded space-y-2 text-[10px] font-mono">
                      <div className="text-[8px] text-neutral-600 uppercase leading-relaxed">
                        Bounded disclosure — what this connection reveals about you:
                      </div>
                      {(
                        [
                          ['connectionExists', 'Connection exists'],
                          ['context', 'Context'],
                          ['identity', 'Identity']
                        ] as const
                      ).map(([field, label]) => {
                        const on = outboundConn.revealedDecision[field];
                        return (
                          <button
                            key={field}
                            onClick={() => setBoundedDisclosure(outboundConn.id, field, !on)}
                            className={`w-full flex items-center justify-between px-2 py-1 rounded border transition-colors ${on ? 'border-neutral-700 bg-neutral-900 text-neutral-200' : 'border-neutral-900 bg-black text-neutral-600'}`}
                          >
                            <span className="uppercase">{label}</span>
                            {on ? <Eye size={11} /> : <EyeOff size={11} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {outboundConn && outboundConn.status === 'pending' && (
                    <div className="p-2 bg-black/40 border border-neutral-900 rounded text-[9px] font-mono text-amber-500 uppercase text-center">
                      Invitation pending
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* INTRODUCTION — ceremonial, always available */}
        <div className="space-y-1.5 pt-2 border-t border-neutral-900">
          <div className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider flex items-center gap-1">
            <GitMerge size={10} className="text-amber-500" /> Introduction
          </div>
          <div className="p-3 bg-black/40 border border-amber-900/20 rounded-lg space-y-2.5">
            <p className="text-[9px] font-mono text-neutral-500 uppercase leading-relaxed">
              As {currentSelf.name}, introduce two Selves to each other. Both must accept.
            </p>
            <div className="flex items-center gap-1.5">
              <select
                value={introA}
                onChange={(e) => setIntroA(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-[10px] text-neutral-200 font-mono focus:outline-none"
              >
                <option value="">Self A…</option>
                {others.filter(s => s.id !== introB).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ArrowRight size={11} className="text-neutral-600 shrink-0" />
              <select
                value={introB}
                onChange={(e) => setIntroB(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-[10px] text-neutral-200 font-mono focus:outline-none"
              >
                <option value="">Self B…</option>
                {others.filter(s => s.id !== introA).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleIntroduce}
              className="w-full py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-800/50 text-amber-400 text-[10px] font-bold rounded font-mono uppercase transition-colors"
            >
              Propose Introduction
            </button>
          </div>
        </div>

      </div>
    </aside>
  );
}
