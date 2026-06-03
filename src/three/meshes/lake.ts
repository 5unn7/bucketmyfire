import * as THREE from 'three';
import { LAKE_SHAPE } from '../config';

/**
 * Procedural lake water surface for the 3D world — an IRREGULAR disc.
 *
 * The outline is no longer a circle: it's built from the lake's `boundaryRadius(phi)`
 * function (the same elongated + lobed boundary the `World` carves the basin to and
 * tests `isOverWater` against), so the shoreline matches the terrain exactly. The mesh
 * is a fan of concentric rings out to that boundary — enough vertices for the water
 * shader's gentle swell, with a per-vertex **`aDepth`** attribute (waterLevel − ground)
 * driving the depth-fade color and shoreline foam. It lies flat in XZ (Y up); the caller
 * positions it at the lake center + flat water level and shares one water material.
 */

export interface WaterMeshOptions {
  segments: number; // angular tessellation (quality-tier driven)
  centerX: number;
  centerZ: number;
  waterLevel: number; // flat surface Y
  boundaryRadius: (phi: number) => number; // irregular shoreline radius at world angle phi
  groundHeightAt: (x: number, z: number) => number; // World ground, for the depth attribute
  material: THREE.Material; // the shared water ShaderMaterial
}

export function createWater(opts: WaterMeshOptions): THREE.Mesh {
  const { segments, centerX, centerZ, waterLevel, boundaryRadius, groundHeightAt, material } = opts;
  const rings = LAKE_SHAPE.meshRings;
  const ang = Math.max(12, segments);

  const vertCount = 1 + rings * ang; // center + (rings × angular) ring vertices
  const positions = new Float32Array(vertCount * 3);
  const depth = new Float32Array(vertCount);

  // Center vertex (deepest).
  positions[0] = 0;
  positions[1] = 0;
  positions[2] = 0;
  depth[0] = Math.max(0, waterLevel - groundHeightAt(centerX, centerZ));

  // Ring vertices: ring i ∈ 1..rings at fraction i/rings of the boundary radius.
  for (let i = 1; i <= rings; i++) {
    const f = i / rings;
    for (let j = 0; j < ang; j++) {
      const phi = (j / ang) * Math.PI * 2;
      const radius = f * boundaryRadius(phi);
      const lx = Math.cos(phi) * radius;
      const lz = Math.sin(phi) * radius;
      const vi = 1 + (i - 1) * ang + j;
      positions[vi * 3] = lx;
      positions[vi * 3 + 1] = 0;
      positions[vi * 3 + 2] = lz;
      depth[vi] = Math.max(0, waterLevel - groundHeightAt(centerX + lx, centerZ + lz));
    }
  }

  // Triangles. Winding reversed (center, j+1, j) so the surface normal faces +Y.
  const indices: number[] = [];
  const ringStart = (i: number) => 1 + (i - 1) * ang; // first vertex of ring i (1-based)
  // Inner fan: center → ring 1.
  for (let j = 0; j < ang; j++) {
    const a = ringStart(1) + j;
    const b = ringStart(1) + ((j + 1) % ang);
    indices.push(0, b, a);
  }
  // Quad bands between successive rings.
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < ang; j++) {
      const a = ringStart(i) + j;
      const b = ringStart(i) + ((j + 1) % ang);
      const c = ringStart(i + 1) + j;
      const d = ringStart(i + 1) + ((j + 1) % ang);
      indices.push(a, d, c);
      indices.push(a, b, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'lake';
  mesh.receiveShadow = true; // the helicopter's shadow falls on the water
  return mesh;
}
