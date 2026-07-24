# AGENTS.md — Selves Constitutional Charter

This file governs every agent task in this repository. It is law, not guidance.
It is amended only by explicit ruling from Liberty, recorded by commit. Agents
do not amend it, reinterpret it, or treat any part of it as negotiable.

---

## 1. ROLE

You are a **constitutional enforcer and feature gate**, not a free-range
designer. Your mandate is to perfect the product, never to redesign it.

- Proposals that conflict with the Locked Constitution are **killed at
  Ontology Review**. They receive no styling discussion, no partial credit,
  no "softer version."
- Weak ideas are not preserved because they already exist. Brutal honesty
  is expected.
- If you are unsure whether something was ratified, treat it as **OPEN**.
  Never present inference as decision.

## 2. GENERATOR PRINCIPLE

> **The software is always one step behind the human.**

All other principles derive from this. The software computes identity
legibility; it never directs it. When any question is unresolved by the
rules below, apply this principle. A mechanic that pulls, nudges, steers,
solicits, or acts on the user's behalf is ahead of the human and therefore
unconstitutional.

## 3. LOCKED CONSTITUTION — never relitigate

1. **Maximum 3 Selves per user.**
2. **No engagement metrics. No algorithmic feed. Ever, under any name.**
3. **Private-by-default graph.**
4. **Instant switching.** No transition between contexts may require a page
   load or perceptible wait.
5. **Desktop-first.** (Sequencing rule, not a permanent boundary — see §8.)
6. **Invite-only growth: 3 invites per Self.**
7. **Every transmission is addressed to visible people, never to an
   abstraction.** Recipients are ground truth.
8. **Rings are derived audience annotations.** Computed from placement
   history. Never stored, never user-chosen. A ring is a compression
   algorithm for reaching names faster and always expands to visible
   humans before Send.
9. **Payload type is a closed enum:** text, photo, poll, gift, key.
10. **The Vault is an intentional-access backstage.** Never monetized
    intimacy. Access is granted by Key only.
11. **Aesthetic law:** never manipulate attention; constantly reward
    intention.

## 4. ONTOLOGY — frozen vocabulary

Do not invent vocabulary. Do not extend these definitions.

- **Self** — who is speaking.
- **Signal** — what moves (the act).
- **Artifact** — what remains (the settled record).
- **Placement** — who receives it (ground truth). **Placement is the atomic
  action.** There is no "posting."
- **Graph** — accumulated placement history. The Graph is a mirror of
  self-knowledge, not a social topology map.

**Lifecycle:** Self → Signal → Introduction (recipient-side, optional) →
Connection → Repeated placements → Observed pattern → Topology → Memory.

**Composer spine (letter register):** From / write / To / Send. The
composer itself is the confirmation surface — From, To, Ring, and payload
are visible before Send. No confirmation modals. No separate review view.

**Product loop:** Mirror/Prism → Continue → Place → Return → Become.

### The Prism — protected object

The Prism is the constitutionally ratified entry point: a Self opens to a
reflection of what it is becoming (artifact counts, quieting/alive
correspondences, recurring recipients and words). Single action:
**Continue [Self]**.

> The Prism may reveal possible significance but may **never** convert
> significance into direction.

**Protection clause:** The Prism may not be redefined, renamed, or absorbed
into another object. Proposals that do so are killed at Ontology Review.
(Two absorption attempts are already on record. There will not be a third
that survives.)

## 5. SETTLEMENT LAW — ratified 2026-07-14

Irreversibility belongs to **settlement**, not to the button press.

**Placement state machine:** `Draft → Departing → Settled`

- **Draft** — editable.
- **Departing** — Send pressed; an inline **Cancel** remains available for
  the departure interval. This window exists to catch motor errors (wrong
  recipient, wrong Self, accidental click), not to soften social
  consequences. The interval is a **descriptive, account-level setting**
  (not a per-transmission or per-Self policy): the user configures it, the
  **server is authoritative** over its value, and it is bounded to the
  closed list **{5, 10, 30, 60} seconds, default 30**. Its value is
  **snapshotted onto the Placement at the moment of departure**; a later
  change to the account setting never alters an in-progress departure.
  Settlement is **client-initiated** and permitted only once the snapshotted
  interval has elapsed (server-enforced floor); there is no automatic
  settlement, and a Placement left in Departing simply remains cancellable.
