import * as THREE from 'three';
import { FIRE3D, FOREST, TREE_TEX } from '../config';
import { loadAlbedo } from './pbrTextures';

/** Drop the CC0 bark albedo onto a trunk material (tiled UP the trunk). No-op when TREE_TEX is off — the
 *  material keeps its flat brown. The bark texture is module-cached + shared across every trunk. */
export function applyBark(trunkMat: THREE.MeshStandardMaterial): void {
  if (!TREE_TEX.enabled) return;
  const bark = loadAlbedo(TREE_TEX.bark, 4);
  bark.repeat.set(1, TREE_TEX.barkRepeat); // u wraps the trunk; tile v up its height
  trunkMat.map = bark;
  trunkMat.color.setHex(0xffffff); // let the bark albedo carry the colour
  trunkMat.needsUpdate = true;
}

/**
 * A dense field of low-poly boreal conifers.
 *
 * The forest is hundreds of trees, but the mobile budget is one frame at 60fps —
 * so we never spawn one mesh per tree. Instead the whole field is TWO
 * `InstancedMesh`es (trunks + foliage cones), each drawn in a single GPU call no
 * matter how many trees we scatter. Per-tree variety (position, yaw, scale) lives
 * entirely in the instance matrices; only the geometry/material is shared.
 *
 * Each tree is modeled with its base at local y=0 and grows up +Y, so dropping
 * an instance onto the terrain is just a translate to `heightAt(x, z)` — the
 * trunk base lands flush on the ground with no per-tree offset math.
 */

export interface TreeSample {
  treeDensity: number; // 0..1 acceptance probability for a tree here
  treeTint: [number, number, number]; // foliage color (0..1 rgb)
}

/**
 * A swappable tree SPECIES — geometry + materials + canopy metrics. Omit to get the
 * default boreal conifer; pass one (see meshes/treeSpecies.ts) for birch/aspen, snags,
 * etc. The same chunk/LOD/collider machinery drives any species, so a mixed forest is
 * just `createTreeField` called once per species with its own density/tint sample.
 */
export interface TreeSpecies {
  trunkGeo: THREE.BufferGeometry;
  trunkMat: THREE.Material;
  foliageGeo: THREE.BufferGeometry;
  foliageLodGeo: THREE.BufferGeometry;
  foliageMat: THREE.Material; // white base + per-instance tint (so wind sway can patch it)
  apex: number; // local canopy apex height (for the collider top)
  collideRadius: number; // canopy footprint radius (for the bucket-snag collider)
}

export interface TreeFieldOptions {
  candidates: number; // how many positions to TRY (each accepted with its biome density)
  size: number; // X area extent; scatter X in [-size/2, +size/2] (square maps: also the Z extent)
  sizeZ?: number; // optional Z extent for a rectangular (true-shape) world; defaults to `size` (square)
  heightAt: (x: number, z: number) => number; // terrain surface Y at an XZ — place each tree trunk-base on the ground
  sample: (x: number, z: number) => TreeSample; // biome density + foliage tint at an XZ (A2)
  rng: () => number; // seeded PRNG → deterministic forest for a given world seed
  species?: TreeSpecies; // optional — defaults to the boreal conifer below
  burnable?: boolean; // if set, trees ignite + char + collapse when the fire field reaches them
  deferred?: boolean; // if set, return an EMPTY field + a `buildStep(budgetMs)` to mesh it across frames
  viewDist?: number; // chunk cull radius override (QUALITY.presets.treeViewDist) — defaults to VIEW_DIST
}

/**
 * One placed tree's collision proxy — a cone the slung bucket can catch on. Pure
 * numbers (no Three objects) so the physics layer can consume it without importing
 * the renderer. `radius` is the canopy footprint; the cone runs from `baseY` (ground)
 * up to `topY` (apex), and obstacle height tapers linearly to ground at the edge.
 */
export interface TreeCollider {
  x: number;
  z: number;
  baseY: number; // ground at the trunk base
  topY: number; // canopy apex (world Y)
  radius: number; // canopy footprint radius for collision
}

/** One burnable tree instance: which chunk meshes + index it lives in, its world XZ, and
 *  its live burn state (0 alive → 1 burning → 2 charred snag). Base transform/colour are
 *  captured on ignition so only burning trees carry that data. */
