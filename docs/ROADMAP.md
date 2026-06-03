# bucketmyfire — Vision Roadmap

> Generative mathematical world · great visuals · physics that feels real.
> A Forza/GTA sensibility on a mobile-browser, zero-asset, 60fps Three.js game.

## Context — why this roadmap exists

The game pivoted from a 2D Phaser prototype to a real-3D Three.js build (`src/three/`),
keeping the validated hand-rolled flight + bucket-pendulum feel. The 3D gameplay loop
works (fly, scoop, drop, douse, win). But a structural flaw surfaced: **terrain, lakes,
and altitude don't share a frame of reference.** Terrain undulates (a height function);
lakes are flat discs placed *on top*; flight floor + scoop trigger use *absolute world-Y*
constants. So "descend to scoop" means something different at every lake, and a fixed
altitude floor clips hills. That's not a tuning bug — it's a missing abstraction.

The fix is the keystone of the whole vision: **one unified heightfield** that everything
reads from. Once it exists, the generative world, the visuals, and the deeper physics all
layer on top of a stable contract. This roadmap is organized as **one foundation phase**
followed by **three parallel tracks** (World, Visuals, Physics).

## Architecture invariants (hold across every phase)

- **Sims stay engine-agnostic.** `sim/*.ts` import only Three's math + `config.ts` — no
  `Scene`, no DOM. Physics→visuals signals are plain numbers/POJOs (`scoopTilt`,
  `submerged`, `agl`, `WaterEvents`, `RotorWash`, per-fire `{intensity,heat}`), read by
  `Game.ts` (the only Three-touching layer).
- **`config.ts` is the single tuning source of truth** (per CLAUDE.md). New blocks, not
  scattered magic numbers.
- **Determinism via one seed.** A `WORLD3D.seed` threads through noise, hydrology, biomes,
  placement, wind, and fire RNG. Same seed → same world + same fire run.
- **Mobile 60fps throughline.** Heavy generation is one-time at load; per-frame work stays
  O(1). No shader recompiles after load (fixed light pools, fixed uniform arrays). DPR is
  the one adaptive runtime lever (capped at 2, recoverable). Quality tiers scale everything else.
- **Zero binary assets.** Procedural geometry + GLSL (ShaderMaterial / onBeforeCompile) +
  runtime canvas/data textures only.
- **Additive / reversible** (not a git repo): new files over rewrites; nothing deleted
  until its replacement is proven.

---

## PHASE 1 — Foundation: Unified World + AGL flight (fixes the scoop bug) — ✅ DONE (2026-06-02)

The keystone. Pure refactor of the *frame of reference* — no noise/visual change yet, so
it regresses cleanly against current screenshots.

**Shipped:** `src/three/World.ts` (the locked API below, pure math, no Three objects);
terrain displaces from `world.groundHeightAt` with carved basins; AGL flight band that rides
`flightFloorAt` + weight-coupling; physical scoop tip + soft rope constraint in `BucketSim`;
camera ground-clearance guard; `Game.ts` fully rewired onto `World`; `config.ts` blocks added
(`WORLD3D` seed/basins, `FLIGHT` clearances/payload, `CAMERA.minGroundClearance`, `BUCKET3D`
scoop-tip/rope). **Verified** (headless, pure-math): scoop AGL + submersion depth identical at
all 4 lakes; basins are real bowls (5u bed, raised bank); floor rides hills at constant 8u
clearance; deterministic from seed. `npm run build` green. *(Live Playwright camera/visual pass
still pending — MCP browser was locked that session.)*

**New `src/three/World.ts`** — single source of ground/water truth (pure math, owns no
Three objects). Lock this API now and never break it:
```
groundHeightAt(x,z): number          // base terrain with lake basins carved in
waterLevelAt(x,z): number | null     // flat per-lake water plane Y, else null
isOverWater(x,z): boolean
lakeAt(x,z): LakeRuntime | null
flightFloorAt(x,z): number           // ground+clearance on land; waterLevel+scoopClearance over water
slopeAt(x,z): number                 // gradient magnitude (for fire + biomes later)
```
- **Carved basins:** each lake's `waterLevel` is computed once (flat); the ground is carved
  into a bowl below it (lakebed → shore shelf → raised bank → blend to terrain) via
  smoothstep. Water sits *in* a depression, not on a hump. This makes scoop identical at
  every lake.
