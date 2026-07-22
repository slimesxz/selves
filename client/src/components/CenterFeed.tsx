/**
 * The Register — composer and correspondence stage.
 * The composer is a letter register: From / write / To / Send.
 * The feed shows only what you wrote or what was addressed to you.
 */

import React, { useState } from 'react';
import { Self, Placement, PayloadType, Poll } from '../types';
import { FeedFilter } from '../hooks/useSelvesState';
import { IconRenderer } from './IconRenderer';
import {
  Bookmark,
  Plus,
  X,
  Lock,
  ArrowRight,
  Check,
  Send,
  KeyRound,
  Gift
} from 'lucide-react';

interface CenterFeedProps {
  currentSelf: Self;
  selves: Self[];
  feedFilter: FeedFilter;
  setFeedFilter: (f: FeedFilter) => void;
  visiblePlacements: Placement[];
  createPlacement: (
    content: string,
    recipientSelfIds: string[],
    payloadType: PayloadType,
    payloadData?: Placement['payloadData']
  ) => string;
  createPollPlacement: (question: string, options: string[], recipientSelfIds: string[]) => void;
  toggleBookmark: (placementId: string) => void;
  bookmarks: { [selfId: string]: string[] };
  voteInPoll: (pollId: string, optionId: string) => void;
  polls: Poll[];
  deriveRing: (fromId: string, toId: string) => string | null;
  connectedIds: string[];
}

const PAYLOADS: PayloadType[] = ['text', 'photo', 'poll', 'gift', 'key'];

const GIFT_OPTIONS = [
  { name: 'Obsidian Monolith', symbol: '⬛' },
  { name: 'Prism Lens', symbol: '💎' },
  { name: 'Hourglass', symbol: '⏳' },
  { name: 'Seal', symbol: '🔏' },
  { name: 'Seed', symbol: '🌱' }
];

