---
name: bmf-ui
description: >-
  Build or refine bucketmyfire's GAME UI/UX — the 2D DOM layer that floats over the 3D canvas.
  Use whenever the task touches how a game screen LOOKS, READS, or is LAID OUT, or adds/edits a HUD
  widget, menu, overlay, button, card, modal, field, tab, or touch control. That covers the
  in-flight HUD (instrument strip, flight tapes, radar, gauges, joystick/DROP cluster) AND every
  full-screen surface (title, home hub, mission/campaign select, pre-flight briefing, mission-end /
  debrief / score card, leaderboard, shop/hangar, onboarding + coach, cloud-save, settings, modals).
  Reach for it on "the HUD", "the menu/home/title screen", "the briefing/debrief", "the leaderboard",
  "game UI", "UX", "lay out the gauges", "add a screen/overlay/panel/button", "make the UI look
  better / less like a web app / more cockpit", "it scrolls / doesn't fit on a phone", "the colours
  are inconsistent", or "add a design token". This is the GLASS-COCKPIT design system: ONE token
  source (`ui/theme.ts`), ONE prose spec (`DESIGN.md`), ONE component kit (`ui/components/`), and two
  colour registers (warm "fight" brand surfaces vs cool "instrument" cockpit). It enforces the
  single-source-of-truth + mobile single-viewport (no-scroll) laws and routes you to the right file
  + the `verify:ui` gate. NOT the 3D world look or gameplay feel (`config.ts` → bmf-tune), NOT
  meshes/VFX/shaders (bmf-asset), NOT mission scenarios (bmf-mission) or maps (bmf-map).
---

# Building bucketmyfire's game UI

You are a game-UI/UX engineer working in a real codebase, not a web designer starting fresh. The
2D **DOM-over-canvas** layer already speaks one visual language — a **glass cockpit** — and it has a
governed single source of truth. Your job is to extend it *with the grain*, never to invent a
parallel one. A clean-looking screen that ignores the system is wrong; a slightly plain screen that
uses it is right and can be made beautiful inside the system.

**Scope boundary (this is the disambiguation from the sibling skills):** this skill owns the **2D DOM
UI** only — HUD, touch controls, menus, overlays, screens. The **3D world** (terrain, water, fire,
smoke, sky, post-fx) and **gameplay feel** are `config.ts` → **bmf-tune**; meshes/VFX/shaders are
**bmf-asset**. If you're editing a `.ts` under `src/three/ui/` or `src/three/hud/`, or `DESIGN.md`,
you're here. If you're editing `config.ts` or a GLSL shader, you're not.

## 1. The single source of truth — read this before touching anything

There is exactly one home for each kind of UI knowledge. **Read from it; never fork it.** This is
the cardinal law of the whole UI layer, and the `verify:ui` gate gives it teeth.

| Knowledge | The one source | Rule |
| --- | --- | --- |
| Colour / surface / blur / shadow / type / radius **tokens** | [`src/three/ui/theme.ts`](../../../src/three/ui/theme.ts) — the `UI`, `HOME`, `BOARD`, `GRADE`, `FS`, `FW`, `R` objects | Read a token. If a value isn't there, **add it there first**, then use it. Never hard-code a `#hex`/`rgba()`/`blur()`/`px` in a module. |
| The **prose** system — roles, state semantics, the two registers, motion, anti-patterns | [`DESIGN.md`](../../../DESIGN.md) (repo root) | The human spec. Read it before any visual change. `theme.ts` is its machine-readable half. |
| Reusable **components** (button, card, modal, field, badge, stat, list row, progress, tabs, headers) | [`src/three/ui/components/`](../../../src/three/ui/components/) (+ spec `docs/specs/ui-component-system.md`) | Compose these. Don't hand-roll a rival button/card. |
| **Placement / responsive / safe-area** | [`src/three/ui/layout.ts`](../../../src/three/ui/layout.ts) + `anchor()` in `theme.ts` | Mount via `anchor(place)`; read breakpoints from `layout.ts`. Don't absolutely-position by hand. |

> **This skill does not re-print the token tables on purpose** — that would create a fifth copy to
> drift. `DESIGN.md` + `theme.ts` are the tables. This file routes and enforces.

**The two non-negotiables, stated plainly:**

1. **No second `UI` object, no hard-coded literal.** There was one palette of record and three
   drifted copies (different text alpha, blur, three "greens"); they were merged into `theme.ts`.
   `verify:ui` fails the build if a second `export const UI = {` appears, or if the count of raw
   colour/blur literals in `ui/**` rises above the baseline. Add a token; don't paste a value.
