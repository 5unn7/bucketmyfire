---
name: bmf-tune
description: >-
  Balance or tune how bucketmyfire FEELS or LOOKS. Use whenever the task is to adjust a gameplay
  or visual value — flight momentum/handling, bucket swing/sag, scoop/drop, fire spread/burn-out/
  re-flare, fuel endurance, structure damage, water look, bloom/fire glow, smoke column, embers,
  god-rays/color grade, camera follow, rotor wash, audio, scoring, or world/terrain/biome
  generation. ALL tuning in this project lives in one file — `src/three/config.ts` — and modules
  read it; the cardinal rule is change the value THERE, never hard-code it in a module. This skill
  maps "I want X to feel different" to the exact config block + fields, and flags the invariants
  you must not break (engine-agnostic sims, determinism from one seed, the load-time vs runtime
  knob distinction, fixed-size pools). Reach for it on any "make it faster/slower/heavier/
  brighter/harder", "tweak", "balance", "dial in", or "tune the feel" request.
---

# Tuning bucketmyfire

`src/three/config.ts` is the **single source of gameplay + visual tuning**. Every subsystem reads
its block once (or per-frame through `FrameContext`). **Change values in `config.ts`; do not
hard-code them in modules** — a scattered magic number is a bug, not a tweak. (The legacy Phaser
build has a separate `src/constants.ts`; ignore it — the live game never loads it.)

## "I want to change X" → which block

Open [src/three/config.ts](../../../src/three/config.ts) and edit the block; the inline comments
are detailed and authoritative. Map:

| You want to change… | Block | Key fields |
| --- | --- | --- |
| World size / seed / lake basins | `WORLD3D` | `size`, `seed`, `lakeBedDepth`, `lakeBankHeight` |
| Terrain shape (hills, ridges, warp) | `TERRAIN` | `baseAmplitude`, `baseFrequency`, `warpStrength`, `ridge*` |
| Lake outline (elongated/lobed) | `LAKE_SHAPE` | `elongMax`, `harmonics`, `meshRings` |
| Rivers / streams | `STREAM` | `width`, `depth`, `connectChance`, `meanderAmp` |
| Biome thresholds, palette, tree density | `BIOMES` | `forestMoist*`, `rockSlope`, `dens*`, `color*` |
| **Flight feel** (power, drag, top speed, climb, banking, dive) | `FLIGHT` | `enginePower`, `linearDrag`, `maxSpeed`, `climbSpeed`, `controlResponse`, `maxBank`, `pitch*`, `payload*Penalty` |
| HUD gauge calibration (kt/ft) | `INSTRUMENTS` | `topSpeedKt`, `ceilingFt`, `maxVsiFpm` |
| Rotor downwash / ground effect | `WASH` | `reach`, `groundLift`, `foliageBend`, `fanRadius` |
| **Bucket swing / sag / rope / scoop / drop** | `BUCKET3D` | `ropeLength`, `stiffness`, `damping`, `maxSwing`, `dropRadius`, `dipThreshold`, `dumpRate`/`dropRate`, `refillRate` |
| Lake positions | `LAKES3D` | hardcoded centers `{x,z,r}` |
| **Fire dynamics** (spread speed, burn-out, growth, re-flare, douse) | `FIRE3D` | `cellRegrow`, `cellBurnRate`, `spreadRate`, `windSpread`, `slopeSpread`, `sizeGrowth`, `litresToClear`, `killSize`, `maxActive` |
| Buildings to defend / damage rate | `STRUCTURES` | `cabinCount`, `threatRadius`, `damagePerSec` |
| Towns / hamlets layout | `COMMUNITIES` | `townCount`, `spacing`, `clusterRadius` |
| Roads | `ROADS` | `width`, `meanderAmp`, `gravelColor` |
| **Scoring** | `SCORE` | `perFireDoused`, `perStructureSaved`, `winBonus`, `perCrewDelivered` |
| **Mission mechanics** (LZ, crew dwell, **fuel/range**) | `MISSIONS` | `lzRadius`, `pickupSec`, `idleBurn`, `thrustBurn`, `refuelPerSec`, `lowWarn` |
| Wildlife | `FAUNA` | `ungulatePer1000`, `loonsPerLake`, `cullDist` |
| Quality presets / adaptive downgrade | `QUALITY` | `presets.{low,med,high}`, `downgradeMs` |
| Bloom / fire glow | `POSTFX`, `FIRELIGHT` | `bloomStrength`, `bloomThreshold` / `count`, `intensity` |
| God-rays, color grade | `GODRAYS`, `GRADE` | `exposure`, `density` / `warmHighlights`, `vignette`, `grain` |
| Embers / sparks | `EMBERS` | `max`, `rise`, `windInfluence`, `colorHot` |
| **Water look** | `WATER` (+ `RIPPLE_SLOTS`) | `shallowColor`/`deepColor`, `depthRange`, `foam*`, `wave*`, `glitter*`, `ripple*` |
| Cloud shadows | `CLOUDS` | `scale`, `darken` |
| Drop spray | `SPRAY` | `max`, `perEmit`, `gravity` |
| **Smoke column** | `SMOKE` | `rise`, `life`, `startSize`/`endSize`, `opacity`, `*Color`, heat fields |
| Heat haze | `HAZE` (+ `HAZE_SLOTS`) | `strength`, `radiusWorld` |
| **Audio** (rotor drone, blade slap) | `AUDIO` | `bladePassHz` (keep constant!), `slapDepth*`, `washVolume` |
| Chase camera | `CAMERA` | `distance`, `height`, `posLerp`, `look*` |