export function CenterFeed({
  currentSelf,
  selves,
  feedFilter,
  setFeedFilter,
  visiblePlacements,
  createPlacement,
  createPollPlacement,
  toggleBookmark,
  bookmarks,
  voteInPoll,
  polls,
  deriveRing,
  connectedIds
}: CenterFeedProps) {
  const [payloadType, setPayloadType] = useState<PayloadType>('text');
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [recipientIds, setRecipientIds] = useState<string[]>([]);

  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [giftIdx, setGiftIdx] = useState(0);

  const [errorBanner, setErrorBanner] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  const activeSelfBookmarks = bookmarks[currentSelf.id] || [];

  // Recipients you can address: Selves you are connected to.
  const addressableSelves = selves.filter(s => s.id !== currentSelf.id && connectedIds.includes(s.id));

  const filteredPlacements = visiblePlacements.filter(p => {
    if (feedFilter === 'Vault') return p.selfId === currentSelf.id && p.recipientSelfIds.length === 0;
    // 'Sent' — the letter register shows only what this Self has written.
    return p.selfId === currentSelf.id && p.recipientSelfIds.length > 0;
  });

  const toggleRecipient = (id: string) => {
    setRecipientIds(prev => (prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]));
  };

  const clearComposer = () => {
    setContent('');
    setMediaUrl('');
    setPollQuestion('');
    setPollOptions(['', '']);
    setRecipientIds([]);
  };

  const flashSuccess = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => setSuccessBanner(''), 2200);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner('');

    // Key must be addressed to at least one visible person.
    if (payloadType === 'key' && recipientIds.length === 0) {
      setErrorBanner('A key must be sent to at least one person.');
      return;
    }

    const recipientNames =
      recipientIds.length === 0
        ? 'Vault (no recipients — private)'
        : recipientIds.map(id => selves.find(s => s.id === id)?.name).filter(Boolean).join(', ');

    if (payloadType === 'poll') {
      const validOptions = pollOptions.map(o => o.trim()).filter(Boolean);
      if (!pollQuestion.trim() || validOptions.length < 2) {
        setErrorBanner('A poll needs a question and at least two options.');
        return;
      }
      createPollPlacement(pollQuestion.trim(), validOptions, recipientIds);
      flashSuccess(`Poll placed. To: ${recipientNames}`);
      clearComposer();
      return;
    }

    if (payloadType === 'photo') {
      if (!mediaUrl.trim()) {
        setErrorBanner('A photo placement needs an image URL.');
        return;
      }
      createPlacement(content.trim(), recipientIds, 'photo', { mediaUrl: mediaUrl.trim() });
      flashSuccess(`Photo placed. To: ${recipientNames}`);
      clearComposer();
      return;
    }

    if (payloadType === 'gift') {
      const gift = GIFT_OPTIONS[giftIdx];
      createPlacement(content.trim(), recipientIds, 'gift', { giftName: gift.name, giftSymbol: gift.symbol });
      flashSuccess(`Gift placed. To: ${recipientNames}`);
      clearComposer();
      return;
    }

    if (payloadType === 'key') {
      createPlacement(content.trim(), recipientIds, 'key');
      flashSuccess(`Key sent. To: ${recipientNames}`);
      clearComposer();
      return;
    }

    // text
    if (!content.trim()) {
      setErrorBanner('Write something first.');
      return;
    }
    createPlacement(content.trim(), recipientIds, 'text');
    flashSuccess(`Placed. To: ${recipientNames}`);
    clearComposer();
  };

  return (
    <div id="center-column" className="flex flex-col h-full bg-black overflow-y-auto">

      {/* Register header + filter */}
      <div className="border-b border-neutral-900 bg-neutral-950/80 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center justify-between p-3 border-b border-neutral-900/60">
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-neutral-400">
            <Send size={12} className="text-neutral-500" />
            THE REGISTER
            <span className="text-neutral-600">//</span>
            <span className="font-bold uppercase" style={{ color: currentSelf.color }}>{currentSelf.name}</span>
          </div>
          <div className="text-[9px] font-mono text-neutral-500 tracking-wider uppercase">
            Every letter is addressed to visible people
          </div>
        </div>

        <div className="flex items-center gap-2 p-2 bg-neutral-950 text-[9px] font-mono border-b border-neutral-900 overflow-x-auto">
          <span className="text-neutral-500 font-bold uppercase shrink-0">Register:</span>
          {(['Sent', 'Vault'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFeedFilter(f)}
              className={`px-2 py-0.5 rounded border uppercase shrink-0 ${feedFilter === f ? 'bg-white border-white text-black font-bold' : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-6 flex-1">

        {errorBanner && (
          <div className="p-2.5 bg-red-950/20 border border-red-900 text-red-400 text-[10px] font-mono rounded uppercase">
            [ERROR]: {errorBanner}
          </div>
        )}
        {successBanner && (
          <div className="p-2.5 bg-emerald-950/20 border border-emerald-900 text-emerald-400 text-[10px] font-mono rounded uppercase flex items-center gap-1">
            <Check size={11} /> {successBanner}
          </div>
        )}

        {/* LETTER REGISTER — From / write / To / Send */}
        <form onSubmit={handleSend} id="composer-container" className="p-3 bg-neutral-950 border border-neutral-900 rounded-lg space-y-3">

          {/* FROM */}
          <div className="flex items-center justify-between pb-2 border-b border-neutral-900">
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-neutral-400">
              <span className="uppercase text-neutral-500 font-bold">From</span>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentSelf.color }}></span>
              <span className="font-bold text-neutral-200 uppercase">{currentSelf.name}</span>
            </div>

            {/* Payload tabs — closed set */}
            <div className="flex items-center gap-1 font-mono text-[9px]">
              {PAYLOADS.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPayloadType(type)}
                  className={`px-2 py-0.5 border rounded uppercase ${payloadType === type ? 'bg-neutral-900 border-neutral-700 text-white font-bold' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* WRITE — text is always present */}
          <textarea
            id="composer-text-input"
            rows={3}
            maxLength={400}
            placeholder={`Write as ${currentSelf.name}...`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full bg-black border border-neutral-900 rounded p-2.5 text-xs text-neutral-200 font-sans focus:outline-none focus:border-neutral-700 leading-relaxed placeholder:font-mono placeholder:text-[10px]"
          />

          {/* Payload-specific fields */}
          {payloadType === 'photo' && (
            <input
              type="text"
              placeholder="Image URL..."
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              className="w-full bg-black border border-neutral-900 rounded px-2.5 py-1.5 text-xs text-neutral-200 font-mono focus:outline-none focus:border-neutral-700"
            />
          )}

          {payloadType === 'poll' && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Poll question..."
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                className="w-full bg-black border border-neutral-900 rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-neutral-700"
              />
              {pollOptions.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder={`Option ${idx + 1}`}
                    value={opt}
                    onChange={(e) => setPollOptions(pollOptions.map((o, i) => (i === idx ? e.target.value : o)))}
                    className="flex-1 bg-black border border-neutral-900 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:border-neutral-700"
                  />
                  {pollOptions.length > 2 && (
                    <button type="button" onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))} className="text-neutral-600 hover:text-white">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              {pollOptions.length < 5 && (
                <button type="button" onClick={() => setPollOptions([...pollOptions, ''])} className="flex items-center gap-1 text-[9px] font-mono text-neutral-500 hover:text-white uppercase">
                  <Plus size={10} /> Add option
                </button>
              )}
            </div>
          )}

          {payloadType === 'gift' && (
            <div className="flex flex-wrap gap-1.5">
              {GIFT_OPTIONS.map((g, i) => (
                <button
                  key={g.name}
                  type="button"
                  onClick={() => setGiftIdx(i)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono transition-colors ${giftIdx === i ? 'bg-neutral-900 border-neutral-600 text-white' : 'bg-black border-neutral-900 text-neutral-500 hover:text-neutral-300'}`}
                >
                  <span>{g.symbol}</span> {g.name}
                </button>
              ))}
            </div>
          )}

          {payloadType === 'key' && (
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <KeyRound size={12} className="text-red-400" />
              <span className="text-neutral-500 uppercase">Grants access to your private correspondence.</span>
            </div>
          )}

          {/* TO — recipients are ground truth */}
          <div className="pt-2 border-t border-neutral-900 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[9px] font-mono">
              <span className="uppercase text-neutral-500 font-bold">To</span>
              {recipientIds.length === 0 && (
                <span className="flex items-center gap-1 text-neutral-600 uppercase">
                  <Lock size={9} /> No recipients — this stays in your Vault
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {addressableSelves.length === 0 && (
                <span className="text-[9px] font-mono text-neutral-600 uppercase">No connected Selves to address yet.</span>
              )}
              {addressableSelves.map(s => {
                const selected = recipientIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleRecipient(s.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-mono transition-all ${selected ? 'border-white bg-neutral-900 text-white font-bold' : 'border-neutral-800 bg-black text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }}></span>
                    {s.name}
                    {selected && <Check size={9} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* SEND */}
          <button
            type="submit"
            className="w-full py-1.5 bg-white hover:bg-neutral-200 text-black text-xs font-bold rounded font-mono transition-colors uppercase flex items-center justify-center gap-1.5"
          >
            <Send size={12} /> Send
          </button>
        </form>

        {/* CORRESPONDENCE */}
        <div className="space-y-4">
          {filteredPlacements.length === 0 && (
            <div className="p-8 border border-neutral-900 bg-neutral-950 rounded-lg text-center text-[10px] text-neutral-600 font-mono uppercase">
              Nothing in this register yet.
            </div>
          )}

          {filteredPlacements.map(placement => {
            const author = selves.find(s => s.id === placement.selfId);
            if (!author) return null;
            const isVault = placement.recipientSelfIds.length === 0;
            const isBookmarked = activeSelfBookmarks.includes(placement.id);
            const poll = placement.payloadType === 'poll' ? polls.find(pl => pl.id === placement.payloadData?.pollId) : null;
            const recipients = placement.recipientSelfIds
              .map(id => selves.find(s => s.id === id))
              .filter((s): s is Self => !!s);

            return (
              <div key={placement.id} className="p-3 bg-neutral-950 border border-neutral-900 rounded-lg space-y-2.5">

                {/* From -> To line */}
                <div className="flex items-center justify-between text-[9px] font-mono">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border font-bold"
                      style={{ borderColor: author.color, color: author.color }}
                    >
                      <IconRenderer name={author.icon} size={9} />
                      {author.name}
                    </span>
                    <ArrowRight size={10} className="text-neutral-600" />
                    {isVault ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-red-900/60 text-red-400/90 uppercase">
                        <Lock size={8} /> Vault
                      </span>
                    ) : (
                      recipients.map(r => {
                        const ring = deriveRing(author.id, r.id);
                        return (
                          <span
                            key={r.id}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-neutral-800 text-neutral-400"
                            title={ring ? `Derived: ${ring}` : undefined}
                          >
                            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: r.color }}></span>
                            {r.name}
                            {ring && <span className="text-[7px] text-neutral-600 uppercase">· {ring}</span>}
                          </span>
                        );
                      })
                    )}
                  </div>
                  <span className="text-neutral-600 shrink-0 ml-2">
                    {new Date(placement.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Content */}
                {placement.content && (
                  <p className="text-xs text-neutral-200 leading-relaxed">{placement.content}</p>
                )}

                {/* Payloads */}
                {placement.payloadType === 'photo' && placement.payloadData?.mediaUrl && (
                  <img
                    src={placement.payloadData.mediaUrl}
                    alt=""
                    className="w-full max-h-64 object-cover rounded border border-neutral-900"
                  />
                )}

                {placement.payloadType === 'gift' && placement.payloadData?.giftName && (
                  <div className="flex items-center gap-2 p-2.5 bg-black border border-neutral-900 rounded text-[10px] font-mono text-neutral-300">
                    <Gift size={12} className="text-amber-500" />
                    <span className="text-base leading-none">{placement.payloadData.giftSymbol}</span>
                    <span className="uppercase">{placement.payloadData.giftName}</span>
                  </div>
                )}

                {placement.payloadType === 'key' && (
                  <div className="flex items-center gap-2 p-2.5 bg-black border border-red-900/40 rounded text-[10px] font-mono text-red-400/90 uppercase">
                    <KeyRound size={12} />
                    Key — access to {author.name}'s private correspondence
                  </div>
                )}

                {poll && (
                  <div className="space-y-1.5 p-2.5 bg-black border border-neutral-900 rounded">
                    <div className="text-[10px] font-mono text-neutral-400 uppercase font-bold">{poll.question}</div>
                    {poll.options.map(opt => {
                      const voted = poll.voterSelfIds[currentSelf.id] === opt.id;
                      const hasVoted = !!poll.voterSelfIds[currentSelf.id];
                      return (
                        <button
                          key={opt.id}
                          disabled={hasVoted}
                          onClick={() => voteInPoll(poll.id, opt.id)}
                          className={`w-full text-left px-2 py-1.5 rounded border text-[10px] transition-colors ${voted ? 'border-white text-white font-bold' : 'border-neutral-800 text-neutral-400 hover:border-neutral-600'} ${hasVoted ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <span>{opt.text}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Row: bookmark — no reactions, no counts */}
                <div className="flex items-center justify-between pt-1.5 border-t border-neutral-900/70">
                  <span className="text-[8px] font-mono text-neutral-600 uppercase">
                    {placement.payloadType} placement
                  </span>
                  <button
                    onClick={() => toggleBookmark(placement.id)}
                    className={`transition-colors ${isBookmarked ? 'text-amber-500' : 'text-neutral-600 hover:text-neutral-300'}`}
                    title="Bookmark (private)"
                  >
                    <Bookmark size={12} fill={isBookmarked ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
