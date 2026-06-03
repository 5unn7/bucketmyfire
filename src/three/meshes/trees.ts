import * as THREE from 'three';

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

export interface TreeFieldOptions {
  candidates: number; // how many positions to TRY (each accepted with its biome density)
  size: number; // square area extent; scatter X,Z in [-size/2, +size/2]
  heightAt: (x: number, z: number) => number; // terrain surface Y at an XZ — place each tree trunk-base on the ground
  sample: (x: number, z: number) => TreeSample; // biome density + foliage tint at an XZ (A2)
  rng: () => number; // seeded PRNG → deterministic forest for a given world seed
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

export interface TreeField {
  object: THREE.Object3D; // the two InstancedMeshes (trunks + foliage)
  colliders: TreeCollider[]; // per-tree collision proxies for bucket snag/scrape
}

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

  const group = new THREE.Group();
  group.name = 'TreeField';

  // --- Trunk geometry: a short cylinder lifted so its base sits at y=0. ---
  const trunkGeo = new THREE.CylinderGeometry(
    TRUNK_RADIUS * 0.7,
    TRUNK_RADIUS,
    TRUNK_HEIGHT,
    RADIAL_SEGMENTS,
  );
  trunkGeo.translate(0, TRUNK_HEIGHT / 2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 1 });

  // --- Foliage geometry: three stacked cones merged into one tapering tree. ---
  // Building the stack into a single BufferGeometry keeps it to ONE instanced
  // mesh (and therefore one draw call) for all foliage in the field.
  const foliageGeo = buildFoliageGeometry();
  // Per-instance tint via instanceColor; base material stays white so the tint shows.
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, candidates);
  trunks.name = 'TreeTrunks';
  trunks.castShadow = true;
  trunks.receiveShadow = true;

  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, candidates);
  foliage.name = 'TreeFoliage';
  foliage.castShadow = true;
  foliage.receiveShadow = true;

  // Scatter. Reused scratch objects so we don't allocate per instance.
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const colliders: TreeCollider[] = [];

  let placed = 0;
  for (let i = 0; i < candidates; i++) {
    const x = (rng() - 0.5) * size; // in [-half, +half]
    const z = (rng() - 0.5) * size;

    // Biome density-rejection: accept this candidate with the biome's tree density
    // (dense in moist forest, sparse in meadow, ~none on rock or water). Consume the
    // rng even when rejected so the stream stays deterministic.
    const biome = sample(x, z);
    if (rng() >= biome.treeDensity) continue;

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

    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(placed, matrix);
    foliage.setMatrixAt(placed, matrix);

    tint.setRGB(biome.treeTint[0], biome.treeTint[1], biome.treeTint[2]);
    foliage.setColorAt(placed, tint);

    // Collision proxy: a canopy cone from the ground up to the scaled apex, with a
    // footprint that scales with the trunk's girth. The bucket physics snags on these.
    colliders.push({
      x,
      z,
      baseY: position.y,
      topY: position.y + CANOPY_APEX * sy,
      radius: COLLIDE_RADIUS * s,
    });

    placed++;
  }

  // Tell Three only `placed` instances are live, so rejected slots aren't drawn.
  trunks.count = placed;
  foliage.count = placed;

  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;

  group.add(trunks, foliage);
  return { object: group, colliders };
}

/**
 * Three green cones stacked into one tapering conifer, merged into a single
 * BufferGeometry. Each cone's base is dropped to where the previous tier's
 * mid-line sits so the tiers overlap like real boreal foliage. Base at y=0.
 */
function buildFoliageGeometry(): THREE.BufferGeometry {
  const tiers = 3;
  const radii = [1.5, 1.1, 0.7]; // widest at the bottom
  const tierHeight = FOLIAGE_HEIGHT / tiers;

  const merged: THREE.BufferGeometry[] = [];
  for (let t = 0; t < tiers; t++) {
    const cone = new THREE.ConeGeometry(radii[t], tierHeight * 1.6, RADIAL_SEGMENTS);
    // Cone is centred on its own origin; lift so its base sits at this tier's
    // start, with each tier overlapping the one below.
    const baseY = FOLIAGE_BOTTOM + t * tierHeight;
    cone.translate(0, baseY + (tierHeight * 1.6) / 2, 0);
    merged.push(cone);
  }

  const geo = mergeGeometries(merged);
  merged.forEach((g) => g.dispose());
  return geo;
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
  const indices = new Uint32Array(indexCount);

  let vOffset = 0; // vertex write cursor (in vertices)
  let iOffset = 0; // index write cursor
  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    positions.set(pos.array as ArrayLike<number>, vOffset * 3);
    normals.set(nrm.array as ArrayLike<number>, vOffset * 3);

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
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingSphere();
  return out;
}
