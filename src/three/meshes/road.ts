import * as THREE from 'three';
import type { RoadRuntime } from '../World';
import { ROADS } from '../config';

/**
 * Procedural GRAVEL bush road (Track A5) — a matte tan-brown dirt ribbon that DRAPES over
 * the terrain, following the road's meandering polyline. Built in WORLD coordinates (the
 * group sits at the origin). Unlike the rivers, a road is NOT carved into the World
 * heightfield (the keystone API stays untouched): it sits a small lift above the ground it
 * crosses and rides a low causeway over water.
 *
 * It deliberately avoids the "cartoon strip" look: no painted centre line, per-vertex
 * brightness SPECKLE (worn gravel, not a flat slab), and slightly RAGGED shoulders (the
 * carriageway half-width wobbles section to section). Each cross-section is three vertices
 * (left edge, centre, right edge) stitched into a strip; the centre rides the surface and
 * each edge blends centre↔own-ground height (ROADS.edgeConform) so a narrow road hugs and
 * gently banks with the terrain. Zero binary assets — one vertex-coloured standard material.
 */

/** `surfaceAt(x,z)` returns the road-deck height: ground+lift on land, water+bridgeLift over water. */
export function createRoadMesh(
  road: RoadRuntime,
  surfaceAt: (x: number, z: number) => number,
  material: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road';
  group.add(buildDeck(road, surfaceAt, material));
  return group;
}

function buildDeck(
  road: RoadRuntime,
  surfaceAt: (x: number, z: number) => number,
  material: THREE.Material,
): THREE.Mesh {
  const pts = road.pts;
  const n = pts.length;
  const positions = new Float32Array(n * 3 * 3);
  const colors = new Float32Array(n * 3 * 3);
  const base = new THREE.Color(ROADS.gravelColor);

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz; // perpendicular to the tangent
    const nz = tx;
    // Ragged shoulders: wobble each side's half-width independently (worn gravel edges).
    const hwL = road.width * (1 + (hash(i * 2 + 1) - 0.5) * 2 * ROADS.edgeRagged);
    const hwR = road.width * (1 + (hash(i * 2 + 7) - 0.5) * 2 * ROADS.edgeRagged);

    const cy = surfaceAt(p.x, p.z) + ROADS.lift; // centreline deck height
    const lx = p.x + nx * hwL;
    const lz = p.z + nz * hwL;
    const rx = p.x - nx * hwR;
    const rz = p.z - nz * hwR;
    // Edge height blends centre↔own-ground so the road banks with terrain (conform).
    const ly = cy + (surfaceAt(lx, lz) + ROADS.lift - cy) * ROADS.edgeConform;
    const ry = cy + (surfaceAt(rx, rz) + ROADS.lift - cy) * ROADS.edgeConform;

    const b = i * 3;
    setVert(positions, b, lx, ly, lz);
    setVert(positions, b + 1, p.x, cy, p.z);
    setVert(positions, b + 2, rx, ry, rz);
    // Per-vertex gravel speckle (brightness around 1.0) — kills the flat-slab/cartoon read.
    setColor(colors, b, base, speckle(lx, lz));
    setColor(colors, b + 1, base, speckle(p.x, p.z));
    setColor(colors, b + 2, base, speckle(rx, rz));
  }

  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 3;
    const c = (i + 1) * 3;
    indices.push(a, a + 1, c + 1, a, c + 1, c); // left half-strip
    indices.push(a + 1, a + 2, c + 2, a + 1, c + 2, c + 1); // right half-strip
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Face up: reverse winding once if normals came out pointing down.
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
  mesh.name = 'roadDeck';
  mesh.receiveShadow = true;
  return mesh;
}

function setVert(pos: Float32Array, i: number, x: number, y: number, z: number): void {
  pos[i * 3] = x;
  pos[i * 3 + 1] = y;
  pos[i * 3 + 2] = z;
}

function setColor(col: Float32Array, i: number, base: THREE.Color, mul: number): void {
  col[i * 3] = base.r * mul;
  col[i * 3 + 1] = base.g * mul;
  col[i * 3 + 2] = base.b * mul;
}

/** Deterministic worn-gravel brightness in [speckleLo, speckleHi] from a world position. */
function speckle(x: number, z: number): number {
  return ROADS.speckleLo + hash(x * 12.9898 + z * 78.233) * (ROADS.speckleHi - ROADS.speckleLo);
}

/** Cheap deterministic hash → [0,1). */
function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}
