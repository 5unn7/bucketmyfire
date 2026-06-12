# Mobile App Design Review — Bucket My Fire (cross-platform: iOS HIG + Android Material)

**Date:** 2026-06-11 · **Reviewer pass:** `/ios-design-review` adapted for web → native
**Scope:** the live site (front door, live-fire map, Prepare, Field Notes blog, in-flight game HUD),
reviewed at an **iPhone 14/15 viewport (390×844 @3x)** and a **Pixel 7 viewport (412×915)** against
**Apple HIG** and **Android Material 3**, to get ready to plan a mobile app launch serving both.

> **Method note.** There is no iOS device or native app yet, and we're on Windows — so this is not a
> live-hardware pass. It's a real-pixel audit of the production web UI at both platforms' reference
> viewports (Playwright + swiftshader WebGL), which is the right basis because the app will almost
> certainly *be* this web build wrapped (see §1). Screenshots captured 0 console errors on every surface.

---

## 1. The one decision that frames everything: packaging path

This is a Vite static multi-page site + a ~1 MB Three.js WebGL game. A from-scratch native rewrite
(SwiftUI + Jetpack Compose) of a WebGL flight sim is not realistic and throws away the whole codebase.
The realistic paths to "an app on both stores":

| Path | What it is | Pros | Cons |
|---|---|---|---|
| **Capacitor wrap** (recommended) | the existing web build inside a native iOS + Android shell | one codebase → both stores; native splash/status-bar/haptics/push/back-button APIs; real App Store + Play Store presence | a thin native shell to maintain; review-guideline risk if it reads as "just a website" (mitigate with native touches: haptics, push, offline) |
| **PWA + TWA** | installable PWA; Play Store via Trusted Web Activity; iOS via Add-to-Home-Screen | least work; no shell | **iOS has no real App Store path for a PWA** — you'd be Play-Store-only + iOS "add to home screen". Weak for a launch that wants both stores |
| **Native rewrite** | rebuild UI native per platform | most native feel | throws away the game + content engine; multi-quarter; not viable |

**Readiness today:** PWA plumbing is already in place — `viewport-fit=cover`, `apple-mobile-web-app-capable`,
`theme-color`, `manifest.webmanifest`, 192/512 + maskable + apple-touch icons. **No Capacitor/Cordova
deps yet.** So we're ~80% of the way to "installable", 0% of the way to "in the stores."

**The current UI is in good shape to be wrapped** — the heavy lifting (bottom tab bar, safe-area insets,
dark glass system, touch controls) is already native-shaped. The work below is polish + closing the
native-wrapper gaps, not a redesign.

---

## 2. Scorecard (0–10 per dimension, both platforms)

| # | Dimension | Score | Biggest leverage fix |
|---|---|:-:|---|
| 1 | Typography hierarchy | **7** | Mono body for long-form/small text is a HIG/Material divergence — validate at Dynamic Type XXL or split body off mono |
| 2 | Spacing rhythm | **8** | Token-driven + safe-area aware; audit bento for stray magic paddings |
| 3 | Color hierarchy | **8** | Reconcile the two disagreeing theme colors; decide dark-only vs honoring light mode |
| 4 | Touch targets | **8** | Bump 44px rows to **48dp** (Material min) so one size serves both; frost the Leaflet zoom buttons |
| 5 | Loading / empty / error | **6** | National-data hero shows **blank numbers** before load — add skeletons |
| 6 | Accessibility | **6** | Fixed-px type ignores OS font-scaling (rem); no VoiceOver/TalkBack on canvas HUD |
| 7 | Animation discipline | **9** | Disciplined + reduced-motion gated; nothing major |
| 8 | iOS/Android idiom alignment | **7** | **No Android back-button handling**; iOS edge-swipe will fight the left joystick |
| 9 | Information density | **8** | Well-paced, no h-scroll, section anchors; verify instrument strip on smallest phones |
| 10 | AI-slop check | **9** | Genuinely low slop, strong voice; fix near-black poster cards that read as broken images |

**Composite ≈ 7.6 / 10** — a strong, distinctive mobile-web UI with a handful of concrete gaps that
specifically matter once it becomes a wrapped app.

---

## 3. Dimension detail

### 1. Typography hierarchy — 7
Clean role-named scale (`FS` tokens, display→body→caption→micro). The recent unify-on-**JetBrains Mono**
decision (retired Saira) gives the cockpit a strong, distinctive instrument character — mono **numerals and
labels** are the right call and read great. The tradeoff: **mono is now the body face for long-form too**
(the Field Notes blog, Prepare copy). HIG (SF Pro) and Material (Roboto/system) both expect a proportional
face for reading text; mono body costs scan speed and tightens at 12px and below. *This is a deliberate
owner decision (do not silently reintroduce a second display face).* **To 10:** confirm mono body survives
**Dynamic Type / font-scale at XXL** on a real phone, and consider a proportional face scoped *only* to
blog article body — instruments stay mono.

