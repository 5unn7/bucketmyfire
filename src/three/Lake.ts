import * as THREE from 'three';
import { createWater } from './meshes/lake';

/**
 * A lake you dip the Bambi bucket into. Owns its procedural (irregular) water disc.
 * The water sits at a fixed `waterLevel` (owned by `World`, flat per lake) inside the
 * carved basin; its outline comes from the lake's `boundaryRadius(phi)` so it matches
 * the carved shoreline exactly. One animated water material is shared across all lakes.
 */
export class Lake {
  readonly mesh: THREE.Mesh;

  constructor(
    scene: THREE.Scene,
    readonly x: number,
    readonly z: number,
    readonly r: number,
    readonly waterY: number,
    segments: number,
    boundaryRadius: (phi: number) => number,
    groundHeightAt: (x: number, z: number) => number,
    material: THREE.Material,
  ) {
    this.mesh = createWater({
      segments,
      centerX: x,
      centerZ: z,
      waterLevel: waterY,
      boundaryRadius,
      groundHeightAt,
      material,
    });
    this.mesh.position.set(x, waterY, z);
    scene.add(this.mesh);
  }
}