- Seeded PRNG (mulberry32, ~5 lines, no dep).

**Changes:**
- `meshes/terrain.ts` → displaces vertices from `world.groundHeightAt` (basins become real
  geometry). `createTerrain(world)`.
- `Lake.ts` / `meshes/lake.ts` → read `waterY` from `World`; disc beds into the carved shore.
- `sim/HelicopterSim.ts` → **AGL**: `update(dt, input, floorY)`; clamp altitude to
  `floorY+minClearance .. floorY+maxClearance`. Collective unchanged; the band moves with
  the ground, so "full descend" always lands you a fixed clearance above whatever's below
  (ground, or a lake basin → just above the water). Expose `agl`. `minClearance` sits above
  canopy to avoid tree clip.
- `ChaseCamera.ts` → ground-clearance guard (lift cam above `groundHeightAt(camXZ)+min`).
- `sim/BucketSim.ts` → physical **scoop tip** (eases a forward tilt + small dip offset while
  submerged; vertical stays near-rigid per your feedback) + soft **rope max-distance
  constraint**.
- **Weight-coupling:** pass `payloadRatio = water/capacity` into `HelicopterSim`; a full
  bucket reduces `enginePower`/`maxSpeed`/`climbSpeed` (heavy & sluggish) and recovers on
  drop. Closes the scoop→heavy→drop→light loop.
- `Game.ts` → construct `World` first; route terrain/trees/fires/scoop/floor through it;
  scoop = `wl !== null && bucketY <= wl + dipThreshold` (now consistent everywhere).
- `config.ts` → `WORLD3D.seed`, `FLIGHT.{minClearance,maxClearance,canopyClearance,
  scoopClearance, payloadAccel/Speed/ClimbPenalty}`, `CAMERA.minGroundClearance`.

**Verify:** autopilot (`window.__game.debug`) descends over each of the 4 lakes → "Scooping…"
at the *same AGL*; floor rides hills without clipping; water discs sit in visible bowls.
`npm run build` green.

---

## TRACK A — Generative mathematical world

Behind the stable `World` API; each phase swaps the *implementation*, not the signatures.

- **A1 · Noise.** ✅ DONE (2026-06-02). New `world/noise.ts`: hand-rolled seeded simplex + FBM +
  ridged + **domain warp** (natural meandering ridges/valleys). Replaced the sine-sum `baseHeight`
  in `World` behind the unchanged `groundHeightAt`. Tuned to the **northern-Saskatchewan Boreal/
  Taiga Shield**: low glacially-scoured relief, domain-warped esker-like ridgelines, ridged granite
  outcrops, flattened muskeg lowlands. New `TERRAIN` config block is the **future-maps seam**
  (a map = profile + seed + lake set). Verified: lakes still carve 5u below water, AGL floor rides
  the new noise, `npm run build` green. *(Biome coloring / terrain-aware placement remain A2/A3.)*
- **A2 · Biomes.** ✅ DONE (2026-06-02). New `world/biomes.ts`: `elevation × moisture × slope`
  (+ water-distance) → blended meadow / forest / rock / shore. Drives terrain vertex colors and
  **seeded** tree density-rejection + per-biome foliage tint (forest dense/dark, meadow sparse/light,
  ~none on rock/water). Moisture is its own low-freq noise channel (wetter in lowlands). Engine-agnostic
  (returns plain rgb/scalars). **Also shipped: irregular water bodies** — each lake gets a seeded
  elongated + lobed boundary (`World.lakeRadius(phi)`, new `LAKE_SHAPE` config) that the carved basin,
  the new ring-based water mesh, and `isOverWater`/`distanceToWater` all share, so Shield lakes read as
  fracture-controlled, not discs. Verified: lake boundaries swing ~30→60u (elong ~1.4–1.65), Phase-1
  scoop depth still exactly 5u at every lake, `npm run build` green.