interface BurnTree {
  foliage: THREE.InstancedMesh;
  lod: THREE.InstancedMesh;
  idx: number;
  x: number;
  z: number;
  state: number;
  t: number; // burn progress 0..1
  bp?: THREE.Vector3; // base position (captured on ignite)
  bq?: THREE.Quaternion; // base rotation
  bs?: THREE.Vector3; // base scale
  bc?: THREE.Color; // base foliage colour
}

// Scratch reused by the burn animation (no per-frame allocation for the hot path).
const _bMat = new THREE.Matrix4();
const _bScale = new THREE.Vector3();
const _bColor = new THREE.Color();

export interface TreeField {
  object: THREE.Object3D; // a group of per-chunk InstancedMeshes (trunks + foliage)
  colliders: TreeCollider[]; // per-tree collision proxies for bucket snag/scrape
  /** Hide chunks beyond the view distance from (camX, camZ) so we only pay for the
   *  trees we can actually see. Frustum culling (free, per-chunk) handles off-screen
   *  ones; this removes the far ring hidden behind the fog. Call once per frame. */
  cull: (camX: number, camZ: number) => void;
  /** Drive tree ignition + burn-down from the fire field (no-op unless `burnable`). A
   *  throttled scan lights trees whose cell is hot; lit trees char + collapse over
   *  `treeBurnTime` into black snags. Call once per frame with the field's `heatAt`. */
  updateFire: (dt: number, heatAt: (x: number, z: number) => number) => void;
  /** Present only when `opts.deferred` is set. Advances the time-budgeted incremental
   *  build (phase-1 candidate scatter, then phase-2 chunk meshing) within `budgetMs`,
   *  and returns `true` once the field is FULLY built. Call once per frame until it
   *  returns true; after that it's a no-op returning true. The candidate loop is paused
   *  and resumed in strict index order, so the deferred build consumes `rng()` in the
   *  IDENTICAL order/count as the synchronous build — same seed → same forest. */
  buildStep?: (budgetMs: number) => boolean;
}

// Spatial chunking for culling. The forest is bucketed into CHUNK-sized cells, each
// its own InstancedMesh pair with a TIGHT bounding sphere — so Three frustum-culls
// the cells you aren't looking at, and `cull()` drops the ones past VIEW_DIST.
const CHUNK = 200; // world units per forest cell
const VIEW_DIST = 480; // default cull radius — callers pass QUALITY.presets.treeViewDist to reach
// toward the (now ~880-1050u) fog on med/high; this floor keeps low tier / legacy callers unchanged
// Geometry LOD: within LOD_DIST a chunk renders full 3-cone trees + trunks; from there
// out to VIEW_DIST it swaps to a cheap single-cone impostor (no trunk), which the fog is
// already softening — a big vertex saving on the mid-distance ring of the big map.
const LOD_DIST = 230;

// One conifer's nominal dimensions (local space, base at y=0).
const TRUNK_HEIGHT = 1.1;
const TRUNK_RADIUS = 0.18;
const FOLIAGE_BOTTOM = 0.7; // foliage starts a touch up the trunk
const FOLIAGE_HEIGHT = 4.4; // total cone stack height above FOLIAGE_BOTTOM
const RADIAL_SEGMENTS = 7; // low poly — cheap silhouette, reads fine at distance

// Foliage apex above the trunk base, in local (unscaled) units — kept in sync with
// buildFoliageGeometry()'s 3-tier cone stack. Used to derive each tree's canopy top.
const CANOPY_APEX = FOLIAGE_BOTTOM + (2 * FOLIAGE_HEIGHT) / 3 + (FOLIAGE_HEIGHT / 3) * 1.6;
const COLLIDE_RADIUS = 1.5 * 0.85; // widest foliage tier (1.5), trimmed so you can thread gaps

