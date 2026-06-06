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

/** A box geometry (position/normal/uv + a flat per-box vertex colour) ready to merge with the others. */
function coloredBox(w: number, h: number, d: number, cx: number, cy: number, cz: number, color: THREE.Color, mul: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
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
  return g;
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
      // A wider, darker "roof" block on top reads as a pitched cabin roof from the air.
      const rh = Math.max(1.1, h * 0.45);
      geos.push(coloredBox(fw * 1.12, rh, fd * 1.12, bx, gy + h - SETTLEMENT3D.sink + rh / 2, bz, pick(roofPalette, rng), speck * 0.92));
    }
  }
  if (!geos.length) return null;

  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
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
