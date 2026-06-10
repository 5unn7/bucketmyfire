# Cinematic graphics plan — look upgrade that holds mobile 60fps

> **STATUS 2026-06-10:** items **#1 (operated camera)**, **#4 (bare-hills fix + ENV on)**,
> **#5 (reactive lens)**, and **#6 (time-of-day arc)** are BUILT and verified (build + 12-gate
> verify + verify:render + a live headless visual/state pass) — uncommitted on `main`.
> New config: `CAMERA` feel-pack fields, `GRADE` reactive-lens fields, `TOD_ARC`,
> `QUALITY.presets.*.treeViewDist`, `FOREST.floorCanopy*`, `ENV.enabled=true`.
> Also fixed: god-ray march banding ("stepped frames along the shafts") via per-pixel IGN
> start-jitter (`GODRAYS.jitter`) + the high tier bakes a 48-step march (`GODRAYS.samplesHigh`).

*2026-06-10. Source: a 6-subsystem rendering-pipeline audit (postfx, quality/DPR, sky/lighting,
VFX/water, terrain/vegetation, camera/loop) + two expert proposal panels (cinematography,
procedural-art), synthesized and ranked. Every item respects the invariants: no shader recompiles
after load, O(1) per-frame work, DPR is the one adaptive lever, tier-gated, all values in
`config.ts`, sim boundary intact.*

## The core finding

The expensive cinematic infrastructure is **already built** — ACES tonemap, HDR bloom, god-rays,
heat haze, a live-uniform grade pass, FrameContext uniform bus, fixed light pools. What's missing
is the **direction layer**: the camera is a tripod (fixed 60° FOV, no roll, no shake, no
acknowledgement of drops/crashes/dispatch), the grade is a still-photo filter (its six knobs are
live uniforms that nothing ever writes), and the light never tells the story (eternal golden hour;
a sun that ignores a province on fire). Most of the plan is therefore **uniform writes and O(1)
camera math riding existing seams** — near-zero GPU cost.

## Shared infrastructure (build once, several items depend on it)

| Infra | What | Unblocks |
|---|---|---|
| **Live dome uniforms** | Return the `uZenith`/`uHorizon`/`uSunHalo` `{value}` refs from `createSkyDome` (FrameContext-style) instead of baking them | Smoke-sky, ToD arc, water reflection, aerial perspective |
| **`fireLoad` scalar** | Export the summed ranked score `HeroFireLights.update` already computes; replace its per-frame `map().sort()` with a fixed top-k scan (kills flagged GC churn) | Smoke-sky, lens flares, fog reaction |
| **`Composer.setLens()` channel** | One game→grade signal struct (exposure, warmPush, vignettePulse, flash); add `uExposure`/`uFlash` beside the six existing live GRADE uniforms | Douse flash, smoke dimming, damage pulse, letterbox, heat CA |
| **`onDpr` multi-listener** | `QualityTier.ts:53` overwrites a single listener slot — convert to a list **before** adding any new resolution-dependent subscriber | Soft particles, any future half-res target |
| **Depth texture on composer target** | Attach `THREE.DepthTexture` at Composer construction (the documented fixed-at-construction seam) | Soft particles; future SSAO/DOF |

## Phase 1 — one week, transforms the look, near-zero perf risk

**1. Operated-camera pack** *(transformative · ~free · all tiers · ~1 day)*
Speed-FOV (60→~68° eased with `speed01`), camera leans a fraction of `heliSim.bank` after the
`lookAt`, and a trauma-spring impulse system: drop-release recoil, douse-impact thump, crash kick,
fire-proximity heat tremble (`fireSystem.heatAt(cam)`), rotor-wash buzz in ground effect
(`wash.surface`). All inside `ChaseCamera.update` — shake must be **rotation-only** (sky dome,
forest cull, and ambient embers read `chase.camera.position` right after `chase.update`). All
signals already exist as plain numbers in the `Game.ts:1734` scope. New `CAMERA` fields:
`speedFovGain/Max`, `rollFollow`, `shakeDecay`, per-source impulse weights. This is the single
change that converts "watching a sim" into "flying a heavy machine."

**2. The lake mirrors the real sky** *(high · ~10 ALU, free · all tiers · ~hours)*
In `WaterMaterial.ts`'s existing `<lights_physical_fragment>` patch, replace the
constant-`uSkyTint` fresnel mix with a reflected-ray sample of the dome gradient + a
`pow(sd,320)` sun-halo path (continuous golden lane joining the existing glitter). Bind the same
live dome Color refs. Bump cache key `bmf-water-v5 → v6`. Highest-leverage water change; with
items 3/6 the lakes automatically go ash-brown under smoke and ember-orange at dusk.

