import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SETTLEMENT3D } from '../config';

/**
 * Decorative settlement skyline ("populate the map" pass) — the buildings that make every town/city/base read
 * as a lived-in place. PURE SCENERY: one merged, vertex-coloured mesh per settlement (≈1 draw call, frustum-
 * culled), built once at load off a LOCAL seed. It is NOT a `sim/Structures` target — these buildings never
 * burn, never count toward a mission's `protect` line, and never touch `world.rng` (so determinism + the
 * campaign verifier are untouched). Three tiers (config `SETTLEMENT3D.tiers`):
 *   - city      — a DENSE downtown of tall flat-roof blocks (taller toward the core) + rooftop mechanicals
 *   - base/community — a low cluster of gabled-look cabins (a roof block on a body box)
 *
 * Y is up; each building drapes onto the terrain (`groundAt`) and is sunk a hair so a flat base covers a gentle
 * slope. Candidates on water — or within an `avoid` radius (landing pads / crew LZs) — are rejected.
 */

export type SettlementTier = 'city' | 'base' | 'community';

export interface SettlementOpts {
  x: number;
  z: number;
  tier: SettlementTier;
  groundAt: (x: number, z: number) => number;
  isWater: (x: number, z: number) => boolean;
  seed: number; // LOCAL deterministic seed (NOT world.rng) — same seed → same skyline
  innerHole?: number; // override the tier's centre keep-clear radius (a base keeps its depot/pad clear)
  avoid?: readonly { x: number; z: number; r: number }[]; // reject candidates near these (pads / LZs)
}

/** Tiny seeded PRNG (mulberry32) — a local stream so decoration never perturbs world.rng / the verifier. */
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

/**
 * Triangular gable-roof prism for cabin-tier settlements — unique verts per face so
 * computeVertexNormals gives flat shading on every slope. The ridge runs along X (at z=cz);
 * every triangle is wound CCW so its outward normal points away from the cabin — otherwise
 * the front slope + both gable ends get inward normals (back-face-culled or lit black, the
 * "broken cabin" look). Six named corners keep the winding auditable.
 */
function coloredPrism(
  span: number, rise: number, depth: number,
  cx: number, cy: number, cz: number,
  color: THREE.Color, mul: number,
): THREE.BufferGeometry {
  const hw = span / 2, hd = depth / 2;
  const r = color.r * mul, g = color.g * mul, b = color.b * mul;
  // Eaves (y=cy) + ridge (y=cy+rise, z=cz). B=back (−Z), F=front (+Z), R=ridge.
  const BL = [cx-hw, cy, cz-hd], BR = [cx+hw, cy, cz-hd];
  const FL = [cx-hw, cy, cz+hd], FR = [cx+hw, cy, cz+hd];
  const RL = [cx-hw, cy+rise, cz], RR = [cx+hw, cy+rise, cz];
  const pos: number[] = [];
  const tri = (a: number[], b2: number[], c: number[]) => pos.push(...a, ...b2, ...c);
  tri(BL, FL, RL);          // left gable end  (−X)
  tri(BR, RR, FR);          // right gable end (+X)
  tri(BL, RL, RR); tri(BL, RR, BR); // back slope  (up + −Z)
  tri(FL, RR, RL); tri(FL, FR, RR); // front slope (up + +Z)
  const positions = new Float32Array(pos);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  const n = positions.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i*3]=r; col[i*3+1]=g; col[i*3+2]=b; }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geom;
}

/** A box geometry with a flat per-box vertex colour, ready to merge with the others. NB: returned
 *  NON-INDEXED with the uv dropped, so its attribute set (position/normal/color) matches `coloredPrism`
 *  exactly — `mergeGeometries` returns null if any sibling differs (indexed-vs-not, or a stray uv), and a
 *  null geometry → `new THREE.Mesh(null)` throws and KILLS the render loop (frozen scene, dead controls). */
function coloredBox(w: number, h: number, d: number, cx: number, cy: number, cz: number, color: THREE.Color, mul: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  g.deleteAttribute('uv'); // settlement material is vertex-coloured (no map) — uv is dead weight + a merge mismatch
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const r = color.r * mul;
  const gg = color.g * mul;
  const b = color.b * mul;
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = gg;
    col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const flat = g.toNonIndexed(); // prism is non-indexed; mergeGeometries needs ALL indexed or NONE
  g.dispose();
  return flat;
}

/**
 * Build ONE settlement's decorative cluster as a single merged mesh. Returns a Group, or null if no building
 * could be placed (every candidate fell on water / too tight — e.g. a lakebound spit). Deterministic from `seed`.
 */
