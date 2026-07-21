import type { Correspondence, Self } from "../types";
import { correspondenceWeight, lastActivity, recencyWeight } from "./recency";

/**
 * The Prism. It arranges reality; it never explains it. Everything here is
 * residue of use — counts, recencies, recurrences, and the user's OWN words
 * lifted verbatim. The prism may surface possible significance. It may never
 * author an adjective about the user, and it may never convert significance
 * into direction. Recognition belongs to the human.
 */

export interface PrismReading {
  self: Self;
  artifactCount: number;
  correspondenceCount: number;
  quietingCount: number; // correspondences with no activity in 21+ days
  unansweredIntroductions: number; // pending outbound first-contacts
  recurringPeople: { name: string; n: number }[]; // your recipients, by frequency
  recurringWords: { word: string; n: number }[]; // YOUR words, verbatim, repeated
  mostAlive: { id: string; name: string } | null;
  goingQuiet: { id: string; name: string; days: number } | null;
  mostRecent: { body: string; withName: string; ago: string } | null;
}

// Words the prism will not count as "recurring" — they carry no residue.
const STOP = new Set(
  ("the a an and or but if then this that these those i you he she it we they " +
    "is are was were be been being to of in on at for with from by as it's im " +
    "my your our their his her its me us them so no not yes do did done have has " +
    "had will would can could should just about into out up down over under " +
    "what when where who how why which than too very more most some any all " +
    "one two three here there now today tonight still yet also like get got")
    .split(" "),
);

const DAY = 86_400_000;

export function readPrism(self: Self, all: Correspondence[]): PrismReading {
  const mine = all.filter((c) => c.selfId === self.id);
  const now = Date.now();

  const artifactCount = mine.reduce((s, c) => s + c.artifacts.length, 0);

  // Recurring people — your recipients, by how often you place to them.
  const peopleCounts = new Map<string, number>();
  for (const c of mine) {
    if (c.vault) continue;
    const outs = c.artifacts.filter((a) => a.direction === "out").length;
    if (outs > 0) peopleCounts.set(c.with.name, outs);
  }
  const recurringPeople = [...peopleCounts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);

  // Recurring words — lifted verbatim from YOUR outbound placements only.
  const wordCounts = new Map<string, number>();
  for (const c of mine) {
    for (const a of c.artifacts) {
      if (a.direction !== "out") continue;
      const words = a.body.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
      for (const w of words) {
        if (STOP.has(w)) continue;
        wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
      }
    }
  }
  const recurringWords = [...wordCounts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([word, n]) => ({ word, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  // Alive vs. quieting — by recency-decayed weight and last activity.
  const person = mine.filter((c) => !c.vault && c.artifacts.length);
  let mostAlive: PrismReading["mostAlive"] = null;
  let bestW = -1;
  for (const c of person) {
    const wgt = correspondenceWeight(c, now);
    if (wgt > bestW) {
      bestW = wgt;
      mostAlive = { id: c.id, name: c.with.name };
    }
  }
  let goingQuiet: PrismReading["goingQuiet"] = null;
  let oldest = -1;
  for (const c of person) {
    const last = lastActivity(c);
    if (!last) continue;
    const days = Math.floor((now - +new Date(last)) / DAY);
    if (days > oldest && days >= 14) {
      oldest = days;
      goingQuiet = { id: c.id, name: c.with.name, days };
    }
  }
  const quietingCount = person.filter((c) => {
    const last = lastActivity(c);
    return last && (now - +new Date(last)) / DAY >= 21;
  }).length;

  const unansweredIntroductions = mine.filter(
    (c) => !c.with.connected && c.artifacts.some((a) => a.pending),
  ).length;

  // Most recent artifact across this Self, shown whole.
  let mostRecent: PrismReading["mostRecent"] = null;
  let newest = -1;
  for (const c of mine) {
    for (const a of c.artifacts) {
      const t = +new Date(a.placedAt);
      if (t > newest) {
        newest = t;
        const mins = Math.floor((now - t) / 60000);
        const ago =
          mins < 60
            ? `${Math.max(1, mins)}m`
            : mins < 1440
              ? `${Math.floor(mins / 60)}h`
              : `${Math.floor(mins / 1440)}d`;
        mostRecent = {
          body: a.body,
          withName: c.vault ? "Vault" : c.with.name,
          ago,
        };
      }
    }
  }

  return {
    self,
    artifactCount,
    correspondenceCount: mine.filter((c) => !c.vault).length,
    quietingCount,
    unansweredIntroductions,
    recurringPeople,
    recurringWords,
    mostAlive,
    goingQuiet,
    mostRecent,
  };
}
