# Mobile App Launch Plan — Bucket My Fire (Capacitor, iOS + Android)

**Date:** 2026-06-11 · **Packaging:** Capacitor wrap of the existing web build · **Targets:** Apple App
Store + Google Play · **Source review:** [mobile-app-design-review-2026-06-11.md](mobile-app-design-review-2026-06-11.md)

> **Strategy in one line:** wrap the current Vite/Three.js web build in a thin native shell (one codebase →
> both stores), bundle `dist/` locally for performance + offline, keep live wildfire data over the network,
> and add enough *native value* (haptics, push, offline Prepare) to read as a real app — not a website in a box.

---

## Critical path (read this first)

```
M0 WebView perf spike ──► M1 Capacitor scaffold ──► M2 Shell parity ──► M3 Platform behavior ──► M7 Beta ─► Submit
   (GATE: kill or go)                                   │                      │
                                                        └─► M4 A11y + loading ─┤
                                                        └─► M5 Native value ───┤
                                                        └─► M6 Store assets ───┘  (M6 can start during M4)
```

**M0 is a hard gate.** Before any shell work, prove the WebGL game holds 60fps inside **WKWebView (iOS)** and
**Android System WebView** on a real low-end phone. WebView ≠ a Safari/Chrome tab — if the game tanks there,
the packaging strategy changes. De-risk it in days, not after weeks of shell work.

---

## M0 — WebView performance spike *(GATE)*

**Goal:** confirm the game is viable inside a native WebView before investing in the shell.

- [ ] Throwaway Capacitor project loading the **live URL** (fastest path to a device build).
- [ ] Run `?province` / `?ffa` flight on a **real mid/low-end Android** (System WebView) and an **older iPhone**
      (WKWebView) — watch fps, the adaptive-DPR watchdog, shader compile, and audio.
- [ ] Confirm the quality watchdog (`render/QualityTier.ts` + DPR lever) behaves in WebView.

**Exit:** flight is playable (≥ ~45–60fps with DPR recovery) on both. If not → spike a fix or reconsider scope.
**Effort:** human ~1–2 days / CC: scaffold + harness ~30 min, then real-device hands-on (human-only).

---

## M1 — Capacitor scaffold

**Goal:** the real web build running as a native app from local assets on both platforms.

- [ ] `npm i @capacitor/core @capacitor/cli` + `npx cap init`; add `@capacitor/ios` + `@capacitor/android`.
- [ ] Point `webDir` at `dist/`; **bundle locally** (no `server.url`) → best perf, offline-capable, passes review.
- [ ] `npm run build && npx cap sync`; open + run in Xcode and Android Studio.
- [ ] Decide the **update channel:** store releases for the shell; optionally a JS live-update later (Appflow /
      Capacitor live updates) so content/UI ship without a store round-trip. Note for later, don't build yet.
- [ ] Keep the GitHub Pages auto-deploy for web untouched; the app build is a **separate** Xcode/Gradle pipeline.

**Exit:** both apps launch from bundled `dist/`, reach the front door, and boot a flight.
**Depends on:** M0. **Effort:** human ~1 day / CC: most of the wiring.

---

## M2 — Native shell parity *(P0)*

**Goal:** it looks like an app from the first frame, with a consistent system-bar identity.

- [ ] **Reconcile theme colors** — manifest `theme_color` `#1b2a1f` vs HTML `#05080b` disagree. Pick one
      (recommend the near-black `#05080b`), apply to manifest, HTML meta, and the StatusBar plugin.
- [ ] **Refresh stale manifest copy** — `name`/`description` still say "Helicopter Wildfire Flight Sim"; the
      product is a live tracker + content + game. Rewrite to match the repositioned site.
- [ ] `@capacitor/status-bar`: light content on dark, overlay-aware; `@capacitor/splash-screen`: brand splash on
      `#0e160f`, hide on first paint.
- [ ] Verify `env(safe-area-inset-*)` holds inside the shell (notch/Dynamic Island, home indicator, gesture bar)
      in portrait **and** landscape flight.

**Exit:** branded splash → dark status bar → safe-area-correct UI on a notched iPhone and a gesture-nav Pixel.
**Depends on:** M1. **Effort:** human ~1–2 days / CC: copy + config + most CSS.

---

## M3 — Platform behavior *(P0)*

**Goal:** the app obeys each platform's navigation and input expectations.

- [ ] **Android back button / gesture** (`@capacitor/app` `backButton`): close the Layers sheet → fire-detail
      sheet → settings → step out of flight → home; only exit the app at the home root. Hard Material expectation.
- [ ] **iOS edge-swipe vs joystick:** suppress the left-edge back-swipe over the game canvas so it doesn't fight
      the virtual joystick.
- [ ] **Orientation decision:** manifest is `any`. Confirm per surface (content scrolls portrait; flight HUD is
      portrait) and lock what should be locked.
- [ ] **Haptics** (`@capacitor/haptics`) on scoop / DROP / win — cheap, big native-feel payoff (also feeds M5).
- [ ] Pull-to-refresh on the map + national-data surfaces.

**Exit:** Android back never unexpectedly kills the app; iOS edge-swipe never hijacks flight; DROP buzzes.
**Depends on:** M1 (parallel with M2). **Effort:** human ~2–3 days / CC: routing + plugin wiring.