- **A3 · Terrain-aware placement.** ✅ DONE (2026-06-02). New `world/placement.ts`: fuel-biased
  fire siting — `fireSite()` rejection-samples toward flammable forest, and spread now creeps
  through fuel (stalls at rock/open/water), so fires live in the trees. Trees were already biome +
  slope density-rejected (A2); bumped to 3600 candidates + denser meadow for a fuller forest.
  **Also this pass: fixed the lake-water banding bug** — the wave-normal frequencies were 26–57u
  wavelengths (1–2 giant stripes across a small lake); retuned to fine multi-octave ripples (~6–12u),
  softened/lightened the depth fade (depthRange 4.5→7, lighter deep color), and raised the water
  mesh to 14 rings. Generated lake siting deferred (optional; the hero `LAKES3D` work well). Verified:
  all start fires on fuel 0.72–1.0, water reads smooth, `npm run build` green.
- **A4 · Hydrology / rivers.** ✅ DONE (2026-06-02). Streams in `World` (`makeRivers`/`nearestRiver`)
  + new `meshes/river.ts` ribbon. Mini rivers connect each lake to its nearest LOWER lake (downhill
  flow); short tiny tributaries feed lakes from uphill ground. Each carves a shallow channel into the
  terrain, and **`waterLevelAt` generalizes so you can scoop from a stream just like a lake** (the
  keystone signature is unchanged — flight floor/scoop all work over rivers for free). New `STREAM`
  config. **Plus this pass:** a **swamp/muskeg biome** (wet + flat + low → murky peat color, sparse
  stunted stand) and a denser forest (5200 candidates). Verified: 6 streams (3 mini + 3 tiny),
  midstream `isOverWater` + floor = surf+scoopClearance (scoopable), channel carved ~1.8u below
  surface, swamp ≈11% of land, lake scoop depth still 5.0.

**Pivotal fork — world scale (see decision below):** Bounded (finite, fully generated) vs
Streaming (infinite chunked tiles). Recommendation: **Bounded ~1200–1500 units** — the
gameplay is spatially local, and streaming adds the genre's hardest 60fps-mobile risk for
value the design doesn't use. Streaming stays possible later behind the same `World` API.

---

## TRACK B — Great visuals (ordered by impact-per-cost)

- **B0 · Quality tiers + FrameContext.** ✅ DONE (2026-06-02; DPR made adaptive/recoverable
  2026-06-03). `render/QualityTier.ts` (auto-detect low/med/high fixes scene complexity at load;
  an **adaptive frame-time watchdog** scales **render DPR** down under load and back up under
  headroom within `[dpr.floor .. dprCap]` — the one recompile-free runtime lever) and
  `render/FrameContext.ts` (shared time/wind/sun uniform bus, reusing `Wind.ts` + the heli-follow
  sun). Wired through `main.ts` (applies DPR to the renderer + composer; shadows set once at load)
  + `Game.ts` (shadow-map/water tessellation read at load). Every later phase reads the tier.
- **B1 · Water** ✅ DONE (2026-06-02) (top win — you stare at it every scoop). `water/WaterMaterial.ts`
  (onBeforeCompile over Standard: animated normals, **real depth-fade** from a per-vertex water
  depth baked off `World.groundHeightAt`, fresnel sky tint, shoreline foam) + `water/Ripples.ts`
  (fixed 8-slot uniform ring; bucket dip + drop impacts spawn expanding rings). One shared material
  across all lakes; no planar reflection. **Verified** live (depth-fade + rings render; no recompiles).
  *Gotcha logged: patch albedo/normal at `<lights_physical_fragment>`, not `<lights_fragment_begin>` —
  the PBR material struct is built before the latter.*
