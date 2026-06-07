import { HOVER_RING } from '../config';
import { createTreeField, TreeField, TreeSample } from './trees';

/**
 * A landing area circled by trees — a deliberate WALL of conifers ringing a clearing, with a clean
 * cutout at centre for a helicopter to drop into, land, and hold a low hover between the timber.
 *
 * This is the visual + collision body of the Low Hover Drill spots. The world already THINS the forest
 * around each drill clearing (`World.setClearings` over `lowHoverClearRadius`), but a thinned scatter
 * reads as a random gap, not a defined hole — and a gap with stray trees in the middle isn't a fair
 * "hold dead-centre" target. This lays a DENSE, deterministic ring in that cleared annulus: solid timber
 * from `innerR`→`outerR`, nothing inside `innerR`. The hole reads instantly from the air.
 *
 * It is NOT new geometry — it delegates to `createTreeField` (the conifer field), reusing its species
 * geometry, instancing, LOD, wind-sway hook, and per-tree canopy COLLIDERS. The returned `colliders`
 * are world-space and are fed into `Obstacles` by `Game`, so drifting into the wall strikes the rotor —
 * the ring IS the hazard the drill trains against (the surrounding forest only thins; this is the wall).
 *
 * Built once per drill spot at load (heavy generation stays off the per-frame path); the returned
 * `TreeField` slots straight into the existing `swayFoliage`/`cull` plumbing.
 */
export interface TreeRingOptions {
  cx: number; // world centre X of the clearing
  cz: number; // world centre Z
  heightAt: (x: number, z: number) => number; // world terrain surface Y (place each trunk base on the ground)
  sample: (x: number, z: number) => TreeSample; // biome sample at a WORLD xz — only its `treeTint` is used (band drives density)
  rng: () => number; // seeded PRNG → a deterministic ring for a given world seed
  innerR?: number; // clear cutout radius (defaults to HOVER_RING.innerR)
  outerR?: number; // outer edge of the tree wall (defaults to HOVER_RING.outerR)
}

export function createTreeRing(opts: TreeRingOptions): TreeField {
  const innerR = opts.innerR ?? HOVER_RING.innerR;
  const outerR = opts.outerR ?? HOVER_RING.outerR;
  const span = 2 * outerR; // square scatter extent that bounds the ring (origin-built, shifted onto the centre below)

  // Candidates to TRY across the bounding square. Only band candidates are accepted (density 1 there),
  // so the in-band count ≈ treesPerU2 × bandArea; size the square draw to hit that areal density.
  const candidates = Math.max(1, Math.round(HOVER_RING.treesPerU2 * span * span));

  // Built at the ORIGIN (like Game's near-spawn patch), then shifted onto the clearing centre — so the
  // field's own square scatter/chunk maths stay centred and we just translate the group + the colliders.
  const field = createTreeField({
    candidates,
    size: span,
    heightAt: (x, z) => opts.heightAt(opts.cx + x, opts.cz + z), // local → world
    sample: (x, z) => {
      const r = Math.hypot(x, z);
      // A solid wall only in the [innerR, outerR] band; nothing inside (the cutout) or past the rim.
      if (r < innerR || r > outerR) return { treeDensity: 0, treeTint: [0, 0, 0] };
      // Density 1 inside the band → every candidate here becomes a tree (a continuous wall, no clip-through
      // gaps). Keep the biome's tint so the wall matches the surrounding forest at this spot.
      return { treeDensity: 1, treeTint: opts.sample(opts.cx + x, opts.cz + z).treeTint };
    },
    rng: opts.rng,
    burnable: false, // a controlled drill feature (the Low Hover Drill mission carries no fires) — not a burn target
  });

  field.object.position.set(opts.cx, 0, opts.cz); // shift the origin-built ring onto the clearing centre
  // Colliders are built in local space — offset them to world XZ so Obstacles snags on them where they stand.
  const worldColliders = field.colliders.map((c) => ({ ...c, x: c.x + opts.cx, z: c.z + opts.cz }));

  // Same TreeField contract (so `swayFoliage`/`cull` work unchanged), but with world-space colliders.
  return { ...field, colliders: worldColliders };
}
