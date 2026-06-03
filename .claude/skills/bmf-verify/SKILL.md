---
name: bmf-verify
description: >-
  Verify a bucketmyfire gameplay or rendering change actually works. This repo has NO unit-test
  runner — the standing approach is headless. Use this whenever you change anything under
  `src/three/` and need to confirm it: flight/bucket/fire physics, scoop/drop, mission outcomes,
  shaders/VFX, HUD, fuel/range, structures. Covers the three verification levels (build gate →
  pure-sim Node assertions → live headless via the `window.__game` debug hook), the
  `?autostart&m=<id>&qa` URL contract, the runtime debug handles (`__game.fireSystem.igniteAt`,
  `__game.heliSim.position` teleport), and the recurring "MCP Playwright browser is locked"
  workaround (vite preview + temp playwright-core driving on-disk Chromium). Reach for this
  skill any time you'd otherwise hand-roll a Playwright script or wonder "did my shader/sim
  change actually take?" — especially for GLSL changes, which pass `tsc`/`npm run build` even
  when broken and only fail at runtime.
---

# Verifying a bucketmyfire change (headless)

There is **no test runner**. `npm run build` only type-checks — it will happily ship a GLSL
shader that compiles to garbage or a sim whose numbers are wrong. So behavior is verified
headlessly, at three escalating levels. **Pick the cheapest level that can catch the class of
bug you might have introduced**, and only climb to the live browser when you must.

## Level 1 — the build gate (always)

```bash
npm run build      # tsc --noEmit (strict: unused imports/locals fail) → vite build
```

This catches type errors and unused-symbol breaks. It does **not** catch logic errors or
shader-compile errors. It's necessary, never sufficient.

## Level 2 — pure-sim Node assertions (for `sim/*.ts` math)

The `sim/*.ts` modules are **engine-agnostic** (they import only Three's math + `config.ts`,
never a `Scene` or the DOM — see CLAUDE.md "sim boundary"). That means you can run them in
plain Node, with no browser, and assert on the numbers. This is the **preferred** way to verify
flight, bucket, fire, fuel, crew, rotor-wash, and structure logic, and to prove determinism from
`WORLD3D.seed`.

The campaign verifier is the worked example and is wired as a script:

```bash
npm run verify:campaign     # esbuild-bundles scripts/verify-campaign.ts → Node, then runs it
```

It builds the real scenario sims per mission (`World` + `FireSystem` + `Structures` +
`CrewTransport` + `FuelSim`), runs a deterministic "perfect player" to a terminal state, and
asserts every mission reaches `won`/`verified` with each goal latched, plus that a no-op/starve
run does **not** win. Read [scripts/verify-campaign.ts](../../../scripts/verify-campaign.ts) — it
is the template for any sim test.

**To write a new one-off sim check**, follow that file's shape: import the sim(s), inject the
`World` field callbacks they need (e.g. `FireSystem` takes `groundHeightAt`/`isOverWater`/
`fuelAt`/`pickSite` + `world.rng`), step `update(dt, …)` in a loop, assert. Run it the same way
the npm script does:

```bash
npx esbuild scripts/my-check.ts --bundle --platform=node --format=esm \
  --outfile=scripts/.my-check.mjs --log-level=warning && node scripts/.my-check.mjs
```

Use a fixed `dt` (the verifier uses `0.1`) and remember the sim runs in seconds; `FireSystem`
and `Structures` take **milliseconds** in `update` (`dt * 1000`) — match the existing call
sites.

## Level 3 — live headless (the ONLY way to catch shader-compile errors + signal wiring)

GLSL only compiles at runtime. If you touched a `*Material.ts`, an `onBeforeCompile`, a
`vfx/*`, `postfx/*`, `water/*`, `sky/*`, or `lighting/*` file, you **must** run the real game in
a browser to know it works. The game exposes a debug hook for exactly this.

### The `__game` hook contract

`src/three/main.ts` attaches `window.__game` **only when** `import.meta.env.DEV || ?qa` is
present. So:

- `npm run dev` (dev server) → `__game` is always there.
- A **production / `vite preview`** build → you **must** append **`?qa`** to the URL or
  `__game` is `undefined`.