**3. Smoke-stained living sky** *(transformative · ~free · all tiers incl. low · ~1 day)*
The defining real-wildfire image the game can't currently make: as `fireLoad` climbs, the sun
reddens toward blood-orange and dims, the horizon band browns and fattens with ash, the sky
desaturates, fog pulls in and warms — and clears when you knock the load down. `uSmokeLoad` joins
FrameContext; ~6 lines of GLSL in the dome fragment; `applyAtmosphere` mutates `scene.fog` in
place (stop allocating `new THREE.Fog`). The enemy's strength becomes legible in the light.
New `SKY_SMOKE` config block.

**4. Fix the bare-hills tell: fog/cull mismatch + ENV on** *(high · cheap · ~1 day)*
Recon's biggest distance bug: `trees.ts VIEW_DIST=480` was tuned for old close fog, but every
preset now has `fogNear ≈ 880–1050` — the forest hard-stops in clear air, leaving a visible
treeless ring and bare green hills from altitude. v1 fix: bake a canopy tint into terrain vertex
colors under forested cells (one-time at load = free) so distance reads forested past the cull,
plus per-tier `VIEW_DIST` in `QUALITY.presets`. Also flip `ENV.enabled` on for med/high — the
HDRI IBL (`render/Environment.ts`) is fully wired, tier-gated, and currently dark on every tier.

**5. The lens reacts to the fight** *(transformative · ~free · ~1 day)*
Via `setLens`: flying into a smoke column dims and flattens the image (drive
`renderer.toneMappingExposure` per frame — pre-tonemap, zero cost, **works on low tier's bare
render too**); a confirmed douse fires a 100ms warm-white bloom lift (tick
`UnrealBloomPass.strength` — runtime-writable); structure damage pulses the vignette dark; the
dispatch weather curve creeps `uWarm` up so a bad afternoon literally looks hotter. Signals
already computed: `smokeVeil` (currently DOM-only), `_drop` resolution, Structures health deltas,
DispatchDirector curve. Brand-safe: warm pushes are scene-side; the cool cyan HUD is DOM and
untouched.

## Phase 2 — the deeper cinematic layer

**6. Time-of-day arc over the shift** *(transformative · ~free GPU · days, mostly tuning)*
The Living Province stops being eternal golden hour: as the dispatch fire-weather curve climbs,
lerp golden → dusk (sun sinks 18°→9°, shadows rake, indigo-over-ember sky, god-ray shafts redden
via a `uShaftTint`). Add `lerpPreset(a,b,t,out)` to `TimeOfDay.ts`; kill the two freeze points
(`sunOffset` cached once at `Game.ts:505`; baked dome uniforms). Everything downstream already
reads live `uSunDir` per frame, and the shadow map already re-renders per frame — a moving sun is
~zero added GPU. Keyframe from the province clock (deterministic → daily-seed board stays fair).
Drop the same director into `AttractScene` so the title breathes. Build together with item 3
(same dome work).

**7. Sun-lit smoke columns** *(high · <0.3ms typical, honest fill risk · ~1 day)*
Smoke is currently **unlit** — it reads as stacked flat stickers. Pseudo-sphere normal from
`gl_PointCoord`, half-lambert vs `uSunDir` (transformed in the **vertex** stage), dense-core
self-AO from existing `tex.r`, silver-gold backlit rim when sun is camera-forward. Smoke is the
game's dominant overdraw (up to 2400 sprites, 680px cap) — ship with `SMOKE.sunShade` as a
uniform ablation knob (zeroable without recompile) and frame-test on a mid Android.

**8. A burn scar that lives** *(high · free · all tiers · ~1 day)*
`FireFieldTexture` B and A channels are verified dead (0/255). Pack **B = wetness** (the sim
already tracks doused-cooldown ground — currently invisible) and **A = scorch age**. In the
existing terrain burn block: fresh char ages to grey ash, a pulsing ember rim flickers along the
active front (menace at distance, owns the frame at dusk), and doused cells render dark and
wet-glossy, drying out — **every drop paints a visible firebreak on the world**. Same texture tap
already paid; ~10 ALU. New `SCAR` config block.

