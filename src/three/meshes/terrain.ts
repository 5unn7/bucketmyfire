import * as THREE from 'three';
import { World } from '../World';

/**
 * Procedural forest-floor terrain for the 3D world.
 *
 * A large ground plane laid flat in the XZ plane (Y up), centered on the origin.
 * Every vertex is displaced by `world.groundHeightAt(x, z)` — the SAME function the
 * sims, placement, and lake meshes read — so the rendered surface and every height
 * query share one frame of reference. The carved lake basins (bowls below each flat
 * water plane) therefore become real geometry here for free.
 *
 * The mesh holds no height function of its own anymore; callers that need a surface
 * height ask the `World` directly.
 */

export interface Terrain {
  mesh: THREE.Mesh; // the ground, in the XZ plane, Y up
}

// Segments per side. 120 → 120*120*2 = 28,800 triangles for the whole ground —
// a comfortable mobile budget that still resolves the rolling hills (and now the
// carved lake basins) smoothly.
const SEGMENTS = 120;

export function createTerrain(world: World): Terrain {
  // PlaneGeometry is built in the XY plane; we rotate it −90° about X so it lies
  // flat in XZ with +Y up. After the rotation, getX/getZ read true world X/Z.
  const geometry = new THREE.PlaneGeometry(world.size, world.size, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  // Displace every vertex by the shared world height, then color it by BIOME (A2):
  // meadow / forest / rock / shore from elevation × moisture × slope × water-distance.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, world.groundHeightAt(x, z));

    const [r, g, b] = world.biomes.sample(x, z).color;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  pos.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Recompute normals after displacement so the sun lights the hills + basins.
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95, // matte forest floor — minimal specular
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;

  return { mesh };
}
