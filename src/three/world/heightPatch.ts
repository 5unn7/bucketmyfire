/**
 * Height patch — a baked mountain MESH sampled into terrain relief.
 *
 * Sibling to `world/authored.ts` (the brush-dab `AuthoredField`): where that rasterises soft circular
 * dabs, this carries a fixed normalized height GRID baked from a real mesh (a downloaded mountain OBJ →
 * `scripts/bake-heightmap.mjs` → a committed `{ n, data }` module). `World` projects each region patch to
 * world XZ once at construction and adds `sample(x,z)` into `baseHeight` (BEFORE lakes, like uplands), so
 * the mountain becomes collidable GROUND: the flight floor rides over it, fire climbs it, lakes pool at
 * its base — the engine never loads a mesh. The patch has a rectangular, rotatable footprint and fades to
 * 0 at its rim so it blends into the surrounding flats. Pure + rng-free (the determinism invariant) and
 * dependency-free (no Three, no World, no config) — World owns the lat/lon→XZ projection and the scaling.
 */

/** The packed, normalized height grid a bake script emits (base64 Uint8, row-major, +Z down). */
export interface PackedHeightmap {
  /** Grid resolution per side (grid is n×n). */
  readonly n: number;
  /** Base64-packed Uint8 normalized heights [0..255]. */
  readonly data: string;
}

/** Decode a base64-packed Uint8 heightmap to a normalized [0,1] Float32 grid (works in browser + Node). */
export function decodeHeightmap(hm: PackedHeightmap): Float32Array {
  const bin = atob(hm.data);
  const n = hm.n;
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length && i < bin.length; i++) grid[i] = bin.charCodeAt(i) / 255;
  return grid;
}

export interface HeightPatchOptions {
  /** Footprint center in world units. */
  centerX: number;
  centerZ: number;
  /** Footprint half-extents in world units (along the patch's local X / Z before rotation). */
  halfWidth: number;
  halfLength: number;
  /** Yaw about +Y in radians (0 = grid X→world X, grid Z→world Z). */
  rotation: number;
  /** Height (world units) the grid's 0.0 and 1.0 normalized values map to. */
  baseHeight: number;
  peakHeight: number;
  /** Normalized [0,1] height grid (decoded), row-major, n×n. */
  grid: Float32Array;
  n: number;
  /** Fraction of the half-extent over which the patch fades to 0 at the rim (blends into flats). */
  edgeFalloff?: number;
}

export class HeightPatch {
  private readonly cx: number;
  private readonly cz: number;
  private readonly halfW: number;
  private readonly halfL: number;
  private readonly cos: number;
  private readonly sin: number;
  private readonly base: number;
  private readonly span: number; // peakHeight − baseHeight
  private readonly grid: Float32Array;
  private readonly n: number;
  private readonly edge: number;

  constructor(o: HeightPatchOptions) {
    this.cx = o.centerX;
    this.cz = o.centerZ;
    this.halfW = Math.max(1e-3, o.halfWidth);
    this.halfL = Math.max(1e-3, o.halfLength);
    this.cos = Math.cos(o.rotation);
    this.sin = Math.sin(o.rotation);
    this.base = o.baseHeight;
    this.span = o.peakHeight - o.baseHeight;
    this.grid = o.grid;
    this.n = Math.max(2, o.n);
    this.edge = Math.min(0.5, Math.max(0, o.edgeFalloff ?? 0.12));
  }

  /** Height contribution (world units) at world (x, z); 0 outside the footprint. */
  sample(x: number, z: number): number {
    // World → patch-local (rotate by −rotation about the center).
    const dx = x - this.cx;
    const dz = z - this.cz;
    const lx = dx * this.cos + dz * this.sin;
    const lz = -dx * this.sin + dz * this.cos;
    const u = lx / this.halfW; // [-1, 1] inside the footprint
    const v = lz / this.halfL;
    const au = Math.abs(u);
    const av = Math.abs(v);
    if (au >= 1 || av >= 1) return 0;

    // Bilinear sample of the normalized grid (u,v in [-1,1] → grid index in [0, n-1]).
    const n = this.n;
    const fx = (u * 0.5 + 0.5) * (n - 1);
    const fz = (v * 0.5 + 0.5) * (n - 1);
    const ix = Math.min(n - 2, Math.max(0, Math.floor(fx)));
    const iz = Math.min(n - 2, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - ix));
    const tz = Math.min(1, Math.max(0, fz - iz));
    const g = this.grid;
    const a = g[iz * n + ix];
    const b = g[iz * n + ix + 1];
    const c = g[(iz + 1) * n + ix];
    const d = g[(iz + 1) * n + ix + 1];
    const hNorm = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;

    // Rectangular edge fade → blend the patch boundary smoothly into the surrounding ground.
    const fade = edgeFade(au, this.edge) * edgeFade(av, this.edge);
    return (this.base + hNorm * this.span) * fade;
  }
}

/** 1 in the interior, smoothstepped to 0 over the outer `m` fraction of [0,1] (a is |u| or |v|). */
function edgeFade(a: number, m: number): number {
  if (m <= 0) return 1;
  const t = (1 - a) / m;
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  return t * t * (3 - 2 * t);
}
