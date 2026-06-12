# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**bucketmyfire** (bucketmyfire.com) has grown from "a game" into a **wildfire website** built
around a mobile-browser helicopter simulator. Three public surfaces share **one** design
system and ship from **one** static client-side build:

1. **The game** — fly over northern Saskatchewan (and BC/AB/ON), scoop water into a slung Bambi
   bucket from lakes, and fight wildfire before it overruns the towns. Real-3D Three.js
   (`src/three/`), entirely client-side.
2. **A live wildfire tracker** — the front door is a live window onto *real* wildfire across
   Canada (agency-reported active fires, out-of-control count, area burned, satellite hotspots,
   fire weather) sourced from **CIFFC + CWFIS**, with a full Leaflet map overlay
   (`src/three/livefire/`). Keyless public feeds; an honest view, **not** an emergency tool.
3. **The Fireline + merch** — a tribute page (`/fireline/` → `src/halloffame/main.ts`; renamed from "Hall of Fame" 2026-06-12, redirect stub at the old path) honouring
   Canada's wildland firefighters through the documented historic moments (each with a full story page at /fireline/story/?ev=<id>), and a **"Wear the
   fight."** merch funnel to the standalone store at shop.bucketmyfire.com (a separate repo).
   (The old Prepare page + "Field Notes" blog/content engine were RETIRED 2026-06-11.)