export function createTreeField(opts: TreeFieldOptions): TreeField {
  const { candidates, size, heightAt, sample, rng } = opts;
  const sizeZ = opts.sizeZ ?? size; // rectangular maps scatter Z over a different extent than X
  const viewDist = opts.viewDist ?? VIEW_DIST; // per-tier cull radius (QUALITY.presets.treeViewDist)

  const group = new THREE.Group();
  group.name = 'TreeField';

  // Geometry + materials come from the species (default: boreal conifer below). The
  // foliage material is white + per-instance tinted, and shared by the full + LOD meshes
  // so the B6 wind sway (which patches by 'TreeFoliage' name) covers both for free.
  const sp = opts.species ?? defaultConiferSpecies();
  const { trunkGeo, trunkMat, foliageGeo, foliageLodGeo, foliageMat } = sp;
  const apex = sp.apex;
  const collideR = sp.collideRadius;

  // Scatter into spatial chunks. Reused scratch objects so we don't allocate per
  // instance (except the per-tree matrix/color we must keep for the chunked build).
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const colliders: TreeCollider[] = [];

  interface Cell { mats: THREE.Matrix4[]; cols: THREE.Color[]; xs: number[]; zs: number[]; cx: number; cz: number; }
  const cells = new Map<number, Cell>();
  const cellsPerSideX = Math.max(1, Math.ceil(size / CHUNK));
  const cellsPerSideZ = Math.max(1, Math.ceil(sizeZ / CHUNK));

  // Per non-empty chunk: trunks + FULL foliage + a LOD (single-cone) foliage, all sharing
  // geometry/material, each with a tight bounding sphere so Three frustum-culls off-screen
  // cells. `cull()` then picks ONE LOD per chunk by distance so only its level draws.
  const chunkList: {
    trunks: THREE.InstancedMesh;
    foliage: THREE.InstancedMesh;
    foliageLod: THREE.InstancedMesh;
    cx: number;
    cz: number;
  }[] = [];
  // Per-tree burn handles (only when `burnable`): the foliage/LOD meshes + this tree's
  // instance index + its world XZ, so the fire field can ignite it and we can char +
  // collapse just that instance. Base transform/colour are captured lazily on ignition.
  const burns: BurnTree[] = [];

  // --- Incremental build state (hoisted so `buildStep` can pause/resume) ---------------
  // Phase 1 scatters candidates 0..candidates-1 into `cells` (the rng-consuming +
  // groundHeight-sampling phase); phase 2 meshes each cell into an InstancedMesh pair.
  // Both run inline in the synchronous path (infinite budget) and across frames in the
  // deferred path — the SAME stepper, so the rng stream is identical either way.
  let phase1Cursor = 0; // next candidate index to scatter (strict order ⇒ stable rng draws)
  let cellIter: IterableIterator<Cell> | null = null; // phase-2 cell cursor (lazily created)
  let built = false; // whole field fully meshed

  // Scatter ONE candidate (index `i`) into `cells`/`colliders`. Consumes rng() in the
  // exact same order/count as the original inline loop, so pausing between candidates
  // never perturbs determinism.
  const scatterCandidate = (i: number): void => {
    const x = (rng() - 0.5) * size; // in [-sizeX/2, +sizeX/2]
    const z = (rng() - 0.5) * sizeZ; // in [-sizeZ/2, +sizeZ/2]

    // Biome density-rejection: accept this candidate with the biome's tree density
    // (dense in moist forest, sparse in meadow, ~none on rock or water). Consume the
    // rng even when rejected so the stream stays deterministic.
    const biome = sample(x, z);
    if (rng() >= biome.treeDensity) return;

    // Base sits on the terrain surface at this XZ.
    position.set(x, heightAt(x, z), z);
    // Yaw varies by index + a seeded jitter so the field never reads as a grid.
    const yaw = i * 2.399963 + rng() * Math.PI * 2;
    quaternion.setFromAxisAngle(up, yaw);
    // Slight scale variety (height varies a touch more than girth) for a natural,
    // uneven canopy. Vary by index too so it's not purely random noise.
    const s = 0.8 + rng() * 0.5 + (i % 5) * 0.03;
    const sy = s * (0.9 + rng() * 0.3);
    scale.set(s, sy, s);

    const matrix = new THREE.Matrix4().compose(position, quaternion, scale);
    tint.setRGB(biome.treeTint[0], biome.treeTint[1], biome.treeTint[2]);

    const ix = Math.min(cellsPerSideX - 1, Math.max(0, Math.floor((x + size / 2) / CHUNK)));
    const iz = Math.min(cellsPerSideZ - 1, Math.max(0, Math.floor((z + sizeZ / 2) / CHUNK)));
    const key = ix * 4096 + iz;
    let cell = cells.get(key);
    if (!cell) {
      cell = { mats: [], cols: [], xs: [], zs: [], cx: (ix + 0.5) * CHUNK - size / 2, cz: (iz + 0.5) * CHUNK - sizeZ / 2 };
      cells.set(key, cell);
    }
    cell.mats.push(matrix);
    cell.cols.push(tint.clone());
    cell.xs.push(x);
    cell.zs.push(z);

    // Collision proxy: a canopy cone from the ground up to the scaled apex, with a
    // footprint that scales with the trunk's girth. The bucket physics snags on these.
    colliders.push({
      x,
      z,
      baseY: position.y,
      topY: position.y + apex * sy,
      radius: collideR * s,
    });
  };

  // Mesh ONE cell into a trunks/foliage/LOD InstancedMesh trio and register it for
  // culling + burning. Only run after ALL candidates are scattered (a cell's instance
  // count isn't final until phase 1 completes).
  const meshCell = (cell: Cell): void => {
    const n = cell.mats.length;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
    const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, n);
    const foliageLod = new THREE.InstancedMesh(foliageLodGeo, foliageMat, n);
    // Named so callers can find the (shared) materials, e.g. foliage wind. All chunks
    // share one foliageMat, so patching the first found mesh's material covers them all.
    trunks.name = 'TreeTrunks';
    foliage.name = 'TreeFoliage';
    foliageLod.name = 'TreeFoliageLod';
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    foliageLod.castShadow = true; // distant trees still read in the shadow pass
    for (let k = 0; k < n; k++) {
      trunks.setMatrixAt(k, cell.mats[k]);
      foliage.setMatrixAt(k, cell.mats[k]);
      foliageLod.setMatrixAt(k, cell.mats[k]);
      foliage.setColorAt(k, cell.cols[k]);
      foliageLod.setColorAt(k, cell.cols[k]);
    }
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    foliageLod.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    if (foliageLod.instanceColor) foliageLod.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    foliage.computeBoundingSphere();
    foliageLod.computeBoundingSphere();
    foliageLod.visible = false; // near chunks start on the full LOD
    group.add(trunks, foliage, foliageLod);
    chunkList.push({ trunks, foliage, foliageLod, cx: cell.cx, cz: cell.cz });

    if (opts.burnable) {
      for (let k = 0; k < n; k++) {
        burns.push({ foliage, lod: foliageLod, idx: k, x: cell.xs[k], z: cell.zs[k], state: 0, t: 0 });
      }
    }
  };

  // The shared stepper: scatter phase-1 candidates (strict index order) until done, THEN
  // mesh phase-2 cells, returning `true` only once the whole field is built. `budgetMs`
  // caps wall-time per call (use Infinity to build it all in one go). After completion
  // it's a no-op returning true. NOTE phase 1 must FULLY finish before phase 2 starts —
  // a chunk's instance count isn't final until all candidates are scattered.
  const stepBuild = (budgetMs: number): boolean => {
    if (built) return true;
    const start = performance.now();

    // Phase 1 — scatter candidates in strict 0..candidates-1 order.
    while (phase1Cursor < candidates) {
      scatterCandidate(phase1Cursor++);
      if (performance.now() - start >= budgetMs) return false;
    }

    // Phase 2 — mesh cells (only reachable once phase 1 is complete).
    if (!cellIter) cellIter = cells.values();
    let next = cellIter.next();
    while (!next.done) {
      meshCell(next.value);
      if (performance.now() - start >= budgetMs) return false;
      next = cellIter.next();
    }

    built = true;
    return true;
  };

  // Default (synchronous) path: build the whole field now — byte-identical to the old
  // inline loops (same rng order, same cells, same meshes). Deferred callers skip this
  // and drive `stepBuild` themselves over multiple frames.
  if (!opts.deferred) {
    stepBuild(Infinity);
  }

  const cull = (camX: number, camZ: number): void => {
    const view2 = viewDist * viewDist;
    const near2 = LOD_DIST * LOD_DIST;
    for (const c of chunkList) {
      const dx = camX - c.cx;
      const dz = camZ - c.cz;
      const d2 = dx * dx + dz * dz;
      const near = d2 <= near2; // full detail
      const mid = !near && d2 <= view2; // cheap single-cone impostor
      c.trunks.visible = near; // trunks vanish first — invisible at range anyway
      c.foliage.visible = near;
      c.foliageLod.visible = mid;
    }
  };

  // --- Burn controller: ignite trees the fire field reaches, then char + collapse them ---
  let scanTimer = 0;
  let burningCount = 0;
  const dirty = new Set<THREE.InstancedMesh>();

  const updateFire = (dt: number, heatAt: (x: number, z: number) => number): void => {
    if (burns.length === 0 || !Number.isFinite(dt) || dt <= 0) return;

    // Throttled ignition scan: light any un-burnt tree whose cell is hot enough.
    scanTimer -= dt;
    if (scanTimer <= 0) {
      scanTimer = FIRE3D.treeScanInterval;
      for (const b of burns) {
        if (b.state !== 0) continue;
        if (heatAt(b.x, b.z) > FIRE3D.treeIgniteHeat) {
          // Capture this instance's base transform + colour, then start burning.
          b.foliage.getMatrixAt(b.idx, _bMat);
          b.bp = new THREE.Vector3();
          b.bq = new THREE.Quaternion();
          b.bs = new THREE.Vector3();
          _bMat.decompose(b.bp, b.bq, b.bs);
          b.bc = new THREE.Color();
          b.foliage.getColorAt(b.idx, b.bc);
          b.state = 1;
          burningCount++;
        }
      }
    }

    // Animate the burning trees: canopy chars to black and collapses into a snag.
    if (burningCount > 0) {
      dirty.clear();
      for (const b of burns) {
        if (b.state !== 1 || !b.bp || !b.bq || !b.bs || !b.bc) continue;
        b.t += dt / FIRE3D.treeBurnTime;
        const tt = b.t < 1 ? b.t : 1;
        // Canopy shrinks (mostly in Y — it burns down) and narrows a touch.
        _bScale.set(b.bs.x * (1 - 0.2 * tt), b.bs.y * (1 - 0.88 * tt), b.bs.z * (1 - 0.2 * tt));
        _bMat.compose(b.bp, b.bq, _bScale);
        b.foliage.setMatrixAt(b.idx, _bMat);
        b.lod.setMatrixAt(b.idx, _bMat);
        // Char toward near-black.
        _bColor.copy(b.bc).multiplyScalar(1 - 0.93 * tt);
        b.foliage.setColorAt(b.idx, _bColor);
        b.lod.setColorAt(b.idx, _bColor);
        dirty.add(b.foliage);
        dirty.add(b.lod);
        if (b.t >= 1) {
          b.state = 2; // burnt out — a black collapsed snag; stop animating it
          burningCount--;
        }
      }
      for (const m of dirty) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  };

  const field: TreeField = { object: group, colliders, cull, updateFire };
  // Only deferred fields expose the incremental driver — keeping the synchronous return
  // shape (and existing callers/types) untouched. `stepBuild` already short-circuits to
  // `true` once built, so a caller that over-calls it is harmless.
  if (opts.deferred) field.buildStep = stepBuild;
  return field;
}

