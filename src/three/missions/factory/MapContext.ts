/**
 * Read-only view of a built `World` for the mission FACTORY (Slice 3). It exposes just what an archetype
 * needs to author a scenario that fits the actual map: the playfield size, the named towns, and which of
 * them are DEFENSIBLE (a scoop lake is in reach, so a fire there can actually be fought).
 *
 * MapContext is OPTIONAL to an archetype's `build()`: without it, an archetype emits feature-relative
 * placements (anchor:'lake', community:'base', random) that self-snap at Game-build time — cheap, no World
 * needed, which is what the runtime daily uses (NEVER build a World on a phone's boot path — the spec's
 * mobile must-fix). WITH it (build-time pre-bake / host-side co-op, where building a World + running the
 * oracle is fine) an archetype can pick a specific defensible town. Only ANCHORED towns are surfaced, so
 * every town carries a stable string `ref` usable as a `CommunityRef` in a placement.
 */
import type { World } from '../../World';

export interface FactoryTown {
  ref: string; // a CommunityRef (the MapAnchor id) usable directly in fire/zone placements
  name: string;
  x: number;
  z: number;
  defensible: boolean; // scoopable open water within reach → a fire here can be fought
}

export class MapContext {
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly towns: readonly FactoryTown[];

  /** `scoopRange` = how far a town may be from open water and still count as defensible (a few bucket
   *  scoop-loops out). 220u ≈ a comfortable scoop-fly-drop radius on the SK world. */
  constructor(world: World, scoopRange = 220) {
    this.sizeX = world.sizeX;
    this.sizeZ = world.sizeZ;
    this.towns = world.communities
      .filter((c) => c.kind === 'town' && !!c.anchorId)
      .map((c) => ({
        ref: c.anchorId as string,
        name: c.name,
        x: c.x,
        z: c.z,
        defensible: world.isScoopWaterWithin(c.x, c.z, scoopRange),
      }));
  }

  /** Towns a fire can actually be fought near (a scoop lake in range) — the candidates for a defend mission. */
  defensibleTowns(): FactoryTown[] {
    return this.towns.filter((t) => t.defensible);
  }
}