2. **The page never scrolls (mobile single-viewport).** The game is a fixed-viewport app, not a web
   page. The app surface is locked to `100dvh`/`100svh` with `overflow:hidden` (see
   `home/styles.ts`). Every screen must **fit above** the bottom rail + HUD on a phone. Design menus
   to **fit, not flow** — compress, carousel, paginate. A bounded *inner* scroll is allowed only for
   a genuinely long list (mission select, leaderboard), never for a hub screen (home, title,
   briefing, debrief, settings). "User has to scroll to reach an action" is a bug.

## 2. Two registers — the fight, and the instrument

The brand keystone (**"Fight the fire."**) splits the UI in two. Holding both is the job; the
hot→cool handoff is intentional, not drift.

- **The fight (warm / ember-gold)** — title, home hub, briefing, mission-end + share/score card,
  shop, menu hero moments. The eye should go to the **fire**. Accent family: `UI.menu` / `UI.ember`.
- **The instrument (cool / cyan)** — the in-flight HUD: instrument strip, tapes, radar, gauges.
  Calm and legible over a burning world. The eye should go to **cyan**, and cyan marks *only* what's
  interactive or live. Accent: `UI.accent`.

You rarely pick these by hand: kit components take a `register: 'cockpit' | 'fight'` and `tone()`
([`components/base.ts`](../../../src/three/ui/components/base.ts)) hands back the right accent family,
so the law can't drift per screen. New surface? Ask DESIGN.md's question: is the player being
**briefed / rewarded / sold** (warm) or **flying** (cool)?

## 3. Build with the grain

**Reach for the layers in this order — only drop down a level when the one above genuinely can't fit:**

1. **A kit component** ([`ui/components/`](../../../src/three/ui/components/)) — `makeButton`,
   `makeIconButton`, `makeCard`, `openModal`, `makeField`, `makeBadge`/`makeGradeChip`/`makeStars`,
   `makeStat`, `makeListRow`, `makeProgress`, `makeTabs`, and the `sectionHeading`/`selectHeading`/
   `stepHeading` headers. Screens **compose components**, not raw `div`s. This is the layer that
   killed the "5 rival buttons" problem — keep it that way.
2. **A theme helper** ([`theme.ts`](../../../src/three/ui/theme.ts)) when there's no component for
   it: `el`/`div` (inline-styled element), `frosted()` (the glass panel), `scrim()` (modal
   backdrop), `button()` (round touch button), `anchor(place)` (safe-area placement), `setBlur()`,
   `makeCanvas()` (DPR-crisp 2D canvas for tapes/radar), `prefersReducedMotion()`.
3. **Raw `div` + tokens** only for a true one-off — and still every value is a `UI`/`FS`/`FW`/`R`
   token, never a literal.

If you find yourself writing a fourth way to make a button, or a `const` of hex values, stop — the
thing you want already exists one layer up.

## 4. "I want to touch X" → where it lives

