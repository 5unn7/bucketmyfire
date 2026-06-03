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
  O(1). No shader recompiles after load (fixed light pools, fixed uniform arrays). DPR
  capped. Quality tiers scale everything.
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
- **A4 · Hydrology / rivers.** New `world/hydrology.ts`: carve river channels along the
  downhill gradient connecting lakes; `waterLevelAt` generalizes so you can scoop from
  rivers too. Highest effort, most optional — last.

**Pivotal fork — world scale (see decision below):** Bounded (finite, fully generated) vs
Streaming (infinite chunked tiles). Recommendation: **Bounded ~1200–1500 units** — the
gameplay is spatially local, and streaming adds the genre's hardest 60fps-mobile risk for
value the design doesn't use. Streaming stays possible later behind the same `World` API.

---

## TRACK B — Great visuals (ordered by impact-per-cost)

- **B0 · Quality tiers + FrameContext.** ✅ DONE (2026-06-02). `render/QualityTier.ts`
  (auto-detect low/med/high + **adaptive frame-time downgrade** — DPR only at runtime, no
  recompiles) and `render/FrameContext.ts` (shared time/wind/sun uniform bus, reusing `Wind.ts`
  + the heli-follow sun). Wired through `main.ts` (DPR/shadows) + `Game.ts` (shadow-map/water
  tessellation read at load). Every later phase reads the tier.
- **B1 · Water** ✅ DONE (2026-06-02) (top win — you stare at it every scoop). `water/WaterMaterial.ts`
  (onBeforeCompile over Standard: animated normals, **real depth-fade** from a per-vertex water
  depth baked off `World.groundHeightAt`, fresnel sky tint, shoreline foam) + `water/Ripples.ts`
  (fixed 8-slot uniform ring; bucket dip + drop impacts spawn expanding rings). One shared material
  across all lakes; no planar reflection. **Verified** live (depth-fade + rings render; no recompiles).
  *Gotcha logged: patch albedo/normal at `<lights_physical_fragment>`, not `<lights_fragment_begin>` —
  the PBR material struct is built before the latter.*
- **B2 · Atmosphere.** `sky/SkyDome.ts` (gradient + sun halo) + `sky/TimeOfDay.ts` presets
  driving sun/hemi/fog. Aerial-perspective fog. (God-rays: high-only, deferred.)
- **B3 · Fire glow.** `postfx/Composer.ts` (EffectComposer + bloom, tier-scaled, half-res on
  med) + `lighting/HeroFireLights.ts` (**fixed pool** of 1–2 lights repositioned to the
  nearest/hottest fires — never added/removed, so no recompiles).
- **B4 · Particles/VFX.** `vfx/ParticleSystem.ts` (pooled GPU Points, wind-bent) →
  `SmokePlume` (per fire, bends downwind, scales with intensity) · `WaterSpray` (drop/scoop)
  · `RotorDownwash` (low-altitude dust + water ripples). Restores the 2D smoke.
- **B5 · Terrain shading.** Triplanar rock/grass/shore blend by slope+height + procedural
  detail normal (world-space so it tiles). Broad but subtle — after the hero elements.
- **B6 · Models/foliage.** Richer low-poly heli (rotor coning/droop, animated gear), foliage
  **wind sway** (vertex shader, reuses FrameContext wind), tree LOD/variety.

---

## TRACK C — Physics & gameplay depth (keep the hand-rolled feel)

- **C1 · (in Phase 1)** AGL flight, physical scoop, weight-coupling, rope constraint, camera
  guard.
- **C2 · Drop dynamics.** Release impulse (heli "pops up" as mass leaves), bucket recoil;
  expose `WaterEvents` (scoop ripple / drop splash / drip trail) for the visuals track.
- **C3 · Fire dynamics.** Extract `sim/FireSystem.ts` (engine-agnostic). Fuel depletion
  (fires burn out), **slope-driven spread** (climbs uphill, via `World.slopeAt`),
  **moisture/wet firebreaks** (doused ground resists for a cooldown), wind-driven fronts,
  proximity ignition. **Stakes:** `sim/Structures.ts` — protect cabins/depot; a rising
  *threat meter* (inverted wanted level) + lose condition + score. HUD threat gauge.
- **C4 · Rotor wash + ground effect.** `sim/RotorWash.ts` (downwash near ground → fans
  flames / ripples water / bends foliage — all as signals) + ground-effect lift assist low
  down (buoyant scooping passes).
- **C5 · Assists + determinism.** `sim/Assist.ts` (auto-hover, terrain-follow, drop-lead
  reticle — toggles) + `sim/Rng.ts` seeded stream so fire runs reproduce from a seed.

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

## Decided

**World scale: Bounded now, streaming-ready for the future.** Build a finite ~1200–1500-unit
generated world. Crucially, the `World` API (`groundHeightAt`/`waterLevelAt`/`isOverWater`/
`flightFloorAt`/`slopeAt`) is designed so a future chunk streamer is a swap-in *behind* it —
consumers (sims, placement, meshes) never learn whether a height came from a prebuilt mesh
or a generated tile. So nothing in Tracks A/B/C has to be rebuilt if streaming lands later.
Implication for Phase 1: keep all height/water queries pure functions of world-space (x,z)
with no dependence on a single global mesh, and keep terrain shading world-space (tiles
seamlessly). Everything else in this roadmap is approved as-is.