/**
 * A tapering stack of overlapping green cones merged into one conifer crown, filling
 * FOLIAGE_BOTTOM → CANOPY_APEX. Tier count + roundness + base/apex radii come from the FOREST
 * config so the canopy can be made fuller WITHOUT moving the apex — the collider contract
 * (CANOPY_APEX) stays fixed regardless of tier count, because the tier step is derived to land the
 * topmost cone's tip exactly on CANOPY_APEX. A vertical light gradient is then baked in
 * (bakeCanopyGradient) for self-shadowed depth. Base at y=0.
 */
function buildFoliageGeometry(tiers: number, segments: number): THREE.BufferGeometry {
  const span = CANOPY_APEX - FOLIAGE_BOTTOM; // canopy vertical extent (fixed)
  const tierStep = span / (tiers + 0.6); // chosen so the top cone's tip lands exactly on CANOPY_APEX
  const coneH = tierStep * 1.6; // each cone overruns its step → tiers overlap like real boreal foliage

  const merged: THREE.BufferGeometry[] = [];
  for (let t = 0; t < tiers; t++) {
    // Radius tapers from a broad base to a fine point; the power curve keeps the lower tiers full.
    const f = tiers === 1 ? 0 : t / (tiers - 1);
    const r = FOREST.bottomRadius + (FOREST.topRadius - FOREST.bottomRadius) * Math.pow(f, 0.9);
    const cone = new THREE.ConeGeometry(r, coneH, segments);
    const baseY = FOLIAGE_BOTTOM + t * tierStep;
    cone.translate(0, baseY + coneH / 2, 0);
    merged.push(cone);
  }

  const geo = mergeGeometries(merged);
  merged.forEach((g) => g.dispose());
  bakeCanopyGradient(geo);
  return geo;
}