---

## M4 — Accessibility + loading polish *(P1)*

**Goal:** clear Apple/Play accessibility expectations and kill the "broken for a beat" loading states.

- [ ] **rem-based type scale** — fixed px ignores iOS Dynamic Type + Android font-scale; move `FS` tokens to rem
      so OS text-size settings work. Re-run `verify:tokens` after.
- [ ] **Loading skeletons** for the national-fire hero (blank numbers today) + an empty state for the Field Notes
      carousel.
- [ ] **Touch targets → 48dp** (Material min; serves iOS 44pt too) on appbar/tab rows; **frost the Leaflet zoom
      controls** to ≥48px glass.
- [ ] **VoiceOver/TalkBack labels** on interactive HUD touch controls; a screen-reader pass on every full-screen
      surface (canvas tapes/radar are decorative → mark/hide appropriately).
- [ ] Validate **mono body at Dynamic Type XXL** for long-form blog; if it breaks, scope a proportional face to
      article body only (instruments stay mono — do not reintroduce a second *display* face without sign-off).

**Exit:** font-scale works; no blank-number flashes; VoiceOver + TalkBack pass on the core flows.
**Depends on:** M1 (parallel with M2/M3). **Effort:** human ~3–4 days / CC: most of the token + skeleton work.

---

## M5 — Native value (clear Apple's "minimum functionality" bar) *(P1)*

**Goal:** the #1 wrapped-app rejection risk (App Store Guideline 4.2) — give it real native reasons to exist.

- [ ] **Push** (`@capacitor/push-notifications`): opt-in "fire danger / new out-of-control fire near you" alerts
      off the live CIFFC/CWFIS data — genuinely useful, on-mission, and a strong retention hook.
- [ ] **Offline Prepare** — the Go-Bag checklist + evacuation/defensible-space Field Notes available offline
      (bundled), so the readiness content works with no signal. Real utility, not a gimmick.
- [ ] **Native share** (`@capacitor/share`) on the score/debrief card + a fire detail.

**Exit:** install → useful with no network (Prepare) + an opt-in alert + native share. Reads as an app, not a site.
**Depends on:** M1; push needs APNs (Apple Dev) + FCM (Firebase) setup. **Effort:** human ~3–5 days / CC: client wiring; backend/push infra is human-led.

---

## M6 — Store assets + listings *(can start during M4)*

**Goal:** everything the two store consoles demand, ready to submit.

- [ ] **Icons:** full iOS app-icon set + Android adaptive icon; **verify maskable safe-zones** (192/512 reuse one
      PNG today — confirm padding so the flame isn't clipped). Use the `bmf-art` skill for any new art.
- [ ] **`manifest.screenshots`** + per-device-class store screenshots (6.7"/6.5"/5.5" iPhone, iPad if shipping,
      Android phone/tablet) — capture from the real shell.
- [ ] **Privacy:** Apple Privacy Nutrition Labels + Google Play Data Safety. We collect a callsign + scores
      (Supabase, env-gated) and fetch public fire data — declare accurately. Confirm `public/privacy.html` +
      `terms.html` match what the app actually does.
- [ ] **Age rating / content** questionnaires; category = Games (or Weather? — decide: the tracker is a real hook).
- [ ] Listing copy + keywords (ASO) consistent with "Fight the fire." and the live-tracker positioning.

**Exit:** both store listings are submission-complete (assets, privacy, rating, copy).
**Depends on:** M2 (real shell for screenshots). **Effort:** human ~2–3 days (console work is human-led).

---

## M7 — Beta → submit

**Goal:** real-tester validation, then ship.

- [ ] **TestFlight** (iOS internal+external) + **Play internal testing** track.
- [ ] Device-matrix smoke: low-end Android, notched iPhone, tablet — fps, safe areas, back button, push, offline.
- [ ] Triage beta findings; fix P0/P1 regressions.
- [ ] Submit to App Store review + Play review; keep the existing `/canary` post-deploy monitoring on the web.

**Exit:** approved on both stores. **Depends on:** M2–M6. **Effort:** human ~1 week incl. review latency.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WebGL game underperforms in WKWebView / Android WebView | Med | High | **M0 gate** on real low-end devices before shell work |
| Apple 4.2 "minimum functionality" rejection (reads as a website) | Med | High | **M5** native value (push/offline/haptics/share) + bundled assets |
| Android back button kills app unexpectedly | High if skipped | High | **M3** explicit back routing |
| Maskable icon clips the flame on Android | Med | Low | **M6** safe-zone audit |
| Mono body fails Dynamic Type readability at XXL | Med | Med | **M4** validation; scoped proportional body if needed |
| Push backend (APNs/FCM) scope creep | Med | Med | Push is P1, not launch-blocking — can ship v1 without it |

---

## What v1.0 must have vs. can defer

- **Must (P0):** Capacitor shell on both stores, M0 perf pass, theme/manifest reconcile, Android back + iOS
  edge-swipe, splash + status bar, store assets + privacy.
- **Should (P1):** rem type + loading skeletons + 48dp + screen-reader pass, offline Prepare, haptics, native share.
- **Defer (P2 / fast-follow):** push alerts (if backend isn't ready), JS live-update channel, light-mode for
  content pages, near-black poster-card art fixes, ASO iteration.
