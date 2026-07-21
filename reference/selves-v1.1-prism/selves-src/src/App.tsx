import { useMemo, useState } from "react";
import type { Correspondence } from "./types";
import { SELVES, CORRESPONDENCES } from "./data/seed";
import VaultTree from "./components/VaultTree";
import Prism from "./components/Prism";
import Composer from "./components/Composer";
import CorrespondenceView from "./components/CorrespondenceView";
import CorrespondenceGraph from "./components/CorrespondenceGraph";
import { logReach, reachSummary } from "./lib/recency";
import { readPrism } from "./lib/prism";

type CenterMode = "prism" | "composer" | "correspondence";

export default function App() {
  const [correspondences, setCorrespondences] = useState<Correspondence[]>(() =>
    structuredClone(CORRESPONDENCES),
  );
  const [activeSelfId, setActiveSelfId] = useState(SELVES[0].id);
  const [mode, setMode] = useState<CenterMode>("prism"); // recognition first
  const [openId, setOpenId] = useState<string | null>(null);
  const [reach, setReach] = useState(() => reachSummary());

  const activeSelf = SELVES.find((s) => s.id === activeSelfId)!;
  const selfCorrespondences = useMemo(
    () => correspondences.filter((c) => c.selfId === activeSelfId),
    [correspondences, activeSelfId],
  );
  const openCorrespondence =
    correspondences.find((c) => c.id === openId) ?? null;
  const reading = useMemo(
    () => readPrism(activeSelf, correspondences),
    [activeSelf, correspondences],
  );

  const enterSelf = (id: string) => {
    setActiveSelfId(id);
    setMode("prism");
    setOpenId(null);
    logReach("self");
    setReach(reachSummary());
  };

  const openCorrespondenceById = (id: string) => {
    const c = correspondences.find((x) => x.id === id);
    if (c) setActiveSelfId(c.selfId);
    setOpenId(id);
    setMode("correspondence");
    logReach("correspondence");
    setReach(reachSummary());
  };

  const appendTo = (coId: string, body: string) =>
    setCorrespondences((cs) =>
      cs.map((c) =>
        c.id === coId
          ? {
              ...c,
              artifacts: [
                ...c.artifacts,
                {
                  id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  direction: "out" as const,
                  body,
                  placedAt: new Date().toISOString(),
                  pending: !c.with.connected,
                },
              ],
            }
          : c,
      ),
    );

  const placeToNames = (names: string[], body: string) => {
    for (const name of names) {
      const co = correspondences.find(
        (c) => c.selfId === activeSelfId && !c.vault && c.with.name === name,
      );
      if (co) appendTo(co.id, body);
    }
    setMode("prism");
  };

  const accept = (coId: string) =>
    setCorrespondences((cs) =>
      cs.map((c) =>
        c.id === coId
          ? {
              ...c,
              with: { ...c.with, connected: true },
              artifacts: c.artifacts.map((a) => ({ ...a, pending: false })),
            }
          : c,
      ),
    );

  const total = reach.self + reach.correspondence;

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[#141416] px-5 h-12 flex items-center">
        <span className="text-[15px] font-extrabold tracking-[0.14em] text-white select-none">
          SELVES
        </span>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,38%)] min-h-0">
        <aside className="flex flex-col border-r border-[#141416] min-h-0">
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <VaultTree
              selves={SELVES}
              correspondences={correspondences}
              activeSelfId={activeSelfId}
              openId={mode === "correspondence" ? openId : null}
              onEnterSelf={enterSelf}
              onOpenCorrespondence={openCorrespondenceById}
            />
          </div>
          <div className="shrink-0 border-t border-[#141416] px-4 py-3">
            <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[#555] mb-2">
              what you reach for
            </div>
            {total === 0 ? (
              <div className="text-[10px] text-[#3a3a3e] font-mono leading-snug">
                nothing yet — the log fills as you use it, and answers which
                object is home.
              </div>
            ) : (
              <div className="space-y-1.5">
                <ReachBar label="entered a Self" n={reach.self} total={total} color="#e4e4e7" />
                <ReachBar
                  label="opened a correspondence"
                  n={reach.correspondence}
                  total={total}
                  color={activeSelf.accent}
                />
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 border-r border-[#141416]">
          {mode === "prism" && (
            <Prism
              reading={reading}
              onContinue={() => setMode("composer")}
              onOpenCorrespondence={openCorrespondenceById}
            />
          )}
          {mode === "composer" && (
            <Composer
              self={activeSelf}
              correspondences={selfCorrespondences}
              onPlace={placeToNames}
              onCancel={() => setMode("prism")}
            />
          )}
          {mode === "correspondence" && (
            <CorrespondenceView
              correspondence={openCorrespondence}
              self={activeSelf}
              onPlace={(coId, body) => appendTo(coId, body)}
              onAccept={accept}
            />
          )}
        </main>

        <section className="min-h-[340px] lg:min-h-0">
          <CorrespondenceGraph
            key={activeSelfId}
            self={activeSelf}
            correspondences={selfCorrespondences}
            openId={mode === "correspondence" ? openId : null}
            onOpen={openCorrespondenceById}
          />
        </section>
      </div>
    </div>
  );
}

function ReachBar({
  label,
  n,
  total,
  color,
}: {
  label: string;
  n: number;
  total: number;
  color: string;
}) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-[#888]">{label}</span>
        <span className="text-[10px] font-mono text-[#666]">
          {n} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-[#141416] overflow-hidden">
        <div
          className="h-full rounded-full accent-transition"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
