import * as THREE from 'three';
import { STRUCTURES, STRUCT_FIRE } from '../config';
import type { StructureKind } from '../sim/Structures';
import { createFire } from './fire';

/** Tiny seeded PRNG (mulberry32) so each cabin's variety is deterministic from its id. */
function mkRng(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Scale an RGB hex toward black by `f` (0..1) — for corner logs / ridge caps a shade off the base. */
function darken(hex: number, f: number): number {
  const r = Math.round(((hex >> 16) & 255) * f);
  const g = Math.round(((hex >> 8) & 255) * f);
  const b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}

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
  setBurning(b: number | boolean): void; // flames + HDR glow while threatened
  flicker(elapsedSeconds: number): void; // advance the building's flame animation (call each frame)
}

// Charred target the timber lerps toward as damage rises.
const CHAR = new THREE.Color(0x14100c);
const EMBER = new THREE.Color(0xff5a1e);

interface Part {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  base: THREE.Color; // pristine albedo, kept so setDamage can re-lerp from scratch
}

export function createStructure(kind: StructureKind, seed = 0): StructureMesh {
  return kind === 'depot' ? buildDepot() : buildCabin(seed);
}

// --- Cabin ------------------------------------------------------------------

function buildCabin(seed: number): StructureMesh {
  const rng = mkRng(seed);
  const s = STRUCTURES.cabinSize;
  const group = new THREE.Group();
  group.name = 'cabin';
  const parts: Part[] = [];

  // Per-cabin variety (deterministic): footprint/height jitter + a log + roof tint drawn
  // from the boreal palette, so a hamlet reads as distinct dwellings rather than clones.
  const j = STRUCTURES.sizeJitter;
  const wf = 1 + (rng() - 0.5) * 2 * j; // body width factor
  const df = 1 + (rng() - 0.5) * 2 * j; // body depth factor
  const hf = 1 + (rng() - 0.5) * 2 * j; // wall height factor
  const logTint = pick(STRUCTURES.logTints, rng);
  const roofTint = pick(STRUCTURES.roofTints, rng);

  const bw = s * 2 * wf; // body width (X)
  const bd = s * 1.5 * df; // body depth (Z)
  const wallH = s * 1.1 * hf;
  const ov = STRUCTURES.roofOverhang;

  // Stone/earth footing skirt — a short, slightly wider course that grounds the cabin from the air.
  const foundH = s * 0.18;
  addBox(group, parts, STRUCTURES.foundationTint, bw * 1.06, foundH, bd * 1.06, 0, foundH / 2, 0);

  // Log body, sitting on the footing.
  const body = addBox(group, parts, logTint, bw, wallH, bd, 0, foundH + wallH / 2, 0);
  body.mesh.castShadow = true;
  body.mesh.receiveShadow = true;
  const wallTop = foundH + wallH;

  // Corner logs: a darker post poking proud at each corner — the notched-corner log-cabin read.
  const cr = s * 0.16;
  const cornerTint = darken(logTint, 0.82);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      addCylinder(group, parts, cornerTint, cr, wallH, (sx * bw) / 2, foundH + wallH / 2, (sz * bd) / 2);

  // Door + two small windows on the front (+Z) wall: dark glazing in a light frame.
  const doorH = wallH * 0.6;
  addBox(group, parts, 0x2c2018, s * 0.45, doorH, s * 0.08, 0, foundH + doorH / 2, bd / 2);
  const winY = foundH + wallH * 0.58;
  for (const wx of [-bw * 0.28, bw * 0.28]) {
    addBox(group, parts, STRUCTURES.trimTint, s * 0.42, s * 0.4, s * 0.06, wx, winY, bd / 2);
    addBox(group, parts, STRUCTURES.windowTint, s * 0.3, s * 0.28, s * 0.1, wx, winY, bd / 2 + 0.01);
  }

  // Gable roof with real eaves on all four sides, plus a ridge cap beam along the peak.
  const rise = s * STRUCTURES.roofRiseFactor;
  addRoof(group, parts, roofTint, bw * (1 + ov), rise, bd * (1 + ov * 1.3), wallTop);
  addBox(group, parts, darken(roofTint, 0.8), bw * (1 + ov) * 1.02, s * 0.12, s * 0.16, 0, wallTop + rise, 0);

  // Chimney up one (randomly chosen) gable end: a stone stack, or a thin metal stovepipe (variety).
  const cside = rng() < 0.5 ? 1 : -1;
  if (rng() < STRUCTURES.stovepipeChance) {
    addCylinder(group, parts, 0x3a3d40, s * 0.12, wallH * 1.15, bw * 0.34, wallTop + wallH * 0.25, cside * bd * 0.28);
  } else {
    const chimH = wallH + s * 0.8; // founded on the footing, poking above the eave like a real stack
    addBox(group, parts, 0x6f7176, s * 0.4, chimH, s * 0.4, bw * 0.34, foundH + chimH / 2, cside * bd * 0.28);
  }

  // Optional covered front porch (posts + a low shed roof) — a strong homestead read.
  if (rng() < STRUCTURES.porchChance) addPorch(group, parts, roofTint, logTint, bw, bd, foundH, wallH, s);

  // Optional outbuildings beside the cabin (seeded), set off to +X so they clear the body.
  if (rng() < STRUCTURES.woodpileChance) addWoodpile(group, parts, rng, bw * 0.5 + s * 0.5, -bd * 0.2, s);
  if (rng() < STRUCTURES.shedChance) addShed(group, parts, logTint, roofTint, -bw * 0.5 - s * 0.7, bd * 0.15, s);

  return finalize(group, parts, 0.78, 'cabin'); // a burnt cabin slumps to a low ruin (keeps some height)
}