URL params the router honors (`main.ts`): `?autostart` boots straight into the first mission;
`?m=<missionId>` selects a specific mission (ids in
[src/three/missions/catalog.ts](../../../src/three/missions/catalog.ts), e.g. `first-sortie`).
Typical QA URL: `http://localhost:<port>/?m=first-sortie&qa=1`.

`__game.debug` is read-only state: `{ x, y, z, agl, floor, bucketY, water, firesLeft, burnedOut,
lakes, fires[] }` (each fire `{ x, z, y, intensity, size, fuel }`). Read it to assert behavior.

### Runtime handles for driving the game (TS `private` isn't enforced at runtime)

- **Teleport to frame something fast** (don't autopilot — it's slow in headless):
  `__game.heliSim.position.set(x,y,z)` then `__game.heliSim.velocity.set(0,0,0)`; the chase cam
  follows. To frame a fire: read `__game.debug.fires[0]`, place the heli e.g. `f.x-72, f.y+30,
  f.z+3`.
- **Ignite a test blaze on demand:** `__game.fireSystem.igniteAt(x, z, radiusCells, heat)`
  (radius ~3 cells stays one blob; space discs ~60u apart for a wall of fire).
- **Read the live fire field:** `__game.fireSystem.fieldView()` → `{ heat, scorch, n, cellSize,
  half }` typed arrays (used to paint scorch scars in tests).
- **Autopilot by keys** if you must: dispatch `KeyboardEvent`s — `KeyI` climb, `KeyJ` descend,
  WASD **or arrows** for throttle/turn, `Space` drop. (Arrows turn more reliably than A/D in a
  low scoop-hover.)
- **Kill the CONTROLS scrim** (it blocks the view): find the `div` whose `textContent` starts
  with `CONTROLS`, walk up ≤6 parents to the `position:fixed` one, set `display:none`.

[scripts/shot.mjs](../../../scripts/shot.mjs) is a complete worked example: boots
`?autostart&m=first-sortie`, waits for `__game.debug.fires.length > 0`, ignites a spread, frames
it, and screenshots (plus a radar crop). Copy it.

### When the MCP Playwright browser is locked (happens almost every session)

If the MCP browser errors with "Browser is already in use … use --isolated", drive Chromium
yourself:

1. **Serve the no-HMR build, not the dev server.** In this environment something re-touches
   `src/three/Input.ts` every ~12s, and `npm run dev`'s HMR does a full page reload on it —
   which resets the heli to start altitude, so a slow headless descent never reaches low AGL.
   Build first, then `npx vite preview --port <p>` against `dist/` (no HMR, no reloads).
   *(Short screenshot runs that finish in a few seconds are fine on `npm run dev` and don't need
   `?qa`.)*
2. **Drive on-disk Chromium via a throwaway `playwright-core`.** `npm i playwright-core@1.60.0`
   in a TEMP dir (keep the project `node_modules` clean). Launch with `executablePath` pointing
   at the installed browser, e.g. `C:/Users/Sunny/AppData/Local/ms-playwright/chromium-1208/
   chrome-win64/chrome.exe`, and WebGL args:
   `['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle']`.
3. **Remember `?qa`** on the preview build URL (step above), since `__game` is gated off in prod.

**Headless realities:** swiftshader can crash the renderer on long heavy-scene runs — guard with
`page.on('crash')`, wrap `evaluate`s in try/catch, and **screenshot as early as the condition you
want is met**. The sim runs in slow-motion under the clamped-`dt`/low-rAF headless loop, so allow
generous wall-clock. You can't easily get the camera *inside* a smoke column (the chase cam keeps
a min distance).

## How to choose

- Changed a **`sim/*.ts`** number or rule, or anything seed-dependent → **Level 2** (Node). Fast,
  deterministic, no browser flake.
- Changed a **shader / material / VFX / post / sky / lighting** → **Level 3** (live). Shaders pass
  the build even when broken; only a real GL context reveals it.
- Changed a **mission def** → `npm run verify:campaign` (Level 2) is the gate; optionally Level 3
  for a visual look. See the **bmf-mission** skill.
- Always finish on a green `npm run build` (Level 1).
