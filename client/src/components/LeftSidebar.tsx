/**
 * Left panel — Self registry, inbox, system.
 */

import React, { useState } from 'react';
import { Self, Notification } from '../types';
import { IconRenderer } from './IconRenderer';
import { Plus, Bell, Trash2, Check, X } from 'lucide-react';

interface LeftSidebarProps {
  selves: Self[];
  currentSelfId: string;
  switchSelf: (id: string) => void;
  createSelf: (name: string, color: string, icon: string, bio: string) => { success: boolean; error?: string };
  notifications: Notification[];
  markNotificationAsRead: (id: string) => void;
  resolveKeyGrant: (grantId: string, status: 'granted' | 'declined') => void;
  resolveIntroduction: (introId: string, targetSelfId: string, accept: boolean) => void;
  acceptConnection: (connectionId: string, targetSelfId: string) => void;
  declineConnection: (connectionId: string) => void;
  factoryReset: () => void;
}

export function LeftSidebar({
  selves,
  currentSelfId,
  switchSelf,
  createSelf,
  notifications,
  markNotificationAsRead,
  resolveKeyGrant,
  resolveIntroduction,
  acceptConnection,
  declineConnection,
  factoryReset
}: LeftSidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#a855f7');
  const [newIcon, setNewIcon] = useState('Compass');
  const [newBio, setNewBio] = useState('');
  const [creationError, setCreationError] = useState('');
  const [activeTab, setActiveTab] = useState<'selves' | 'notifs' | 'system'>('selves');

  const userSelves = selves.filter(s => s.userId === 'user_1');
  const activeSelf = userSelves.find(s => s.id === currentSelfId) || userSelves[0];

  const activeNotifications = notifications.filter(n => n.selfId === currentSelfId);
  const unreadNotifsCount = activeNotifications.filter(n => !n.read).length;

  const iconOptions = ['Shield', 'BookOpen', 'Moon', 'Terminal', 'Library', 'Compass', 'Eye', 'PenTool', 'Cpu'];
  const colorOptions = [
    { name: 'Teal', hex: '#14b8a6' },
    { name: 'Ruby', hex: '#ef4444' },
    { name: 'Violet', hex: '#8b5cf6' },
    { name: 'Gold', hex: '#f59e0b' },
    { name: 'Emerald', hex: '#10b981' },
    { name: 'Rose', hex: '#f43f5e' },
    { name: 'Ocean', hex: '#06b6d4' }
  ];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setCreationError('A name is required.');
      return;
    }
    const res = createSelf(newName, newColor, newIcon, newBio);
    if (res.success) {
      setIsCreating(false);
      setNewName('');
      setNewBio('');
      setCreationError('');
    } else {
      setCreationError(res.error || 'Failed to create Self.');
    }
  };

  return (
    <aside id="left-column" className="flex flex-col h-full bg-neutral-950 border-r border-neutral-900 overflow-y-auto text-neutral-300">

      {/* Brand */}
      <div className="p-4 border-b border-neutral-900 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-white rounded flex items-center justify-center text-black font-black text-xs font-mono">
            S
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-neutral-100 font-mono">SELVES</h1>
            <p className="text-[9px] text-neutral-500 font-mono">BOUNDED DISCLOSURE // V2.0</p>
          </div>
        </div>
        <div className="text-[10px] bg-neutral-900 px-1.5 py-0.5 rounded font-mono border border-neutral-800 text-neutral-400">
          STABLE
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-3 border-b border-neutral-900 text-center font-mono text-[10px] uppercase">
        <button
          id="tab-selves"
          onClick={() => setActiveTab('selves')}
          className={`py-2 border-r border-neutral-900 transition-colors ${activeTab === 'selves' ? 'bg-neutral-900 text-neutral-100 font-bold border-b border-b-white' : 'hover:bg-neutral-900/50 text-neutral-500'}`}
        >
          Selves
        </button>
        <button
          id="tab-notifs"
          onClick={() => setActiveTab('notifs')}
          className={`py-2 border-r border-neutral-900 relative transition-colors ${activeTab === 'notifs' ? 'bg-neutral-900 text-neutral-100 font-bold border-b border-b-white' : 'hover:bg-neutral-900/50 text-neutral-500'}`}
        >
          Inbox
          {unreadNotifsCount > 0 && (
            <span className="absolute right-2 top-2 w-2 h-2 rounded-full bg-red-500"></span>
          )}
        </button>
        <button
          id="tab-system"
          onClick={() => setActiveTab('system')}
          className={`py-2 transition-colors ${activeTab === 'system' ? 'bg-neutral-900 text-neutral-100 font-bold border-b border-b-white' : 'hover:bg-neutral-900/50 text-neutral-500'}`}
        >
          System
        </button>
      </div>

      <div className="flex-1 p-4 flex flex-col justify-between">

        {/* SELVES */}
        {activeTab === 'selves' && (
          <div className="space-y-4">

            {activeSelf && (
              <div className="p-3 bg-neutral-900/50 border border-neutral-900 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white border"
                    style={{ backgroundColor: activeSelf.color, borderColor: activeSelf.color }}
                  >
                    <IconRenderer name={activeSelf.icon} size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase text-neutral-500">Active Self</div>
                    <div className="text-xs font-bold text-neutral-100">{activeSelf.name}</div>
                  </div>
                </div>
                <p className="text-[10px] text-neutral-400 line-clamp-2 leading-relaxed italic">
                  "{activeSelf.bio || 'No description yet.'}"
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider">SELF REGISTRY ({userSelves.length}/3)</span>
                {userSelves.length < 3 && !isCreating && (
                  <button
                    id="btn-trigger-create-self"
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-0.5 text-[9px] text-white hover:underline uppercase font-mono font-bold"
                  >
                    <Plus size={10} /> NEW_SELF
                  </button>
                )}
              </div>

              {isCreating && (
                <form onSubmit={handleCreate} className="p-3 bg-neutral-900 border border-neutral-800 rounded-lg space-y-3 mb-3">
                  <div className="flex justify-between items-center pb-1.5 border-b border-neutral-800">
                    <span className="text-[9px] font-mono text-neutral-400 font-bold">NEW SELF</span>
                    <button type="button" onClick={() => setIsCreating(false)} className="text-neutral-500 hover:text-white">
                      <X size={12} />
                    </button>
                  </div>

                  <div>
                    <label className="block text-[8px] font-mono uppercase text-neutral-500 mb-1">Name</label>
                    <input
                      type="text"
                      maxLength={16}
                      placeholder="e.g. Scribe"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-neutral-600 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[8px] font-mono uppercase text-neutral-500 mb-1">Color</label>
                    <div className="flex flex-wrap gap-1.5">
                      {colorOptions.map(col => (
                        <button
                          key={col.hex}
                          type="button"
                          onClick={() => setNewColor(col.hex)}
                          className={`w-4 h-4 rounded-full border transition-all ${newColor === col.hex ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                          style={{ backgroundColor: col.hex }}
                          title={col.name}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[8px] font-mono uppercase text-neutral-500 mb-1">Seal</label>
                    <div className="flex flex-wrap gap-1 bg-neutral-950 p-1.5 border border-neutral-800 rounded">
                      {iconOptions.map(ic => (
                        <button
                          key={ic}
                          type="button"
                          onClick={() => setNewIcon(ic)}
                          className={`p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-900 transition-colors ${newIcon === ic ? 'bg-neutral-800 text-white' : ''}`}
                          title={ic}
                        >
                          <IconRenderer name={ic} size={13} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[8px] font-mono uppercase text-neutral-500 mb-1">Description (optional)</label>
                    <textarea
                      maxLength={120}
                      rows={2}
                      placeholder="What is this Self for..."
                      value={newBio}
                      onChange={(e) => setNewBio(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-neutral-600 font-mono leading-relaxed"
                    />
                  </div>

                  {creationError && (
                    <div className="text-[9px] text-red-500 font-mono">{creationError}</div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-1 bg-white hover:bg-neutral-200 text-black text-xs font-bold rounded font-mono transition-colors uppercase"
                  >
                    CREATE SELF
                  </button>
                </form>
              )}

              <div className="space-y-1.5">
                {userSelves.map(self => {
                  const isActive = self.id === currentSelfId;
                  return (
                    <button
                      key={self.id}
                      onClick={() => switchSelf(self.id)}
                      className={`w-full flex items-center justify-between p-2 rounded border text-left transition-all ${isActive ? 'bg-neutral-900 border-neutral-700 font-bold' : 'bg-neutral-950 hover:bg-neutral-900/30 border-neutral-900'}`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white"
                          style={{ backgroundColor: self.color }}
                        >
                          <IconRenderer name={self.icon} size={12} />
                        </div>
                        <div>
                          <div className="text-xs text-neutral-100">{self.name}</div>
                          <div className="text-[8px] text-neutral-500 font-mono uppercase line-clamp-1">
                            {self.bio || '—'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 font-mono text-[8px] text-neutral-500">
                        {isActive ? (
                          <span className="text-emerald-500 font-bold uppercase tracking-wider flex items-center gap-0.5">
                            <Check size={8} strokeWidth={3} /> ACTIVE
                          </span>
                        ) : (
                          <span>SWITCH_TO</span>
                        )}
                      </div>
                    </button>
                  );
                })}

                {userSelves.length >= 3 && (
                  <div className="p-2.5 border border-neutral-900 bg-neutral-950/20 text-center font-mono text-[9px] text-neutral-600 rounded">
                    CONSTITUTIONAL LIMIT REACHED
                    <div className="text-[7px] text-neutral-700 uppercase mt-0.5">
                      A person may maintain no more than three Selves.
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* INBOX */}
        {activeTab === 'notifs' && (
          <div className="space-y-3 flex-1 flex flex-col justify-between">
            <div className="space-y-2">
              <span className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider">
                INBOX ({activeNotifications.length})
              </span>

              {activeNotifications.length === 0 ? (
                <div className="p-6 border border-neutral-900 bg-neutral-950 rounded-lg text-center text-[10px] text-neutral-600 font-mono">
                  Nothing waiting for this Self.
                </div>
              ) : (
                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                  {activeNotifications.map(notif => (
                    <div
                      key={notif.id}
                      className={`p-2.5 border rounded text-xs transition-colors ${notif.read ? 'bg-neutral-950 border-neutral-900/60 text-neutral-400' : 'bg-neutral-900 border-neutral-800 text-neutral-200'}`}
                      onClick={() => markNotificationAsRead(notif.id)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-neutral-100 text-[10px] uppercase font-mono flex items-center gap-1">
                          <Bell size={10} className={notif.read ? 'text-neutral-600' : 'text-amber-500'} />
                          {notif.title}
                        </span>
                        {!notif.read && (
                          <span className="text-[7px] bg-amber-950 border border-amber-800 text-amber-500 px-0.5 rounded font-mono uppercase">Unread</span>
                        )}
                      </div>
                      <p className="text-[10px] text-neutral-400 font-mono leading-relaxed mb-2">
                        {notif.message}
                      </p>

                      {!notif.read && notif.type === 'key_request' && notif.data?.grantId && (
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-neutral-800">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              resolveKeyGrant(notif.data.grantId, 'granted');
                              markNotificationAsRead(notif.id);
                            }}
                            className="flex items-center gap-0.5 px-2 py-0.5 bg-neutral-100 hover:bg-neutral-200 text-black text-[9px] font-bold rounded font-mono"
                          >
                            <Check size={8} /> GRANT KEY
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              resolveKeyGrant(notif.data.grantId, 'declined');
                              markNotificationAsRead(notif.id);
                            }}
                            className="flex items-center gap-0.5 px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[9px] font-bold rounded font-mono"
                          >
                            <X size={8} /> DECLINE
                          </button>
                        </div>
                      )}

                      {!notif.read && notif.type === 'introduction' && notif.data?.introId && (
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-neutral-800">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              resolveIntroduction(notif.data.introId, currentSelfId, true);
                              markNotificationAsRead(notif.id);
                            }}
                            className="flex items-center gap-0.5 px-2 py-0.5 bg-neutral-100 hover:bg-neutral-200 text-black text-[9px] font-bold rounded font-mono"
                          >
                            <Check size={8} /> ACCEPT
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              resolveIntroduction(notif.data.introId, currentSelfId, false);
                              markNotificationAsRead(notif.id);
                            }}
                            className="flex items-center gap-0.5 px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[9px] font-bold rounded font-mono"
                          >
                            <X size={8} /> DECLINE
                          </button>
                        </div>
                      )}

                      {!notif.read && notif.type === 'connection' && notif.data?.connectionId && (
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-neutral-800">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              acceptConnection(notif.data.connectionId, currentSelfId);
                              markNotificationAsRead(notif.id);
                            }}
                            className="flex items-center gap-0.5 px-2 py-0.5 bg-neutral-100 hover:bg-neutral-200 text-black text-[9px] font-bold rounded font-mono"
                          >
                            <Check size={8} /> CONNECT
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              declineConnection(notif.data.connectionId);
                              markNotificationAsRead(notif.id);
                            }}
                            className="flex items-center gap-0.5 px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[9px] font-bold rounded font-mono"
                          >
                            <X size={8} /> DECLINE
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* SYSTEM */}
        {activeTab === 'system' && (
          <div className="space-y-4">
            <div>
              <span className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider block mb-2">CONSTITUTION</span>
              <div className="p-3 bg-neutral-900/50 border border-neutral-900 rounded-lg space-y-2 text-[10px] font-mono">
                <div className="flex justify-between">
                  <span className="text-neutral-500">MAX_SELVES:</span>
                  <span className="text-neutral-200">3</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">RECIPIENTS:</span>
                  <span className="text-neutral-200">GROUND TRUTH</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">RINGS:</span>
                  <span className="text-neutral-200">DERIVED ONLY</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">METRICS:</span>
                  <span className="text-neutral-200">NONE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">GRAPH:</span>
                  <span className="text-neutral-200">PRIVATE</span>
                </div>
              </div>
            </div>

            <div>
              <span className="text-[9px] font-mono uppercase text-neutral-500 font-bold tracking-wider block mb-2">STORAGE</span>
              <div className="p-3 bg-neutral-900/20 border border-neutral-900 rounded-lg space-y-2.5 text-[10px] font-mono leading-relaxed text-neutral-400">
                <p>
                  This prototype persists locally in your browser. A factory reset clears local state and re-seeds the demonstration correspondents.
                </p>
              </div>
            </div>

            <button
              id="btn-factory-reset"
              onClick={() => {
                if (window.confirm('Factory reset? All local placements, Selves and connections will be re-seeded to baseline.')) {
                  factoryReset();
                }
              }}
              className="w-full py-1.5 border border-red-950 hover:bg-red-950/20 text-red-500 hover:text-red-400 text-[10px] font-bold rounded font-mono transition-colors uppercase flex items-center justify-center gap-1.5"
            >
              <Trash2 size={12} /> FACTORY_RESET
            </button>
          </div>
        )}

        <div className="mt-8 pt-3 border-t border-neutral-900 text-center font-mono text-[8px] text-neutral-600 uppercase tracking-widest">
          SELVES // BOUNDED DISCLOSURE
        </div>

      </div>
    </aside>
  );
}
