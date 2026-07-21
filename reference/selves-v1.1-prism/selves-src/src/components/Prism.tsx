import type { PrismReading } from "../lib/prism";
import { ArrowRight } from "lucide-react";

/**
 * The Prism — what a Self is becoming, made legible from its own residue.
 * It arranges reality; it never explains it. Every line is a count, a recency,
 * a recurrence, or the user's own words. No authored adjectives. No direction.
 */
export default function Prism({
  reading,
  onContinue,
  onOpenCorrespondence,
}: {
  reading: PrismReading;
  onContinue: () => void;
  onOpenCorrespondence: (id: string) => void;
}) {
  const r = reading;
  const accent = r.self.accent;

  const Line = ({ n, label }: { n: number; label: string }) =>
    n > 0 ? (
      <div className="flex items-baseline gap-2.5">
        <span className="text-[15px] font-mono tabular-nums text-white w-7 text-right">
          {n}
        </span>
        <span className="text-[13px] text-[#888]">{label}</span>
      </div>
    ) : null;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-10 py-10">
        {/* Identity */}
        <div className="mb-8">
          <div className="text-[26px] font-bold tracking-tight text-white">
            {r.self.name}
          </div>
          <div className="text-[12px] font-mono mt-1" style={{ color: accent }}>
            @{r.self.handle}
          </div>
        </div>

        {/* Becoming visible through — counts */}
        <div className="mb-9">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#555] mb-3">
            becoming visible through
          </div>
          <div className="space-y-1.5">
            <Line n={r.artifactCount} label="artifacts" />
            <Line n={r.correspondenceCount} label="correspondences" />
            <Line n={r.quietingCount} label="quieting lines" />
            <Line
              n={r.unansweredIntroductions}
              label={
                r.unansweredIntroductions === 1
                  ? "unanswered introduction"
                  : "unanswered introductions"
              }
            />
          </div>
        </div>

        {/* Recurring lately — YOUR people and YOUR words, verbatim */}
        {(r.recurringPeople.length > 0 || r.recurringWords.length > 0) && (
          <div className="mb-9">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#555] mb-3">
              recurring lately
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {r.recurringPeople.map((p) => (
                <span key={p.name} className="text-[14px] text-zinc-200">
                  {p.name}
                </span>
              ))}
              {r.recurringWords.map((w) => (
                <span key={w.word} className="text-[14px] text-[#9a9aa2]">
                  {w.word}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Alive / quiet — arranged side by side, unexplained */}
        <div className="grid grid-cols-2 gap-6 mb-9">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#555] mb-2">
              most alive
            </div>
            {r.mostAlive ? (
              <button
                onClick={() => onOpenCorrespondence(r.mostAlive!.id)}
                className="text-[15px] font-medium text-white hover:opacity-80 transition-opacity"
                style={{ color: accent }}
              >
                {r.mostAlive.name}
              </button>
            ) : (
              <span className="text-[13px] text-[#3a3a3e]">—</span>
            )}
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#555] mb-2">
              going quiet
            </div>
            {r.goingQuiet ? (
              <button
                onClick={() => onOpenCorrespondence(r.goingQuiet!.id)}
                className="text-left hover:opacity-80 transition-opacity"
              >
                <span className="text-[15px] font-medium text-zinc-300">
                  {r.goingQuiet.name}
                </span>
                <span className="block text-[11px] font-mono text-[#555] mt-0.5">
                  {r.goingQuiet.days}d silent
                </span>
              </button>
            ) : (
              <span className="text-[13px] text-[#3a3a3e]">—</span>
            )}
          </div>
        </div>

        {/* Most recent — shown whole, unremarked */}
        {r.mostRecent && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#555] mb-2">
              most recent
            </div>
            <p
              className="text-[14px] leading-relaxed text-zinc-300 border-l-2 pl-3"
              style={{ borderColor: `${accent}55` }}
            >
              {r.mostRecent.body}
            </p>
            <div className="text-[11px] font-mono text-[#3a3a3e] mt-1.5">
              to {r.mostRecent.withName} · {r.mostRecent.ago} ago
            </div>
          </div>
        )}
      </div>

      {/* The only action: continue. Opens the composer with To: empty. */}
      <div className="shrink-0 px-10 py-5 border-t border-[#141416]">
        <button
          onClick={onContinue}
          className="inline-flex items-center gap-2.5 pl-5 pr-4 py-2.5 rounded-xl text-[14px] font-semibold text-black transition-transform active:scale-[0.98]"
          style={{ background: accent }}
        >
          Continue {r.self.name}
          <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
