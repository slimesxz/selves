import type { Self, Correspondence } from "../types";

const daysAgo = (n: number, h = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(d.getHours() - h);
  return d.toISOString();
};

export const SELVES: Self[] = [
  {
    id: "self-caelum",
    name: "Caelum",
    handle: "caelum.vanguard",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200",
    accent: "#9b87f5",
    label: "work. the version that ships.",
  },
  {
    id: "self-velvet",
    name: "Velvet",
    handle: "velvet.aesthete",
    avatar:
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200",
    accent: "#34d399",
    label: "the eye. material things, for people who'd get it.",
  },
  {
    id: "self-spectre",
    name: "Spectre",
    handle: "spectre",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200",
    accent: "#fb7185",
    label: "3am. no one from the office.",
  },
];

/**
 * Correspondences are the enduring relationships. Each belongs to one Self.
 * Artifacts live inside them, in both directions — the returned half is what
 * makes this not a message-in-a-bottle. Each Self has a Vault: a correspondence
 * with itself.
 */
export const CORRESPONDENCES: Correspondence[] = [
  // ── Caelum ──────────────────────────────────────────────
  {
    id: "co-cael-liv",
    selfId: "self-caelum",
    with: { id: "liv", name: "Liv", kind: "person", connected: true },
    vault: false,
    artifacts: [
      { id: "cl1", direction: "out", body: "The revised architecture holds. Shipping the spine first; everything else is consequence.", placedAt: daysAgo(1, 3) },
      { id: "cl2", direction: "in", body: "Got it. The 4.2 change is the right call — I'd have fought you on it a month ago.", placedAt: daysAgo(1, 1) },
      { id: "cl3", direction: "out", body: "Then we're aligned. Distribution begins tomorrow.", placedAt: daysAgo(1, 0) },
    ],
  },
  {
    id: "co-cael-thomas",
    selfId: "self-caelum",
    with: { id: "thomas", name: "Thomas", kind: "person", connected: true },
    vault: false,
    artifacts: [
      { id: "ct1", direction: "out", body: "Reduction over addition. Forty-five became thirteen. That's the work.", placedAt: daysAgo(4) },
      { id: "ct2", direction: "in", body: "The tally speaks for itself. Sending notes.", placedAt: daysAgo(3, 20) },
    ],
  },
  {
    id: "co-cael-mara",
    selfId: "self-caelum",
    with: { id: "mara", name: "Mara", kind: "person", connected: true },
    vault: false,
    artifacts: [
      { id: "cm1", direction: "out", body: "Decision: we don't build the thing we can't yet test. Holding.", placedAt: daysAgo(6) },
    ],
  },
  {
    id: "co-cael-daniel",
    selfId: "self-caelum",
    with: { id: "daniel", name: "Daniel", kind: "person", connected: false },
    vault: false,
    artifacts: [
      { id: "cd1", direction: "out", body: "You don't know this version of me yet. Here's the door.", placedAt: daysAgo(0, 2), pending: true },
    ],
  },
  {
    id: "co-cael-self",
    selfId: "self-caelum",
    with: { id: "self", name: "Caelum", kind: "self", connected: true },
    vault: true,
    artifacts: [
      { id: "cs1", direction: "out", body: "One principle worth keeping at the top: the software is always one step behind the human.", placedAt: daysAgo(9) },
      { id: "cs2", direction: "out", body: "Early note on bounded disclosure. Keeping this one.", placedAt: daysAgo(34) },
    ],
  },

  // ── Velvet ──────────────────────────────────────────────
  {
    id: "co-velv-kora",
    selfId: "self-velvet",
    with: { id: "kora", name: "Kora", kind: "person", connected: true },
    vault: false,
    artifacts: [
      { id: "vk1", direction: "out", body: "The grain in this scan didn't survive the export. Sending the raw.", placedAt: daysAgo(2) },
      { id: "vk2", direction: "in", body: "The raw is better. It has the mistake in it.", placedAt: daysAgo(1, 18) },
    ],
  },
  {
    id: "co-velv-ren",
    selfId: "self-velvet",
    with: { id: "ren", name: "Ren", kind: "person", connected: true },
    vault: false,
    artifacts: [
      { id: "vr1", direction: "out", body: "Material study. Concrete that remembers water. You'd get it.", placedAt: daysAgo(6) },
    ],
  },
  {
    id: "co-velv-self",
    selfId: "self-velvet",
    with: { id: "self", name: "Velvet", kind: "self", connected: true },
    vault: true,
    artifacts: [
      { id: "vs1", direction: "out", body: "Kept: the only frame from that roll that was honest.", placedAt: daysAgo(28) },
    ],
  },

  // ── Spectre ─────────────────────────────────────────────
  {
    id: "co-spec-jonah",
    selfId: "self-spectre",
    with: { id: "jonah", name: "Jonah", kind: "person", connected: true },
    vault: false,
    artifacts: [
      { id: "sj1", direction: "out", body: "can't sleep. the city sounds different when no one's performing for it.", placedAt: daysAgo(3) },
      { id: "sj2", direction: "in", body: "i'm up too. it always does.", placedAt: daysAgo(3, -2) },
    ],
  },
  {
    id: "co-spec-self",
    selfId: "self-spectre",
    with: { id: "self", name: "Spectre", kind: "self", connected: true },
    vault: true,
    artifacts: [
      { id: "ss1", direction: "out", body: "3am thought I won't have in daylight. here, only here.", placedAt: daysAgo(19) },
    ],
  },
];
