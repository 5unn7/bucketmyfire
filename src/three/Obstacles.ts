import { World } from './World';
import { TreeCollider } from './meshes/trees';

/**
 * Collision height field for the slung bucket — the single answer to "what's the
 * highest solid thing under (x, z) that the bucket can rest on / catch on?".
 *
 * It combines the World ground (terrain with lake basins carved in) with the forest:
 * each tree is a canopy CONE (apex at the treetop, tapering to the ground at its
 * footprint radius), and `heightAt` returns the max of the ground and every nearby
 * cone. So the bucket scrapes along the dirt over open ground, then rides up and
 * snags on the treetops over forest — all from one number per query.
 *
 * Trees are bucketed into a uniform grid ONCE at construction (the forest never
 * moves), so each per-frame query only tests the handful of trees in the 3×3 cells
 * around the bucket — O(1) per frame, holding the mobile-60fps budget even with
 * thousands of trees. Pure numbers: no Three objects, no scene, no DOM.
 */

const CELL = 16; // grid cell size (world units) — comfortably larger than any canopy radius
const CELL_OFFSET = 4096; // shift cell coords positive before packing into one integer key

export class Obstacles {
  private readonly grid = new Map<number, TreeCollider[]>();

  constructor(
    private readonly world: World,
    trees: TreeCollider[],
  ) {
    for (const t of trees) {
      const key = this.cellKey(Math.floor(t.x / CELL), Math.floor(t.z / CELL));
      let bucket = this.grid.get(key);
      if (!bucket) {
        bucket = [];
        this.grid.set(key, bucket);
      }
      bucket.push(t);
    }
  }

  /**
   * Highest collision surface Y at world (x, z): the ground, raised to any tree
   * canopy cone whose footprint covers this point. Over water this is just the
   * (carved) lakebed — far below the surface — so the bucket still dips to scoop.
   */
  heightAt(x: number, z: number): number {
    let h = this.world.groundHeightAt(x, z);

    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const bucket = this.grid.get(this.cellKey(gx, gz));
        if (!bucket) continue;
        for (const t of bucket) {
          const d = Math.hypot(x - t.x, z - t.z);
          if (d >= t.radius) continue;
          // Cone profile: full apex at the trunk, tapering linearly to the ground
          // at the footprint edge — a smooth ramp the bucket rides up onto.
          const canopy = t.baseY + (t.topY - t.baseY) * (1 - d / t.radius);
          if (canopy > h) h = canopy;
        }
      }
    }
    return h;
  }

  /** Pack signed cell coords into one integer key (forest stays within ±CELL_OFFSET cells). */
  private cellKey(cx: number, cz: number): number {
    return (cx + CELL_OFFSET) * (CELL_OFFSET * 2) + (cz + CELL_OFFSET);
  }
}
