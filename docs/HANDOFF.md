# bucketmyfire — Agent Handoff

> Read this first, then [docs/ROADMAP.md](./ROADMAP.md). Last updated 2026-06-02.
> Build is **GREEN** at handoff (`npm run build` passes; 539 kB / 139 kB gzip).
> **Phase 1 (the keystone) is ✅ DONE** — see "What's done" + ROADMAP "PHASE 1". Now into the
> parallel tracks (B visuals / A world-gen / C physics).

## TL;DR — where things stand

- The game is a **mobile-browser helicopter water-bomber** (fly, scoop from lakes, drop on
  forest fires). It was **pivoted from a 2D Phaser prototype to real 3D Three.js.**
- **The active build is `src/three/`** (entry: `index.html` → `src/three/main.ts`). The old
  Phaser code (`src/main.ts`, `src/scenes/`, `src/objects/`, `src/controls/`) is **dormant
  but intentionally kept** as a fallback — it's no longer bundled.
- The **3D gameplay loop works end-to-end**: world + chase cam, fly with momentum, manual
  altitude (collective), scoop water by descending the slung bucket into a lake, drop to
  douse fires, wind-biased fire spread, win when all out. Touch controls + keyboard both work.
- **Phase 1 is done** — the `src/three/World.ts` unified heightfield is live; the scoop bug is
  fixed (consistent AGL at every lake), terrain has carved lake basins, flight is AGL with
  weight-coupling, and the camera has a ground guard. **Next: the parallel tracks** (B/A/C).
  See "Next steps".

## ⚠️ Critical gotchas (read before editing)

- **NOT a git repo.** Deletions are permanent (no undo). Prefer additive/reversible changes;
  don't delete a file until its replacement is proven. This is why the dormant Phaser files
  still exist — leave them.
- **`npm run build` is the CI gate** (`tsc --noEmit && vite build`). TypeScript is strict
  with `noUnusedLocals`/`noUnusedParameters` ON — an unused import/var **breaks the build**.
- **`npm run lint` is broken** — there is no ESLint config file in the repo (pre-existing,
  unrelated). Don't rely on it; the build is the gate. (Adding a flat `eslint.config.js` is a
  nice-to-have, not required.)
- **Audio is deliberately removed.** Do not re-add a throttle-revving rotor sound — a heli
  rotor is a constant drone, not a car engine. See the `heli-audio-not-car` memory.
- Two harmless Three.js deprecation warnings in console (`Clock`, shadow map type) — ignore
  or tidy later; not blocking.

## How to run & verify

```bash
npm run dev        # Vite dev server (5173, or 5174 if busy), exposed on LAN for phone testing
npm run build      # CI gate: tsc --noEmit then vite build
npm run typecheck  # just tsc --noEmit
```

**Live verification pattern used this session** (reliable, repeatable):
- `main.ts` exposes a debug hook: `window.__game` with `__game.debug` →
  `{ x, y, z, bucketY, water, firesLeft, lakes:[{x,z,r}], fires:[{x,z}] }`.
- Drive it headless via Playwright MCP: navigate to the dev URL, `mouse.click` the canvas to
  focus, then `keyboard.down/up` (`w/a/s/d` move, `Shift` descend, `Space` drop, `e` drop) or
  click the on-screen buttons; read `__game.debug` to autopilot toward a lake/fire and assert
  state (e.g. water 0→100 on scoop, fires N→N-1 on douse). Take screenshots for visual checks.
- Screenshots from this session live at repo root (`3d-*.png`, `loop-*.png`, `controls-*.png`).

## Architecture & invariants (keep these)

- **Sims are engine-agnostic.** `src/three/sim/*.ts` (HelicopterSim, BucketSim, Wind) import
  only Three's math + `config.ts` — no `Scene`, no DOM. `Game.ts` is the ONLY module that
  touches Three; it reads sim numbers and poses meshes. Physics→visuals signals must stay
  plain numbers/POJOs.
- **`src/three/config.ts` is the single tuning source of truth.** Put new knobs there.
- **Zero binary assets** — all geometry procedural; shaders/GLSL and runtime canvas textures
  are allowed, image/audio files are not.
- **Mobile 60fps:** generation is one-time at load; per-frame work O(1); DPR capped at 2;
  per-fire PointLights are disabled (emissive flames self-light) to avoid shader recompiles.
