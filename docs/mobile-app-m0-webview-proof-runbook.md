# M0 — WebView Performance Proof Runbook

**The launch gate.** Before any Capacitor shell work, prove the WebGL game holds playable framerate
inside a **native WebView** — Apple **WKWebView** (iOS) and **Android System WebView**. A WebView is
**not** a Safari/Chrome tab: it can run WebGL on a different code path, throttle background work, and
hand out less GPU. If the game tanks here, the whole "wrap it with Capacitor" strategy changes — so this
must be answered first, with a recorded GO / CONDITIONAL / NO-GO.

> **Status:** not yet run. This is the executable protocol. It needs a **Mac** (for iOS/WKWebView) and
> **Android Studio** (for Android WebView) — neither was available on the machine that wrote it, so it is
> documented to run, not run here. Budget ~half a day with the devices in hand.
>
> **Related docs:** `mobile-app-design-review-2026-06-11.md` (the UI audit) ·
> `mobile-app-launch-plan-2026-06-11.md` (the full M1–M7 plan this gate unblocks).

---

## 0. Gate logic — what the three verdicts mean

| Verdict | Meaning | Next action |
|---|---|---|
| **GO** | Flight is playable on the **low-end** device of both platforms (see §6 criteria). | Proceed to M1 (Capacitor scaffold) in the launch plan. |
| **CONDITIONAL** | Playable, but one named problem (e.g. DPR stuck at floor, audio crackle, thermal throttle after 4 min). | Fix the named issue first, then re-run this runbook. |
| **NO-GO** | Sub-30fps, stuck-blurry, crashing, or no audio on a low-end device. | Do **not** build the shell. Revisit: trim the bundle, force the `low` tier in WebView, gate the game behind a "best on a recent phone" notice, or reconsider Capacitor for the *game* (the tracker/content could still ship). |

The proof's job is to find the **floor**: the cheapest phone a real user might install on. A flagship will
always be fine; the low-end device is the one that decides viability.

---

## 1. Prerequisites

**iOS (WKWebView):**
- macOS + Xcode (latest stable) + Command Line Tools.
- A **real iPhone** on the older end you intend to support (e.g. iPhone 11 / SE 2nd-gen class), plus a
  mid/recent one if available. *Simulator is not valid for a perf proof — it uses the Mac's GPU.*
- A free Apple ID is enough to run on a personal device for testing.

**Android (System WebView):**
- Android Studio + SDK + platform-tools (`adb`).
- A **real low-end Android** (e.g. a budget device 2–3 years old, 3–4 GB RAM) with **USB debugging** on,
  plus a mid-tier if available. *Emulator is not valid for the perf proof.*
- Confirm the device's **Android System WebView** / Chrome is current (Play Store → updates) — Capacitor
  uses the system WebView, and its version moves the perf floor.

**Both:**
- Node 18+ and this repo checked out (only to scaffold the throwaway project; the proof itself loads the
  **live** site).
- The live site reachable: **https://bucketmyfire.com** (the game lazy-loads on a play deep-link).

---

## 2. Throwaway Capacitor project (disposable — delete after)

This is **not** the real app shell. It is the fastest way to get the live game into a real WebView. Point
it at the **live URL** so there is nothing to bundle.

```bash
# In a SCRATCH directory OUTSIDE the repo (this is throwaway):
mkdir bmf-webview-proof && cd bmf-webview-proof
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "BMF Proof" com.bucketmyfire.proof --web-dir=www
mkdir www && echo "redirecting..." > www/index.html   # placeholder; we load the live URL instead
```

Edit `capacitor.config.json` (or `.ts`) so the WebView loads the live game directly:

```json
{
  "appId": "com.bucketmyfire.proof",
  "appName": "BMF Proof",
  "webDir": "www",
  "server": {
    "url": "https://bucketmyfire.com/?ffa&qa",
    "cleartext": false
  }
}
```

> `?ffa` boots straight into endless flight (Open Skies); `?qa` exposes the `window.__game` debug handle
> and disables the coach/cold-start so you land in flight immediately (gated in `src/three/main.ts` on
> `import.meta.env.DEV || ?qa`). Swap to `?province&qa` for the dispatch mode in a second pass.

Add platforms and run on the **connected real device**:

```bash
npx cap add ios
npx cap add android
npx cap sync

npx cap run android      # pick the real device when prompted (adb)
npx cap run ios          # opens Xcode → select your iPhone → Run (set your signing team once)
```

**When done, delete the whole `bmf-webview-proof/` folder.** Nothing here feeds the real launch.

---

## 3. Device matrix (minimum)

| Slot | Platform | Device class | Why |
|---|---|---|---|
| A | Android | **low-end** (budget, 2–3 yr old) | The viability floor — the verdict hinges on this one |
| B | iOS | **older** iPhone (SE 2 / 11 class) | WKWebView floor |
| C | Android | mid/recent (optional) | Headroom + DPR-recovery check |
| D | iOS | recent iPhone (optional) | Headroom + DPR-recovery check |

Slots **A and B are required** for a defensible verdict; C and D add confidence.

---

## 4. Test routes

Run each on every device. All are live URLs (the throwaway project's `server.url`, or just retype in the
WebView via the inspector address bar):

- `https://bucketmyfire.com/?ffa&qa` — endless free-flight (Open Skies). The main stress: terrain, water,
  fire field, smoke/embers, post-fx, audio, touch.
- `https://bucketmyfire.com/?province&qa` — dispatch mode (adds the director + onboarding arc). Second pass.
- `https://bucketmyfire.com/` — the **front door** (no game). Sanity: does the marketing/live-data site +
  Leaflet/globe map feel smooth in the WebView too (scroll jank, map pan)?

---

## 5. What to measure (per device, ~5 minutes of flight each)