/** A stacked-log woodpile: a few horizontal logs in two short rows beside the cabin. */
function addWoodpile(group: THREE.Group, parts: Part[], rng: () => number, x: number, z: number, s: number): void {
  const logR = s * 0.12;
  const logL = s * 1.1;
  const rows = 2;
  const perRow = 3;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < perRow; i++) {
      const tint = 0x6a4a2c + Math.floor(rng() * 0x0a0a06);
      addCylinder(group, parts, tint, logR, logL, x, logR + r * logR * 2.05, z + (i - 1) * logR * 2.1, 'x');
    }
  }
}

/** A small lean-to shed: a low box body with a single-slope roof slab. */
function addShed(group: THREE.Group, parts: Part[], wallTint: number, roofTint: number, x: number, z: number, s: number): void {
  const w = s * 1.1;
  const h = s * 0.8;
  const d = s * 0.9;
  addBox(group, parts, wallTint, w, h, d, x, h / 2, z);
  // Slanted roof slab (tilt about Z so it sheds toward +X).
  const roof = addBox(group, parts, roofTint, w * 1.25, s * 0.12, d * 1.2, x, h + s * 0.1, z);
  roof.mesh.rotation.z = 0.22;
}

/** A covered front porch on the +Z wall: two posts carrying a low, slightly-sloped shed roof. */
function addPorch(
  group: THREE.Group,
  parts: Part[],
  roofTint: number,
  postTint: number,
  bw: number,
  bd: number,
  foundH: number,
  wallH: number,
  s: number,
): void {
  const depth = s * 0.9; // how far the porch reaches out past the front wall (+Z)
  const z0 = bd / 2; // the front wall line
  const postH = wallH * 0.82;
  const pz = z0 + depth;
  for (const px of [-bw * 0.4, bw * 0.4]) {
    addCylinder(group, parts, darken(postTint, 0.9), s * 0.1, postH, px, foundH + postH / 2, pz);
  }
  // Low shed roof from the wall out over the posts, sloped down toward the front.
  const roof = addBox(group, parts, roofTint, bw * 0.95, s * 0.1, depth + s * 0.25, 0, foundH + postH + s * 0.05, z0 + depth / 2);
  roof.mesh.rotation.x = -0.12;
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

  return finalize(group, parts, 0.55, 'depot'); // depot collapses less (concrete) — slumps gently
}

// --- Shared damage behavior -------------------------------------------------

function finalize(group: THREE.Group, parts: Part[], collapseDrop: number, kind: StructureKind): StructureMesh {
  let burn = 0; // 0..1 from setBurning (a fire is within threatRadius)
  let dmg = 0; // 0..1 from setDamage (1 − health)

  // Reuse the wildfire flame, scaled to the building (a cabin burns modestly; the base goes up big).
  // DROP its point light so a burning structure never changes the scene's light count (a shader
  // recompile hazard) — the HeroFireLights pool lights burning structures on the ground instead. The
  // flame is built once and hidden until the building catches, so it costs nothing while it's intact.
  const flameSize = kind === 'depot' ? STRUCT_FIRE.depotFlameSize : STRUCT_FIRE.cabinFlameSize;
  const flame = createFire();
  flame.group.remove(flame.light);
  flame.setSize(flameSize);
  flame.setIntensity(0);
  flame.group.visible = false;
  group.add(flame.group);

  // Flame intensity flares in the instant a building catches and roars as it chars to destruction.
  function flameIntensity(): number {
    return burn <= 0 ? 0 : clamp01(STRUCT_FIRE.flameBase + dmg * STRUCT_FIRE.flameGain);
  }

  // Re-apply flame + glow from the current (burn, dmg, collapse) state. Cheap; called by both setters.
  function refresh(): void {
    const fi = flameIntensity();
    const lit = fi > 0.001;
    flame.group.visible = lit;
    if (lit) {
      flame.setIntensity(fi);
      // Counter the collapse scale so the flame stays full-height + upright while the building slumps.
      flame.group.scale.set(1 / Math.max(0.1, group.scale.x), 1 / Math.max(0.1, group.scale.y), 1 / Math.max(0.1, group.scale.z));
    }
    for (const p of parts) {
      // Char the timber toward black with damage; while burning, glow it HOT in HDR so the building
      // blooms into a beacon at night (was a dull LDR tint that barely read).
      p.material.color.copy(p.base).lerp(CHAR, dmg * 0.85);
      p.material.emissive.copy(EMBER).multiplyScalar(lit ? STRUCT_FIRE.glowHDR * fi : 0);
    }
  }

  function setDamage(d: number): void {
    dmg = clamp01(d);
    // Progressive collapse: char + sag from collapseStart all the way to destruction (no longer a
    // last-instant snap), so you can SEE a structure losing the fight and racing to save it matters.
    const sag = smoothstep01((dmg - STRUCT_FIRE.collapseStart) / Math.max(0.001, 1 - STRUCT_FIRE.collapseStart));
    group.scale.set(1 - 0.14 * sag, 1 - collapseDrop * sag, 1 - 0.14 * sag);
    group.rotation.z = 0.13 * sag;
    refresh();
  }

  function setBurning(b: number | boolean): void {
    burn = typeof b === 'number' ? clamp01(b) : b ? 1 : 0;
    refresh();
  }

  function flicker(elapsedSeconds: number): void {
    if (flame.group.visible) flame.flicker(elapsedSeconds);
  }

  setBurning(0);
  setDamage(0);
  return { group, setDamage, setBurning, flicker };
}

function smoothstep01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
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
  axis: 'y' | 'x' | 'z' = 'y',
): Part {
  const material = mat(color);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), material);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2; // lay the cylinder along X (a horizontal log)
  else if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
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