## Invariants you must hold while tuning

- **Don't break the sim boundary.** `sim/*.ts` (flight, bucket, fire, fuel, crew, wash,
  structures) import only Three math + `config.ts`. Tune by changing config they read — never make
  a sim reach into a `Scene` or the DOM, and never inline a constant into a sim.
- **Don't replace the flight integrator.** `HelicopterSim` integrates velocity manually so the
  craft carries momentum. Tune `FLIGHT` values; do **not** rewrite it to `setVelocity(input *
  speed)` — that deletes the inertia that is the whole point of the feel.
- **Determinism from one seed.** `WORLD3D.seed` threads through noise/hydrology/biomes/placement/
  fire RNG. Same seed → same world + same fire run. Don't introduce `Math.random()` into
  generation; use `world.rng`. (Per-mission seeds live in the mission def, not here — see
  **bmf-mission**.)
- **Runtime knob vs load-time field — know which you're touching.** The adaptive watchdog only
  moves the *cheap, recompile-free* levers at runtime (DPR, shadows on/off). **Load-time-only**
  fields are read once at construction and changing them means a rebuild/realloc, not a live
  tweak: `QUALITY.presets.*.{shadowMapSize, waterSegments, terrainSegments, bloom}`,
  `FIRE3D.{fireCells, blobCells, gridCells}`, `GODRAYS.samples`, and the **fixed-size pool caps**
  `RIPPLE_SLOTS`, `HAZE_SLOTS`, `SPRAY.max`, `EMBERS.max`, `SMOKE.max`, `FIRE3D.maxActive`,
  `FIRELIGHT.count`. These caps are sized once so there are **no shader recompiles or per-frame
  allocations after load** (the mobile-60fps invariant) — raise them thoughtfully, never grow them
  per frame.
- **Audio: the blade-pass rate is constant on purpose.** `AUDIO.bladePassHz` must NOT track
  throttle — only the slap *depth* swells with load. A rotor is not a car engine.

## Verify a tuning change

1. `npm run build` (type gate).
2. Then the matching headless check from the **bmf-verify** skill:
   - A **sim/number** change (flight, fire, fuel, bucket) → a pure-sim Node assertion or
     `npm run verify:campaign`. Fast and deterministic.
   - A **visual** change (water, bloom, smoke, grade, god-rays) → live headless. Shader values
     compile clean even when they render wrong, so you must *look*. Watch the logged
     `<lights_physical_fragment>` gotcha for any water/material edit.
3. For "feel" changes, there's no substitute for flying it — boot `?m=first-sortie&qa=1` and fly,
   or note in your summary that a human should feel-test on a phone (the 60fps target is a real
   device, not a desktop).
