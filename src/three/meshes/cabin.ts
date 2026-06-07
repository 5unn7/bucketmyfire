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

function darken(hex: number, f: number): number {
  const r = Math.round(((hex >> 16) & 255) * f);
  const g = Math.round(((hex >> 8) & 255) * f);
  const b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/**
 * Procedural buildings to defend (Track C3 — stakes). A log cabin with stacked
 * horizontal log courses and notched corners, wide asymmetric gable roof with large
 * front overhang sheltering a porch with diagonal knee braces, and a stone chimney
 * on one gable end. Depot is a larger lakeside base. All from primitive geometry.
 *
 * Driven by two signals from sim/Structures.ts via `Game.ts`:
 *   - `setDamage(d)` 0→1 chars the timber darker and collapses the building into a ruin.
 *   - `setBurning(b)` adds a hot emissive ember glow while a fire is eating at it.
 *
 * Y is up; the group origin sits on the ground so the caller just sets `group.position`.
 */

export interface StructureMesh {
  group: THREE.Group;
  setDamage(d: number): void;
  setBurning(b: number | boolean): void;
  flicker(elapsedSeconds: number): void;
}

const CHAR = new THREE.Color(0x14100c);
const EMBER = new THREE.Color(0xff5a1e);

interface Part {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  base: THREE.Color;
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

  const j = STRUCTURES.sizeJitter;
  const wf = 1 + (rng() - 0.5) * 2 * j;
  const df = 1 + (rng() - 0.5) * 2 * j;
  const logTint = pick(STRUCTURES.logTints, rng);
  const roofTint = pick(STRUCTURES.roofTints, rng);

  const bw = s * 2.2 * wf;   // cabin width (X — the long axis)
  const bd = s * 1.8 * df;   // cabin depth (Z — front to back)
  const logR = s * 0.065;    // log radius — thin enough for 8+ courses
  const logPitch = logR * 2.08;
  const wallH = s * 1.1;
  const numLogs = Math.max(5, Math.round(wallH / logPitch));
  const wallTop = numLogs * logPitch + logR;
  const ext = logR * 1.6;    // how far logs extend past the corner notch

  // === STACKED LOG COURSES ===
  // Alternating X/Z logs create the classic notched-corner read: even courses
  // run front+back (X axis, extend past the side walls); odd courses run the
  // sides (Z axis, extend past the front/back walls). Both sets extend by `ext`.
  for (let i = 0; i < numLogs; i++) {
    const y = logR + i * logPitch;
    const shade = 0.80 + rng() * 0.18;
    const c = darken(logTint, shade);
    if (i % 2 === 0) {
      addCylinder(group, parts, c, logR, bw + ext * 2, 0, y, -bd / 2, 'x', 8);
      addCylinder(group, parts, c, logR, bw + ext * 2, 0, y,  bd / 2, 'x', 8);
    } else {
      addCylinder(group, parts, c, logR, bd + ext * 2, -bw / 2, y, 0, 'z', 8);
      addCylinder(group, parts, c, logR, bd + ext * 2,  bw / 2, y, 0, 'z', 8);
    }
  }

  // === GABLE END FILLS ===
  // Flat triangles sitting on top of the log wall at each gable end (±X).
  // Span only the cabin depth (bd) — the roof eaves overhang beyond these.
  const rise = s * STRUCTURES.roofRiseFactor * 1.2;
  const roofSpan = bw + ext * 2; // ridge length in X — matches log wall extents
  addGableEnd(group, parts, darken(logTint, 0.88), bd, rise, wallTop, -roofSpan / 2,  1);
  addGableEnd(group, parts, darken(logTint, 0.88), bd, rise, wallTop,  roofSpan / 2, -1);

  // === GABLE ROOF (asymmetric — more overhang in front for porch shelter) ===
  const ov = STRUCTURES.roofOverhang;
  const porchExt = s * 0.80; // extra front eave extension beyond normal overhang
  const backOv  = bd / 2 + ov * s;             // back eave distance from cabin center
  const frontOv = bd / 2 + ov * s + porchExt;  // front eave distance (larger)
  addRoofAsym(group, parts, roofTint, roofSpan, rise, backOv, frontOv, wallTop);
  // Ridge cap beam along the peak
  addBox(group, parts, darken(roofTint, 0.72), roofSpan * 1.02, s * 0.1, s * 0.14,
         0, wallTop + rise, 0);

  // === CHIMNEY (stone stack on one gable end, centered depth-wise) ===
  const cSide = rng() < 0.5 ? 1 : -1;
  const chimW = s * 0.38;
  const chimH = wallTop + rise * 0.52 + s * 0.22; // pokes above the ridge
  const chimX = cSide * (bw / 2 - s * 0.05);     // at the gable end wall
  addBox(group, parts, 0x6e6860, chimW, chimH, chimW * 0.88, chimX, chimH / 2, 0);
  // Cap (slightly wider, darker)
  addBox(group, parts, 0x524e49, chimW * 1.18, s * 0.09, chimW, chimX, chimH, 0);

  // === DOOR (front face = +Z) ===
  const doorH = wallTop * 0.68;
  addBox(group, parts, 0x2c1a0a, s * 0.42, doorH, s * 0.05, 0, doorH / 2, bd / 2 + 0.02);

  // === WINDOWS (two on the front face, flanking the door) ===
  const winY = wallTop * 0.50;
  for (const wx of [-bw * 0.29, bw * 0.29]) {
    addBox(group, parts, STRUCTURES.trimTint, s * 0.36, s * 0.28, s * 0.05, wx, winY, bd / 2 + 0.01);
    addBox(group, parts, STRUCTURES.windowTint, s * 0.26, s * 0.19, s * 0.07, wx, winY, bd / 2 + 0.02);
  }

  // === FRONT PORCH — diagonal knee braces under the extended front eave (not every cabin) ===
  if (rng() < STRUCTURES.porchChance) addLogPorch(group, parts, logTint, bw, bd, wallTop, porchExt, s);

  // Optional outbuildings
  if (rng() < STRUCTURES.woodpileChance) addWoodpile(group, parts, rng, bw * 0.5 + s * 0.45, -bd * 0.2, s);
  if (rng() < STRUCTURES.shedChance) addShed(group, parts, logTint, roofTint, -bw * 0.5 - s * 0.75, bd * 0.15, s);

  return finalize(group, parts, 0.78, 'cabin');
}

/** Two diagonal knee braces under the wide front eave — the homestead porch read. */
function addLogPorch(
  group: THREE.Group,
  parts: Part[],
  logTint: number,
  bw: number,
  bd: number,
  wallTop: number,
  porchExt: number,
  s: number,
): void {
  const braceThick = s * 0.085;
  const topY = wallTop * 0.88;     // where the brace meets the front wall (near eave)
  const botY = s * 0.10;           // where the brace foot rests
  const fwd  = porchExt * 0.82;   // how far forward the foot reaches

  const dY = topY - botY;
  const braceLen = Math.sqrt(dY * dY + fwd * fwd);
  // Negative rotation.x tilts the top of the standing box toward -Z (into the wall)
  const angle = -Math.atan2(fwd, dY);

  const midY = (topY + botY) / 2;
  const midZ = bd / 2 + fwd / 2;

  for (const bx of [-bw * 0.28, bw * 0.28]) {
    const brace = addBox(group, parts, darken(logTint, 0.80), braceThick, braceLen, braceThick,
                         bx, midY, midZ);
    brace.mesh.rotation.x = angle;
  }
}

/** Stacked-log woodpile beside the cabin. */
function addWoodpile(group: THREE.Group, parts: Part[], rng: () => number, x: number, z: number, s: number): void {
  const logR = s * 0.12;
  const logL = s * 1.1;
  const rows = 2;
  const perRow = 3;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < perRow; i++) {
      const tint = 0x6a4a2c + Math.floor(rng() * 0x0a0a06);
      addCylinder(group, parts, tint, logR, logL, x, logR + r * logR * 2.05, z + (i - 1) * logR * 2.1, 'x', 6);
    }
  }
}

