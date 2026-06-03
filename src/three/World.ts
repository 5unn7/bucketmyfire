import { WORLD3D, FLIGHT, LAKES3D, TERRAIN, LAKE_SHAPE } from './config';
import { Noise2D, FbmParams } from './world/noise';
import { Biomes } from './world/biomes';
import { Placement } from './world/placement';

/**
 * The unified heightfield — the single source of ground/water truth for the whole
 * 3D world. This is the keystone abstraction (see docs/ROADMAP.md, Phase 1): terrain
 * displacement, lake water planes, the flight floor, and slope all flow from ONE
 * frame of reference here, so "descend to scoop" means the same thing at every lake
 * and a fixed altitude floor rides the hills without clipping.
 *
 * It owns NO Three.js objects — pure math over world-space (x, z). The terrain mesh,
 * lake discs, sims, and placement all READ from these functions; none of them know
 * whether a height came from a prebuilt mesh or (one day) a streamed tile. That keeps
 * the door open for a chunk streamer behind the same API without touching consumers.
 *
 * Locked API (never break these signatures):
 *   groundHeightAt(x,z): base terrain with lake basins carved in
 *   waterLevelAt(x,z):   flat per-lake water surface Y, or null on land
 *   isOverWater(x,z):    inside any lake's waterline
 *   lakeAt(x,z):         the lake whose disc covers (x,z), or null
 *   flightFloorAt(x,z):  minimum heli altitude here (canopy clearance on land,
 *                        scoop clearance over water) — the AGL band rides this
 *   slopeAt(x,z):        gradient magnitude of the ground (for fire/biomes later)
 */

/** Per-lake irregular-boundary parameters (an elongated ellipse + angular lobes). */
export interface LakeShape {
  elong: number; // long/short axis ratio (≥1)
  elongAngle: number; // world orientation of the long axis (rad)
  harmonics: { k: number; amp: number; phase: number }[]; // lobe terms summed onto the radius
}

export interface LakeRuntime {
  x: number;
  z: number;
  r: number; // nominal (base) radius — the boundary varies around it by angle
  /** Flat water-surface height — computed once from the base terrain at the center. */
  waterLevel: number;
  shape: LakeShape;
}

export class World {
  readonly size = WORLD3D.size;
  readonly lakes: LakeRuntime[];
  /** Seeded PRNG (mulberry32). One stream for all deterministic world generation. */
  readonly rng: () => number;
  /** Biome classification (A2) — elevation × moisture × slope → color/density/tint. */
  readonly biomes: Biomes;
  /** Terrain-aware placement (A3) — fuel-biased fire siting. */
  readonly placement: Placement;
  /** Seeded noise field that shapes the base terrain (Track A1). */
  private readonly noise: Noise2D;
  private readonly baseFbm: FbmParams;
  private readonly ridgeFbm: FbmParams;

  constructor() {
    this.rng = mulberry32(WORLD3D.seed);
    // Offset the noise seed off the rng seed so terrain and placement RNG don't correlate.
    this.noise = new Noise2D(WORLD3D.seed ^ 0x9e3779b9);
    this.baseFbm = {
      octaves: TERRAIN.octaves,
      frequency: TERRAIN.baseFrequency,
      lacunarity: TERRAIN.lacunarity,
      gain: TERRAIN.gain,
    };
    this.ridgeFbm = {
      octaves: TERRAIN.ridgeOctaves,
      frequency: TERRAIN.ridgeFrequency,
      lacunarity: TERRAIN.lacunarity,
      gain: TERRAIN.gain,
    };

    // Each lake's water surface is the base terrain height at its center, sampled
    // ONCE (so the plane stays flat). The ground is then carved into a bowl below
    // it in groundHeightAt — water sits IN a depression, not on a hump. Each lake
    // also gets a seeded irregular boundary (elongated + lobed) so it reads as a
    // fracture-controlled Shield lake rather than a perfect disc.
    this.lakes = LAKES3D.map((l) => ({
      x: l.x,
      z: l.z,
      r: l.r,
      waterLevel: this.baseHeight(l.x, l.z),
      shape: this.makeLakeShape(),
    }));

    // Biomes read elevation/slope/water-distance from this World plus their own
    // moisture noise channel (seeded off the world seed).
    this.biomes = new Biomes(
      WORLD3D.seed ^ 0x85ebca6b,
      (x, z) => this.groundHeightAt(x, z),
      (x, z) => this.slopeAt(x, z),
      (x, z) => this.distanceToWater(x, z),
    );
    this.placement = new Placement(this);
  }