- **Determinism:** a `WORLD3D.seed` is planned to thread through all generation (Phase 1+).

## File map (active build, `src/three/`)

- `main.ts` — renderer bootstrap, animation loop, `window.__game` hook.
- `Game.ts` — scene graph + per-frame orchestration (the integrator of everything).
- `config.ts` — all tuning (FLIGHT, BUCKET3D, LAKES3D, FIRE3D, WORLD3D, CAMERA).
- `ChaseCamera.ts` — eased follow camera.
- `Input.ts` — keyboard + on-screen touch (joystick + ▲/▼ collective + DROP). `ControlState
  = {moveX,moveZ,lift,drop}`.
- `HUD.ts` — DOM overlay (water bar, fire count, hint, win banner).
- `Fire.ts` / `Lake.ts` — game-logic wrappers owning their meshes.
- `sim/HelicopterSim.ts` — momentum flight integrator; **altitude is currently ABSOLUTE**
  (collective → altVel → clamp [minAltitude,maxAltitude]). Phase 1 makes this AGL.
- `sim/BucketSim.ts` — bucket pendulum: lateral spring-damper (sway/overshoot), **vertical
  near-rigid** (no bounce — per user feedback). Drops emit from bucket XZ.
- `sim/Wind.ts` — meandering/gusting wind; biases fire spread.
- `meshes/*.ts` — procedural factories: helicopter, bucket, lake (flat disc), fire (emissive
  flicker), terrain (sine-sum heightfield), trees (InstancedMesh forest).

## What's done vs not (in 3D)

**Done:** world + chase cam; momentum flight; manual altitude (collective); touch + keyboard
controls; swinging bucket on a rope (lateral sway, rigid vertical); physical-ish scoop
(descend bucket into lake → fill on a timer); drop douses fires in radius; wind-biased fire
spread (capped); DOM HUD; win condition. **Phase 1 (keystone):** `World.ts` unified heightfield
with carved lake basins; **AGL flight** (altitude band rides `flightFloorAt`); **weight-coupling**
(full bucket flies heavy); physical **scoop tip** + soft **rope constraint**; **camera ground
guard**. The old scoop-inconsistency / floor-clipping bug is **fixed**.

**Not done (next, parallel tracks):** Track B visuals (B0 quality tiers + FrameContext → B1
water shader → sky → bloom → particles → terrain shading → foliage), Track A generative world
(A1 noise → A2 biomes → A3 placement → A4 rivers), Track C physics depth (C2 drop dynamics →
C3 fire dynamics + structures-as-stakes → C4 rotor wash → C5 assists). The `World` API is the
stable seam: Track A swaps the height *implementation* behind unchanged signatures.

## Decisions on record

- **3D engine: Three.js** (chosen over Babylon to preserve the hand-rolled flight feel).
- **World scale: Bounded (~1200–1500 units) now, streaming-ready behind the `World` API** for
  the future (a chunk streamer can swap in without rebuilding biomes/rivers/placement).
- **Audio: out for now**, to be redone as a constant rotor drone later (not throttle-tied).

## Next steps — start here

Phase 1 is done (✅). Three tracks now run in parallel behind the stable `World` API (see
[docs/ROADMAP.md](./ROADMAP.md)): **A** generative world (noise → biomes → placement → rivers),
**B** visuals (quality tiers → water shader → sky/time-of-day → bloom+hero lights → particles →
triplanar → foliage), **C** physics (drop momentum → fire dynamics + structures-as-stakes →
rotor wash → assists). Recommended first slices: **B0+B1 (water)** for instant visual payoff,
**A1 (noise)** for the generative leap, **C3 (fire dynamics + stakes)** for gameplay depth.

**Loose end:** the live Playwright camera/visual pass for Phase 1 never ran (MCP browser locked).
Worth a quick screenshot dogfood: confirm water discs sit in visible bowls and the chase cam
never clips a ridge.

## Persistent memory (loaded automatically each session)

Durable facts are stored as memory files (outside the repo) and surface to future agents:
`bucketmyfire-3d-pivot`, `bucketmyfire-roadmap`, `heli-audio-not-car`. The roadmap memory
points back to `docs/ROADMAP.md` as the source of truth.
