---
spec: ui-component-system
status: filed
created: 2026-06-05
intent: redesign-to-vision (component kit + visual/UX uplift, glass-cockpit language)
shape: epic + 4 phased children
surfaces: HUD, menu wizard + pickers, overlays, title + onboarding
---

# UI component system — close the gap between the engine and the interface

## Context

The 3D engine, world generation, and editor tooling are world-class; the DOM UI is not.
The player sees "random buttons, missing info, bad layout, bad UX" — a web-app feel where the
game demands a cockpit. This is not a tokens problem and not a "missing design system" problem.
Both already exist and are good:

- [`src/three/ui/theme.ts`](../../src/three/ui/theme.ts) — a real **tokens** layer: `UI` (colours/
  surfaces/effects), `FS`/`FW`/`R` (type/weight/radius scales), `GRADE`, plus DOM helpers
  (`el`/`div`/`frosted`/`button`/`scrim`/`anchor`/`makeCanvas`).
- [`DESIGN.md`](../../DESIGN.md) — the prose system: glass-cockpit aesthetic, **two registers**
  (cockpit = cyan/instrument, fight = gold/ember/brand), colour roles, type scale, motion,
  anti-patterns.
- [`src/three/ui/layout.ts`](../../src/three/ui/layout.ts) — a genuinely good responsive
  controller (breakpoints, safe-area CSS vars, `anchor()` placement). **Do not rebuild this.**

The gap is the **component layer** that should sit between tokens and screens — and doesn't.

## Verified current state (2026-06-05)

There is no shared `Button`, `Card`, `Modal`, `Field`, `ListRow`, `Stat`, `Tabs`, or `Badge`.
Instead, interactivity is reinvented per screen:

**Rival button implementations (none compose):**

| Impl | File | Shape |
|---|---|---|
| `button()` | `ui/theme.ts` | round frosted touch button (HUD stick / DROP / eye / help) |
| `primaryButton()` | `ui/flow/chrome.ts` | gold-gradient advance button, returns a control handle |
| `ghostButton()` | `ui/flow/chrome.ts` | text button |
| `featureButton()` | `ui/flow/chrome.ts` | bordered tinted pill |
| `utilityChip()` | `ui/menuShared.ts` | icon+label pill chip |

**Ad-hoc interactive elements (raw `div` + inline style + listener):**

- **37** `cursor:pointer` declarations across **13** files
- **17** raw `addEventListener('click', …)` across **6** files
  (HUD, ConfigPanel, Card3D, HeliCard3D, HelpModal, chrome, TitleScreen, ShopScreen,
  Leaderboard, CloudSave, ScreenIdentity, MapCard3D, EditorUI).

**No shared overlay/modal:** every full-screen overlay re-implements scrim + card + open/close +
pointer-capture independently — `openLeaderboard()`, `openShop()`, `openCloudSave()`,
`HelpModal`. There is a `scrim()` helper but no `Modal` that owns titlebar, close affordance,
ESC, focus-trap, and unmount.

**No shared field:** `ScreenIdentity` hand-rolls `field()` + `flowLabel()` + an inline
validation message node; any future form repeats it.

Consequence (maps 1:1 to the complaint):
- *random buttons* → 5 rival impls + 37 ad-hoc clickables, each with its own hover/active/
  disabled/touch-target behaviour (or none).
- *missing info / bad layout* → no component contract enforcing header/meta/empty/loading states;
  drift accumulates per screen.
- *bad UX* → inconsistent focus rings, no keyboard semantics on `div` buttons, inconsistent hit
  areas on touch, no disabled affordance, ad-hoc modal close behaviour.

What is GOOD and must NOT be rebuilt: the token set (`theme.ts`), the responsive `layout.ts`
+ `anchor()` system, the screen-builder pattern (`buildXScreen(ctx): HTMLElement`), the
two-register brand law (`DESIGN.md`).

## Proposed change

Build a real component kit in `src/three/ui/components/`, each component a token-driven factory
(no second token set), then rebuild all four surfaces out of it and fix layout/UX/info gaps
on the way. Stay inside the glass-cockpit + two-register language — this is execution uplift,
not a new aesthetic.

### Component contract (every kit component obeys)

- Reads **only** `theme.ts` tokens (`UI`/`FS`/`FW`/`R`/`GRADE`). Never hard-codes a colour/blur/
  shadow/size. (Enforces DESIGN.md anti-patterns mechanically.)
- A **`register`** prop where it matters: `'cockpit'` (cyan) | `'fight'` (gold/ember). Default
  cockpit. This bakes the two-register law into the type system.
- Real semantics: interactive elements are `<button>`/`<input>` (keyboard + focus for free),
  with `:focus-visible` rings, `disabled` affordance, and **≥44px touch targets** on touch sizes.
- Reduced-motion aware (gate entrance/hover transitions on `prefersReducedMotion()`).
- O(1) construction, zero binary assets, no backdrop-blur stacking (DESIGN.md: one glass layer
  per surface).
