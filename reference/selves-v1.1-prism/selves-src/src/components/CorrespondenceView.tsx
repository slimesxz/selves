import { useState } from "react";
import type { Correspondence, Self } from "../types";
import { relTime, recencyWeight } from "../lib/recency";
import { ArrowRight } from "lucide-react";

/**
 * An open correspondence — the enduring relational object. Rendered as a
 * document you read top to bottom (what passed between a Self and one other),
 * NOT a chat. Placing extends it, the way typing extends a note. The recipient
 * is the correspondence itself, so there is no audience picker — you are not
 * addressing people, you are continuing a relationship.
 */
export default function CorrespondenceView({
  correspondence,
  self,
  onPlace,
  onAccept,
}: {
  correspondence: Correspondence | null;
  self: Self;
  onPlace: (correspondenceId: string, body: string) => void;
  onAccept: (correspondenceId: string) => void;
}) {
  const [body, setBody] = useState("");
  const [depressed, setDepressed] = useState(false);

  if (!correspondence) {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <p className="text-[13px] text-[#3a3a3e] text-center max-w-xs leading-relaxed">
          Open a correspondence to read what has passed — or enter a Self and begin one.
        </p>
      </div>
    );
  }

  const c = correspondence;
  const isVault = c.vault;
  const other = c.with.name;
  const artifacts = [...c.artifacts].sort(
    (a, b) => +new Date(a.placedAt) - +new Date(b.placedAt),
  );

  const send = () => {
    if (!body.trim()) return;
    setDepressed(true);
    const b = body;
    window.setTimeout(() => {
      onPlace(c.id, b);
      setBody("");
      setDepressed(false);
    }, 260);
  };

  const truth = isVault
    ? "This stays with you."
    : c.with.connected
      ? `This reaches ${other}, and stops.`
      : `${other} hasn't met ${self.name} yet. This asks to reach them.`;

  return (
    <div className="h-full flex flex-col">
      {/* Correspondence identity */}
      <div className="shrink-0 px-8 py-5 border-b border-[#141416]">
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold text-white">{self.name}</span>
          <span className="text-[#444]">{isVault ? "·" : "↔"}</span>
          <span
            className="text-[15px] font-semibold"
            style={{ color: isVault ? self.accent : "#e4e4e7" }}
          >
            {isVault ? "Vault" : other}
          </span>
          {!c.with.connected && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400/80 ml-1">
              pending introduction
            </span>
          )}
        </div>
        <div className="text-[11px] text-[#555] mt-1 font-mono">
          {isVault
            ? "a correspondence with yourself — kept, out of time"
            : `${c.artifacts.length} placement${c.artifacts.length === 1 ? "" : "s"} · the line between you`}
        </div>
      </div>

      {/* What passed — read top to bottom */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {artifacts.map((a) => {
          const mine = a.direction === "out";
          const op = 0.5 + 0.5 * recencyWeight(a.placedAt);
          return (
            <div key={a.id} style={{ opacity: op }}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span
                  className="text-[11px] font-mono font-medium"
                  style={{ color: mine ? self.accent : "#888" }}
                >
                  {mine ? self.name : other}
                </span>
                <span className="text-[10px] font-mono text-[#3a3a3e]">
                  {relTime(a.placedAt)} ago
                </span>
                {a.pending && (
                  <button
                    onClick={() => onAccept(c.id)}
                    title="Prototype: stand in for the recipient accepting"
                    className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/30 text-amber-400/90 hover:bg-amber-500/10 transition-colors"
                  >
                    accept
                  </button>
                )}
              </div>
              <p
                className="text-[14px] leading-relaxed text-zinc-200 pl-0 border-l-2 pl-3"
                style={{ borderColor: mine ? `${self.accent}55` : "#26262a" }}
              >
                {a.body}
              </p>
            </div>
          );
        })}
      </div>

      {/* Place into this correspondence — extends the object */}
      <div className="shrink-0 px-8 py-4 border-t border-[#141416]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#555]">
            From
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full accent-transition"
            style={{ background: self.accent }}
          />
          <span className="text-[12px] font-mono accent-transition" style={{ color: self.accent }}>
            @{self.handle}
          </span>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={isVault ? "keep something…" : "write something…"}
          rows={2}
          className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-zinc-100 placeholder-[#3a3a3e] focus:outline-none"
          style={{ caretColor: self.accent }}
        />
        <div className="mt-2 flex items-center justify-between gap-4">
          <span className="text-[12px] font-mono text-[#666]">{truth}</span>
          <button
            onClick={send}
            disabled={!body.trim()}
            className="inline-flex items-center gap-2 pl-4 pr-3 py-2 rounded-xl text-[13px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: body.trim() ? self.accent : "#161618",
              color: body.trim() ? "#000" : "#555",
              transform: depressed ? "scale(0.97)" : "scale(1)",
            }}
          >
            {isVault ? "Keep" : "Send"}
            <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