/**
 * Bake a vertical light gradient into a crown geometry as a per-vertex `color` attribute: the base
 * is darkened (FOREST.aoGradient — fakes the self-shadowing deep in a canopy) and the tips lift
 * toward the sun (FOREST.topLift), with a little deterministic per-vertex jitter so it reads as
 * needles rather than a smooth ramp. The foliage material is white + per-instance biome tint, so
 * this gradient MULTIPLIES the tint (vertexColor × instanceColor) — free depth, no extra draw cost.
 */
function bakeCanopyGradient(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  const span = CANOPY_APEX - FOLIAGE_BOTTOM;
  const base = 1 - FOREST.aoGradient;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const f = Math.min(1, Math.max(0, (y - FOLIAGE_BOTTOM) / span));
    const ramp = base + (FOREST.topLift - base) * (f * f * (3 - 2 * f)); // smoothstep base→tip
    const hash = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const frac = hash - Math.floor(hash); // deterministic [0,1)
    const b = ramp * (1 + FOREST.gradientJitter * (frac - 0.5) * 2);
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** The default species — the boreal conifer (3-cone spruce + brown trunk). */
function defaultConiferSpecies(): TreeSpecies {
  const trunkGeo = new THREE.CylinderGeometry(TRUNK_RADIUS * 0.7, TRUNK_RADIUS, TRUNK_HEIGHT, RADIAL_SEGMENTS);
  trunkGeo.translate(0, TRUNK_HEIGHT / 2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 1 });
  applyBark(trunkMat); // real CC0 bark (no-op when TREE_TEX is off)
  return {
    trunkGeo,
    trunkMat,
    foliageGeo: buildFoliageGeometry(FOREST.canopyTiers, FOREST.radialSegments),
    foliageLodGeo: buildFoliageLOD(),
    // white base × per-instance biome tint × the baked canopy gradient (vertexColors).
    foliageMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }),
    apex: CANOPY_APEX,
    collideRadius: COLLIDE_RADIUS,
  };
}