/** Small lean-to shed with a single-slope roof slab. */
function addShed(group: THREE.Group, parts: Part[], wallTint: number, roofTint: number, x: number, z: number, s: number): void {
  const w = s * 1.1;
  const h = s * 0.8;
  const d = s * 0.9;
  addBox(group, parts, wallTint, w, h, d, x, h / 2, z);
  const roof = addBox(group, parts, roofTint, w * 1.25, s * 0.12, d * 1.2, x, h + s * 0.1, z);
  roof.mesh.rotation.z = 0.22;
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

  addBox(group, parts, 0x55585c, s * 2.4, s * 0.18, s * 1.8, 0, wallH + s * 0.09, 0);

  const padR = s * 0.95;
  const padX = s * 1.9;
  addCylinder(group, parts, 0x2b2e33, padR, 0.12, padX, 0.06, 0, 'y', 24);
  const markH = 0.14;
  addBox(group, parts, 0xe8eef2, padR * 0.18, markH, padR * 0.9, padX - padR * 0.35, 0.14, 0);
  addBox(group, parts, 0xe8eef2, padR * 0.18, markH, padR * 0.9, padX + padR * 0.35, 0.14, 0);
  addBox(group, parts, 0xe8eef2, padR * 0.7,  markH, padR * 0.2, padX, 0.14, 0);

  return finalize(group, parts, 0.55, 'depot');
}

