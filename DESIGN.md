# Design System — Bucket My Fire

> The DOM UI layer (HUD, touch controls, menus, overlays) speaks one visual language: a
> **glass cockpit**. This file is the prose system. The machine-readable source of truth is
> [`src/three/ui/theme.ts`](src/three/ui/theme.ts) — every colour, surface, and effect lives in its
> `UI` token object (plus the `HOME`/`BOARD`/`GRADE` ramps and `FS`/`FW`/`R` scales).
> [`tokens.ts`](src/three/ui/tokens.ts) derives the CSS custom properties FROM those consts;
> `npm run gen:tokens` writes them to the committed, **do-not-hand-edit**
> [`mockups/tokens.css`](mockups/tokens.css) so the static mockups read the same tokens as the live
> UI, and `npm run verify:tokens` fails the build if it drifts. **Read a value from `theme.ts`;
> never hard-code a colour/blur/shadow, and never hand-mirror a token value, in a module or a
> mockup.** If a value isn't in `theme.ts`, add it there first (then `gen:tokens`).
>
> Scope note: this governs the **2D DOM UI only**. The 3D world (terrain, water, fire, smoke,
> sky, post-fx) is procedural GLSL/geometry tuned in [`src/three/config.ts`](src/three/config.ts)
> — that's a different system (`bmf-tune`), not this one.

---

## Brand Platform

> **Keystone: Fight the fire.**

The fire is the enemy — alive, spreading, winning unless you stop it. The brand is not
"firefighting," not "save the forest," not pilot heroics, not a cause lecture. There is a
fire, and you fight it. Every surface below serves that one idea.

- **The enemy has a face.** The fire is the antagonist everywhere: it spreads with wind, flanks
  you, reaches the cabins. Frame it as a living threat, never a static target to tidy up.
- **A fight you can lose.** That is the stake. No participation trophy, no softening.
- **Voice: dry, direct, calm.** The fire is loud enough; say it straight. No hype, no preach, no
  cosplay. (Same voice as the in-game dispatcher comms.)
- **The line.** Essence (the rallying command): **"Fight the fire."** That is the brand line —
  short, primal, declarative. **Retired:** the three-noun hook *"A bucket, a chopper, a wildfire"*
  — do not bring it back (rejected repeatedly by the owner). One line, "Fight the fire," everywhere.
- **Anti-slop, brand-wide.** No "simulator" as the lead noun, no "save the forest / before it
  spreads," no "battle raging wildfires," no console-grade / asserted-realism flexing. Plain,
  declarative, factual. Let the cabins carry the gravity.

### Two registers: the fight, and the instrument

The keystone splits the UI into two registers. Holding both is the job.

| Register | Where | Feel | Hero colour |
|---|---|---|---|
| **The fight** (warm) | title screen, ember logo, briefing, mission-end + share/score card, menu hero moments, OG/social, merch | warm, ember, alive, threatening | **fire / ember** |
| **The instrument** (cool) | the in-flight HUD — instrument strip, flight tapes, radar, gauges | calm, dark, legible over a burning world | **cyan accent** |

The hot→cool handoff is intentional, not drift: you leave the briefing and strap into the
aircraft. Brand surfaces run warm; the cockpit stays cool so a digit never gets lost in the fire.
New surface? Ask: is the player being **briefed / rewarded / sold** (warm), or **flying** (cool)?

---

## Product Context

- **What this is:** a mobile-browser helicopter wildfire game. You fly over northern
  Saskatchewan, scoop from the lakes, and fight a fire that's running at the cabins.
- **Who it's for:** a phone-first player who wants a real flight *feel* in a browser, plus a
  8-mission campaign and a global leaderboard.
- **Project type:** real-3D Three.js game with a DOM heads-up display and full-screen menus.
- **The one thing to remember:** *fight the fire* (see Brand Platform). The in-flight UI sells
  the cockpit — instruments, not chrome; the brand surfaces sell the fight. If an in-game screen
  feels like a web app instead of a cockpit, it's wrong even if it's "clean."

