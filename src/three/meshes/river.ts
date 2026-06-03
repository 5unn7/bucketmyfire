import * as THREE from 'three';
import type { RiverRuntime } from '../World';

/**
 * Procedural stream / mini-river surface (Track A4) — a thin water ribbon that follows
 * the river's meandering polyline, its surface descending along the run. Built in WORLD
 * coordinates (mesh sits at the origin) so it shares the one animated water material
 * with the lakes: each vertex carries the same `aDepth` (surface − ground) the shader
 * uses for depth-fade color + shoreline foam, so streams read as the same water.
 *
 * Each cross-section is three vertices — left edge, center (deepest), right edge — so
 * the depth-fade shows across the channel; consecutive sections are stitched into a
 * strip. Winding is corrected to face +Y after the fact.
 */
export function createRiverMesh(
  river: RiverRuntime,
  groundHeightAt: (x: number, z: number) => number,
  material: THREE.Material,
): THREE.Mesh {
  const n = river.pts.length;
  const positions = new Float32Array(n * 3 * 3);
  const depth = new Float32Array(n * 3);
  const w = river.width;

  for (let i = 0; i < n; i++) {
    const p = river.pts[i];
    const prev = river.pts[Math.max(0, i - 1)];
    const next = river.pts[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz; // perpendicular to the tangent
    const nz = tx;
    const surf = river.surfStart + (river.surfEnd - river.surfStart) * (river.cum[i] / river.total);

    const lx = p.x + nx * w;
    const lz = p.z + nz * w;
    const rx = p.x - nx * w;
    const rz = p.z - nz * w;
    const b = i * 3;
    writeVert(positions, depth, b, lx, surf, lz, groundHeightAt);
    writeVert(positions, depth, b + 1, p.x, surf, p.z, groundHeightAt);
    writeVert(positions, depth, b + 2, rx, surf, rz, groundHeightAt);
  }

  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 3;
    const c = (i + 1) * 3;
    const L0 = a;
    const C0 = a + 1;
    const R0 = a + 2;
    const L1 = c;
    const C1 = c + 1;
    const R1 = c + 2;
    indices.push(L0, C0, C1, L0, C1, L1); // left half-strip
    indices.push(C0, R0, R1, C0, R1, C1); // right half-strip
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Ensure the ribbon faces up; reverse winding once if computeVertexNormals points it down.
  const nrm = geometry.attributes.normal as THREE.BufferAttribute;
  if (nrm.getY(1) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'river';
  mesh.receiveShadow = true;
  return mesh;
}

function writeVert(
  pos: Float32Array,
  depth: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  groundHeightAt: (x: number, z: number) => number,
): void {
  pos[i * 3] = x;
  pos[i * 3 + 1] = y;
  pos[i * 3 + 2] = z;
  depth[i] = Math.max(0, y - groundHeightAt(x, z));
}
