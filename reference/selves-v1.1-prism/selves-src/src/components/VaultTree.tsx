import type { Self, Correspondence } from "../types";
import { correspondenceWeight } from "../lib/recency";
import { ChevronDown, ChevronRight, Archive } from "lucide-react";

/**
 * The vault tree. Self is the top-level navigational object; correspondences
 * nest beneath it. Neither is privileged in code — clicking a Self and clicking
 * a correspondence are both first-class, and both are recorded so use can tell
 * us which one is "home".
 */
export default function VaultTree({
  selves,
  correspondences,
  activeSelfId,
  openId,
  onEnterSelf,
  onOpenCorrespondence,
}: {
  selves: Self[];
  correspondences: Correspondence[];
  activeSelfId: string;
  openId: string | null;
  onEnterSelf: (id: string) => void;
  onOpenCorrespondence: (id: string) => void;
}) {
  return (
    <nav className="text-[13px] select-none">
      {selves.map((self) => {
        const active = self.id === activeSelfId;
        const mine = correspondences
          .filter((c) => c.selfId === self.id)
          .sort((a, b) => {
            if (a.vault !== b.vault) return a.vault ? 1 : -1; // vault last
            return correspondenceWeight(b) - correspondenceWeight(a);
          });

        return (
          <div key={self.id} className="mb-1">
            {/* Self row — enter this identity */}
            <button
              onClick={() => onEnterSelf(self.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] transition-colors group"
            >
              {active ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#555] shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#444] shrink-0" />
              )}
              <span
                className="w-2 h-2 rounded-full shrink-0 accent-transition"
                style={{ background: self.accent }}
              />
              <span
                className={`font-semibold truncate ${
                  active ? "text-white" : "text-zinc-400 group-hover:text-zinc-200"
                }`}
              >
                {self.name}
              </span>
            </button>

            {/* Correspondences — the relational objects, nested */}
            {active && (
              <div className="ml-[15px] pl-3 border-l border-[#161618] mt-0.5 space-y-0.5">
                {mine.map((c) => {
                  const isOpen = c.id === openId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onOpenCorrespondence(c.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left ${
                        isOpen ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      {c.vault ? (
                        <Archive
                          className="w-3.5 h-3.5 shrink-0"
                          style={{ color: self.accent }}
                        />
                      ) : (
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            c.with.connected ? "" : "ring-1"
                          }`}
                          style={{
                            background: c.with.connected ? "#3a3a3e" : "transparent",
                            ...(c.with.connected
                              ? {}
                              : { boxShadow: `inset 0 0 0 1px ${self.accent}` }),
                          }}
                        />
                      )}
                      <span
                        className={`truncate ${
                          isOpen ? "text-white" : "text-zinc-400"
                        }`}
                      >
                        {c.vault ? "Vault" : c.with.name}
                      </span>
                      {!c.with.connected && (
                        <span className="ml-auto text-[9px] font-mono uppercase text-amber-400/70 shrink-0">
                          pending
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