## Aesthetic Direction: Glass Cockpit

A modern EV-cluster / avionics look. Frosted-glass surfaces float over the live 3D world;
information reads as backlit instruments, not boxed cards. Dark, calm, legible over bright
terrain. One cyan accent does all the "alive / interactive" work; warm reds and oranges carry
fire and danger. Light type, hairline strokes, generous blur. This is the **cockpit register**;
brand surfaces (title, briefing, share card, merch) run **warm / fire-forward** — see Brand
Platform → Two registers.

**Principles**

1. **State before chrome.** The number/gauge/LED is the content. Labels are small; values are bold.
2. **Ration the accent.** Cyan marks only what is interactive, selected, or live. If everything
   is cyan, nothing is. (See the spec-meter fix: data bars are cyan; they are not vehicle identity.)
3. **Legible over a moving world.** Surfaces are translucent + blurred so terrain shows through,
   but never enough to lose a digit. Overlays that sit over other UI must fully occlude it.
4. **One layer of glass per surface.** A frosted capsule blurs once; its contents are transparent
   (the HUD instrument strip is a single backdrop-blur layer, not one per pod). Backdrop-filter is
   expensive on mobile.

## Color

All values below are the canonical tokens in `theme.ts → UI`. **Two registers (see Brand Platform):**
in the **cockpit**, the hue family is cool (cyan/blue) for interactive/live and warm (orange/red)
for fire/danger; on **brand surfaces** the warm **fire/ember** family is the HERO colour (the fight),
with cyan demoted to quiet support. Neutrals are pure white at low alpha over a near-black world.

### Accent (cyan) — interactive / live

| Token | Value | Use |
|---|---|---|
| `accent` | `#67e8ff` | the one interactive colour: selection, primary action, fill bars, focus |
| `accentSoft` | `rgba(103,232,255,0.55)` | softened accent for secondary emphasis |
| `accentFill` | `rgba(103,232,255,0.10)` | wash behind a selected card / the "NEXT" pill |
| `glow` | `0 0 10px rgba(103,232,255,0.45)` | ambient accent glow |

**Rule: cyan = you can act on it, or it is happening now.** Scanning a screen, the eye goes to cyan.
(That rule governs the **cockpit**. On **brand surfaces**, the eye should go to the fire — see Ember below.)

### Ember (fire) — the brand hero (warm register)

| Token | Value | Use |
|---|---|---|
| `fire` / `warm` | `#ff7a45` | the fire / the DROP action; the base warm |
| `ember` | `#ff6a2c` | brand hero ember — warm CTA gradients + brand accents on the fight register |
| `emberHi` | `#ffc24a` | bright top stop for a warm CTA gradient / ember highlight |
| `emberGlow` | `0 0 16px rgba(255,106,44,0.5)` | warm brand glow (the fight-register analog of `glow`) |

**Rule: on a brand surface, fire is what the eye goes to** (the PLAY button, the score card, the
logo). Inside the cockpit, that job stays with `accent` (cyan).

### State / semantic

| Token | Value | Meaning |
|---|---|---|
| `warn` | `#ff5d4d` | amber-red. RTB cue, threatened structure, critical gauge (flashes) |
| `fire` / `warm` | `#ff7a45` | orange. fire, the DROP action (`warm` is the alias used by touch controls) |
| `fireMarker` | `#ff2a2a` | vivid red. the RADAR fire blip only — kept distinct from the orange burn overlay and from `warn` so a fire dot never reads as a threatened building |
| `water` | `#56c4ee` | scoop water |
| `ok` | `#63d68a` | success / "cleared" green (menus, cloud-save). |

> **Documented green exception:** the in-world HUD **hull** gauge uses a deeper
> `#46d17a` (the `HULL_OK` const in `HUD.ts`), tuned to read against bright terrain. That is a
> deliberate in-world variant, not drift. Everything in menus/overlays uses `ok`.