- Stateful components return a small handle (`{ el, setX… }`) mirroring the existing
  `primaryButton()`/`stepDots()` pattern.

## Phases

### #1 — Build the kit (foundation; additive, no screen edits)

New `src/three/ui/components/`:

| Component | Folds in | Notes |
|---|---|---|
| `Button` | primaryButton, ghostButton, featureButton, utilityChip | variant `primary\|secondary\|ghost\|pill\|danger` × register × size `sm\|md\|lg`; icon; loading; handle |
| `IconButton` | `theme.button()` | round touch button; warm variant for DROP |
| `Card` | menuShared/ShopScreen cards | surface `glass\|soft`; optional header (title/meta/trailing); `selectable`; hover-lift; register |
| `Modal` | openLeaderboard/openShop/openCloudSave/HelpModal scrim plumbing | scrim + titlebar + close X + ESC + focus-trap + click-scrim-close (opt) + unmount; returns `{ el, close, onClose }` |
| `Field` | ScreenIdentity field()/flowLabel()/msg | label, icon/pin, hint, error, validation (ok/warn), focus ring |
| `ListRow` | leaderboard rows | leading/primary/secondary/trailing; `mine` highlight; hairline divider |
| `Stat` | statTile, pilotRecord stats | label-over-value + value-over-label; optional track bar |
| `Tabs` | leaderboard career/mission tabs | pill segmented control; `onChange` |
| `Badge`/`Pill` | SOON/NEXT/LOCKED, grade chip, starPips | status pill + grade chip (uses `GRADE`) |
| `ProgressBar` | campaign %, fill tracks | labelled fill bar |
| `headers` | screenHeading, selectHeading, stepHeader | one headers module |
| `index.ts` | — | barrel export |

Plus a **`?kit` gallery route** (`main.ts` router) that renders every component × every state on
one page — the visual-QA surface this repo lacks (no test runner). Verifiable with the existing
headless harness.

**#1 acceptance:** kit compiles (`npm run build`); `?kit` renders all components/states with 0
console errors (headless); no screen behaviour changed yet; DESIGN.md gains a "Components" section.

### #2 — Migrate HUD / cockpit
HUD.ts + Input touch controls onto `IconButton`/`Badge`/`Stat`. Preserve the byte-identical
instrument feel DESIGN.md mandates (the documented `#46d17a` hull-green exception stays). Delete
`theme.button()` once HUD/Input are off it.

### #3 — Migrate menu wizard + pickers
`ui/flow/*`, the card carousels, `menuShared` onto `Button`/`Card`/`Field`/`headers`. Retire
`primaryButton`/`ghostButton`/`featureButton` and the `menuShared` fragments they duplicate.
Fix the layout/info gaps on these screens.

### #4 — Migrate overlays + title/onboarding
Leaderboard/ShopScreen/CloudSave/HelpModal/debrief onto `Modal`/`ListRow`/`Tabs`/`Stat`;
TitleScreen/Onboarding/hints onto `Button`. Fix the dead Squadron-Store CTA and the
"missing info" gaps. Delete the per-overlay scrim plumbing.

## Acceptance criteria (epic — pass/fail)

1. Every interactive UI element is a kit component: **0** ad-hoc `cursor:pointer` +
   `addEventListener('click')` interactive `div`s remain in `src/three/ui/**` and `HUD.ts`
   (grep proves it).
2. The 5 rival button impls are deleted (`primaryButton`/`ghostButton`/`featureButton`/
   `utilityChip`/`theme.button`); all call sites use `Button`/`IconButton`.
3. `?kit` gallery renders every component × state, 0 console errors (headless).
4. `npm run build` green; `npm run verify:campaign` unchanged-green.
5. DESIGN.md updated with the component layer (the layer between tokens and screens), and its
   anti-patterns reference the kit.
6. No visual regression vs intent on any of the 4 surfaces (creative-director / design-review pass).

## Out of scope

- The 3D world rendering (terrain/water/fire/smoke/sky/post-fx) — that's `config.ts` / `bmf-tune`,
  a different system.
- `layout.ts` / `anchor()` rearchitecture — it's good; the kit consumes it.
- A new aesthetic / rebrand — glass-cockpit + two registers stay.
- The 3D card meshes' internal geometry (`Card3D`/`HeliCard3D`/`MapCard3D` Three objects) — only
  their DOM chrome migrates.

## Effort

~30–60 min CC per child (human: ~1–3 days each). Phase 1 first (everything depends on it); #2/#3/#4
are independent after it and can land in any order.

## Files reference (Phase 1)

| File | Change |
|---|---|
| `src/three/ui/components/*.ts` | NEW — the kit |
| `src/three/ui/components/index.ts` | NEW — barrel |
| `src/three/main.ts` | `?kit` gallery route (additive) |
| `DESIGN.md` | NEW "Components" section |

## Rollback

Phase 1 is purely additive (new dir + one route) — revert the dir + route. Each migration child
is its own commit/PR — revert independently; the deleted rival impl returns with the revert.
