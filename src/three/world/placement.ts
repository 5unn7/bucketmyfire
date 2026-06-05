import type { World } from '../World';

/**
 * Terrain-aware placement (Track A3). Decides WHERE things belong on the generated
 * world by reading the biome/elevation/slope fields — so fires start and creep through
 * flammable dry forest (where the fuel and trees are), not bare rock, meadow, or water.
 *
 * Trees themselves are already placed by biome density-rejection (A2, in `trees.ts`),
 * which folds in slope via the rock biome — so this module focuses on the new A3
 * behavior: fuel-biased fire siting. Pure logic over the `World` fields; owns no scene.
 */
export class Placement {
  constructor(private readonly world: World) {}

  /**
   * Flammable "fuel" at (x, z) in 0..1 — high in dense forest, low in open meadow,
   * ~0 on bare rock and water. Reuses the biome tree density (forest is fueled by its
   * trees), so fire naturally follows the forest the player can see.
   */
  fuelAt(x: number, z: number): number {
    if (this.world.isOverWater(x, z)) return 0;
    return this.world.biomes.sample(x, z).treeDensity;
  }

  /**
   * Pick a fire start position biased toward dry forest: rejection-sample candidates
   * and accept one with probability equal to its fuel. `rng` keeps it deterministic;
   * `minFromOrigin` keeps the first fires off the player's spawn. Returns null if no
   * fueled spot is found in the attempt budget (caller can retry or skip).
   *
   * `bound` is the X half-extent; `boundZ` (default = bound) the Z half-extent — so a true-shape
   * rectangular world keeps random fires inside the actual playfield, not in the void off its narrow
   * axis. Square maps pass one value → boundZ === bound → the rng stream + sites are byte-identical.
   */
  fireSite(rng: () => number, bound: number, minFromOrigin = 0, boundZ: number = bound): { x: number; z: number } | null {
    for (let i = 0; i < 80; i++) {
      const x = (rng() * 2 - 1) * bound;
      const z = (rng() * 2 - 1) * boundZ;
      if (minFromOrigin > 0 && Math.hypot(x, z) < minFromOrigin) continue;
      const fuel = this.fuelAt(x, z);
      if (fuel <= 0) continue;
      if (rng() < fuel) return { x, z }; // accept in proportion to flammability
    }
    return null;
  }
}
