import type { Artifact, Correspondence } from "../types";

/** Activity decays; topology does not. Half-life ~14 days, floored (memory, not erasure). */
export function recencyWeight(placedAt: string, now = Date.now()): number {
  const days = (now - new Date(placedAt).getTime()) / 86_400_000;
  return Math.max(0.12, Math.pow(0.5, Math.max(0, days) / 14));
}

export function lastActivity(c: Correspondence): string | null {
  if (!c.artifacts.length) return null;
  return c.artifacts.reduce(
    (a, b) => (+new Date(a.placedAt) > +new Date(b.placedAt) ? a : b),
  ).placedAt;
}

export function correspondenceWeight(c: Correspondence, now = Date.now()): number {
  return c.artifacts.reduce((s, a) => s + recencyWeight(a.placedAt, now), 0);
}

export const relTime = (iso: string): string => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
};

/**
 * The instrument. The open architectural question is which enduring object the
 * user inhabits — the Self (identity) or the Correspondence (relationship). We
 * do not prejudge it; we record what the hand reaches for first and let a week
 * of use answer it. Persisted, so the signal accumulates across sessions.
 */
export type ReachKind = "self" | "correspondence";
interface Reach {
  kind: ReachKind;
  at: number;
}
const KEY = "selves.reachlog.v1";

export function logReach(kind: ReachKind) {
  try {
    const raw = localStorage.getItem(KEY);
    const arr: Reach[] = raw ? JSON.parse(raw) : [];
    arr.push({ kind, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-500)));
  } catch {
    /* non-fatal */
  }
}

export function reachSummary(): { self: number; correspondence: number } {
  try {
    const raw = localStorage.getItem(KEY);
    const arr: Reach[] = raw ? JSON.parse(raw) : [];
    return {
      self: arr.filter((r) => r.kind === "self").length,
      correspondence: arr.filter((r) => r.kind === "correspondence").length,
    };
  } catch {
    return { self: 0, correspondence: 0 };
  }
}