- **Settled** — the recipient boundary has been crossed. The Placement
  cannot be recalled.

**Per-payload finality after settlement:**

- **Text, photo** — cannot be withdrawn.
- **Poll** — cannot be rewritten; may later be **closed** (prospective act;
  close-mechanics bundled into the open poll-visibility ruling).
- **Gift** — cannot be reclaimed once accepted/settled per its eventual
  transfer rules.
- **Key** — remains revocable, because a Key is an ongoing **capability**,
  not settled content. Revocation ends future access; it cannot undo access
  already exercised. A Key is issued **as a Placement** (see Key transmission
  below), never as an Artifact.

> **Governing law:** A Placement may be stopped before it arrives. Once
> received, its history belongs to every party it reached. Capabilities may
> be revoked prospectively; disclosure cannot be erased retroactively.

**Key transmission — ratified 2026-07-24 (P7-A).** A Key is a capability
payload carried by an ordinary Placement through the ordinary
`Draft → Departing → Settled` lifecycle; it is never an Artifact and never
content. Settlement of the Placement establishes the authoritative capability
grant binding the granting Self, the grantee Self, and the exact protected
Artifact.

> **Settlement of the transmission is irreversible; revocation of the
> capability is prospective.**

- **Cancellation of a Key Placement before settlement means the capability
  never existed; it is not revocation.** No grant is written.
- **A Key Placement never contributes to recipient-ground artifact access;
  the sole revocable read path is the capability register.** A settled Key
  Placement produces exactly one authorization effect — the active capability
  grant — and revocation of that capability cannot be defeated by the
  Placement that transmitted it.
- A Key Placement addresses **exactly one** recipient (the grantee); the
  sender may not be its own Key recipient. This is a Key-payload narrowing of
  the general recipient law (§3.7), not a repeal of it.

## 6. CONSTITUTIONAL TESTS — apply during review

1. **Transactions are not places.** Navigation contains only persistent
   places. Introductions, key grants, self-creation, send-review are
   transactions that happen *inside* places, never top-level destinations.
2. **The disappearance test.** If a proposed object vanished tomorrow and
   the ontology would not break, it is not load-bearing and is not
   constitutional. It may be an affordance; it is never law.
3. **Descriptive properties, not behavioral policies.** Persistent objects
   may have descriptive properties (name, icon, color, descriptor). They
   may not quietly accumulate standing policies that act on the user's
   behalf. Disclosure in Selves is always an **act**, never a **setting**.
   No delegated action exists without explicit constitutional
   authorization.
4. **Presence is dead in all costumes.** No surface may visually
   distinguish relationships by recency or activity level in a way that
   solicits re-engagement. This mechanic has been killed as "Presence,"
   as "dark regions," and as "time as weather." Kill it again regardless
   of the name it arrives under.
5. **No attention telemetry.** Consumption behavior (revisits, views,
   hovers, dwell) may never shape geometry, ordering, weight, or
   visibility. Placement history may; attention history may not.

## 7. VIEW INVENTORY — prototype scope

The prototype is a **single client-side-routed application**. Five routes
plus a first-run flow. Nothing else ships in the prototype.

1. **Prism** — entry point. Port `selves-v1.1-prism.html` **unmodified**.
2. **Composer** — the letter register, containing the Departing/Cancel
   state inline.
3. **Correspondences** — where placements addressed to you are received
   and continued. Absorbs artifact detail and introduction moments.
   Includes "place something here": composing from inside a correspondence
   opens the Composer with the To line pre-filled (recipient-first
   composition — gated and approved as consistent with the letter
   register).
4. **Graph** — private topology of the active Self. Absorbs connection
   inspection and introduction state.
5. **Vault** — intentionally granted private artifacts. Absorbs key
   management.

**Onboarding (first-run flow, not a route):** create the first Self, learn
the laws by performing them once — a real first placement to a real
recipient, vocabulary named as it is touched — ending at the Prism showing
its first reflection. Teach the laws, not the buttons. If a button needs a
tooltip, the button failed review.

**Persistent chrome:** the Self switcher (instant, redraws the app) is a
control, not a route.

**Post-prototype, not in scope:** authentication, settings, search,
placement history.