// --- Shared damage behavior -------------------------------------------------

function finalize(group: THREE.Group, parts: Part[], collapseDrop: number, kind: StructureKind): StructureMesh {
  let burn = 0;
  let dmg = 0;

  const flameSize = kind === 'depot' ? STRUCT_FIRE.depotFlameSize : STRUCT_FIRE.cabinFlameSize;
  const flame = createFire();
  flame.group.remove(flame.light);
  flame.setSize(flameSize);
  flame.setIntensity(0);
  flame.group.visible = false;
  group.add(flame.group);

  function flameIntensity(): number {
    return burn <= 0 ? 0 : clamp01(STRUCT_FIRE.flameBase + dmg * STRUCT_FIRE.flameGain);
  }

  function refresh(): void {
    const fi = flameIntensity();
    const lit = fi > 0.001;
    flame.group.visible = lit;
    if (lit) {
      flame.setIntensity(fi);
      flame.group.scale.set(1 / Math.max(0.1, group.scale.x), 1 / Math.max(0.1, group.scale.y), 1 / Math.max(0.1, group.scale.z));
    }
    for (const p of parts) {
      p.material.color.copy(p.base).lerp(CHAR, dmg * 0.85);
      p.material.emissive.copy(EMBER).multiplyScalar(lit ? STRUCT_FIRE.glowHDR * fi : 0);
    }
  }

  function setDamage(d: number): void {
    dmg = clamp01(d);
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
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.0, flatShading: true });
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
  segs = 14,
): Part {
  const material = mat(color);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), material);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  else if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const part: Part = { mesh, material, base: material.color.clone() };
  parts.push(part);
  return part;
}

/**
 * Flat triangular gable-end fill sitting on top of the log wall at each ±X end.
 * DoubleSide so it reads correctly from any camera angle.
 */
function addGableEnd(
  group: THREE.Group,
  parts: Part[],
  color: number,
  depth: number,    // cabin depth (bd) — the triangle base in Z
  rise: number,
  baseY: number,
  x: number,        // world X position of this gable face
  normalSign: 1 | -1,
): Part {
  const hd = depth / 2;
  const pos = new Float32Array([
    0, 0, -hd,   // back eave corner
    0, 0,  hd,   // front eave corner
    0, rise, 0,  // ridge peak (centered in Z)
  ]);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // CCW winding when viewed from the outward normal direction (±X)
  geom.setIndex(normalSign > 0 ? [0, 2, 1] : [0, 1, 2]);
  geom.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color, roughness: 0.92, metalness: 0.0, flatShading: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(x, baseY, 0);
  mesh.castShadow = true;
  group.add(mesh);
  const part: Part = { mesh, material, base: material.color.clone() };
  parts.push(part);
  return part;
}

/**
 * Asymmetric gable roof: more overhang in front (+Z) than back to shelter the porch.
 * The ridge sits at z=0 (cabin wall center) so the gable fills align with the peak.
 */
function addRoofAsym(
  group: THREE.Group,
  parts: Part[],
  color: number,
  span: number,       // ridge length (X extent)
  rise: number,       // peak height above baseY
  depthBack: number,  // eave distance from cabin center toward -Z
  depthFront: number, // eave distance from cabin center toward +Z (larger for porch)
  baseY: number,
): Part {
  // Cross-section triangle in the shape's XY plane (maps to world ZY after rotation).
  // shape.x = world Z, shape.y = world Y.
  const shape = new THREE.Shape();
  shape.moveTo(-depthBack, 0);   // back eave
  shape.lineTo(depthFront, 0);   // front eave
  shape.lineTo(0, rise);         // ridge (at z=0 in world space)
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false });
  geom.translate(0, 0, -span / 2);  // center extrusion on X
  geom.rotateY(Math.PI / 2);         // ridge now runs along X
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
