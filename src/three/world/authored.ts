/**
 * Authored map layers — the hand-painted data the map editor produces and the world generator reads.
 *
 * Three layers, all authored in the in-game map editor (src/three/editor/) and pasted into a region:
 *   - TERRAIN   — soft brush "dabs" that raise (+) or lower (−) the ground.
 *   - FOLIAGE   — brush dabs that bias tree density up (paint forest) or down (clear).
 *   - BUILDINGS — individual decorative structures dropped on the terrain.
 *
 * Like the other authored layers (uplands, rivers, lake outlines), these are pinned at REAL lat/lon so
 * they ride the same cosine projection as everything else; `World` projects them to world XZ once at
 * construction. They consume NO rng, so adding authored data never perturbs the seeded world (the
 * determinism invariant) — a region with no authored layers is byte-identical to before.
 *
 * This module is intentionally dependency-free (no Three, no World, no config): it owns the data shapes
 * plus the pure rasteriser that turns projected brush dabs into a load-time height/density field. World
 * does the lat/lon→XZ projection (it owns the frame) and the editor reuses the SAME `AuthoredField` for
 * its live preview — so what you paint is exactly what the engine bakes.
 */

/** A terrain brush dab: raise/lower the ground by `deltaM` real metres within `radiusKm`, smooth falloff. */
export interface TerrainDab {
  lat: number;
  lon: number;
  radiusKm: number;
  deltaM: number; // + raises, − lowers (real metres → world units via MAPGEO.metresPerUnit)
}

/** A foliage brush dab: bias tree density by `density` within `radiusKm` (+ paints forest, − clears). */
export interface FoliageDab {
  lat: number;
  lon: number;
  radiusKm: number;
  density: number; // additive density delta; the world multiplies trees by max(0, 1 + field)
}

/** The procedural building kinds the editor can drop (must match meshes/cabin.ts `createStructure`). */
export type BuildingKind = 'cabin' | 'depot';
export const BUILDING_KINDS: readonly BuildingKind[] = ['cabin', 'depot'];

/** A hand-placed decorative building (pure scenery — never damages, never counts toward win/lose). */
export interface AuthoredBuilding {
  lat: number;
  lon: number;
  kind: BuildingKind;
  rotationDeg?: number; // yaw about Y in degrees (0 default)
}

/** A brush dab already projected into world XZ — what the rasteriser consumes. */
export interface ProjectedDab {
  x: number;
  z: number;
  r: number; // radius in world units
  amp: number; // peak contribution at the centre (height units, or density delta)
}

/**
 * Grid resolution for the baked authored field (vertices per side). At a 2100u world this is ~8u/cell —
 * fine for terrain sculpting and foliage painting, ~256 KB per field. On a true-shape rectangular world the
 * same N spans each axis, so cells are slightly non-square (a non-issue for a soft brush field).
 */
export const AUTHORED_GRID = 256;

/**
 * A load-time-rasterised scalar field over the world rectangle, summed from soft circular brush dabs and
 * bilinear-sampled per query — so `baseHeight()` / tree placement stay O(1) regardless of dab count.
 * Each dab adds `amp · smoothstep(1 − d/r)` (same falloff as an upland) within its radius. Deterministic,
 * rng-free. The editor builds an identical field from the same projected dabs for its live preview. The
 * grid is N×N regardless of aspect; the world→cell map is per-axis (sizeX/sizeZ) so it covers a rectangle.
 */
export class AuthoredField {
  private readonly grid: Float32Array;
  private readonly N: number;
  private readonly minX: number; // world min on X (−sizeX/2)
  private readonly minZ: number; // world min on Z (−sizeZ/2)
  private readonly sizeX: number;
  private readonly sizeZ: number;

  constructor(sizeX: number, sizeZ: number, dabs: readonly ProjectedDab[], resolution: number = AUTHORED_GRID) {
    const N = Math.max(2, Math.round(resolution));
    this.N = N;
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.minX = -sizeX / 2;
    this.minZ = -sizeZ / 2;
    const grid = new Float32Array(N * N);
    const cellX = sizeX / (N - 1);
    const cellZ = sizeZ / (N - 1);
    const idxX = (v: number) => (v - this.minX) / cellX;
    const idxZ = (v: number) => (v - this.minZ) / cellZ;
    for (const d of dabs) {
      if (d.r <= 0 || d.amp === 0) continue;
      const cx0 = Math.max(0, Math.floor(idxX(d.x - d.r)));
      const cx1 = Math.min(N - 1, Math.ceil(idxX(d.x + d.r)));
      const cz0 = Math.max(0, Math.floor(idxZ(d.z - d.r)));
      const cz1 = Math.min(N - 1, Math.ceil(idxZ(d.z + d.r)));
      for (let iz = cz0; iz <= cz1; iz++) {
        const wz = this.minZ + iz * cellZ;
        for (let ix = cx0; ix <= cx1; ix++) {
          const wx = this.minX + ix * cellX;
          const dist = Math.hypot(wx - d.x, wz - d.z);
          if (dist >= d.r) continue;
          const t = 1 - dist / d.r;
          grid[iz * N + ix] += d.amp * t * t * (3 - 2 * t); // smoothstep falloff
        }
      }
    }
    this.grid = grid;
  }

  /** Bilinear sample at world (x, z); clamps to the field edge (0 outside any dab's reach). */
  sample(x: number, z: number): number {
    const N = this.N;
    const cellX = this.sizeX / (N - 1);
    const cellZ = this.sizeZ / (N - 1);
    const fx = (x - this.minX) / cellX;
    const fz = (z - this.minZ) / cellZ;
    const ix = Math.max(0, Math.min(N - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const tz = Math.max(0, Math.min(1, fz - iz));
    const g = this.grid;
    const a = g[iz * N + ix];
    const b = g[iz * N + ix + 1];
    const c = g[(iz + 1) * N + ix];
    const d = g[(iz + 1) * N + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
}
