---
name: bmf-asset
description: >-
  Add a new visual element to bucketmyfire the right way. Use whenever the task is to build a new
  procedural mesh (a `meshes/createX()` builder — terrain feature, prop, vehicle part, structure),
  a pooled GPU-Points particle effect (`vfx/` — spray, smoke, embers, dust), an animated material
  via `onBeforeCompile`, or a new selectable helicopter/model registry entry. The project is
  procedural-FIRST (geometry + GLSL + runtime textures), with a few licensed downloaded assets
  swapped in behind procedural fallbacks. This skill gives the four templates (mesh / pooled VFX /
  shader patch / model registry), the mobile-60fps invariants that every addition must respect
  (one-time generation, O(1)/frame, no shader recompiles after load, fixed-size pools, shared
  FrameContext uniforms), the known white-render shader gotcha, and how to wire it into `Game`.
  Reach for it on "add a mesh/model/particle/effect", "new helicopter", "make it spray/smoke/
  glow", "procedural X", or any new geometry/shader under `src/three/meshes|vfx|water|postfx`.
---

# Adding a visual element to bucketmyfire

The project is **procedural-first**: geometry from raw Three.js, look from GLSL (`ShaderMaterial`
/ `onBeforeCompile`) and runtime canvas/data textures. A handful of **licensed downloaded assets**
now exist too (the glTF helicopters under `public/models/`, the wildlife glb, the `smoke-puff.png`
sprite, the rotor-audio mp3) — each is swapped in **behind a procedural fallback** and credited by
a `license.txt`/`ATTRIBUTION.txt` beside it. So: build procedural first; only reach for a
downloaded asset when procedural truly can't get there, keep it optional/fallback, and credit it.

Pick the template that matches what you're adding.

## A) A procedural mesh — `meshes/createX.ts`

The pattern (see [src/three/meshes/bucket.ts](../../../src/three/meshes/bucket.ts) as the
canonical example):

- Author **dimensions and materials as module-level constants** at a comfortable modeling size,
  then `group.scale.setScalar(SCALE)` once so it reads right against the heli (~9.7u fuselage).
- A **factory function** `createX(): XMesh` that builds a `THREE.Group` and returns a small typed
  interface: `{ group, ...setters }` (e.g. bucket returns `{ group, topAnchorY, setFill(t) }`).
  Setters mutate existing geometry/material — they do **not** rebuild.
- Set `castShadow` on solid parts. Keep `radialSegments` low (the bucket uses 14) — mobile.
- **Wire into `Game`**: build it in the constructor and `this.scene.add(x.group)` once (grep
  `Game.ts` for the existing `createBucket()` / `this.scene.add(` calls — follow that placement).
  Pose/animate it each frame from sim numbers in `update`, never rebuild it.
- **Swap-in seam:** because nothing downstream knows the internals, you can later replace the
  builder with one that loads real art and keep the same returned interface (this is exactly how
  the helicopters work — see template D).

## B) A pooled GPU-Points VFX — `vfx/X.ts`

The pattern (see [src/three/vfx/SmokePlume.ts](../../../src/three/vfx/SmokePlume.ts) and
`WaterSpray.ts`):

- Size everything from a **config cap** (`SMOKE.max`, `SPRAY.max`, `EMBERS.max`) — see **bmf-tune**
  for adding the config block. Allocate **fixed-length typed arrays** (`Float32Array(n*…)`) for
  positions/velocities/life/etc. up front.
- One `THREE.Points` over a `THREE.BufferGeometry`; mark dynamic attributes
  `.setUsage(THREE.DynamicDrawUsage)`. Park dead particles far below (`y = -9999`).
- A **ring-buffer cursor** recycles the oldest particle on `emit(...)` — **never** push/allocate
  or add/remove scene objects per frame.
- `emit(...)` seeds particles; `update(dt, …)` integrates them (and reads the live wind for
  drift). Expose `.points` and `this.scene.add(x.points)` once in `Game`'s constructor.
- If the particle needs a sprite, prefer a **procedural soft disc in the fragment shader** (zero
  textures). Only use a downloaded sprite (like `SMOKE.tex`) if procedural can't get the look —
  and then credit it.

## C) An animated material via `onBeforeCompile`

- Grab the **shared** `FrameContext` references in `onBeforeCompile` so one `update()` per frame
  drives every material with no per-material plumbing:
  `src/three/render/FrameContext.ts` exposes `uTime`, `uWind`, `uSunDir`, `uWash` as
  `{ value }` objects — assign those **same references** into your `shader.uniforms`. Don't make
  your own clock/wind uniform.
- **The white-render gotcha (logged, it will bite again):** when patching a `MeshStandardMaterial`
  via `onBeforeCompile`, inject albedo/normal edits at the **`<lights_physical_fragment>`** chunk,
  **not** `<lights_fragment_begin>`. The PBR material struct is built before the latter, so
  patching there renders **white**. (See `water/WaterMaterial.ts`.)
- Bake array sizes / sample counts as **compile-time constants** (e.g. `RIPPLE_SLOTS`,
  `HAZE_SLOTS`, `GODRAYS.samples`) so there are **no recompiles after load**. Reading per-frame
  uniforms is fine; changing a shader's *structure* at runtime is not.

## D) A selectable helicopter / model registry entry

Adding a heli = **one entry** in
[src/three/meshes/heliModels.ts](../../../src/three/meshes/heliModels.ts) (`HELI_MODELS` record)
**+ one card** in `src/three/ui/profile.ts` (the `HELIS` catalog). The glTF loads and swaps in
**behind** the procedural Bell-205A-1, keeping the exact `{ group, rotor, tailRotor }` contract so
nothing downstream changes; the procedural model shows instantly as the fallback.

A `HeliModelSpec` normalizes the imported model: `url` (under the Vite base), `yaw` (point the
nose to world **+X**), `targetLen` (nose-to-tail world units), the separable `mainRotorNode`/
`tailRotorNode` (or `splitRotorMinY`/`procTailRotor` for merged meshes), and `repaintLivery` for
untextured exports. GLTFLoader sanitizes node names (whitespace → `_`); inspect the model and pin
the real node names. Put the asset under `public/models/<name>/` **with a `license.txt`/
`ATTRIBUTION.txt`** beside it, like the existing three.

## Mobile-60fps invariants (every addition must hold these)

- Heavy generation is **one-time at load**; per-frame work is **O(1)**.
- **No shader recompiles after load** — fixed light pools, fixed-size uniform arrays, compile-time
  sample counts.
- **No per-frame allocation** — pre-allocate pools and recycle (ring buffers).
- Respect `QualityTier`: read tessellation/shadow/bloom from the current preset at construction so
  the element scales down on weak devices. Render DPR is handled globally — an adaptive watchdog
  scales it within `[QUALITY.dpr.floor .. 2]` (recoverable), so don't size anything off DPR yourself.

## Verify

`npm run build`, then **live headless** from the **bmf-verify** skill — this is mandatory for
anything with a shader, because GLSL compiles clean in the build even when it renders wrong. Use
`__game.fireSystem.igniteAt(...)` / teleport to frame your new element, and watch the page console
for shader-compile errors.