/**
 * Cheap LOD foliage: ONE cone spanning the whole canopy (vs the full tree's 3-cone
 * stack), at low radial detail. Same silhouette envelope (base radius + apex height) so
 * the impostor lines up with the full tree as a chunk crosses the LOD threshold; the fog
 * hides the simplification. ~5 tris instead of ~40 per tree.
 */
function buildFoliageLOD(): THREE.BufferGeometry {
  const height = CANOPY_APEX - FOLIAGE_BOTTOM; // span the full canopy
  const cone = new THREE.ConeGeometry(FOREST.bottomRadius, height, 5);
  cone.translate(0, FOLIAGE_BOTTOM + height / 2, 0); // base at the foliage start, apex at CANOPY_APEX
  bakeCanopyGradient(cone); // same gradient so the impostor matches the full crown across the LOD swap
  return cone;
}

/**
 * Minimal position+normal geometry merge — keeps us off `three/examples`
 * BufferGeometryUtils so the import stays a clean `'three'`-only file. All the
 * cones share attribute layout (position, normal, uv), so we concatenate them
 * and rebuild an index.
 */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();

  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geos) {
    const pos = g.getAttribute('position');
    vertexCount += pos.count;
    const idx = g.getIndex();
    indexCount += idx ? idx.count : pos.count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2); // preserved so the foliage can carry a leaf texture (TREE_TEX)
  const indices = new Uint32Array(indexCount);

  let vOffset = 0; // vertex write cursor (in vertices)
  let iOffset = 0; // index write cursor
  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    positions.set(pos.array as ArrayLike<number>, vOffset * 3);
    normals.set(nrm.array as ArrayLike<number>, vOffset * 3);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (uv) uvs.set(uv.array as ArrayLike<number>, vOffset * 2); // cones have uv; preserve it through the merge

    const idx = g.getIndex();
    if (idx) {
      for (let k = 0; k < idx.count; k++) {
        indices[iOffset++] = idx.getX(k) + vOffset;
      }
    } else {
      // Non-indexed: vertices are already in triangle order.
      for (let k = 0; k < pos.count; k++) {
        indices[iOffset++] = k + vOffset;
      }
    }
    vOffset += pos.count;
  }

  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingSphere();
  return out;
}
