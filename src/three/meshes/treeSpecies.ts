import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TreeSpecies } from './trees';

/**
 * Extra procedural tree SPECIES for a mixed boreal forest (zero-asset), built to plug
 * into `createTreeField`'s species slot so they reuse its chunk/LOD/instancing machinery:
 *
 *  - **deciduous** (birch/aspen) — a slim pale trunk under a rounded blobby crown (a few
 *    low-poly icospheres). Tint comes from the placement `sample`, so the same geometry
 *    reads as green birch or golden aspen depending on where it's scattered.
 *  - **snag** — a tall charred dead trunk with a couple of bare branch stubs; fits the
 *    wildfire theme and breaks up the canopy.
 *
 * Foliage materials stay white + per-instance-tinted (so the B6 wind sway patches them by
 * name), and every geometry has its base at y = 0 so it drops onto the terrain cleanly.
 */

// --- Deciduous (birch / aspen) ---------------------------------------------------------

const DECID_TRUNK_H = 2.0;
const DECID_APEX = 4.7;

export function deciduousSpecies(): TreeSpecies {
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.16, DECID_TRUNK_H, 6);
  trunkGeo.translate(0, DECID_TRUNK_H / 2, 0);

  return {
    trunkGeo,
    trunkMat: new THREE.MeshStandardMaterial({ color: 0xc9c3b2, roughness: 0.85 }), // pale birch bark
    foliageGeo: deciduousCrown(),
    foliageLodGeo: blob(1.3, 3.2, 1, 0.95, 1),
    foliageMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    apex: DECID_APEX,
    collideRadius: 1.3,
  };
}

/** A rounded crown from a few overlapping low-poly icospheres (base at y=0). */
function deciduousCrown(): THREE.BufferGeometry {
  const parts = [
    blob(1.25, 2.9, 1.05, 0.9, 1.05),
    blob(0.95, 3.7, 1, 0.95, 1),
    blob(0.85, 2.4, 1.15, 0.7, 1.15),
  ];
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return geo;
}

function blob(r: number, y: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 0); // 20 faces — cheap, reads as a foliage clump
  g.scale(sx, sy, sz);
  g.translate(0, y, 0);
  return g;
}

// --- Burnt snag (dead standing tree) ---------------------------------------------------

const SNAG_H = 3.6;

export function snagSpecies(): TreeSpecies {
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.22, SNAG_H, 6); // tapered charred pole
  trunkGeo.translate(0, SNAG_H / 2, 0);

  return {
    trunkGeo,
    trunkMat: new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 1 }), // charcoal
    foliageGeo: snagBranches(),
    foliageLodGeo: branch(0.05, 0.5, 2.6, 0.5),
    foliageMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), // tinted grey by sample
    apex: SNAG_H,
    collideRadius: 0.5,
  };
}

/** A few bare angled branch stubs near the top of the snag. */
function snagBranches(): THREE.BufferGeometry {
  const parts = [
    branch(0.05, 0.6, 2.7, 0.7),
    branch(0.045, 0.5, 3.1, -0.9),
    branch(0.04, 0.45, 2.4, 2.0),
    branch(0.04, 0.4, 3.0, -2.4),
  ];
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return geo;
}

/** One thin branch stub, angled out from the trunk at height `y`, around the pole by `ang`. */
function branch(r: number, len: number, y: number, ang: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.6, r, len, 4);
  g.rotateZ(Math.PI / 2.6); // lean outward
  g.rotateY(ang); // distribute around the trunk
  g.translate(Math.cos(ang) * len * 0.35, y, Math.sin(ang) * len * 0.35);
  return g;
}

/** mulberry32 — a seeded stream for each extra species so they don't perturb the others. */
export function speciesRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