- **B2 · Atmosphere.** ✅ DONE (2026-06-02). `sky/SkyDome.ts` (camera-following gradient dome
  with a horizon→zenith blend + a soft sun halo reading the shared `FrameContext.uSunDir`) +
  `sky/TimeOfDay.ts` presets (`DAY`/`GOLDEN`) driving sun color/intensity, hemisphere fill, and
  **aerial-perspective fog** whose color = the sky horizon, so distant hills dissolve into the sky.
  Wired in `Game` (one preset replaces the flat background + lights; dome follows the eye each frame).
  Verified live: gradient sky, sun glow, hills fading into haze. (God-rays still deferred, high-only.)
- **B3 · Fire glow.** ✅ DONE (2026-06-03). `postfx/Composer.ts` (EffectComposer: RenderPass →
  UnrealBloomPass → OutputPass, tier-gated — on for med/high at the renderer's full DPR (MSAA on
  high), OFF on low; chosen once at load) wired in `main.ts` (renders through the composer). The bloom **threshold (0.95)** is
  tuned to the HDR emissive flames (emissiveIntensity up to 2.6, kept HDR in the composer's half-float
  target) so the fires + sun core glow while the LDR sky stays crisp — no horizon wash-out. Plus
  `lighting/HeroFireLights.ts` — a **fixed pool** of 2 point-lights (added once, never removed → no
  recompiles) repositioned each frame onto the nearest/hottest fires, intensity ∝ heat with per-light
  flicker. Verified live: flames bloom, crisp sky, 2 pooled lights present. New `POSTFX`/`FIRELIGHT` config.
- **B4 · Particles/VFX.** ◐ MOSTLY DONE (2026-06-03). `vfx/WaterSpray.ts` (drop/scoop pour) +
  **`vfx/SmokePlume.ts`** ✅ — one pooled `THREE.Points` cloud (fixed ring buffer, soft procedural
  puffs, zero textures) shared by all fires: each burning fire puffs from its crown, particles RISE,
  EXPAND, fade, and **BEND downwind** (velocity dragged toward the live `Wind` vector each frame),
  scaling with intensity. Restores the 2D smoke; reads great against the B3 bloom. New `SMOKE` config.
  Verified live (auto-emit accumulates with active fires; plume bends with the 29 kt wind). *Rotor
  downwash (low-altitude water ripples + canopy bend) shipped under **C4** — see Track C. Remaining:
  optional `vfx/ParticleSystem.ts` generalization + low-altitude dust over dry ground.*
