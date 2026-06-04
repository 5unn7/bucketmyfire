# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**bucketmyfire** is a mobile-browser helicopter simulator: fly a water-bomber over
northern Saskatchewan, scoop water into a slung Bambi bucket from lakes, and drop it
on forest fires before they spread. It runs entirely client-side — no backend. Art is
**procedural-first** (geometry + GLSL + runtime textures), with a **few licensed downloaded
assets** swapped in behind procedural fallbacks: the glTF helicopters under `public/models/`,
the wildlife glb, the `public/textures/smoke-puff.png` sprite, and the rotor-audio mp3 — each
credited by a `license.txt`/`ATTRIBUTION.txt` beside it. (The old "zero binary assets" rule has
softened to "procedural unless procedural can't get there, then a credited fallback.")

> **One optional exception to "no backend":** the global leaderboard
> (`src/three/leaderboard/`) talks to Supabase via plain `fetch` (no SDK) when
> `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set at build time (see
> `.env.example` + `supabase/schema.sql`). It is **fully env-gated and degrades to an
> "offline" board** when unconfigured — the game itself stays 100% client-side, and the
> local best-score store (`missions/progress.ts`) remains authoritative for unlocks.

Design intent: a **real-3D** game with a Forza/GTA chase-cam sensibility, great
generative visuals, and flight/payload physics that *feel real* (momentum, inertia,
a bucket that swings and lags) — all holding 60fps on mobile browsers.

> **The game pivoted from 2D Phaser to real-3D Three.js.** The live game is the
> Three.js build under `src/three/`. The old Phaser prototype (`src/main.ts`,
> `src/scenes/`, `src/objects/`, `src/controls/`, `src/constants.ts`) and the
> `phaser` dependency were **removed** once the 3D build was proven — `src/` is now
> just `three/` + `vite-env.d.ts`. `index.html` boots `src/three/main.ts`. See
> `docs/ROADMAP.md` for the approved vision and phase status.

> **This IS a git repo now** (`main` branch), and **every push to `main` auto-deploys** to
> GitHub Pages via `.github/workflows/deploy.yml` (CI builds → publishes `dist/` to `gh-pages`;
> manual fallback `scripts/deploy.ps1`). The game is live at **5unn7.github.io/bucketmyfire**.
> Prefer additive changes, but normal git hygiene applies — branch, commit, and don't be afraid
> to delete proven-dead code.

> **Project-specific skills live in `.claude/skills/`.** When the task matches, use them:
> **`bmf-verify`** (headless verification — there's no test runner), **`bmf-mission`** (author a
> campaign mission), **`bmf-tune`** (balance values in `config.ts`), **`bmf-asset`** (add a
> procedural mesh / pooled VFX / shader / model).

## Commands

```bash
npm run dev        # Vite dev server on :5173, exposed on LAN (test on a real phone)
npm run build      # tsc --noEmit type-gate, then vite build → dist/ (static site)
npm run typecheck  # tsc --noEmit only
npm run preview    # serve the production build locally
npm run verify:campaign  # esbuild-bundle the pure sims → Node; prove every mission is completable
npm run lint       # eslint over src/
npm run format     # prettier over src/
```

There is no test runner. `npm run build` is the CI gate — it fails on any type error
because `tsc --noEmit` runs before `vite build`. The strict tsconfig has
`noUnusedLocals`/`noUnusedParameters` on, so unused imports break the build.

To deploy: `npm run build` and host `dist/` on any static host (`base: './'` in
`vite.config.ts` makes it path-independent).

### Verifying behavior (no unit tests) — see the `bmf-verify` skill

Three escalating levels (use the cheapest that catches your bug class):

1. **`npm run build`** — type gate only. It will happily ship a broken GLSL shader.
2. **Pure-sim Node assertions** — `sim/*.ts` are engine-agnostic, so bundle them with esbuild and
   assert the numbers in Node (no browser). `npm run verify:campaign` is the worked example
   (`scripts/verify-campaign.ts`): it runs a deterministic "perfect player" through every mission.
   Best for flight/bucket/fire/fuel/crew logic and determinism from `WORLD3D.seed`.
3. **Live headless** — the only way to catch shader-compile errors (they pass the build). `main.ts`
   hangs a debug handle on `window.__game`, but it's now **gated**: present only when
   `import.meta.env.DEV || ?qa`. So `npm run dev` exposes it always; a `vite preview`/prod build
   needs **`?qa`** on the URL. `__game.debug` is read-only state (`x,y,z,agl,floor,bucketY,water,
   firesLeft,burnedOut,lakes,fires[]`); `__game.fireSystem.igniteAt(...)` and
   `__game.heliSim.position` (teleport) drive it. URL router: `?autostart`, `?m=<missionId>`.
   `scripts/shot.mjs` is a full screenshot example. The **`bmf-verify`** skill documents the
   "MCP Playwright browser is locked" workaround (vite preview + temp `playwright-core`).

## Architecture (the live 3D build, `src/three/`)

Plain Three.js — **no game framework**. `main.ts` owns the `WebGLRenderer` and a
single `setAnimationLoop` that clamps `dt`, samples the quality watchdog, steps
`Game.update(dt)`, and renders. `Game` owns the scene graph and per-frame
orchestration; everything else is a focused module it composes.

```
main.ts (renderer + loop + QualityTier + Composer + campaign router)
  └─ Game.ts (scene graph + per-frame "draw + rules")
       ├─ World.ts ........... heightfield: the single source of ground/water truth
       ├─ world/ ............. generation: noise, biomes, placement, minimap, names
       ├─ sim/ ............... engine-agnostic physics (numbers only, no Three scene/DOM)
       │    ├─ HelicopterSim   momentum flight integrator (the core "feel")
       │    ├─ BucketSim       spring-damped slung-bucket pendulum
       │    ├─ FireSystem      cellular fire FIELD (spread/burn-out/re-flare/scorch)
       │    ├─ Structures      cabins/depot with health (the stakes / lose condition)
       │    ├─ FuelSim         thrust+payload-metered range model (refuel at depot)
       │    ├─ CrewTransport   slung crew/cargo insertion + evacuation
       │    ├─ RotorWash       AGL → downwash + ground-effect signals
       │    └─ Wind            drifting wind vector (biases fire + water)
       ├─ meshes/ ............ procedural geometry (terrain, trees, heli, bucket, lake, fire, cabin…)
       ├─ water/ ............. shared animated water ShaderMaterial + ripple pool
       ├─ vfx/ ............... pooled GPU Points (water spray, smoke plumes, embers)
       ├─ sky/ ............... camera-following sky dome + time-of-day presets
       ├─ postfx/ ............ EffectComposer: bloom, god-rays, heat-haze, color grade
       ├─ lighting/ .......... pooled hero fire point-lights (no recompiles)
       ├─ render/ ............ FrameContext (shared uniforms) + QualityTier + FireFieldTexture
       ├─ missions/ .......... data-driven MissionDef catalog + runtime + director + progress
       ├─ leaderboard/ ....... env-gated Supabase PostgREST client (plain fetch, RLS)
       ├─ ui/ ................ HUD, MissionSelect menu, onboarding, leaderboard, profile/picker
       ├─ audio/ ............. HeliAudio (recorded rotor loop + procedural SFX)
       ├─ ChaseCamera.ts ..... trailing follow-cam with ground-clearance guard + free-look
       ├─ Input.ts ........... keyboard + touch merged behind read(): ControlState
       └─ config.ts .......... ALL gameplay + visual tuning (see the bmf-tune skill)
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

Fire is a **cellular FIELD**, not a handful of objects (`sim/FireSystem.ts`, engine-agnostic —
World fields are injected as callbacks, it never imports `World`). A fixed grid of cells each hold
`fuel` (sampled once from `world.fuelAt` → forest burns, rock/water/road don't) and live `heat`; a
burning cell **pre-heats neighbours** weighted by wind + slope + fuel, so an advancing **front**
creeps, runs downwind, climbs uphill, and **stalls at firebreaks** (doused ground stays wet for a
cooldown). Each fire carries a `size` 0..1 that **grows** while it burns and only **spots** new
fires once established; dousing knocks down intensity **and** size, so a big blaze **re-flares**
and needs several passes (`killSize`). The ≤`maxActive` flame **meshes** are a pooled view of the
hottest cell clusters (built once, no runtime add/remove). The field is packed into a DataTexture
each frame (`render/FireFieldTexture.ts`) that drives terrain char + ember glow + the radar scar.
Fires also ignite **trees** and panic **fauna**, and damage **`sim/Structures.ts`** within
`threatRadius` — **lose** when every structure is destroyed. **Win** = every fire out (water kills
score more than natural burn-outs). All of this is `FIRE3D`/`STRUCTURES` in `config.ts`.

### Rendering performance system

- `render/QualityTier.ts` — auto-detects a low/med/high preset that fixes **scene complexity**
  at load (shadows, tessellation, post-fx). Render **resolution (DPR)** is a separate,
  **recompile-free** lever: an **adaptive frame-time watchdog** scales DPR DOWN under sustained
  load and back UP under headroom (within `[QUALITY.dpr.floor .. dprCap]`), so a transient stall
  can't strand the device at a permanently blurry resolution. `main.ts` re-applies each DPR change
  to the renderer + composer; load-time fields (shadow-map size, water tessellation) are read once
  at construction.
- `render/FrameContext.ts` — a shared uniform bus (`uTime`, `uWind`, `uSunDir`, `uWash`). Every
  animated material grabs the **same `{ value }` references** in its `onBeforeCompile`,
  so one `update()` per frame propagates to all of them with no per-material plumbing.
- `postfx/Composer.ts` — the main loop renders **through** an EffectComposer (bloom → god-rays →
  heat-haze → tonemap/color-grade), tier-gated (off on low → bare renderer; on for med/high at the
  renderer's full DPR, with MSAA on high; chosen once at load — the scene is **not** rendered
  half-res). `lighting/HeroFireLights.ts` is a **fixed pool** of point-lights repositioned onto the
  hottest fires each frame (never added/removed → no recompiles).

**Mobile-60fps invariants** (from the roadmap, enforce them): heavy generation is
one-time at load; per-frame work is O(1); **no shader recompiles after load** (fixed
light pools, fixed-size uniform arrays — e.g. `RIPPLE_SLOTS`, `SPRAY.max`); DPR is the one
adaptive runtime lever (capped at 2, recoverable); quality tiers scale everything else.

### Water shader gotcha (logged, will bite you again)

In `water/WaterMaterial.ts` (onBeforeCompile over `MeshStandardMaterial`), patch albedo/
normal at the `<lights_physical_fragment>` chunk, **not** `<lights_fragment_begin>` — the
PBR material struct is built before the latter, so patching there renders white.

### Missions & campaign (see the `bmf-mission` skill)

A **10-mission linear-unlock campaign** sits on top of the sandbox. A `MissionDef`
(`missions/types.ts`, `missions/catalog.ts`) is **pure SCENARIO data** (seed, where the fires/
crews/structures sit, win/lose) — `config.ts` `MISSIONS` holds the mechanic VALUES. `Game` resolves
a def's placement specs against the seeded `World` (`missions/scenario.ts`) and feeds a per-frame
`MissionSignals` snapshot to `missions/MissionRuntime.ts`, which latches objectives (`extinguishAll`/
`extinguishCount`/`deliver`/`evacuate`/`survive`) and fails (`protect`/`timeout`/`fuelOut`).
`missions/MissionDirector.ts` runs the reactive radio-comms/ignite/wind **beats**. `main.ts` routes
`?m=<id>` / the `MissionSelect` menu; **switching a mission is a page reload** (no Three.js
teardown). `missions/progress.ts` persists unlock + best score to localStorage and is authoritative
for unlocks. **3 helicopters are playable** (`meshes/heliModels.ts` registry + `ui/profile.ts`
picker; physics is shared). Audio is `audio/HeliAudio.ts` (a recorded rotor loop + procedural
scoop/drop/win SFX). The optional global leaderboard (`leaderboard/`) posts scores to Supabase via
env-gated plain `fetch` and degrades to "offline" when unconfigured.

### Input

`Input.ts` merges keyboard and on-screen touch behind one `read(): ControlState`
(`turn`, `throttle`, `lift`, `drop`). Touch = bottom-left virtual joystick (turn +
variable throttle) plus a right-hand ▲/▼/DROP cluster, built as pointer-captured DOM
over the canvas. Keyboard = WASD/arrows (steer + throttle), Space/Shift (collective),
E (drop); held keys are scaled below full deflection so desktop feels closer to the
analog stick. Touch overrides keyboard when the stick is engaged.

### Tuning

`src/three/config.ts` is the **single source of gameplay + visual tuning** — ~30 blocks now:
`WORLD3D`/`TERRAIN`/`LAKE_SHAPE`/`STREAM`/`BIOMES` (world gen), `FLIGHT`/`WASH`/`BUCKET3D`
(physics feel), `FIRE3D`/`STRUCTURES`/`COMMUNITIES`/`ROADS` (fire + map), `MISSIONS`/`SCORE`
(campaign mechanics + scoring), `QUALITY`/`POSTFX`/`GODRAYS`/`GRADE`/`FIRELIGHT`/`EMBERS`/`WATER`/
`CLOUDS`/`SPRAY`/`SMOKE`/`HAZE` (visuals), `AUDIO`, `CAMERA`, `FAUNA`, `INSTRUMENTS`. Prefer
changing values here over hard-coding them in modules — the **`bmf-tune`** skill maps "change X" to
the right block.

## Conventions

- TypeScript strict mode. Y-up world; the craft flies in the XZ plane, altitude along +Y.
  The heli mesh nose points local **+X**; with `group.rotation.y = yaw`, world-forward is
  `(cos yaw, 0, -sin yaw)`. Airframe is posed `rotation.set(bank, yaw, pitch, 'YZX')`.
- **Procedural-first art** — geometry + GLSL (ShaderMaterial / onBeforeCompile) + runtime/data
  textures. A *few* licensed downloaded assets exist (glTF helis/wildlife, smoke sprite, rotor mp3)
  swapped in **behind a procedural fallback** and credited by a `license.txt`/`ATTRIBUTION.txt`
  beside the file under `public/`. Build procedural unless it truly can't reach the look; then add
  a credited fallback. To swap in real art, replace a `meshes/createX()` builder — nothing
  downstream changes. See the **`bmf-asset`** skill.
- **Additive but git-backed** — this *is* a git repo (auto-deploys on push to `main`). Prefer new
  files over risky rewrites and don't delete until a replacement is proven, but use normal git
  hygiene (branch, commit), and don't be afraid to delete proven-dead code (the legacy Phaser tree
  was removed this way once the 3D build was solid).
- `Training/` and `water-b1-beauty.jpeg` hold concept/reference art — **not** game assets.
- **DOM UI = one design system.** All HUD / menu / overlay styling reads tokens from
  `src/three/ui/theme.ts` (the single `UI` palette + shared `el`/`div`/`setBlur`/`anchor`/`frosted`
  helpers). The prose system — colour/state semantics, type scale, motion, anti-patterns — lives in
  **`DESIGN.md`** at the repo root; read it before any visual/UI change. Never add a second `UI`
  token object or hard-code a colour/blur/shadow in a module; add a token to `theme.ts` instead.

## Roadmap

`docs/ROADMAP.md` is the approved plan and is **largely shipped**: Phase 1 (unified `World` + AGL
flight), Track **A** (noise → biomes → placement → rivers), Track **B** (water, atmosphere, bloom,
smoke/embers, terrain shading, models/foliage + tree LOD), Track **C** (fire dynamics + stakes,
fire size classes, rotor wash + ground effect), and Track **D** (the 10-mission campaign, which
also realized the C6 fuel/range model) are all marked **done**. Remaining/optional: C5 assists,
C6 forward fuel caches, SSAO, and a few polish items — check the roadmap's status markers before
starting. World scale is **decided: bounded ~1500u, streaming-ready behind the `World` API.**
Consult it so a new feature lands in the right track. (Live Playwright visual passes are noted as
"pending" on several phases — the MCP browser was repeatedly locked; see the **`bmf-verify`** skill
for how to verify live anyway.)
