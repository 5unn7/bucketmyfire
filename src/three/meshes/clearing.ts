import * as THREE from 'three';
import { COMMUNITIES } from '../config';

/**
 * A cleared-yard ground decal (Track A5 polish) — a packed-dirt clearing draped under each
 * settlement so a hamlet reads as lived-in instead of boxes dropped in the forest. It pairs
 * with `World.clearingFactor`, which thins the forest scatter over the SAME radius, so the
 * trees open up exactly where the dirt shows.
 *
 * Built like the road deck: a finely tessellated disc whose vertices ride `groundHeightAt`
 * (so it hugs the rolling terrain at any tessellation), vertex-coloured packed earth with a
 * worn brightness speckle, and a per-vertex ALPHA that fades the rim into the surrounding
 * ground (no hard edge). Sits a hair above the terrain and writes no depth, so it blends as
 * a decal without z-fighting. One transparent vertex-coloured standard material — zero assets.
 */
export function createYardPatch(
  cx: number,
  cz: number,
  groundHeightAt: (x: number, z: number) => number,
  material: THREE.Material,
): THREE.Mesh {
  const R = COMMUNITIES.yardRadius;
  const inner = R * COMMUNITIES.yardInner;
  const rings = 5;
  const seg = 40;
  const lift = 0.12;
  const base = new THREE.Color(COMMUNITIES.yardColor);

  // Vertex 0 is the centre; then `rings` concentric rings of `seg` vertices each.
  const vcount = 1 + rings * seg;
  const positions = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 4); // RGBA → per-vertex alpha for the soft rim

  writeVert(positions, colors, 0, cx, cz, groundHeightAt, lift, base, 1);
  for (let r = 0; r < rings; r++) {
    const rad = (R * (r + 1)) / rings;
    // Alpha: opaque dirt inside `inner`, smoothstepping to 0 at the rim (matches the
    // forest-clearing falloff so the cleared trees and the dirt line up).
    const t = rad <= inner ? 0 : (rad - inner) / (R - inner);
    const alpha = 1 - t * t * (3 - 2 * t);
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const x = cx + Math.cos(a) * rad;
      const z = cz + Math.sin(a) * rad;
      writeVert(positions, colors, 1 + r * seg + s, x, z, groundHeightAt, lift, base, alpha);
    }
  }

  const indices: number[] = [];
  // Inner fan: centre to the first ring.
  for (let s = 0; s < seg; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % seg);
    indices.push(0, a, b);
  }
  // Ring-to-ring quads.
  for (let r = 0; r < rings - 1; r++) {
    const r0 = 1 + r * seg;
    const r1 = 1 + (r + 1) * seg;
    for (let s = 0; s < seg; s++) {
      const a = r0 + s;
      const b = r0 + ((s + 1) % seg);
      const c = r1 + s;
      const d = r1 + ((s + 1) % seg);
      indices.push(a, c, d, a, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'yard';
  mesh.receiveShadow = true;
  mesh.renderOrder = -1; // draw before the roads/structures that layer on top of it
  return mesh;
}

/** The one shared yard material (transparent, vertex-coloured, decal-style). */
export function createYardMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false, // ground decal — blend over terrain without z-fighting
    polygonOffset: true,
    polygonOffsetFactor: -1,
    roughness: 1,
    metalness: 0,
  });
}

function writeVert(
  pos: Float32Array,
  col: Float32Array,
  i: number,
  x: number,
  z: number,
  groundHeightAt: (x: number, z: number) => number,
  lift: number,
  base: THREE.Color,
  alpha: number,
): void {
  pos[i * 3] = x;
  pos[i * 3 + 1] = groundHeightAt(x, z) + lift;
  pos[i * 3 + 2] = z;
  const mul = 1 - COMMUNITIES.yardSpeckle * 0.5 + hash(x * 12.9898 + z * 78.233) * COMMUNITIES.yardSpeckle;
  col[i * 4] = base.r * mul;
  col[i * 4 + 1] = base.g * mul;
  col[i * 4 + 2] = base.b * mul;
  col[i * 4 + 3] = alpha;
}

/** Cheap deterministic hash → [0,1). */
function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}