- **B5 · Terrain shading.** ✅ DONE (2026-06-03). `meshes/terrain.ts` patches the ground material
  (onBeforeCompile) with: a **detail bump** (derivative-based micro-relief from hash value-noise — no
  trig) + multi-scale **albedo mottling**, now sampled **triplanar** (the height noise is projected on
  all three world planes and blended by the surface normal, so it doesn't smear down cliffs); and
  **slope-driven rock** — where the ground steepens (low normal.y) the albedo tilts to granite grey
  with higher-contrast grain and the bump strengthens, so outcrops/cliffs read as rough rock while the
  flats stay soft. World-space, tiles seamlessly, zero textures. Also raised terrain grid +
  water-disc/stream resolution (quality-tiered) for smooth shorelines.
- **B6 · Models/foliage.** ✅ DONE (2026-06-03). Foliage **wind-sway** — new `meshes/foliageWind.ts`
  patches the instanced tree-foliage material with a world-space vertex displacement that bends each
  crown toward the live `FrameContext.uWind` (the SAME wind that bends the smoke), scaled by height²
  (base stays planted) and oscillated on a per-tree phase so the forest shimmers, not pulses. Patched
  in `Game` after the forest builds. Richer Bell-205 heli model + instrument HUD landed in parallel.
  **Tree LOD** (on top of the chunked frustum/distance culling): each forest chunk now carries a full
  3-cone mesh + a cheap single-cone **impostor**, and `cull()` bands them by distance — full within
  ~230u, impostor (no trunk) out to the fog at ~480u, culled beyond. Verified: from one viewpoint only
  4 of 64 chunks draw full trees, 14 the impostor, 46 fully culled. *(Structure heights also fixed:
  cabins/depot were taller than the canopy — now ~3.6–3.9u vs trees ~6–8u.)*

---

## TRACK C — Physics & gameplay depth (keep the hand-rolled feel)

- **C1 · (in Phase 1)** AGL flight, physical scoop, weight-coupling, rope constraint, camera
  guard.
- **C2 · Drop dynamics.** Release impulse (heli "pops up" as mass leaves), bucket recoil;
  expose `WaterEvents` (scoop ripple / drop splash / drip trail) for the visuals track.
- **C3 · Fire dynamics + stakes.** ✅ DONE (2026-06-03). **Pass A (fire-dynamics engine):** new
  engine-agnostic `sim/FireSystem.ts` owns fire state as numbers (World fields injected as
  callbacks — never imports `World`). Adds **fuel depletion** (each fire drains a local reserve;
  its intensity ceiling tracks remaining fuel so it visibly dies down, then burns out at ~54s and
  scorches its patch — a smolder floor guarantees finite burn-out vs the fuel↔intensity asymptote),
  **slope-driven spread** (a local uphill-vector pull blended with the downwind bias — fire climbs),
  and **wet firebreaks** (a drop soaks ground cells in a fixed-size suppression grid; they resist
  reignition until they dry over a cooldown). `Game.ts` rewired onto a **fixed FireMesh pool**
  (size `maxActive`, built once, synced to active fires — no runtime scene add/remove, no
  recompiles); `douse` routes through `FireSystem.douse`. New `FIRE3D` fuel/firebreak/slope config.
  Verified headless (Node-bundled pure-sim harness): burn-out, uphill bias vs flat control,
  firebreak suppression, volume douse, determinism — 9/9; `npm run build` green. **Pass B (stakes)
  DONE (2026-06-03):** new engine-agnostic `sim/Structures.ts` — a lakeside **depot** + forest
  **cabins** (sited via `placement.fireSite`, so the fire reaches them), each with `health`/`burning`
  state; a fire within `threatRadius` drains health ∝ intensity×proximity (~17s point-blank to
  destroy). **Lose = every structure destroyed** (latches the sim off like `won`); **score** =
  water-doused fires + surviving structures + win bonus (`FireSystem.doused` counts water kills vs
  burn-outs). `meshes/cabin.ts` draws procedural cabins/depot (box + gable roof + chimney /
  flat-roof + helipad) that char + collapse with damage and ember while burning — pooled, built
  once. HUD: a **THREAT gauge**, structures on the radar (intact/burning/lost), and a **lose banner**
  + final score. New `STRUCTURES`/`SCORE` config. Verified headless: placement, point-blank destroy
  + lose latch, threat tracking, doused-vs-burned counting — 11/11; `npm run build` green.
  *(proximity ignition folded into the fuel-biased spread. Live Playwright visual pass still pending
  — MCP browser profile locked again this session.)*
- **C3.1 · Fire size classes + reactive glow/smoke.** ✅ DONE (2026-06-03). Grounded in real
  wildfire science (NWCG size classes A–G; Byram fireline-intensity ↔ flame-length ↔ suppression
  difficulty; elliptical growth). Each fire now carries a **`size` 0..1** (Class-A spot → big blaze):
  it **ignites small and GROWS** while it burns, its intensity ceiling (≈ flame length) rises with
  **both fuel and size**, and it only throws **spot fires once established** (`spreadSizeThreshold`),
  so an ignition grows into a blaze *then* spreads (spread cadence quickened 9s→4.5s). **Re-flare:**
  a drop knocks down intensity **and** size, but a fire is only OUT once knocked down *and* shrunk
  under `killSize` — so a big blaze survives one tank and re-flares from its remaining size/fuel
  (~2–3 passes), while a fresh spot dies in one. **Reactive visuals:** flame cluster scales with
  size; the periodic-sine flicker (the "on repeat" glow) is replaced by **non-repeating 1-D value
  noise** in both `meshes/fire.ts` and `HeroFireLights` (hero-light reach also scales with heat);
  smoke gains a per-puff **`aHeat`** channel + multi-puff emission so a hot fire throws a **taller,
  bigger, denser, darker column** that obscures the seat of the fire (the in-world reason a
  high-class fire is hard to fight). New `FIRE3D` size/re-flare block + `SMOKE` heat fields.
  Verified headless: growth, size→intensity coupling, spotting gate, re-flare (big survives one
  drop, dies in ~2–3; small dies in one), burn-out regression — 10/10; `npm run build` green.
  *(Live visual pass pending — MCP browser locked again.)*
- **C4 · Rotor wash + ground effect.** ✅ DONE (2026-06-03). New engine-agnostic
  `sim/RotorWash.ts` (numbers only — imports just THREE math + `config`, same boundary as
  the other sims): turns the flight sim's **AGL** into two plain SIGNALS — `surface` 0..1
  (downwash reaching the ground/water, squared falloff so only genuinely low passes blow,
  +collective) and `groundEffect` 0..1 (the in-ground-effect cushion near the deck).
  `Game` reads them each frame (off last frame's AGL — one-frame lag, like the bucket-dip
  read) and drives: **water** — concentric ripple rings emanate from under a low heli over
  a lake (reuses the B1 ripple pool, its own cadence); **foliage** — the canopy directly
  below bows radially OUTWARD via a new shared `FrameContext.uWash` disc the wind-sway
  shader reads (height² law, recompile-free uniform, both forest + grove fields); **fire** —
  flames within `fanRadius` whip harder under the wash (a new `uFan` on the flame shader,
  **cosmetic only** — never touches sim intensity/size). **Ground effect** feeds
  `HelicopterSim.update` a buoyant lift assist near the surface, **gated by collective** so
  a full-DOWN descent still bottoms exactly on the floor (scoop unaffected) while a neutral
  low hover floats. New `WASH` config block. Verified: pure-sim harness (signal curve,
  ground-effect hover-float, scoop-invariant) 9/9; live headless (no-HMR preview) — `wash`/
  `groundEffect` rise smoothly as AGL drops (0 above 28u reach → 0.75/1.0 on the deck),
  full descent reaches `agl=0`, **zero shader compile errors**; `npm run build` green.
- **C5 · Assists + determinism.** `sim/Assist.ts` (auto-hover, terrain-follow, drop-lead
  reticle — toggles) + `sim/Rng.ts` seeded stream so fire runs reproduce from a seed.

- **C6 · Fuel & forward bases.** ◯ PLANNED. The first stake tied to *distance from base*:
  water refills free at any lake, so nothing today punishes flying far. Fuel does. Pairs
  with the C3 lose-condition (two clocks race: keep fuel **and** keep cabins alive).

  - **Fuel metered by thrust + payload, not a wall clock.** New engine-agnostic
    `sim/FuelSim.ts` (numbers only — same boundary as `HelicopterSim`/`FireSystem`; imports
    only `config.ts`). `update(dt, { throttle01, climbRate, payloadRatio })` drains a `fuel`
    reserve (0..1) at
    `rate = idleBurn + thrustBurn · demand · (1 + payloadBurn · payloadRatio)`, where
    `demand = ½·throttle01 + ½·climbUp`. An idle hover sips the `idleBurn` floor; full
    throttle / heavy climb with a full bucket hits peak burn — so flying heavy and hard is
    visibly thirsty, and the **~2.5-min endurance is the average, not a fixed countdown the
    player can't influence.**
  - **Burn derived from the real airframe (DECIDED).** Calibrated to the hero **Bell 205A-1**:
    250 US gal, **~85–90 gal/hr working a bucket → ~2.5 hr** usable endurance, vs **~4.2 hr**
    light/economical loiter (max endurance, no reserve). That real ratio (2.5 ÷ 4.2 ≈ **1.68×**)
    *is* the model; map real-hours→game-minutes (**60× time compression**, 2.5 hr → 2.5 min) and
    the values fall out: `idleBurn 0.0040` (floor → ~4.2-min loiter), `thrustBurn 0.0020` (at
    full demand), `payloadBurn 0.35` (full bucket = +35% on the thrust term, the heavy-lift
    premium), `lowWarn 0.20` (gauge flashes at 20% ≈ the real "30-min reserve"), `startFuel 1.0`.
    Full bucket + full power = 0.0067/s → 150 s (2.5 min); light loiter = 0.0040/s → 252 s
    (~4.2 min). Preserves the 1.68× spread so it *feels* like a turbine.
  - **Empty = forced landing, not instant death.** At `fuel <= 0` the sim raises a
    `starved` flag; `HelicopterSim` cuts engine power to an autorotation descent (clamp
    collective so it can only sink). The player sets down wherever they are — soft fail. It
    only becomes a **loss** if a fire front then reaches the grounded heli (reuse the
    `Structures` proximity math against the heli XZ) or all cabins burn while you're down.
  - **Refuel at the depot.** `sim/Structures.ts` already sites a `depot` on a lake shore —
    give it the job. Add `FUEL.refuelRadius` + `refuelPerSec`; while the heli is grounded/slow
    within that radius of the depot (or a cache), `fuel` climbs. The depot also becomes the
    **spawn point** (heli starts here, full tank).
  - **Forward fuel caches (the agency layer).** After the player has earned it, caches
    air-drop out at the fire front so they aren't tethered home. Gate + spawn entirely from
    signals that already exist — **no new bookkeeping:**
    - **Trigger:** `FireSystem.doused >= FUEL.cacheMinKills` (≥10) **AND** any active fire's
      intensity `> FUEL.cacheMinFireLevel` (level >3 → `> maxIntensity * 0.3`).
    - **Cadence:** a rarity roll on a cooldown (`cacheChance` per `cacheIntervalMs`, seeded
      RNG), under a hard `maxCaches` cap (mirrors `FIRE3D.maxActive`) so the map never litters.
    - **Placement:** near the **active front**, not random forest — pick a point offset from
      a hot `FireSystem.active()` fire along the downwind bias, on dry flammable ground
      (`isOverWater` reject). Reward lands where the work is.
    - Caches live as a second `Structures`-style pooled list (`kind: 'cache'`), drawn from a
      fixed crate-mesh pool with a smoke/beacon marker. **Consumed-only, no expiry timer
      (DECIDED):** a cache is a forward jerry-can worth a partial top-up (`cacheFuel 0.5` —
      half a tank), and refuelling there (drained to 0) frees its slot. It sits until used.
  - **HUD + cold start.** HUD gains a fuel gauge (DOM, beside the water bar) that flashes
    under `FUEL.lowWarn`; a depot/cache beacon hint when low. *Optional polish (B-track
    flourish, not a gate):* a <3s skippable cold-start spool-up on the very first launch from
    the depot for the Forza-intro tone — skip on every subsequent run.
  - **Config:** new `FUEL` block (starter values, real-airframe-derived) — `{ startFuel 1.0,
    idleBurn 0.0040, thrustBurn 0.0020, payloadBurn 0.35, lowWarn 0.20, refuelRadius 18,
    refuelPerSec 0.25 (full tank ~4 s), cacheMinKills 10, cacheMinFireLevel 30 (= maxIntensity·0.3,
    >level 3), cacheChance 0.25, cacheIntervalMs 20000, maxCaches 2, cacheFuel 0.5 }`.
  - **Wiring:** `Game.ts` constructs `FuelSim`, feeds it the flight sim's throttle/climb/
    payload each frame, reads `fuel`/`starved` back to gate engine power + drive the HUD,
    and runs the cache spawner off `FireSystem` signals + the depot/cache refuel check.
  - **Verify** (headless, pure-sim — the standing approach): a hard sortie drains to 0 in
    ~2.5 min and an idle hover lasts far longer (thrust coupling); `starved` latches at 0 and
    refuel within `refuelRadius` of the depot climbs back to full; a cache spawns only after
    ≥10 douses with a >level-3 fire present, never exceeds `maxCaches`, never on water, and
    sits near the front; deterministic from `WORLD3D.seed`. `npm run build` green.

---

## Sequencing

1. **Phase 1** (foundation) — ships the bug fix + best feel-per-effort. Critical path.
2. Then tracks run largely in parallel after Phase 1. Suggested first slices:
   **B0+B1 (water)** for instant visual payoff, **A1 (noise)** for the generative leap,
   **C3 (fire dynamics + stakes)** for gameplay depth.
3. **Lock the world-scale decision before A2/A3/A4** (biomes/placement/rivers reshape if
   streaming).
4. Rivers (A4) and SSAO/god-rays are explicitly last/optional.

## Verification approach

- Every phase ends on the CI gate: `npm run build` (tsc --noEmit + vite build).
- Behavior verified live via Playwright + the `window.__game.debug` hook (autopilot the heli,
  read `{x,y,z,bucketY,water,firesLeft,...}`), and screenshots for visual phases.
- Phase 1 acceptance: consistent scoop AGL across all lakes; no terrain/camera clipping.

---

## TRACK D — Missions & campaign — ✅ DONE (2026-06-03)

A data-driven **mission framework** + a **10-mission linear-unlock campaign** on top of the
sandbox. A `MissionDef` (`missions/types.ts`, `missions/catalog.ts`) is pure SCENARIO data
(seed, where the fires/crews/structures sit, win/lose) — `config.ts` stays the single TUNING
source (new `MISSIONS` block holds only mechanic values: LZ radius, crew dwell, fuel burn).
`missions/MissionRuntime.ts` evaluates objectives (`extinguishAll`/`extinguishCount`/`deliver`/
`evacuate`/`survive`) + fail conditions (`protect`/`timeout`/`fuelOut`) against a per-frame
`MissionSignals` snapshot `Game` already computes; win = all objectives, lose = any fail.

**New mechanics (engine-agnostic sims, the C6 fuel work realized here):**
- `sim/CrewTransport.ts` + `meshes/landingZone.ts` + `meshes/crewBasket.ts` — sling crew/cargo
  transport: load low+slow at a `load` zone, deliver at an `unload` zone. Powers BOTH crew
  **insertion** (base→LZs) and **evacuation** (cabins→base) from one machine; in `payload:'crew'`
  missions the bucket is hidden and a crew basket slings on the **same** `BucketSim` pendulum.
- `sim/FuelSim.ts` — Track **C6** range model (thrust+payload metered burn, ~2.5-min hard
  endurance vs ~4.2-min loiter, refuel at the depot, `starved`→forced sink). Per-mission opt-in.

**Wiring:** `World(seed)` (per-mission map — the "future maps" seam), `FireSystem.igniteAt`/
`igniteLine` (targeted spots / Class-F blazes / ridge-line fronts), `Structures` explicit
placement plan, `Wind(angle, strengthScale)`. `ui/MissionSelect.ts` is the campaign menu;
`missions/progress.ts` persists unlock + best score to localStorage; mission switching is by
**page reload** (no Three.js teardown). HUD gains an objective checklist, fuel gauge, LZ radar
blips, and a Next/Retry/Menu end banner. **Verified:** `npm run build` green; a Node-bundled
pure-sim harness (the standing approach) asserts the runtime/transport/fuel/catalog — 28/28.
*(Live Playwright visual pass pending — MCP browser profile locked again this session.)*

## Decided

**World scale: Bounded now, streaming-ready for the future.** Build a finite ~1200–1500-unit
generated world. Crucially, the `World` API (`groundHeightAt`/`waterLevelAt`/`isOverWater`/
`flightFloorAt`/`slopeAt`) is designed so a future chunk streamer is a swap-in *behind* it —
consumers (sims, placement, meshes) never learn whether a height came from a prebuilt mesh
or a generated tile. So nothing in Tracks A/B/C has to be rebuilt if streaming lands later.
Implication for Phase 1: keep all height/water queries pure functions of world-space (x,z)
with no dependence on a single global mesh, and keep terrain shading world-space (tiles
seamlessly). Everything else in this roadmap is approved as-is.