export function createSettlement(opts: SettlementOpts, material: THREE.Material): THREE.Group | null {
  const cfg = SETTLEMENT3D.tiers[opts.tier];
  const rng = mkRng(opts.seed);
  const isCity = opts.tier === 'city';
  const wallPalette = (isCity ? SETTLEMENT3D.cityWalls : SETTLEMENT3D.townWalls).map((c) => new THREE.Color(c));
  const roofCity = new THREE.Color(SETTLEMENT3D.cityRoof);
  const roofPalette = SETTLEMENT3D.townRoof.map((c) => new THREE.Color(c));
  const innerHole = opts.innerHole ?? cfg.innerHole;
  const avoid = opts.avoid ?? [];

  const geos: THREE.BufferGeometry[] = [];
  const placed: { x: number; z: number }[] = [];
  let guard = 0;
  while (placed.length < cfg.count && guard++ < cfg.count * 16) {
    const ang = rng() * Math.PI * 2;
    // sqrt → area-uniform fill; squared again for a city packs the downtown core and thins to the suburbs.
    let rt = Math.sqrt(rng());
    if (isCity) rt *= rt;
    const rad = innerHole + rt * Math.max(1, cfg.spread - innerHole);
    const bx = opts.x + Math.cos(ang) * rad;
    const bz = opts.z + Math.sin(ang) * rad;
    if (opts.isWater(bx, bz)) continue;
    if (placed.some((p) => Math.hypot(p.x - bx, p.z - bz) < cfg.spacing)) continue;
    if (avoid.some((a) => Math.hypot(a.x - bx, a.z - bz) < a.r)) continue;
    placed.push({ x: bx, z: bz });

    const gy = opts.groundAt(bx, bz);
    const fw = cfg.footMin + rng() * (cfg.footMax - cfg.footMin);
    const fd = cfg.footMin + rng() * (cfg.footMax - cfg.footMin);
    // City: taller toward the centre (downtown), shorter at the rim; town/base: a flat range.
    let h: number;
    if (isCity) {
      const core = 1 - rad / cfg.spread; // 1 at centre → 0 at the rim
      h = cfg.minH + (cfg.maxH - cfg.minH) * (0.25 + 0.75 * core) * (0.6 + 0.4 * rng());
    } else {
      h = cfg.minH + rng() * (cfg.maxH - cfg.minH);
    }
    const speck = 1 + (rng() - 0.5) * 2 * SETTLEMENT3D.speckle;
    const wall = pick(wallPalette, rng);
    // Body box, sunk a hair so a flat base covers a gentle slope.
    geos.push(coloredBox(fw, h, fd, bx, gy + h / 2 - SETTLEMENT3D.sink, bz, wall, speck));
    if (cfg.flatRoof) {
      // A thin parapet cap, plus an occasional rooftop mechanical box for skyline variety.
      geos.push(coloredBox(fw * 1.04, 0.6, fd * 1.04, bx, gy + h - SETTLEMENT3D.sink + 0.3, bz, roofCity, speck));
      if (rng() < 0.4) {
        const pw = fw * (0.28 + rng() * 0.26);
        const ph = 1 + rng() * 2.6;
        geos.push(coloredBox(pw, ph, pw, bx + (rng() - 0.5) * fw * 0.35, gy + h - SETTLEMENT3D.sink + ph / 2, bz + (rng() - 0.5) * fd * 0.35, roofCity, speck));
      }
    } else {
      // Gabled log-cabin roof: a peaked prism with eave overhang + a ridge cap beam.
      const rise = Math.max(0.9, fw * 0.44);
      const ov = 0.20; // eave overhang fraction
      const roofColor = pick(roofPalette, rng);
      geos.push(coloredPrism(fw * (1 + ov), rise, fd * (1 + ov), bx, gy + h - SETTLEMENT3D.sink, bz, roofColor, speck * 0.90));
      // Ridge cap
      geos.push(coloredBox(fw * (1 + ov) * 1.01, rise * 0.14, fw * 0.14, bx, gy + h - SETTLEMENT3D.sink + rise, bz, roofColor, speck * 0.72));
    }
  }
  if (!geos.length) return null;

  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  // Defence in depth: a null merge (incompatible attributes) must NOT reach `new THREE.Mesh(null)` —
  // that throws in the ctor, escapes the setAnimationLoop callback, and the rAF chain never reschedules
  // (whole game freezes on a dead canvas while audio plays on). Drop the decoration instead.
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = `settlement:${opts.tier}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'settlement';
  group.add(mesh);
  return group;
}

/** The one shared decorative-building material (vertex-coloured, matte) — all settlements reuse it. */
export function createSettlementMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
}
