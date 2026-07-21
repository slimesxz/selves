import { useMemo, useRef, useState } from "react";
import type { Correspondence, Self } from "../types";
import { ArrowRight } from "lucide-react";

/**
 * The composer — how a Self continues. Reached only after recognition (the
 * Prism). It opens with To: empty. The Prism may reveal that Thomas has gone
 * quiet; it never points the composer at Thomas. Direction is the user's.
 */
export default function Composer({
  self,
  correspondences,
  onPlace,
  onCancel,
}: {
  self: Self;
  correspondences: Correspondence[]; // this Self's correspondences
  onPlace: (recipientNames: string[], body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [depressed, setDepressed] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);

  // Candidates: people this Self already corresponds with (non-vault).
  const candidates = useMemo(
    () =>
      correspondences
        .filter((c) => !c.vault)
        .map((c) => c.with.name),
    [correspondences],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((n) => !recipients.includes(n))
      .filter((n) => (q ? n.toLowerCase().startsWith(q) : false))
      .slice(0, 5);
  }, [query, candidates, recipients]);

  const canSend = body.trim().length > 0 && recipients.length > 0;

  const add = (name: string) => {
    setRecipients((r) => (r.includes(name) ? r : [...r, name]));
    setQuery("");
    toRef.current?.focus();
  };
  const remove = (name: string) =>
    setRecipients((r) => r.filter((x) => x !== name));

  const send = () => {
    if (!canSend) return;
    setDepressed(true);
    const b = body,
      r = recipients;
    window.setTimeout(() => {
      onPlace(r, b);
      setBody("");
      setRecipients([]);
      setDepressed(false);
    }, 280);
  };

  const reaches =
    recipients.length === 0
      ? "No one yet. This reaches no one until you choose."
      : `This reaches ${recipients.length} ${
          recipients.length === 1 ? "person" : "people"
        } and stops.`;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-8 py-5 border-b border-[#141416] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold text-white">
            Continue {self.name}
          </span>
        </div>
        <button
          onClick={onCancel}
          className="text-[11px] font-mono text-[#555] hover:text-zinc-300 transition-colors"
        >
          back to prism
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#666]">
            From
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full accent-transition"
            style={{ background: self.accent }}
          />
          <span
            className="text-[12px] font-mono accent-transition"
            style={{ color: self.accent }}
          >
            @{self.handle}
          </span>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="write something…"
          rows={4}
          autoFocus
          className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-100 placeholder-[#3a3a3e] focus:outline-none"
          style={{ caretColor: self.accent }}
        />

        <div className="mt-4 pt-4 border-t border-[#161618]">
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#666] pt-2">
              To
            </span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {recipients.map((name) => (
                  <span
                    key={name}
                    className="chip-settle inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[#101012] border text-[12px] text-zinc-200"
                    style={{ borderColor: `${self.accent}44` }}
                  >
                    {name}
                    <button
                      onClick={() => remove(name)}
                      className="text-[#555] hover:text-zinc-300 leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  ref={toRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && suggestions[0]) {
                      e.preventDefault();
                      add(suggestions[0]);
                    } else if (e.key === "Backspace" && !query && recipients.length) {
                      remove(recipients[recipients.length - 1]);
                    }
                  }}
                  placeholder={recipients.length ? "" : "— a name…"}
                  className="flex-1 min-w-[90px] bg-transparent text-[13px] text-zinc-100 placeholder-[#3a3a3e] focus:outline-none py-1"
                />
              </div>
              {suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {suggestions.map((n) => (
                    <button
                      key={n}
                      onClick={() => add(n)}
                      className="px-2.5 py-1 rounded-full border border-[#1c1c1f] hover:border-[#2b2b30] text-[12px] text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-8 py-4 border-t border-[#141416] flex items-center justify-between gap-4">
        <span
          className={`text-[12px] font-mono ${
            recipients.length === 0 ? "text-[#555]" : "text-zinc-400"
          }`}
        >
          {reaches}
        </span>
        <button
          onClick={send}
          disabled={!canSend}
          className="inline-flex items-center gap-2 pl-4 pr-3 py-2 rounded-xl text-[13px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: canSend ? self.accent : "#161618",
            color: canSend ? "#000" : "#555",
            transform: depressed ? "scale(0.97)" : "scale(1)",
          }}
        >
          Send
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