### Podium medals (leaderboard top three)

`gold #ffd66b` · `silver #cfe0ee` · `bronze #e6a268`

### Text hierarchy (white at descending alpha)

| Token | Value | Use |
|---|---|---|
| `text` | `rgba(255,255,255,0.94)` | primary text, values, titles |
| `dim` | `rgba(255,255,255,0.45)` | secondary text, metadata, captions |
| `faint` | `rgba(255,255,255,0.34)` | smallest labels, separators |

### Surfaces (frosted fills)

| Token | Value | Use |
|---|---|---|
| `panel` | `rgba(14,20,27,0.38)` | in-world HUD frosted chip |
| `glass` | `rgba(12,18,25,0.42)` | round touch buttons (a touch more opaque, holds over bright terrain) |
| `warmGlass` | `rgba(44,17,13,0.46)` | the DROP hero button |
| `cardGlass` | `rgba(16,24,32,0.60)` | overlay cards (menus / leaderboard / cloud-save) |
| `cardSoft` | `rgba(16,24,32,0.42)` | quieter card — leaderboard list rows |
| `rowMine` | `rgba(103,232,255,0.14)` | accent-tinted row: "this one is you" |
| `field` | `rgba(8,13,18,0.60)` | recessed input / text field |

### Strokes (hairlines, not borders)

| Token | Value | Use |
|---|---|---|
| `stroke` | `rgba(255,255,255,0.12)` | default hairline (HUD panels, overlay cards) |
| `strokeStrong` | `rgba(255,255,255,0.18)` | touch-button border |
| `warmStroke` | `rgba(255,138,110,0.85)` | DROP hero edge |
| `hair` | `rgba(255,255,255,0.07)` | faintest divider between list rows |

### Effects

| Token | Value | Use |
|---|---|---|
| `blur` | `blur(12px) saturate(120%)` | the one frosted-glass blur (always mirror to `-webkit-` via `setBlur()`) |
| `shadow` | `0 6px 28px rgba(0,0,0,0.32)` | in-world HUD panels (subtle) |
| `shadowBtn` | `0 6px 22px rgba(0,0,0,0.40)` | touch buttons |
| `shadowCard` | `0 8px 30px rgba(0,0,0,0.45)` | overlay cards — stronger, to lift off a busy backdrop |

### Vehicle identity accents (separate system)

[`src/three/ui/profile.ts`](src/three/ui/profile.ts) holds a per-aircraft / per-map `accent`
(green `#3f7d4a`, clay `#b5642a`, blue `#3d7fa6`, red `#c8362a`, gold `#d8a12a`, sage `#5b6b50`).
These are **identity** colours, used only on the aircraft's **icon halo** and tagline. They must
**not** drive functional UI (a spec meter, a button, a status). Functional fills use `accent`.

## Buttons

There is **one button of record** — the `.btn` class, defined once in the component kit
([`ui/components/base.ts`](src/three/ui/components/base.ts) `injectKitStyles`, injected globally on
`:root`) and emitted by [`makeButton()`](src/three/ui/components/Button.ts). Screens get it two ways
and they are the **same** button: imperative code calls `makeButton({…})`; string-markup screens
write `class="btn …"`. Don't hand-roll a `<button>` with inline styles.

- **Variants:** `primary` (gold CTA) · `secondary` (warm glass) · `ghost` (quiet) · `danger` (warn),
  plus an `ember` CSS class for warm-outline string markup. **No round pills** — every button uses
  the rugged `R.lg` (10px) radius.
- **Registers (two-register law):** the CSS default is the warm **fight** look; add `.cockpit` for
  the cyan **instrument** look. `makeButton`'s `register` option does the same — note its TS default
  is `cockpit`, so pass `register:'fight'` for a warm brand button.