Art is **procedural-first** (geometry + GLSL + runtime textures), with a **few licensed
downloaded assets** swapped in behind procedural fallbacks: the glTF helicopters under
`public/models/`, the wildlife glb, the `public/textures/smoke-puff.png` sprite, and the
rotor-audio mp3 — each credited by a `license.txt`/`ATTRIBUTION.txt` beside it. (The old "zero
binary assets" rule has softened to "procedural unless procedural can't get there, then a
credited fallback.")

> **One optional exception to "no backend":** the global leaderboard + the **Open Skies / Living
> Province shared lobby** (`src/three/leaderboard/` + `@supabase/realtime-js`) talk to Supabase
> when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set at build time (see `.env.example` +
> `supabase/schema.sql`). It is **fully env-gated and degrades to an "offline" board / solo flight**
> when unconfigured — the game itself stays 100% client-side, and the local best-score store
> (`missions/progress.ts`) remains authoritative.

Design intent: a **real-3D** game with a Forza/GTA chase-cam sensibility, great
generative visuals, and flight/payload physics that *feel real* (momentum, inertia,
a bucket that swings and lags) — all holding 60fps on mobile browsers.

> **The game pivoted from 2D Phaser to real-3D Three.js.** The live game is the
> Three.js build under `src/three/`. The old Phaser prototype was **removed** once the 3D build
> was proven. **Entry point (changed):** `index.html` now boots **`src/hub.ts`** — the light
> **front-door controller** that paints the marketing/live-data home and lazy-loads the ~1 MB 3D
> game (`src/three/main.ts`) **only** when a play/QA deep-link is present (`?province`, `?ffa`,
> `?m`, `?autostart`, `?qa`, `?editor`, `?dev`, …). A bare URL = the front door. See
> `docs/ROADMAP.md` for the approved game vision; the site/content/front-door work sits in the
> `docs/FRONT-DOOR-PLAN.md` / `docs/CONTENT-STRATEGY.md` / `docs/livefire-honest-window-design.md`
> plans.

> **The game is the open-world "Living Province."** One play mode: an endless fight where dispatch
> calls emerge over a climbing fire-weather curve and you hold the province's towns. It runs as
> **Open Skies** (`?ffa`, shared daily-seed map, ghost pilots, live board), the **Living Province**
> (`?province`, the same shared fight with a dispatch director + onboarding arc), or a private
> **Solo** round (`?solo=1`). See "The Living Province" below.

> **This IS a git repo now** (`main` branch), and **every push to `main` auto-deploys** to
> GitHub Pages via `.github/workflows/deploy.yml` (CI builds → publishes `dist/` to `gh-pages`;
> manual fallback `scripts/deploy.ps1`). It is live at **bucketmyfire.com** (GitHub Pages custom domain).
> Prefer additive changes, but normal git hygiene applies — branch, commit, and don't be afraid
> to delete proven-dead code.

> **Project-specific skills (`.claude/skills/` + the gstack registry).** When the task matches, use
> them: **`bmf-verify`** (headless verification — there's no test runner), **`bmf-tune`** (balance
> values in `config.ts`), **`bmf-asset`** (procedural mesh / pooled VFX / shader / model),
> **`bmf-ui`** (the DOM HUD/menus/front-door glass-cockpit UI), **`bmf-map`** (per-region maps under
> `maps/<region>/`),
> **`bmf-art`** (on-brand image-generation prompts), and **`bmf-mission`** (mission *scenario* data —
> the `MissionDef` shape, the factory archetypes, and the completability oracle the Living Province uses).

## Commands

```bash
npm run dev        # Vite dev server on :5173, exposed on LAN (test on a real phone)
npm run build      # tsc --noEmit type-gate, then vite build → dist/ (multi-page static site)
npm run typecheck  # tsc --noEmit only
npm run preview    # serve the production build locally
npm run verify:campaign  # esbuild-bundle the pure sims → Node; prove every mission is completable
npm run verify     # full pure-Node gate suite (see the list below — 11 gates now)
npm run verify:all # the above + verify:render (the only headless gate; catches broken shaders)
npm run build:legal      # regenerate public/privacy.html + public/terms.html
npm run gen:tokens # regenerate mockups/tokens.css FROM theme.ts — run after ANY token change
npm run verify:tokens    # CI check: mockups/tokens.css is in sync with theme.ts (red ⇒ run gen:tokens)
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

The full pure-Node gate is **`npm run verify`** — now **11** gates: campaign · crash · voice ·
feel · world · coach · **province** · **livefire** · ui · **contrast** · tokens.
**`npm run verify:all`** adds the headless render/shader smoke (`verify:render`). All are wired
into `deploy.yml`, so a red gate blocks the deploy. New since the old list:
**`verify:province`** (the open-world dispatch mode stays winnable), **`verify:livefire`** (the
CIFFC/CWFIS feed normalizers parse the real shapes), **`verify:contrast`** (WCAG-AA on the token
palette). (`verify:content` retired with the Field Notes blog, 2026-06-11.) **`verify:tokens`** fails when
`mockups/tokens.css` has drifted from `theme.ts` — regenerate with **`npm run gen:tokens`** and
commit the result (it is generated; do not hand-edit it).

## The site shell (front door + live-fire + the Fireline) — `src/hub.ts`, `src/site/`

The page that loads is **not** the game — it's a light, crawlable, content-first **front door**.
Keep this layer Three-free: the ~1 MB game bundle must download **only** on a play deep-link.

- **`src/hub.ts`** — the front-door controller `index.html` boots. A bare URL builds the
  glass-cockpit **marketing bento** (positioning hero over the *live* national fire data, an Open
  Skies play tile, the Map card, the "Wear the fight." merch banner, and a Fireline promo).
  It **reuses the in-game home's component system** (`injectKitStyles` /
  `injectHomeStyles` / `home/menus.ts` builders) so the front door and the in-game hub are one
  visual language. Any `GAME_PARAMS` (`?m`,`autostart`,`qa`,`ffa`,`province`,`daily`,`editor`,`dev`,
  `heliview`,`kit`,`tune`) hand straight off to `import('./three/main')`.
- **Multi-page static site** (`vite.config.ts` `rollupOptions.input`): `index.html → src/hub.ts`,
  `campaign/index.html → src/campaign/main.ts`, `open-skies/index.html → src/openskies/main.ts`,
  `fireline/index.html → src/halloffame/main.ts`, `fireline/story/index.html → src/halloffame/story.ts`. Plus the generated legal pages
  (`public/privacy.html`, `public/terms.html`, via `npm run build:legal`). Each page is light +
  crawlable and lazy-loads the game only on a play link.
- **`src/site/siteNav.mjs` is THE single source of site chrome** — appbar, mobile tab bar,
  breadcrumb, footer brand, and the `NAV` list (Home · Campaign · Fireline · Map · Shop).
  It is **zero-import plain ESM** so BOTH worlds consume it: the Vite-bundled
  TS front door (`src/site/{frontShell,shell}.ts`, `hub.ts`) imports it, and
  the **Node-run legal renderer** (`scripts/content/legal.mjs`) imports it at build time and inlines
  its CSS. Add a nav item **here** — nowhere else — or the two worlds drift.
- **Live-fire (`src/three/livefire/`)** — the CIFFC + CWFIS data layer (keyless, CORS-`*` public
  feeds): `client.ts` (fetch), `normalize.ts` (parse to POJOs), `fields.ts`/`types.ts`/`strings.ts`,
  and `FireMap.ts` (the lazy Leaflet map with layer toggles + smoke scrubber + detail sheet). It
  hydrates BOTH the front-door national-data grid (`hub.ts hydrateNational`) **and** the full Map
  overlay (`openLiveFires`). When both authoritative feeds are down it shows an **honest fallback**
  ("live data unavailable → official sources"), never "no fires".
- **The Fireline (`fireline/` → `src/halloffame/main.ts` + `story.ts`, data `events.ts`)** — the tribute page: eleven documented
  moments from Canada's wildfire history (1825 Miramichi → the 2023 record season) on an ember-spine
  timeline, honouring the crews/pilots/lookouts/dispatchers as a whole, closing with a "Fly with
  them" hand-off into Open Skies. **The backbone rule survives the blog it came from:** every fact
  on this page is drawn from the public record (NRCan, CIFFC, Public Safety Canada, provincial
  governments, CBC archives) — keep figures conservative ("~", "more than") and NEVER invent people
  or deeds. (The Prepare page, readiness checklist, Field Notes blog and its content engine were
  retired 2026-06-11; `scripts/content/legal.mjs` survives as the legal-page generator, and the
  static `public/sitemap.xml` replaced the blog-generated one.)

## Architecture (the live 3D build, `src/three/`)

Plain Three.js — **no game framework**. `main.ts` owns the `WebGLRenderer` and a
single `setAnimationLoop` that clamps `dt`, samples the quality watchdog, steps
`Game.update(dt)`, and renders. `Game` owns the scene graph and per-frame
orchestration; everything else is a focused module it composes.

```
main.ts (renderer + loop + QualityTier + Composer + campaign router)
  └─ Game.ts (scene graph + per-frame "draw + rules")
       ├─ World.ts ........... heightfield: single source of ground/water truth (rectangular, province-masked)
       ├─ world/ ............. generation: noise, biomes, placement, minimap, names
       ├─ maps/ ............. per-region SOURCE OF TRUTH (data): region geo/terrain/missions/card + registry
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
       ├─ province/ .......... the GAME MODE: open-world dispatch (buildProvince · ProvinceMode · DispatchDirector · career · OnboardingScript)
       ├─ missions/ .......... scenario plumbing (types/scenario/runtime/director) + freeforall + factory/ + oracle; catalog assembles 0 campaign missions now
       ├─ livefire/ .......... CIFFC+CWFIS real-data layer (client/normalize/fields) + the Leaflet FireMap (shared with the front door)
       ├─ leaderboard/ ....... env-gated Supabase client (plain fetch) + cloudSave; Open Skies adds a realtime shared lobby
       ├─ ui/ ................ HUD, home hub, onboarding/coach, leaderboard, profile/picker (the same builders the front door reuses)
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
groundHeightAt(x,z): number          // base terrain with lake basins carved in (+ off-province falloff on bounds maps)
waterLevelAt(x,z): number | null     // flat per-lake water plane Y, else null
isOverWater(x,z): boolean
lakeAt(x,z): LakeRuntime | null
flightFloorAt(x,z): number           // ground+canopyClearance on land; waterLevel+scoopClearance over water
slopeAt(x,z): number                 // gradient magnitude (for fire/biomes later)
```

Each lake's `waterLevel` is sampled **once** (so the plane stays flat); the ground is
then carved into a smoothstepped bowl *below* it, so water sits in a depression, not on
a hump. World generation is **deterministic from `WORLD3D.seed`** via a mulberry32 PRNG.

**The world is RECTANGULAR + true-shape now** (the maps-foundation slices). `World` carries
`sizeX`/`sizeZ` (≠ on a true-shape map; `size` = the bounding square for square-grid consumers). A region
whose geo declares `fit:'bounds'` (currently **Saskatchewan**, ~1029×1996u) is masked to the real province
outline: `groundHeightAt`/`flightFloorAt` fall off to `MAPGEO.offProvinceLevel` across `MAPGEO.outlineBlendBand`
straddling the projected outline, so the visible land edge traces the trapezoid (beyond = off-province
lowland + fog, no ocean, no hard wall). Additive read-only queries (the locked API is unchanged): `isInProvince(x,z,margin?)`,
`isScoopWaterWithin(x,z,range)`, `provinceOutline()`. Square/procedural maps are byte-identical (the mask is
gated on `fit==='bounds'`). Engine-decided SIZE: a bounds map's extent = its real bbox at a constant
`MAPGEO.unitsPerKm`, clamped to `[worldSizeMin, worldSizeMax]`.

### Maps are data — `src/three/maps/` is the per-region source of truth

A map is a self-contained `src/three/maps/<region>/` module (`region` geo/anchors/lakes/names, optional
`terrain` profile + `card`), resolved through `maps/registry.ts`
(`getMap`/`getRegion`/`getTerrainProfile`/`mapCards`/`allMissions`/`missionById`). `World(seed, {regionId, …})`
grows the chosen region. **Four regions ship now:** `saskatchewan` (the primary, true-shape `fit:'bounds'`
playfield, with `terrain` + `card`), plus `british-columbia`, `alberta`, and `ontario` (geography fleshed
out to varying depth). **The old `world/regions.ts` + `world/terrainProfile.ts` + `world/maps/saskatchewan-true.ts`
are DELETED** — do not reference them; add a map under `maps/`, not to those. See the `bmf-map` skill.

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
World fields are injected as callbacks, it never imports `World`). A **rectangular** grid (`nx×nz` at a
CONSTANT cell size `CELL_U=13.125u` via the shared `fireGridFor(sizeX,sizeZ)`, capped by `FIRE3D.maxCells`,
so the fire game is scale-INVARIANT — square SK stays 160×160 byte-identical, true-shape SK is 78×152) of
cells each hold `fuel` (sampled once from `world.fuelAt` → forest burns, rock/water/road don't) and live `heat`; a
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

### The Living Province (the game) — `src/three/province/`

The game's one mode is an endless open-world fight over a seeded `World`.
`province/buildProvince.ts` (`isProvinceId`) assembles the scenario; `ProvinceMode` +
`DispatchDirector.ts` emit dispatch calls over a climbing fire-weather curve while you hold the
province's towns; `career.ts` (`isOnboarded`) gates a new pilot's guided first shift
(`OnboardingScript.ts`, `?onboard=1/0`). `main.ts` routes it three ways (each reloads to (re)boot;
RETRY rebuilds a Game in place, no full reload):

- **`?province`** — the Living Province: shared daily seed (fair board + ghost pilots) + the dispatch
  director + onboarding. `?region=<id>` picks the map (default Saskatchewan).
- **`?ffa`** — **Open Skies**, the endless free-for-all on the same daily-seeded map
  (`missions/freeforall.ts` `buildFreeForAll`/`isFfaId`): live shared lobby, ghost pilots, personal
  score, re-enterable anytime, always boots in flight.
- **`?solo=1`** — a PRIVATE round of the dispatch (no ghosts, no shared board) for a picked map.

A nameless pilot hitting any of these deep links registers a callsign first (`bootNamed`) — it's what
the board flies under. `missions/progress.ts` persists best score to localStorage.

**`missions/` is the shared scenario engine the province builds on.** A `MissionDef`
(`missions/types.ts`) is **pure SCENARIO data** (seed + placements + win/lose; `config.ts` `MISSIONS`
holds the mechanic VALUES); `missions/scenario.ts` resolves specs against the seeded `World` and feeds
a per-frame `MissionSignals` snapshot to `missions/MissionRuntime.ts` (latches objectives + fails).
`missions/oracle.ts` is the engine-agnostic "perfect player" trust anchor, and `missions/factory/`
(`archetypes.ts` parametric templates · `generateMission` · `MapContext.ts`) deterministically
produces `MissionDef`s; `verify:campaign` + `verify:province` prove completability OFFLINE across
seeds — never run the oracle on a phone. `missions/catalog.ts` exports `CAMPAIGN = allMissions()`,
which is empty today (no map ships hand-authored missions), so a `?m=<id>` deep-link or `?autostart`
falls through to the province — old bookmarks + the headless QA harness still land on a live game.

**3 helicopters are playable** (`meshes/heliModels.ts` registry + `ui/profile.ts` picker; physics is
shared; unlock via career points OR spending wallet points). Audio is `audio/HeliAudio.ts` (a recorded
rotor loop + procedural scoop/drop/win SFX). The optional global leaderboard (`leaderboard/`) posts
scores to Supabase via env-gated plain `fetch` and degrades to "offline" when unconfigured; Open Skies
adds a `@supabase/realtime-js` shared lobby for ghost pilots.

### Input

`Input.ts` merges keyboard and on-screen touch behind one `read(): ControlState`
(`turn`, `throttle`, `lift`, `drop`). Touch = bottom-left virtual joystick (turn +
variable throttle) plus a right-hand ▲/▼/DROP cluster, built as pointer-captured DOM
over the canvas. Keyboard = WASD/arrows (steer + throttle), Space/Shift (collective),
E (drop); held keys are scaled below full deflection so desktop feels closer to the
analog stick. Touch overrides keyboard when the stick is engaged.

### Tuning

`src/three/config.ts` is the **single source of gameplay + visual tuning** — ~30 blocks now:
`WORLD3D`/`MAPGEO` (world size + true-shape mask: `unitsPerKm`, `worldSizeMin/Max`, `outlineBlendBand`,
`offProvinceLevel`)/`TERRAIN`/`LAKE_SHAPE`/`STREAM`/`BIOMES` (world gen), `FLIGHT`/`WASH`/`BUCKET3D`
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
  `src/three/ui/theme.ts` — the machine source: the `UI` palette + the `HOME`/`BOARD`/`GRADE` ramps +
  `FS`/`FW`/`R` scales, plus shared `el`/`div`/`setBlur`/`anchor`/`frosted` helpers.
  `src/three/ui/tokens.ts` (`tokenDecls`/`tokenBlock`) is the **derived CSS-custom-property layer**
  built FROM those consts: the live UI injects it (`.bmf-app` via `home/styles.ts`; `:root` globally
  via the kit `components/base.ts` `injectKitStyles`), and `npm run gen:tokens` writes the same vars
  to `mockups/tokens.css` (mockups `@import` it; `verify:tokens` guards drift). Above tokens sits the
  component kit (`ui/components/`) — the **one button of record** is `.btn` (defined in
  `injectKitStyles`, emitted by `makeButton()`; no round pills). The prose system — colour/state
  semantics, type scale, motion, the button system, anti-patterns — lives in **`DESIGN.md`** at the
  repo root; read it before any visual/UI change. Never add a second `UI` token object, **never
  hand-mirror a token value** (consume `theme.ts`/`tokens.ts`), and never hard-code a
  colour/blur/shadow in a module — add it to `theme.ts` (then `gen:tokens`).
- **No-scroll, single-viewport UI (hard rule).** The game is a fixed-viewport app, not a scrolling
  web page — **the page itself must never scroll.** Lock the app surface to the viewport
  (`100dvh`/`100svh`, body non-scrolling) and size every screen / menu / overlay to fit *above* the
  fixed bottom rail + HUD. Design menus to **fit, not flow**: compress, use carousels, or paginate.
  A bounded inner scroll region is permitted **only** for a genuinely long list (mission select,
  leaderboard) and never for primary hub screens (home, title, briefing, debrief, settings) — those
  always fit on a phone with zero scroll. Treat "user has to scroll to reach an action" as a bug.

## Roadmap

`docs/ROADMAP.md` is the approved plan and is **largely shipped**: Phase 1 (unified `World` + AGL
flight), Track **A** (noise → biomes → placement → rivers), Track **B** (water, atmosphere, bloom,
smoke/embers, terrain shading, models/foliage + tree LOD), Track **C** (fire dynamics + stakes,
fire size classes, rotor wash + ground effect), and Track **D** (the campaign work, which delivered
the C6 fuel/range model now carried by the Living Province) are all marked **done**.
Remaining/optional: C5 assists,
C6 forward fuel caches, SSAO, and a few polish items — check the roadmap's status markers before
starting.

**Beyond the roadmap — the maps-foundation + factory slices (2026-06, shipped & live):** the world is no
longer a fixed 2100u square. Slice 1 made the engine **scale-invariant** (rectangular fire grid via
`fireGridFor`, km-authored placements, engine-decided size, `missions/oracle.ts`); Slice 2 **flipped
Saskatchewan to its true province shape** (`geo.fit:'bounds'`, ~1029×1996u, outline-masked); Slice 3 added
the **mission factory** (`missions/factory/`). The canonical record is in the spec
`~/.claude/plans/mutable-inventing-trinket.md` and the auto-memory `map-foundation-and-mission-factory`.

**Beyond that — the product is now a wildfire *website* (the last few days, mostly uncommitted on `main`):**
(1) **Living Province** — one open-world mode (`province/` + Open Skies / Solo), where the fires keep coming.
(2) **Front door** — `index.html` boots `src/hub.ts`, a content-first marketing/live-data home that lazy-loads
the game; a multi-page static site (Home/Campaign/Open Skies/Fireline) shares one nav source
(`src/site/siteNav.mjs`). (3) **Live wildfire tracker** — `src/three/livefire/` surfaces real CIFFC + CWFIS
data on the front door and a Leaflet map. (4) **The Fireline** — `/fireline/`, the tribute timeline that
REPLACED the Prepare surface + the "Field Notes" blog/content engine (both retired 2026-06-11).
(5) **"Wear the fight." merch funnel**
to the standalone store at shop.bucketmyfire.com. These are tracked in `docs/FRONT-DOOR-PLAN.md`,
`docs/FREE-FOR-ALL.md`, `docs/livefire-honest-window-design.md`, and the
`MEMORY.md` auto-memory index.
(Live Playwright visual passes remain "pending" — the MCP browser was repeatedly locked; see the
**`bmf-verify`** skill for how to verify live anyway.)

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules (gstack):
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

Project skills (bucketmyfire-specific — see "Project-specific skills" above):
- Verify a `src/three/` change (no test runner) → invoke /bmf-verify
- Balance/tune a gameplay or visual value in `config.ts` → invoke /bmf-tune
- Build/refine the DOM HUD / menus / front-door UI → invoke /bmf-ui
- Add/polish a per-region map under `maps/<region>/` → invoke /bmf-map
- Write an on-brand image-generation prompt → invoke /bmf-art
- Add a procedural mesh / pooled VFX / shader / model → invoke /bmf-asset
- Author/edit a mission *scenario* (the `MissionDef` machinery the province uses) → invoke /bmf-mission

Deploy caveat: every push to `main` auto-deploys to prod (GitHub Pages). Treat /ship and any
`git push` as outward-facing — confirm before pushing, since it goes live immediately.