  /** Generate one lake's seeded irregular boundary (elongation + angular lobes). */
  private makeLakeShape(): LakeShape {
    const elong = LAKE_SHAPE.elongMin + this.rng() * (LAKE_SHAPE.elongMax - LAKE_SHAPE.elongMin);
    const elongAngle = this.rng() * Math.PI * 2;
    const harmonics = [];
    for (let i = 0; i < LAKE_SHAPE.harmonics; i++) {
      harmonics.push({
        k: 2 + Math.floor(this.rng() * 3), // 2..4 lobes
        amp: LAKE_SHAPE.harmonicAmp * (0.5 + this.rng() * 0.5),
        phase: this.rng() * Math.PI * 2,
      });
    }
    return { elong, elongAngle, harmonics };
  }

  /**
   * Boundary radius of a lake at world angle `phi` (from its center): an ellipse
   * (elongation along the lake's long axis) modulated by its lobe harmonics. The
   * carved basin, the water-disc mesh, and isOverWater all read this same function,
   * so the irregular shoreline is identical across geometry, physics, and queries.
   */
  lakeRadius(lake: LakeRuntime, phi: number): number {
    const s = lake.shape;
    const a = phi - s.elongAngle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const ellipse = 1 / Math.sqrt((ca / s.elong) * (ca / s.elong) + sa * sa);
    let w = 1;
    for (const h of s.harmonics) w += h.amp * Math.sin(h.k * phi + h.phase);
    return lake.r * ellipse * w;
  }

  // --- Base terrain ------------------------------------------------------------

  /**
   * Pure base terrain height (no lakes) at world (x, z) — Track A1's seeded noise.
   * Boreal-Shield recipe: domain-warp the coords (winding ridgelines), sample a
   * low-relief FBM for the rolling base, add a ridged layer above a threshold for
   * granite outcrops, then compress sub-waterline dips into flatter muskeg basins.
   * Pure + deterministic, so the mesh and every height query stay in lockstep.
   */
  private baseHeight(x: number, z: number): number {
    const [wx, wz] = this.noise.warp(x, z, TERRAIN.warpStrength, TERRAIN.warpFrequency);

    // Rolling base (low relief). fbm is ~[-1,1].
    let h = this.noise.fbm(wx, wz, this.baseFbm) * TERRAIN.baseAmplitude;

    // Rocky outcrops: ridged crests above a threshold poke up through the soil.
    const ridge = this.noise.ridged(wx, wz, this.ridgeFbm); // ~[0,1]
    if (ridge > TERRAIN.ridgeThreshold) {
      const t = (ridge - TERRAIN.ridgeThreshold) / (1 - TERRAIN.ridgeThreshold);
      h += t * t * TERRAIN.ridgeAmplitude;
    }

    // Muskeg: pull lowlands flatter so wet basins read level rather than as deep bowls.
    if (h < 0) h *= 1 - TERRAIN.lowlandFlatten;
    return h;
  }

  // --- Ground (base + carved lake basins) -------------------------------------