1. **Sustained flight fps** — fly continuously: scoop from a lake, drop on fire, bank hard, fly low over
   forest (the heaviest draw). Watch the *sustained* number, not the peak.
2. **DPR watchdog recovery** — the game starts sharp and the watchdog (`render/QualityTier.ts`) lowers
   render resolution (DPR) under sustained load, then **steps it back up** under headroom. Real config:
   DPR **floor 1.0**, **step 0.25**, up-window **4 s**; the `low` tier pins `dprCap: 1`. The question:
   does DPR drop and then **recover toward ≥1.0+**, or does it strand the device at the floor (permanently
   blurry)? Stuck-at-floor on a mid device = a red flag.
3. **Shader compile** — any **white / black** render or missing water/fire = a shader failed to compile in
   the WebView (this is the class that passes `npm run build` but only breaks at runtime; see the
   `bmf-verify` skill). The world must render with terrain, water, fire, and smoke visible.
4. **Audio** — the recorded rotor loop + procedural scoop/drop/win SFX. WKWebView has stricter audio
   autoplay/unlock rules; confirm sound starts after the first touch and doesn't crackle.
5. **Touch latency** — the left joystick (turn + throttle) and the DROP button. Input must feel immediate;
   WebView touch handling occasionally adds lag.
6. **Thermal / sustained** — keep flying ~5 min. Does fps **degrade** (thermal throttle) or stay stable?
   Note the device getting hot.
7. **Memory** — watch for steady growth (a leak) over the 5 min; the inspector's memory panel.

### How to read fps + internals

- **iOS:** connect the iPhone to the Mac → **Safari → Develop → [your iPhone] → the WKWebView page** → Web
  Inspector. Use the **Timelines / FPS** panel. In the **Console**, `window.__game` is live under `?qa`:
  - `window.__game.debug` → read-only state (`x,y,z,agl,floor,bucketY,water,firesLeft,burnedOut,lakes,
    fires[]`) — confirms the sim is actually running, not frozen.
  - For an explicit fps number, paste a tiny rAF counter in the console (it has no fps field of its own):
    ```js
    let n=0,t=performance.now(); (function loop(){n++; const d=performance.now()-t;
      if(d>=1000){console.log('fps',Math.round(n*1000/d)); n=0; t=performance.now();}
      requestAnimationFrame(loop);})();
    ```
- **Android:** Chrome on the desktop → **`chrome://inspect`** → find the device's WebView page → **inspect**
  → the same **Performance** panel + the `window.__game` console hook + the rAF counter above.
- A **frozen scene with audio still playing** = a throw escaped the animation loop (a known failure mode);
  treat as NO-GO for that build and capture the console error.

---

## 6. Pass / fail criteria

Apply to the **low-end** device of each platform (slots A + B).

| Signal | GO | CONDITIONAL | NO-GO |
|---|---|---|---|
| Sustained flight fps | **≥ 45** | 30–45 | **< 30** |
| DPR after load | recovers toward ≥ 1.0+ | stuck at floor 1.0 but ≥30fps | stuck-blurry **and** sub-30 |
| Shader / render | full world renders | — | white/black/missing layers |
| 5-min thermal | stable | mild drop, still ≥30 | falls below 30 / crashes |
| Audio | starts + clean | crackles | silent / breaks |
| Touch | immediate | slight lag | unusable lag |

**GO** = every signal in the GO column on **both** low-end devices.
**NO-GO** = any signal in the NO-GO column on either low-end device.
**CONDITIONAL** otherwise — name the single worst signal, fix it, re-run.

---

## 7. Result-capture template (fill in, then decide)

```
M0 WebView Proof — run date: __________  runner: __________

Device A (Android, low-end): model ______  Android __  WebView ver ______
  sustained fps (min/avg): ___ / ___    DPR floor hit? __  recovered? __
  shader/render OK? __   audio OK? __   touch OK? __   5-min throttle? __   mem growth? __
  console errors: ______________________________________________
  verdict: GO / CONDITIONAL / NO-GO

Device B (iOS, older): model ______  iOS __
  sustained fps (min/avg): ___ / ___    DPR floor hit? __  recovered? __
  shader/render OK? __   audio OK? __   touch OK? __   5-min throttle? __   mem growth? __
  console errors: ______________________________________________
  verdict: GO / CONDITIONAL / NO-GO

Device C (Android, mid) [optional]: ______  fps ___/___  recovered? __  notes: ______
Device D (iOS, recent) [optional]: ______  fps ___/___  recovered? __  notes: ______

OVERALL GATE VERDICT: GO / CONDITIONAL / NO-GO
If CONDITIONAL/NO-GO, the single blocking signal + planned fix: _______________________
```

Record the overall verdict back into `mobile-app-launch-plan-2026-06-11.md` (M0 row) before starting M1.

---

## 8. If NO-GO — the levers before giving up

The game is built to be mobile-60fps (one-time generation, O(1)/frame, no shader recompiles, DPR the one
runtime lever), so a WebView NO-GO usually means a specific bottleneck, not a dead end. In rough order of
cheapness:

1. **Force the `low` quality tier in the WebView** (no post-fx, no shadows, `dprCap: 1`) — biggest single
   win on weak GPUs; tunable in `QUALITY.presets` (`config.ts`) / `render/QualityTier.ts`.
2. **Lower the DPR cap / start at the floor** so the device never pays the sharp-render startup cost.
3. **Trim the bundle / defer more generation** (the load-time gen is the dominant cold-start cost).
4. **Update the device's System WebView** (Android) — an old WebView is often the real culprit.
5. Only if all fail: ship the **tracker + content** as the app and gate the game behind "best in a browser
   on a recent phone," or revisit native-rendering options — a strategy change, escalate to the owner.
```
