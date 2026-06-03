import * as THREE from 'three';
import { STRUCTURES } from '../config';
import type { StructureKind } from '../sim/Structures';

/**
 * Procedural buildings to defend (Track C3 — stakes). A log cabin (box body + gable
 * roof + stone chimney) or a larger lakeside depot (wide body + flat roof + a helipad
 * pad with an "H"), all from primitive geometry — ZERO binary assets.
 *
 * Driven by two signals from sim/Structures.ts via `Game.ts`:
 *   - `setDamage(d)` 0→1 chars the timber darker and, past the threshold, collapses the
 *     building into a slumped, blackened ruin.
 *   - `setBurning(b)` adds a hot emissive ember glow while a fire is eating at it.
 *
 * Y is up; the group origin sits on the ground (everything is built above y=0) so the
 * caller just sets `group.position` to a terrain point.
 */

export interface StructureMesh {
  group: THREE.Group;
  setDamage(d: number): void; // 0 pristine → 1 destroyed
  setBurning(b: number | boolean): void; // ember glow while threatened
}

// Charred target the timber lerps toward as damage rises.
const CHAR = new THREE.Color(0x14100c);
const EMBER = new THREE.Color(0xff5a1e);
const COLLAPSE_AT = 0.999; // damage at which the structure visibly slumps to ruin

interface Part {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  base: THREE.Color; // pristine albedo, kept so setDamage can re-lerp from scratch
}

export function createStructure(kind: StructureKind): StructureMesh {
  return kind === 'depot' ? buildDepot() : buildCabin();
}

// --- Cabin ------------------------------------------------------------------

function buildCabin(): StructureMesh {
  const s = STRUCTURES.cabinSize;
  const group = new THREE.Group();
  group.name = 'cabin';
  const parts: Part[] = [];

  const wallH = s * 1.1;
  const body = addBox(group, parts, 0x6b4a2f, s * 2, wallH, s * 1.5, 0, wallH / 2, 0);
  body.mesh.castShadow = true;
  body.mesh.receiveShadow = true;

  // Gable roof: a prism made from a triangular extrude, spanning the body.
  const roof = addRoof(group, parts, 0x4a2f1c, s * 2.2, s * 0.9, s * 1.7, wallH);

  // Stone chimney up one side.
  addBox(group, parts, 0x6f7176, s * 0.4, s * 1.4, s * 0.4, s * 0.7, wallH * 0.5 + s * 0.5, -s * 0.45);

  void roof;
  return finalize(group, parts, 1.0);
}

// --- Depot ------------------------------------------------------------------

function buildDepot(): StructureMesh {
  const s = STRUCTURES.depotSize;
  const group = new THREE.Group();
  group.name = 'depot';
  const parts: Part[] = [];

  const wallH = s * 0.9;
  const body = addBox(group, parts, 0x7a7d82, s * 2.2, wallH, s * 1.6, 0, wallH / 2, 0);
  body.mesh.castShadow = true;
  body.mesh.receiveShadow = true;

  // Flat roof slab with a slight overhang.
  addBox(group, parts, 0x55585c, s * 2.4, s * 0.18, s * 1.8, 0, wallH + s * 0.09, 0);

  // Helipad: a dark disc beside the building with a painted "H" (two bars + crossbar).
  const padR = s * 0.95;
  const padX = s * 1.9;
  addCylinder(group, parts, 0x2b2e33, padR, 0.12, padX, 0.06, 0);
  const markH = 0.14;
  addBox(group, parts, 0xe8eef2, padR * 0.18, markH, padR * 0.9, padX - padR * 0.35, 0.14, 0);
  addBox(group, parts, 0xe8eef2, padR * 0.18, markH, padR * 0.9, padX + padR * 0.35, 0.14, 0);
  addBox(group, parts, 0xe8eef2, padR * 0.7, markH, padR * 0.2, padX, 0.14, 0);

  return finalize(group, parts, 0.55); // depot collapses less (concrete) — slumps gently
}

// --- Shared damage behavior -------------------------------------------------

function finalize(group: THREE.Group, parts: Part[], collapseDrop: number): StructureMesh {
  let burn = 0;

  function setDamage(d: number): void {
    const dd = clamp01(d);
    for (const p of parts) {
      p.material.color.copy(p.base).lerp(CHAR, dd * 0.85);
      // Re-apply the ember on top of the (possibly re-charred) base each call.
      p.material.emissive.copy(EMBER).multiplyScalar(burn * 0.6 * (0.4 + 0.6 * dd));
    }
    // Past the threshold the building is a ruin: slump it down and tilt slightly.
    if (dd >= COLLAPSE_AT) {
      group.scale.set(1, 1 - collapseDrop, 1);
      group.rotation.z = 0.12;
    } else {
      group.scale.set(1, 1, 1);
      group.rotation.z = 0;
    }
  }

  function setBurning(b: number | boolean): void {
    burn = typeof b === 'number' ? clamp01(b) : b ? 1 : 0;
    for (const p of parts) {
      p.material.emissive.copy(EMBER).multiplyScalar(burn * 0.6);
    }
  }

  setBurning(0);
  setDamage(0);
  return { group, setDamage, setBurning };
}

// --- Geometry helpers -------------------------------------------------------

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.0 });
}

function addBox(
  group: THREE.Group,
  parts: Part[],
  color: number,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): Part {
  const material = mat(color);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const part: Part = { mesh, material, base: material.color.clone() };
  parts.push(part);
  return part;
}

function addCylinder(
  group: THREE.Group,
  parts: Part[],
  color: number,
  r: number,
  h: number,
  x: number,
  y: number,
  z: number,
): Part {
  const material = mat(color);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), material);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  group.add(mesh);
  const part: Part = { mesh, material, base: material.color.clone() };
  parts.push(part);
  return part;
}

/** A gable (triangular-prism) roof centered on the body, ridge running along X. */
function addRoof(
  group: THREE.Group,
  parts: Part[],
  color: number,
  span: number,
  rise: number,
  depth: number,
  baseY: number,
): Part {
  // Triangle cross-section in the ZY plane, extruded along X.
  const shape = new THREE.Shape();
  shape.moveTo(-depth / 2, 0);
  shape.lineTo(depth / 2, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false });
  geom.translate(0, 0, -span / 2); // center the extrusion on X
  geom.rotateY(Math.PI / 2); // ridge now runs along X
  const material = mat(color);
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(0, baseY, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const part: Part = { mesh, material, base: material.color.clone() };
  parts.push(part);
  return part;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