### 2. Spacing rhythm — 8
Anchors are safe-area-aware (`env(safe-area-inset-*)`), edges/gaps come from `layout.ts` breakpoints, radii
ride one `R` scale. Bento spacing reads consistent on both viewports. **To 10:** a quick 4/8pt-grid audit of
the front-door bento gaps; lock the corner-cut card signature into the maskable icon story so the brand
notch shows up on the home-screen icon too.

### 3. Color hierarchy — 8
The two-register system (warm "fight" brand surfaces / cool "instrument" cockpit) is excellent and rare —
rationed cyan, fire-forward CTAs, a `verify:contrast` WCAG-AA gate. Dark-mode-native throughout. **Two real
issues:** (a) **manifest `theme_color` `#1b2a1f` (green) ≠ HTML `theme-color` `#05080b` (near-black)** — the
status bar / task-switcher tint will be inconsistent between the address bar and the installed app; pick one.
(b) **No light mode** — fine as a brand stance for a cockpit game, but the *content* pages (blog/Prepare) are
permanently dark regardless of the user's system setting; decide explicitly rather than by omission.

### 4. Touch targets — 8
Appbar nav rows `min-height:44px`, tab bar 56px, HUD joystick/DROP large. Meets **iOS 44pt**. **Android
Material wants 48dp** — the 44px rows are 4px short of the Material recommendation. The map's stock Leaflet
`+`/`−` zoom buttons are white system controls (off-brand) and look ~30px. **To 10:** raise tap rows to 48px
(serves both mediums at once) and replace/frost the Leaflet zoom controls to ≥48px glass buttons.

### 5. Loading / empty / error — 6 *(below threshold)*
The map has an honest "data unavailable → official sources" fallback (great), and the leaderboard has a
skeleton shimmer. But the **front-door national-fire hero shows empty values under their labels** while the
CIFFC/CWFIS fetch is in flight (visible on the slower Pixel capture: "active fires" with no number, blank
OUT-OF-CONTROL / SATELLITE counts). For a beat the hero reads broken. **To 10:** skeleton placeholders (or
last-known cached values) for every stat in the national grid; an explicit empty state for the Field Notes
carousel if content fails.

### 6. Accessibility — 6 *(below threshold)*
Good: `aria-current`, `aria-label` on icon buttons, breadcrumb roles, `prefers-reduced-motion` honored (the
flame flicker stops), WCAG-AA contrast gate. **Gaps that bite on both platforms:** (a) type tokens are fixed
**px**, so **iOS Dynamic Type and Android font-scale don't resize the UI** — a real a11y miss; move the type
scale to `rem`. (b) The flight tapes + radar are **canvas** with no accessibility tree; the DOM touch controls
need explicit VoiceOver/TalkBack labels. **To 10:** rem-based type, label every interactive HUD control, run a
TalkBack + VoiceOver pass.

### 7. Animation discipline — 9
Motion table is informational and quick (200–300ms), reduced-motion gated, no decorative loops except the
brand flame (which respects reduce-motion). **To 10:** confirm the in-flight count-up / fill animations never
exceed 2 simultaneous on the HUD.

### 8. iOS/Android idiom alignment — 7
**Strong:** a **bottom tab bar** (the shared iOS Tab Bar / Material Bottom Navigation idiom — exactly right
for "serve both"), no hamburger on phone, a native `<select>` for the region picker (invokes each platform's
native wheel). **Gaps that only appear once wrapped:** (a) **Android back button / gesture is unhandled** — in
a Capacitor shell, back must close overlays (Layers sheet, fire detail, settings) and step out of flight, or
it'll kill the app; this is a hard Material expectation. (b) **iOS left-edge swipe-back will fight the
left-hand virtual joystick** in flight — disable the edge gesture over the game canvas. (c) No pull-to-refresh
on the map/content (expected on both). **To 10:** back-button routing, edge-gesture suppression over controls,
pull-to-refresh on data surfaces.

### 9. Information density — 8
Front-door bento is well-paced, no horizontal scroll, the blog uses real section anchors ("ALL ↓"). The
in-flight HUD is dense but cockpit-appropriate (state before chrome). DESIGN.md already caps the instrument
strip so it wraps without colliding with the radar. **To 10:** spot-check the instrument strip + points panel
on a 360px-wide Android (the smallest common phone) — the ghosted onboarding text over the bright sky was
low-contrast in the capture.