## 8. ARCHITECTURE & DELIVERABLES

- **Source of truth is this repository.** No iteration is real until
  committed. Work stranded in chat sessions or external playgrounds does
  not exist.
- **Structure:** Vite/React source tree with client-side routing. The
  single-file HTML era is over; single-file builds are for throwaway
  spikes only. Canonical prior build for reference: `selves-v2.html`.
- **Logic layer independence:** placement rules, ring derivation, key
  grants, and the settlement state machine live in pure TypeScript modules
  with zero UI imports. Mobile is a future target; desktop remains first.
  The ontology must survive a re-skinning untouched.
- **Backend:** Firebase Firestore (project `selves-99`). The placement
  schema is defined *after* the relevant open rulings, not before.
- Prefer complete rewrites over accumulating partial diffs when a
  component becomes complicated.

## 9. AESTHETIC — joyful precision

Rigorous and alive simultaneously. **Obsidian** and **Linear** are the
canonical references. Never sterile; never manipulative. Every deliberate
action should feel good; every accidental action should feel impossible.

**Typography:** Inter (Google Fonts), three tiers —
- Headings/names: weight 600, tight tracking.
- Body/metadata: weight 400.
- Small tags/rings/status labels: weight 500, 0.75rem, uppercase, slight
  positive tracking.

## 10. REVIEW FRAMEWORK — strict order

Every feature proposal passes, in sequence:

**Identify → Ontology Review → Logic Review → User Behavior Review →
Network Effect Review → UI/UX Review → Improvement**

UI/UX is always last. No styling discussion occurs before ontology and
logic are resolved. A proposal killed at any step does not proceed to the
next.

## 11. OPEN QUESTIONS — quarantined

**OPEN means not implementable without a ruling.** Do not resolve these
unilaterally. Do not build partial versions. Do not treat a mention in any
chat, document, or prior prototype as ratification.

1. Replies modeled as placements addressed back to authors.
2. Derived-ring threshold methodology (current volume math is placeholder).
3. Timed key expiration enforcement.
4. Poll count visibility + poll closing mechanics.
5. "Presence" as a return-loop concept (see Test 4 — presumed dead;
   formally unresolved).
6. **Reveal Identity** — voluntarily revealing that multiple Selves share
   one person. The most dangerous action in the product; demoted from the
   view inventory pending full review. If ever ratified, expectation is
   transactional execution each time, never standing automation.
7. **Introduction as a standalone view.** The concept is ratified as a
   lifecycle moment; a dedicated destination is not (transactions are not
   places).
8. **Brokering** — a user initiating introductions between two of their
   contacts. Constitutionally live: introducing A to B discloses both
   relationships. Unruled.
9. **Tells** — user-authored identity anchors. Failed the disappearance
   test; may return as a lightweight descriptive affordance, not law.
10. **Reveal policy** — rejected as a standing setting under Test 3; any
    future form must be an act, not automation.

## 12. FILED PROPOSALS — post-prototype

`docs/atlas.md` and `docs/instrument.md` (spatial identity object,
computed topology). Status: **PROPOSED / POST-PROTOTYPE**. If gated, they
enter review as a **Graph view evolution**, never as a Prism replacement.
Already-killed components within them: "Drift" (topology with gravity that
steers attention — generator principle inverted), mass-from-attention
(Test 5), time-as-weather (Test 4), compose-in-empty-space (creates
artifacts before recipients exist — the ontology of posting). The one
extracted survivor — recipient-first composition from inside a
correspondence — is already ratified into the Correspondences view (§7).

---

*Ratified rulings of 2026-07-14: settlement law (§5); constitutional tests
1–3 (§6); view inventory collapse to five routes (§7); demotions and open
questions 6–10 (§11). Recorded by Claude as auditor, ruled by Liberty.*

*Ratified rulings of 2026-07-24 (P7-A, Key lifecycle): Key issuance is a
Placement carrying a capability payload (§5 Key transmission); settlement is
irreversible and revocation is prospective; a Key Placement never contributes
to recipient-ground artifact access; a Key Placement addresses exactly one
recipient and never the sender. Design recorded in
[docs/decisions/0007](docs/decisions/0007-key-lifecycle.md). Ruled by Liberty,
recorded by Claude as engineer.*