  /**
   * Ground surface Y at world (x, z): the base terrain with each nearby lake's bowl
   * carved in. The bowl is a smoothstep profile — lakebed → shore shelf → raised
   * bank → blend back to terrain — so the water plane always sits inside a visible
   * depression. Lakes are far apart (non-overlapping basins); the lerp accumulation
   * is a no-op outside a lake's influence radius.
   */
  groundHeightAt(x: number, z: number): number {
    let h = this.baseHeight(x, z);
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const d = Math.hypot(dx, dz);
      const rAt = this.lakeRadius(lake, Math.atan2(dz, dx)); // irregular boundary at this angle
      const w = basinWeight(d, rAt);
      if (w <= 0) continue;
      h = lerp(h, basinProfile(d, lake, rAt), w);
    }
    return h;
  }

  // --- Water -------------------------------------------------------------------

  /** Flat water-surface Y if (x, z) lies within a lake's waterline, else null. */
  waterLevelAt(x: number, z: number): number | null {
    const lake = this.lakeAt(x, z);
    return lake ? lake.waterLevel : null;
  }

  isOverWater(x: number, z: number): boolean {
    return this.lakeAt(x, z) !== null;
  }

  /** The lake whose (irregular) water disc covers (x, z), or null. */
  lakeAt(x: number, z: number): LakeRuntime | null {
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const d = Math.hypot(dx, dz);
      if (d <= this.lakeRadius(lake, Math.atan2(dz, dx))) return lake;
    }
    return null;
  }

  /**
   * Signed distance (world units) to the nearest lake's shoreline: negative inside
   * the water, positive on land. Approximated along the radial to each center, which
   * is exact for the star-convex lake boundaries. Used by biomes for the shore band.
   */
  distanceToWater(x: number, z: number): number {
    let min = Infinity;
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const d = Math.hypot(dx, dz);
      min = Math.min(min, d - this.lakeRadius(lake, Math.atan2(dz, dx)));
    }
    return min;
  }

  // --- Flight floor ------------------------------------------------------------

  /**
   * Minimum heli altitude at (x, z) — the surface the AGL band rides. Over water it
   * sits a small scoopClearance above the flat surface (so a full descent dips the
   * slung bucket under); on land it sits a larger canopyClearance above the ground
   * (so the rotor disc clears the trees). HelicopterSim adds the [minClearance,
   * maxClearance] band on top.
   */
  flightFloorAt(x: number, z: number): number {
    const wl = this.waterLevelAt(x, z);
    if (wl !== null) return wl + FLIGHT.scoopClearance;
    return this.groundHeightAt(x, z) + FLIGHT.canopyClearance;
  }

  // --- Slope -------------------------------------------------------------------

  /** Gradient magnitude of the ground at (x, z) — central differences. */
  slopeAt(x: number, z: number): number {
    const e = 1;
    const dx = (this.groundHeightAt(x + e, z) - this.groundHeightAt(x - e, z)) / (2 * e);
    const dz = (this.groundHeightAt(x, z + e) - this.groundHeightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }
}

// --- Basin shaping (module-pure helpers) ---------------------------------------

/**
 * Carve weight in [0, 1] at radial distance `d` from a lake of waterline radius `r`:
 * full (1) out through the raised bank, then smoothstepping down to 0 across the
 * blend ring. Zero beyond, so groundHeightAt's lerp leaves distant terrain untouched.
 */
function basinWeight(d: number, r: number): number {
  const bankEnd = r + WORLD3D.lakeBankWidth;
  const outer = bankEnd + WORLD3D.lakeBlendWidth;
  if (d <= bankEnd) return 1;
  if (d >= outer) return 0;
  return 1 - smoothstep((d - bankEnd) / WORLD3D.lakeBlendWidth);
}

/**
 * Target ground height inside a lake's basin at radial distance `d`:
 *   - d ≤ r: lakebed (deep at the center) rising to the shore shelf at the waterline
 *   - r < d ≤ r+bankWidth: shore rising to a raised bank lip above the water
 *   - beyond: the bank top (blended back toward terrain by basinWeight)
 * All heights are absolute, anchored on the lake's flat waterLevel.
 */
function basinProfile(d: number, lake: LakeRuntime, r: number): number {
  const wl = lake.waterLevel;
  const bed = wl - WORLD3D.lakeBedDepth;
  const shore = wl - WORLD3D.lakeShoreDrop;
  const bankTop = wl + WORLD3D.lakeBankHeight;

  if (d <= r) {
    return lerp(bed, shore, smoothstep(d / r));
  }
  const bankEnd = r + WORLD3D.lakeBankWidth;
  if (d <= bankEnd) {
    return lerp(shore, bankTop, smoothstep((d - r) / WORLD3D.lakeBankWidth));
  }
  return bankTop;
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** mulberry32 — tiny seeded PRNG, no dependency. Same seed → same stream. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
