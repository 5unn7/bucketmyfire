# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**bucketmyfire** is a mobile-browser helicopter simulator: fly a water-bomber over
northern Saskatchewan, scoop water into a slung Bambi bucket from lakes, and drop it
on forest fires before they spread. It runs entirely client-side — no backend, no
binary art assets (all geometry/textures are procedural).

Design intent: a **real-3D** game with a Forza/GTA chase-cam sensibility, great
generative visuals, and flight/payload physics that *feel real* (momentum, inertia,
a bucket that swings and lags) — all holding 60fps on mobile browsers.

> **The game pivoted from 2D Phaser to real-3D Three.js.** The live game is the
> Three.js build under `src/three/`. The old Phaser tree (`src/main.ts`,
> `src/scenes/`, `src/objects/`, `src/controls/`, `src/constants.ts`) is **legacy
> fallback** — kept (this is not a git repo) but not loaded. `index.html` boots
> `src/three/main.ts`. When working on the game, assume `src/three/` unless told
> otherwise. See `docs/ROADMAP.md` for the approved vision and phase status.

## Commands

```bash
npm run dev        # Vite dev server on :5173, exposed on LAN (test on a real phone)
npm run build      # tsc --noEmit type-gate, then vite build → dist/ (static site)
npm run typecheck  # tsc --noEmit only
npm run preview    # serve the production build locally
npm run lint       # eslint over src/
npm run format     # prettier over src/
```

There is no test runner. `npm run build` is the CI gate — it fails on any type error
because `tsc --noEmit` runs before `vite build`. The strict tsconfig has
`noUnusedLocals`/`noUnusedParameters` on, so unused imports break the build.

To deploy: `npm run build` and host `dist/` on any static host (`base: './'` in
`vite.config.ts` makes it path-independent).

### Verifying behavior (no unit tests)

`src/three/main.ts` hangs a debug handle on `window.__game`; `Game.debug` exposes
read-only flight/world state (`x,y,z,agl,floor,bucketY,water,firesLeft,lakes,fires`).
Drive the heli headless via Playwright and read that hook to assert behavior, and
screenshot for visual phases. This is the project's standing verification approach
(see `docs/ROADMAP.md` → "Verification approach").

## Architecture (the live 3D build, `src/three/`)

Plain Three.js — **no game framework**. `main.ts` owns the `WebGLRenderer` and a
single `setAnimationLoop` that clamps `dt`, samples the quality watchdog, steps
`Game.update(dt)`, and renders. `Game` owns the scene graph and per-frame
orchestration; everything else is a focused module it composes.

```
main.ts (renderer + loop + QualityTier)
  └─ Game.ts (scene graph + per-frame "draw + rules")
       ├─ World.ts ........... heightfield: the single source of ground/water truth
       ├─ sim/ ............... engine-agnostic physics (numbers only, no Three scene/DOM)
       │    ├─ HelicopterSim   momentum flight integrator (the core "feel")
       │    ├─ BucketSim       spring-damped slung-bucket pendulum
       │    └─ Wind            drifting wind vector (biases fire + water)
       ├─ meshes/ ............ procedural geometry (terrain, trees, heli, bucket, lake, fire)
       ├─ water/ ............. shared animated water ShaderMaterial + ripple pool
       ├─ vfx/ ............... pooled GPU Points (water spray)
       ├─ render/ ............ FrameContext (shared uniforms) + QualityTier (adaptive)
       ├─ ChaseCamera.ts ..... trailing follow-cam with ground-clearance guard
       ├─ Input.ts ........... keyboard + touch merged behind read(): ControlState
       ├─ HUD.ts ............. DOM overlay (water bar, fire count, hint, victory)
       ├─ Lake.ts / Fire.ts .. per-instance runtime objects
       └─ config.ts .......... ALL gameplay + visual tuning
```

### `World` is the keystone — read it first

`src/three/World.ts` is the **single source of ground/water truth** (the Phase-1
foundation in the roadmap). It owns **no Three.js objects** — it's pure math over
world-space `(x, z)`. Terrain displacement, lake water planes, the flight floor, and
slope all flow from this one frame of reference, so "descend to scoop" means the same
thing at every lake and a fixed altitude band rides the hills without clipping.

**Locked API — never break these signatures** (a future chunk-streamer is meant to
swap in *behind* them without touching any consumer):

```
groundHeightAt(x,z): number          // base terrain with lake basins carved in
waterLevelAt(x,z): number | null     // flat per-lake water plane Y, else null
isOverWater(x,z): boolean
lakeAt(x,z): LakeRuntime | null
flightFloorAt(x,z): number           // ground+canopyClearance on land; waterLevel+scoopClearance over water
slopeAt(x,z): number                 // gradient magnitude (for fire/biomes later)
```

Each lake's `waterLevel` is sampled **once** (so the plane stays flat); the ground is
then carved into a smoothstepped bowl *below* it, so water sits in a depression, not on
a hump. World generation is **deterministic from `WORLD3D.seed`** via a mulberry32 PRNG.

### The sim boundary (architecture invariant — hold it)

`sim/*.ts` are **engine-agnostic**: they import only Three's math + `config.ts` — no
`Scene`, no DOM. They own only numbers (position, velocity, angles) which `Game.ts`
reads out each frame to pose meshes and the camera. Physics→visuals signals are plain
numbers/POJOs (`agl`, `tip`, `submerged`, water events). `Game.ts` is the **only**
Three-touching gameplay layer. Keep new physics here, not inlined into `Game`.

### Flight model (the core "feel")