**9. Crash + douse + dispatch get a director** *(high · ~free · ~1 day)*
Crash: during the `CRASH.deathHold` window the camera eases out ~40% and slow-orbits the wreck
(reuse the `introT` lerp pattern in reverse) — every crash becomes a scene; FFA respawns make
this beat repeat. Douse: 0.4s of look-weight biased toward the impact point via the existing
`lookReturnLerp` machinery. Dispatch: a 1.2s yaw nudge toward the new fire's bearing + a thin
letterbox breathe (`uLetterbox`, ~4 ALU in the grade pass; low tier gets nudge-only). All must
yield to `look.active` exactly as the bombing assist does.

**10. Resurrect the establishing shot** *(high · ~free · ~1 day)*
The cinematic fly-in machinery exists but `skipColdStart` (`main.ts:346`) kills it for
ffa/province — the only live modes boot with zero ceremony. Add `beginEstablishing()`: 3.5s high
and wide over the base (look biased toward the nearest active fire or threatened town —
DispatchDirector knows it), easing into the trail cam; auto-complete on first input; instant-skip
under `?qa`/`?autostart` so the headless harness is untouched. Terrain is built synchronously
(only groves/snags defer), so the high shot is safe during `pumpBuild`.

**11. Image integrity under pressure** *(high · the one real-ms item: ~0.4–0.6ms · ~1 day)*
Med tier currently has **zero AA** (msaa 0 + the composer path bypasses canvas AA) and DPR drops
just look soft. Add FXAA on med (`aaPass` in `QUALITY.presets`, read once at construction — the
GODRAYS gating pattern), a 5-tap CAS-style sharpen whose strength rises as the watchdog lowers
DPR, and a subtle 3-tap radial chromatic fringe keyed to fire proximity (heat-stressed lens, not
Instagram). Fix the logged bug while there: `Composer.setPixelRatio` doesn't update the grade's
`uResolution`, so film-grain frequency drifts across DPR steps.

## Phase 3 — showpieces and polish (gated, device-verify first)

**12. Soft particles** *(high · 0.3–0.8ms worst case · med first)* — depth-fade smoke/fire
billboards at terrain contact; kills the razor intersection line, the biggest "video game" tell.
Needs the depth texture; med is clean WebGL2, **high (MSAA 4) needs the blitFramebuffer depth
resolve verified on-device via the bmf-verify render gate before enabling**. New
`softParticles` per-tier flag is the kill switch.

**13. Directional aerial perspective** *(medium · ~8 ALU · all tiers)* — sunward ridges dissolve
warm into the halo, leeward cool toward horizon blue; shared ~8-line snippet at the three
existing `<lights_physical_fragment>` patches (terrain/water/foliage). Low tier benefits most —
it has no grade/bloom, so this becomes its main depth cue. New `AIR` block.

**14. Canopy catches the light** *(medium · <0.3ms · ~1 day)* — paste the terrain CLOUDS shadow
block into the foliage material (fixes clouds darkening ground but not the forest standing on
it), sun-wrap lambert over the baked AO gradient, warm backlit rim at golden hour. In the shader,
not the bake, so it stays correct under the moving sun.

**15. Firebrand streaks** *(medium · ~free · ~hours)* — velocity-stretched embers (aVel
attribute, skewed gaussian falloff) so the downwind rake the sim already computes finally shows;
crash becomes a shrapnel burst of light. Same session: gate `AmbientEmbers`' four unconditional
per-frame buffer uploads on `anyAlive` (flagged waste).

**16. Anamorphic flare kit** *(medium · ~free · med/high)* — fixed pool of 5–6 additive quads on
the sun + the hottest fire, placed with the proven pooled-projection pattern from
`Composer.updateSunRays`; inherits the god-rays' below-horizon/behind-camera fades so it never
pops.

## If you only had one day

1. **Operated-camera pack (#1)** — the single biggest feel transform, free on every tier.
2. **Water sky reflection (#2)** — hours, and every scoop run becomes a poster shot.
3. **Ember streaks (#15)** — hours, makes the fire head read dangerous at a glance.

## Ordering constraints

- Live dome uniforms before/with #3, #6, #2 (one shared change).
- `setLens` channel (#5) before letterbox (#9) and heat CA (#11).
- `onDpr` multi-listener fix before soft particles (#12).
- Depth texture lands with #12 (and is the prerequisite for any future SSAO/DOF).
- Every GLSL change goes through `verify:render` + a real phone — shaders pass the type gate
  broken (bmf-verify).

## Explicitly rejected (violates invariants or melts phones)

Motion blur (velocity buffer + full-screen pass), SSR, real planar lake reflections (second scene
render), TAA (history buffers + ghosting at variable DPR), per-pixel volumetric smoke
(ray-marched), shadow cascades as a Phase-1 item (real cost; revisit only as high-tier headroom
spending), and any runtime material swap (recompile).