| Surface / task | File(s) |
| --- | --- |
| In-flight **HUD** (instrument strip, tapes, status hint, comms, gauges) | [`src/three/HUD.ts`](../../../src/three/HUD.ts) (facade) + `src/three/hud/` (`Radar.ts`, `EndScreen.ts`, `engineStart.ts`) |
| **Touch controls** (joystick, ▲/▼, DROP, eye, help) | `src/three/Input.ts` (uses `theme.button()` / `anchor()`) |
| **Title** screen | `src/three/ui/title/` |
| **Home hub** + rail + the **mission/campaign & map pickers** | `src/three/ui/home/` (`HomeScreen.ts`, `menus.ts`, `rail.ts`, `NewPilot.ts`, **`styles.ts`** = the hub's injected CSS) — note: there is **no** `MissionSelect.ts`; that picker is in `home/menus.ts` |
| **Leaderboard** | `src/three/ui/Leaderboard.ts` (+ `BOARD` tokens in `theme.ts`) |
| **Shop / hangar** | `src/three/ui/ShopScreen.ts` |
| **Onboarding / coach** (first-flight tutorial) | `src/three/ui/Onboarding.ts`, `src/three/ui/coach/` (`CoachDirector` is pure logic, `CoachOverlay` is the view) |
| **Help**, **cloud-save**, **callsign/profile**, loading, share card | `HelpModal.ts`, `CloudSave.ts`, `callsign.ts` + `profile.ts`, `LoadingOverlay.ts`, `shareCard.ts` |
| Add a **token** (colour/surface/type/radius) | `theme.ts` — the `UI`/`FS`/`FW`/`R` objects (then reference it everywhere) |
| Change a **rule / role / anti-pattern** | `DESIGN.md` (and log the decision in its Decisions table) |
| Responsive **breakpoints / pod sizes / safe-area** | `layout.ts` |

How it runs: `main.ts` is the screen router (`?kit` gallery, `?m=<id>`, `?daily`, `?editor`, …);
`Game.ts` owns the `HUD` and feeds it a state snapshot each frame (the HUD reads numbers and poses
DOM — it doesn't compute gameplay). Most menu→mission transitions are a page reload, a few rebuild
`Game` in place — match the surrounding screen's pattern.

## 5. Game UI/UX craft for this cockpit

The portable principles, applied to a phone-first game that must stay legible over a moving,
burning world:

- **State before chrome.** The number / gauge / LED *is* the content. Labels are small; values are
  bold. Don't box information in card-chrome it doesn't need — instruments, not widgets.
- **Ration the accent.** If everything is cyan, nothing is. Cyan = interactive or live, full stop
  (in the cockpit). On a brand surface, ration the *fire* the same way.
- **Glanceable under motion.** A player reads the HUD in fractions of a second while flying.
  Hierarchy, contrast, and position do the work; surfaces are translucent + blurred so terrain
  shows through, but **never enough to lose a digit**. Test legibility against bright terrain *and*
  dark smoke.
- **Thumb-reach & touch targets.** Primary actions sit where thumbs are (bottom corners); touch
  buttons are round, ≥ the kit's min target, and `anchor()`-placed so they clear notches. Don't put
  a must-hit control top-center.
- **One layer of glass per surface.** A frosted capsule blurs *once*; its children are transparent.
  `backdrop-filter` is expensive on mobile — never stack blur layers.
- **Occlude, don't bleed.** A full-screen overlay opened over the menu must fully occlude it
  (near-opaque fill + `setBlur(root)` / `scrim()`), or the busy grid shows through and reads broken.
- **Motion is informational.** Quick, purposeful, nothing looping for decoration. Gate non-essential
  entrance animation on `prefersReducedMotion()`. Per-frame work stays O(1) (this is a 60fps game).
- **Feedback / juice, in budget.** A press, a douse, a mission win should *feel* — but with tokens
  (`glow`/`emberGlow`) and short transitions, not neon and not new per-frame cost.
- **Don't bleed vehicle-identity colour into functional UI.** A data bar / button / status is
  `accent`, not the aircraft's livery red/clay (that lives only on the icon halo + tagline).

When the task is a *taste* call ("is this on-brand / does it look slop / which of these reads
better") rather than a build, that's the **creative-director** skill's job — bring it in to judge,
then build the verdict here.

## 6. Verify a UI change

There's no test runner; the UI is verified by a type gate, a token-drift gate, and your eyes.

1. **`npm run build`** — the `tsc --noEmit` type gate (also fails on unused imports). Necessary,
   not sufficient: it happily ships an ugly or scrolling screen.
2. **`npm run verify:ui`** — the design-system gate (`scripts/verify-ui.mjs`, plain Node, instant).
   It checks two things: **(a)** exactly one `export const UI` token object exists, and **(b)** the
   count of raw colour/blur literals per file in `ui/**` has not risen above
   `scripts/ui-baseline.json`. If you legitimately added art literals (an allowlisted file), re-baseline
   with `npm run verify:ui -- --update` **and say so in your summary** — don't silently ratchet it up.
3. **Look at it.** The system can't see layout, hierarchy, or scroll.
   - **`?kit`** — `main.ts` mounts the live component gallery (`ui/components/gallery.ts`) at the
     `?kit` URL: every component × state on one page. Check new/changed kit pieces here.
   - **`mockups/`** — static HTML previews of the screens that read `mockups/kit.css`. Useful as a
     design reference, but **they are a hand-maintained parallel copy, not generated from `theme.ts`** —
     trust the live TS UI over a mockup if they disagree, and don't treat editing a mockup as
     shipping a change.
   - **Live headless / a real phone** — boot the screen (`?m=<id>&qa`, `?daily`, bare URL for
     title→home) and confirm it **fits one viewport with no page scroll**, occludes cleanly, and
     reads against bright terrain. The 60fps + thumb-reach targets are real-device facts; note when
     a human should phone-test. See **bmf-verify** for the headless harness.

Then run the full `npm run verify` before handing off, so a UI change didn't break a sibling gate.