- **Sizes:** `sm` · `md` (default) · `lg`; add `block` for full-width.
- **States:** `locked` (gated, non-interactive) · `is-disabled`/`[disabled]` · `is-loading` (spinner).
  `makeButton` exposes `setEnabled`/`setLoading`/`setLocked`.
- **Intentional carve-outs (NOT drift):** the in-flight HUD round touch controls (`theme.button()` —
  joystick / DROP / eye / help) are a separate widget; and the **title-screen hero PLAY** is a
  deliberately larger, glowier brand moment (token-driven, but bigger than a standard button). Both
  are by design — don't fold them into `.btn`.

## Typography

System font stack everywhere (zero binary assets, instant on mobile). The cockpit's character
comes from numbers and instruments, not a display face.

```
ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif   // theme.UI.font
```

Type, weight, and radius are tokenized in [`theme.ts`](src/three/ui/theme.ts) as `FS` (font size),
`FW` (font weight), and `R` (radius) — one scale each, changeable in one place. Use the token, not
an inline `px`.

**`FS` (font size)**

| Token | px | Role |
|---|---|---|
| `FS.mega` | 42 | score-grade letter (debrief) |
| `FS.banner` | 32 | end-banner headline |
| `FS.display` | 24 | overlay title (leaderboard, briefing) |
| `FS.hero` | 20 | section header |
| `FS.title` | 18 | mission name, score, big values |
| `FS.xl` | 16 | callsign input |
| `FS.lg` | 15 | leaderboard row name |
| `FS.md` | 14 | body copy, button labels |
| `FS.body` | 13 | chips, tabs, card titles, intro |
| `FS.sm` | 12 | secondary body, mission brief |
| `FS.meta` | 11 | sub-labels, metadata, comms text |
| `FS.label` | 10 | uppercase labels |
| `FS.tag` | 9 | micro tags ("YOU", "NEXT") |
| `FS.micro` | 8 | comms speaker tag |

**`FW` (font weight):** `medium` 500 · `semibold` 600 · `bold` 700 · `heavy` 800 · `black` 900.

Convention: **uppercase + wide letter-spacing for labels (FW.bold/heavy); bold + tight for
values.** Mono is not used in the DOM UI.

**What stays inline (by design):** the flight tapes and radar draw their own numerals on **canvas**
(their own px); the leaderboard **podium** uses bespoke oversize emphasis (26/22 medal, 21/17 avatar)
deliberately off the scale so first place reads bigger; and injected-CSS-string stops (scrollbar
thumb, skeleton-shimmer gradient) keep their tuned alphas. Those are rendering details, not tokens.

## Spacing & Layout

- **Placement:** every HUD widget mounts inside an `anchor(place)` from `theme.ts` — a fixed,
  safe-area-aware corner container that reads `--bmf-edge` / `--bmf-gap` from `layout.ts`. New HUD
  bits are one line and get notch-safety + responsive reflow for free. Don't absolutely-position
  by hand.
- **Safe area:** overlays pad with `env(safe-area-inset-*)` so content clears notches /
  home-indicators in landscape.
- **Content column:** full-screen overlays centre a `max-width` column (mission select uses
  `980px`; leaderboard `640px`) so everything aligns to one left edge.
- **Radii (`R`):** `R.round` 50% (LEDs, avatars, status dots, and the in-flight HUD touch buttons
  *only*) · `R.pill` 99px (fill tracks, the toggle switch, carousel dots — **not** chips/badges,
  **not** buttons) · `R.xs` 2 · `R.sm` 8 (the square chip / badge radius) · `R.md` 12 (cards, chips —
  the default) · `R.lg` 10 (**the one `.btn` radius** + panels — tighter/rugged, never a round pill) ·
  `R.xl` 18 (modals, hero cards). One scale; pick the nearest step.
