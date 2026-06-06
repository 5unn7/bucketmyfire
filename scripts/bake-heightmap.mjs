// Heightmap bake (build-time, Node). Turns a downloaded mountain MESH master (a Blender OBJ
// heightfield) into the tiny, normalized height grid the engine bakes into terrain — so the heavy
// .obj/.blend/.rar binaries never ship. This is the "model → terrain" path: the mesh is a SOURCE of
// shape, not a runtime asset (the game has no mesh to load; World adds the relief into baseHeight).
//
//   node scripts/bake-heightmap.mjs
//
// Reads the master from art-source/ (gitignored, like the other optimize-assets masters), rasterises
// the named sub-object's (x,z,height) samples into an N×N grid (scatter → dilate empties → light blur),
// normalises to [0,1], and writes a base64-packed Uint8 grid to a committed TS module. Re-run only to
// regenerate; the generated TS is what the game + verifier read, so the game stays reproducible without
// the master. Deterministic + dependency-free (plain Node, no Three).
//
// Add another baked mountain = add a row to JOBS and re-run.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const N = 64; // output grid resolution (per side). Source is ~60×60, so 64 captures it natively.

const JOBS = [
  {
    // The Cypress Hills massif. Master sits in art-source/ (moved out of public/ so it isn't deployed).
    src: 'art-source/models/mountain/mount.blend1.obj',
    object: 'Landscape', // the OBJ also has a flat ground "Plane" we ignore
    out: 'src/three/maps/saskatchewan/cypressHeightmap.ts',
    exportName: 'CYPRESS_HEIGHTMAP',
    title: 'Cypress Hills',
  },
];

/** Parse one named `o <object>` block from an OBJ and return its vertices [[x,y,z], ...]. */
function readObjObject(file, objectName) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inObj = false;
  const vs = [];
  for (const ln of lines) {
    if (ln.startsWith('o ')) {
      inObj = ln.slice(2).trim() === objectName;
      continue;
    }
    if (inObj && ln.startsWith('v ')) {
      const p = ln.slice(2).trim().split(/\s+/).map(Number);
      if (p.length >= 3 && p.every((v) => Number.isFinite(v))) vs.push(p);
    }
  }
  if (!vs.length) throw new Error(`no vertices found for object "${objectName}" in ${file}`);
  return vs;
}

/** Rasterise scattered (x,z,height) samples into an N×N normalized [0,1] grid (row-major, +Z down). */
function rasterise(vs, n) {
  const xs = vs.map((v) => v[0]);
  const ys = vs.map((v) => v[1]); // height (Y-up)
  const zs = vs.map((v) => v[2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const spanX = maxX - minX || 1, spanZ = maxZ - minZ || 1, spanY = maxY - minY || 1;

  // Pass 1 — scatter: accumulate each vertex into its nearest cell (sum + count → average).
  const sum = new Float64Array(n * n);
  const cnt = new Uint32Array(n * n);
  for (const v of vs) {
    const gx = Math.min(n - 1, Math.max(0, Math.round(((v[0] - minX) / spanX) * (n - 1))));
    const gz = Math.min(n - 1, Math.max(0, Math.round(((v[2] - minZ) / spanZ) * (n - 1))));
    const i = gz * n + gx;
    sum[i] += (v[1] - minY) / spanY; // normalized height [0,1]
    cnt[i] += 1;
  }
  const filled = new Uint8Array(n * n);
  const grid = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (cnt[i]) {
      grid[i] = sum[i] / cnt[i];
      filled[i] = 1;
    }
  }

  // Pass 2 — dilate: fill empty cells from filled neighbours, repeat until none remain.
  let remaining = grid.length - filled.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (remaining > 0 && guard++ < n) {
    const nextG = grid.slice();
    const nextF = filled.slice();
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = z * n + x;
        if (filled[i]) continue;
        let acc = 0, k = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nx >= n || nz < 0 || nz >= n) continue;
            const j = nz * n + nx;
            if (filled[j]) { acc += grid[j]; k++; }
          }
        }
        if (k) { nextG[i] = acc / k; nextF[i] = 1; }
      }
    }
    grid.set(nextG);
    filled.set(nextF);
    remaining = grid.length - filled.reduce((a, b) => a + b, 0);
  }

  // Pass 3 — light box blur (2×) to smooth scatter/dilation seams. Terrain is soft; this is harmless.
  for (let pass = 0; pass < 2; pass++) {
    const next = grid.slice();
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        let acc = 0, k = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nx >= n || nz < 0 || nz >= n) continue;
            acc += grid[nz * n + nx]; k++;
          }
        }
        next[z * n + x] = acc / k;
      }
    }
    grid.set(next);
  }

  // Re-normalize to [0,1] after blur (blur can compress the range slightly).
  let lo = Infinity, hi = -Infinity;
  for (const g of grid) { if (g < lo) lo = g; if (g > hi) hi = g; }
  const span = hi - lo || 1;
  const bytes = new Uint8Array(n * n);
  for (let i = 0; i < grid.length; i++) bytes[i] = Math.round(((grid[i] - lo) / span) * 255);

  return { bytes, aspect: spanX / spanZ, footprint: { x: spanX, z: spanZ }, srcReliefRange: spanY };
}

function fmt(n) {
  return Math.round(n * 1000) / 1000;
}

for (const job of JOBS) {
  if (!existsSync(job.src)) {
    console.error(`  SKIP (missing master): ${job.src}`);
    console.error(`  Place the mountain OBJ there (it was moved out of public/ so it isn't deployed).`);
    continue;
  }
  const vs = readObjObject(job.src, job.object);
  const { bytes, aspect, footprint } = rasterise(vs, N);
  const b64 = Buffer.from(bytes).toString('base64');

  const ts = `// GENERATED by scripts/bake-heightmap.mjs — do not edit by hand. Re-run the script to regenerate.
//
// ${job.title}: a normalized ${N}×${N} height grid (row-major, +Z down), base64-packed Uint8 (0..255).
// Baked from a downloaded mountain mesh master (see art-source/ + ATTRIBUTION). The game has NO mesh to
// load — World samples this grid into terrain relief (see world/heightPatch.ts), so it's collidable
// ground: the flight floor rises over it, fire climbs it, lakes pool at its base. Source footprint
// aspect (X:Z) ≈ ${fmt(footprint.x)}:${fmt(footprint.z)} — set the region patch's widthKm:lengthKm to match.

export const ${job.exportName} = {
  /** Grid resolution per side (the grid is N×N; footprint aspect lives in the region patch's km). */
  n: ${N},
  /** Source footprint aspect ratio X/Z (informational — drives widthKm:lengthKm authoring). */
  aspect: ${fmt(aspect)},
  /** Base64-packed Uint8 normalized heights [0..255], row-major (+Z down). Decode at load. */
  data: '${b64}',
} as const;
`;
  mkdirSync(dirname(job.out), { recursive: true });
  writeFileSync(job.out, ts);
  console.log(`  ${job.title}: ${vs.length} verts → ${N}×${N} grid → ${job.out}`);
  console.log(`     packed ${bytes.length} bytes (base64 ${b64.length} chars), aspect X:Z = ${fmt(footprint.x)}:${fmt(footprint.z)}`);
}