### 10. AI-slop check — 9
Genuinely low slop. Real CIFFC/CWFIS data, a sharp brand voice ("Fight the fire."), no lorem ipsum, no
cargo-cult Material cards, distinctive signatures (frosted glass, chamfered corner-cut cards, ember register).
**To 10:** several Field Notes poster cards render near-black (faint ember only) — on a phone they read as a
failed image load. Ensure every poster carries visible key art.

---

## 4. Per-surface notes

- **Front door** (`frontdoor-iphone/pixel`): the strongest screen — live national stat as the hero ("87
  active fires"), Live-fire-map card, Open Skies play tile, "FLY NOW" gold CTA, "Wear the fight." merch,
  Prepare promo, Field Notes carousel, honest footer disclaimer. Layout is byte-identical iPhone↔Pixel (good).
  Fix: the loading state (§5) and the dark poster cards (§10).
- **Live-fire map** (`map-globe/flat`): polished. Default procedural 3D globe with stage-of-control fire dots,
  region dropdown, stat strip, frosted layer toggles. Leaflet `?flat=1` fallback works. Fix: the white Leaflet
  zoom controls (§4); ensure the Layers sheet + fire-detail sheet close on Android back (§8).
- **In-flight HUD** (`game-home-iphone`): true cockpit — instrument strip, radar minimap, dual flight tapes,
  large joystick + DROP + throttle cluster. Fix: low-contrast onboarding text over bright sky (§9); canvas a11y
  (§6); iOS edge-swipe vs joystick (§8).
- **Prepare / Field Notes** (`prepare`, `blog`): clean editorial, consistent cards, good hierarchy, section
  anchors. Fix: mono body for long-form reading (§1); some article hero images render very dark (§10).

---

## 5. Mobile-app-readiness checklist (the wrapper-specific gaps)

These are the items that do **not** show up in a browser but **will** at store-launch:

- [ ] **Pick the packaging path** (§1) — recommend Capacitor.
- [ ] **Reconcile theme colors** — manifest `theme_color` vs HTML `theme-color` disagree.
- [ ] **Manifest copy is stale/game-only** — it says "Helicopter Wildfire Flight Sim"; the product is now a
      live tracker + content + game. Update `name`/`description` to match the repositioned site.
- [ ] **Add `manifest.screenshots`** — Play Store + richer install prompts use them; none today.
- [ ] **Verify maskable icon safe-zone** — 192/512 are flagged `maskable` but reuse the same PNG; confirm
      adaptive-icon padding so Android doesn't clip the flame.
- [ ] **Android back-button / gesture routing** (§8).
- [ ] **iOS edge-swipe suppression over game controls** (§8).
- [ ] **Native splash screen** per platform (background `#0e160f` today) + status-bar style (light content on
      dark) wired in the shell.
- [ ] **Haptics** on DROP / scoop / win (Capacitor Haptics) — cheap, huge native-feel payoff, and helps clear
      Apple's "more than a website" review bar.
- [ ] **Orientation decision** — manifest is `any`; the game HUD is portrait. Lock or confirm per surface.
- [ ] **OS font-scaling** — move type to `rem` (§6) so Dynamic Type / font-scale work.
- [ ] **Decide dark-only vs `prefers-color-scheme`** for content pages (§3).
- [ ] **Loading skeletons** for the national-data hero (§5).

---

## 6. Prioritized punch list

**P0 — blocks a credible launch on both stores**
1. Choose packaging path (Capacitor recommended) and stand up the iOS + Android shells.
2. Android back-button routing + iOS edge-swipe suppression over the joystick.
3. Reconcile theme colors + refresh stale manifest copy.

**P1 — native feel + accessibility (do before store submission)**
4. Loading skeletons for the live-data hero.
5. rem-based type scale (OS font-scaling) + VoiceOver/TalkBack labels on HUD controls.
6. Bump tap rows to 48dp; frost the Leaflet zoom controls.
7. Haptics on DROP/scoop/win; native splash + status-bar style.

**P2 — polish**
8. Fix near-black poster cards; low-contrast onboarding text over sky.
9. Add `manifest.screenshots`; verify maskable safe-zones.
10. Decide dark-only vs light-mode for content pages; validate mono body at Dynamic Type XXL.

---

*Screenshots: `.design-shots/` (frontdoor-iphone, frontdoor-pixel, map-globe-iphone, map-flat-iphone,
game-home-iphone, prepare-iphone, blog-iphone).*