- **Corner-cut — the brand "panel notch":** every `.card` carries a chamfered corner via `clip-path`
  (it's the DEFAULT on `.card`, not just an opt-in `.cut`): top-left on panels (`--cut-tl`),
  bottom-right on list/grid cards (`--cut-br` — mission + aircraft cards), and a deeper bottom-right on
  the hero poster (`.artcard`). The geometry has one source — the `--cut-*` vars in `home/styles.ts`.
  This is a **card** signature: chips stay **square** (small radius), never round-pill, and the one
  chamfered chip is the rank insignia (`.rank`).
- **Poster cards are portrait (`AR.poster` → `--ar-poster`, `3 / 4`):** any card that carries
  **key-art** — the Field Notes posters (`.fd-mcard`, rail + showcase grid), the Maps / Hangar
  carousel slides (`.artcard`), the mockup `.poster` — locks to a tall portrait aspect, **always, and
  especially on a phone**, where a wide key-art card flattens into a landscape letterbox and throws
  the poster read away. The host fixes the width (rail flex-basis / grid track) and `--ar-poster`
  derives the height; on a height-filled phone carousel it works the other way — a short / landscape
  viewport shrinks the card's width to stay taller-than-wide rather than going wide. One value of
  record (`theme.ts` `AR`, the aspect-ratio analog of `R`) — never hand-set a card aspect.
- **Density:** comfortable. Pods/cells size from `layout.ts` breakpoints (`podSize`), shrinking
  ~8% on compact. The instrument strip wraps to a second row on a narrow phone, capped so it never
  collides with the radar.

## Motion

Informational and quick. Nothing decorative, nothing looping for its own sake.

| Motion | Spec | Where |
|---|---|---|
| Status-hint fade | opacity `0.35s ease`, auto-hide after 3.6s | top-center tooltip |
| Comms drop-in | opacity + `translateY(-6px→0)` `0.22s ease`, TTL 4.8–6.5s | radio log under radar |
| Hover lift | `translateY(-2/-3px)` `0.12–0.15s` | mission/aircraft cards |
| Tab/selection | `border-color` + `color` `0.12s ease` | tabs, selected card |
| Impact flash | snap in `0.05s`, bleed out `0.55s ease` | red damage vignette |
| Row reveal | `bmf-lb-in` fade+rise `0.28s`, staggered | leaderboard rows |
| Skeleton shimmer | `bmf-lb-shimmer 1.2s linear` | leaderboard loading |
| Engine spool ring | conic-gradient fill driven by live RPM | cold-start dial |

Respect the project's perf invariants: per-frame work is O(1), no shader recompiles, DPR is the
only adaptive runtime lever.

## Anti-Patterns (don't)

- **Don't add a new `const UI = {…}`** in a UI module. There was one palette of record and three
  drifted copies; they were merged into `theme.ts`. Import from there.
- **Don't hard-code a colour, blur, shadow, font-size, weight, or radius** in a module. Use a
  `UI` / `FS` / `FW` / `R` token, or add one.
- **Don't bleed vehicle identity colour into functional UI.** A data bar / button / status is
  `accent` (cyan), not the aircraft's red/clay/etc.
- **Don't let an overlay sit translucent over other UI.** A full-screen overlay opened over the
  menu must occlude it (near-opaque fill + `setBlur(root)`), or the busy grid bleeds through.
- **Don't use borders for separation.** Hairline strokes (`stroke`/`hair`) and surface contrast.
- **Don't stack backdrop-blur layers.** One frosted surface blurs once; children are transparent.
- **Don't over-glow.** Glow is a quiet instrument backlight, not neon.
- **Don't hand-roll a button.** There's one `.btn` of record (`makeButton()` or `class="btn …"`).
  The only exceptions are the HUD touch controls (`theme.button()`) and the title-screen hero PLAY.
- **Don't `innerHTML` dynamic, user, or remote data.** There's no `escapeHtml` helper. The callsign
  is sanitized (at input *and* on load), but build anything carrying user/remote text (leaderboard
  names, free input) with `textContent` or DOM nodes — never interpolated into `innerHTML`.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-04 | DESIGN.md created; `theme.ts` made the single token source | The glass-cockpit system already shipped but was undocumented and duplicated across four `UI` objects (theme + MissionSelect + Leaderboard + CloudSave) that had drifted. Folded the three copies into `theme.ts` (HUD values kept canonical, so the in-flight HUD is byte-identical; overlays shifted sub-perceptually). Added `shadowCard` (overlay vs HUD shadow) and unified the two menu success-greens into `ok`. |
| 2026-06-04 | Spec-meter fills use `accent`, not vehicle colour | Per-aircraft red/clay meters read as "warning." Vehicle identity now stays on the icon halo + tagline; data bars are system cyan. |
| 2026-06-04 | Leaderboard overlay made opaque + blurred | The old `0.9/0.96` gradient with no backdrop-blur let the mission grid bleed through behind an empty board. |
| 2026-06-04 | Keep the system font stack (no display face) | Honors the zero-binary-asset ethos and mobile perf; the cockpit's character is instrument/number-driven, not type-personality-driven. |
| 2026-06-04 | Tokenized type / weight / radius (`FS`/`FW`/`R`) + `track` fill | Swept ~150 inline `px` across theme/HUD/Input/MissionSelect/Leaderboard/CloudSave onto role-named scales; normalized a few odd steps (12.5/11.5→12, 19→18px; radii 7→8, 10/11→12, 16/20→18). Canvas numerals, the podium's off-scale emphasis, and injected-CSS-string stops stay inline by design. |
| 2026-06-07 | Single token source: `theme.ts` → `tokens.ts` → generated `mockups/tokens.css` | `mockups/kit.css` hand-mirrored the tokens and drifted silently (its own README admitted it). Now mockups `@import` a generated file; `gen:tokens` writes it and `verify:tokens` (in the deploy gate) fails on drift. `verify:ui` now also scans `.css` so styling moved out of `.ts` can't hide. Added `textSubtle` for the ~0.82 body whites that had no token. (107a7f3, 1e05d7b) |
| 2026-06-07 | One button of record: global `.btn`, emitted by `makeButton`; round pills removed | The button had re-forked into `.bmf-app .btn` (8px + a round-pill `.ember`) vs `makeButton` (10px, inline styles). Unified into one global `.btn` in the kit; `makeButton` emits the classes; rugged `R.lg` radius, no pills, `cockpit`/`fight` registers, `locked` folded in. HUD touch controls + the title hero PLAY are documented carve-outs. (f340607, 3198f4a) |
| 2026-06-07 | Callsign sanitized on load, not just on save | `loadProfile()` runs `cleanCallsign`, closing a tampered-storage / cloud-restore self-XSS at the one chokepoint every screen reads through. (107a7f3) |
| 2026-06-09 | Poster/art cards lock to a portrait aspect (`AR.poster` `3 / 4` → `--ar-poster`) | A key-art card flattens to a landscape letterbox on a wide phone — the Field Notes rail card sits at 78% width, and the in-game Maps/Hangar carousel fills the viewport height (so a short/landscape phone went wide). Added an `AR` aspect-ratio scale to `theme.ts` (one value of record, the analog of `R`), applied it to `.fd-mcard` (rail + showcase) and the `.artcard` carousel (a short-viewport guard derives the card width from the available height so it shrinks instead of flattening), and pointed the mockup `.poster` at the same token so the documented pattern can't drift. |
| 2026-06-09 | Brand corner-cut is the DEFAULT on every `.card`; home chips squared | The notch had drifted: the hub's cards cut, but the Settings `.card`s, the Open Skies `.helicard` grid, and the Hangar wallet chip (`.pts-bal`) were plain rounded / a round pill. Made `clip-path` the default on `.card` (so Settings auto-cuts), centralized the geometry into `--cut-tl`/`--cut-br`, added the notch to `.helicard`, and squared `.pts-bal` (`R.pill` → `R.sm`). Rule: cards chamfer, chips stay square. Also corrected the stale Radii note that listed chips/badges as `R.pill`. |