`sim/HelicopterSim.ts` integrates velocity **manually** so the aircraft carries
momentum. Helicopter-style steering: the pilot **yaws the nose directly** and applies
variable throttle **along it** (thrust → velocity → drag bleed → hard speed cap), then
the airframe banks into turns and pitches with throttle. The nose does **not** chase
the velocity vector — that's deliberate, it's what keeps the chase camera stable.

Altitude is a **real Y axis** now (the 2D build faked it). Collective is **AGL**: the
altitude band rides `World.flightFloorAt`, so a full descent always bottoms out a fixed
clearance above whatever's below (canopy over land, just-dipping over water). A full
bucket flies **heavy** — `payloadRatio` shaves engine power / top speed / climb rate.

Do **not** replace the integrator with `setVelocity(input * speed)` — that removes the
inertia that is the whole point.

### Bucket physics

`sim/BucketSim.ts` is a 3D spring-damped pendulum slung under the heli on a rope. It
lags in turns, overshoots on stops, sags when full, and obeys a soft max-swing
constraint. **Water leaves the bucket's world XZ, not the heli's** — so a swung bucket
misses, and smooth flying bombs true. `Game` draws the rope as a `THREE.Line` between
heli and bucket each frame.

### Scoop & drop (both physical, no scoop button)

- **Scoop** is purely positional: while the slung bucket's Y is within `dipThreshold`
  of a lake's water level, the bucket fills. The player just descends over a lake.
- **Drop** is the DROP button / E: water drains and douses any fire within `dropRadius`
  of the **bucket's** XZ. A pooled GPU-Points spray (`vfx/WaterSpray.ts`) pours from the
  bucket mouth, and impacts on water spawn ripple rings.

### Fire simulation

`Fire.ts` instances have `intensity` that `grow()`s back when ignored and `douse()`s
down under water (self-destructs at zero). Fires **spread** on a wind-biased timer
(`Game.spreadFires`) — each active fire may spawn a neighbour, never onto water, under
a hard `maxActive` cap. Win = every fire extinguished (`won` latches the sim off).

### Rendering performance system

- `render/QualityTier.ts` — auto-detects a low/med/high preset, then runs an **adaptive
  frame-time watchdog** that steps DOWN a tier under sustained load. Only the cheap,
  **recompile-free** knobs move at runtime (DPR, shadows on/off); load-time fields
  (shadow-map size, water tessellation) are read once at construction.
- `render/FrameContext.ts` — a shared uniform bus (`uTime`, `uWind`, `uSunDir`). Every
  animated material grabs the **same `{ value }` references** in its `onBeforeCompile`,
  so one `update()` per frame propagates to all of them with no per-material plumbing.

**Mobile-60fps invariants** (from the roadmap, enforce them): heavy generation is
one-time at load; per-frame work is O(1); **no shader recompiles after load** (fixed
light pools, fixed-size uniform arrays — e.g. `RIPPLE_SLOTS`, `SPRAY.max`); DPR capped;
quality tiers scale everything.

### Water shader gotcha (logged, will bite you again)

In `water/WaterMaterial.ts` (onBeforeCompile over `MeshStandardMaterial`), patch albedo/
normal at the `<lights_physical_fragment>` chunk, **not** `<lights_fragment_begin>` — the
PBR material struct is built before the latter, so patching there renders white.

### Input

`Input.ts` merges keyboard and on-screen touch behind one `read(): ControlState`
(`turn`, `throttle`, `lift`, `drop`). Touch = bottom-left virtual joystick (turn +
variable throttle) plus a right-hand ▲/▼/DROP cluster, built as pointer-captured DOM
over the canvas. Keyboard = WASD/arrows (steer + throttle), Space/Shift (collective),
E (drop); held keys are scaled below full deflection so desktop feels closer to the
analog stick. Touch overrides keyboard when the stick is engaged.

### Tuning

`src/three/config.ts` is the **single source of gameplay + visual tuning** — `WORLD3D`
(size/seed/basins), `FLIGHT` (power/drag/speed/clearances/payload penalties), `BUCKET3D`,
`LAKES3D`, `FIRE3D`, `QUALITY` presets, `WATER`/`RIPPLE_SLOTS`, `SPRAY`, `CAMERA`. Prefer
changing values here over hard-coding them in modules. (Note: the legacy Phaser build has
its own separate `src/constants.ts` — don't confuse the two.)

## Conventions

- TypeScript strict mode. Y-up world; the craft flies in the XZ plane, altitude along +Y.
  The heli mesh nose points local **+X**; with `group.rotation.y = yaw`, world-forward is
  `(cos yaw, 0, -sin yaw)`. Airframe is posed `rotation.set(bank, yaw, pitch, 'YZX')`.
- **Zero binary assets** — procedural geometry + GLSL (ShaderMaterial / onBeforeCompile)
  + runtime/data textures only. To swap in real art, replace a `meshes/createX()` builder;
  nothing downstream changes.
- **Additive / reversible** — this is *not* a git repo. Prefer new files over rewrites;
  don't delete a thing until its replacement is proven (this is why the Phaser tree lives on).
- `Training/` and `water-b1-beauty.jpeg` hold concept/reference art — **not** game assets.

## Roadmap

`docs/ROADMAP.md` is the approved plan: Phase 1 (unified `World` + AGL flight) and the
B0/B1 visual phases are **done**; remaining work is three parallel tracks — **A** generative
world (noise → biomes → placement → rivers), **B** visuals (atmosphere, fire glow/bloom,
particles, terrain shading, models), **C** physics depth (drop dynamics, fire dynamics +
stakes, rotor wash, assists). World scale is **decided: bounded, streaming-ready behind the
`World` API.** Consult it before starting a new feature so it lands in the right track.
