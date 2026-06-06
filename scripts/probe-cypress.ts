// One-off probe (not a CI gate): visualise the Cypress Hills massif baked into the SK terrain and confirm
// Cypress Lake survives on the low flank. Bundled like verify:campaign (esbuild → Node). Run:
//   npx esbuild scripts/probe-cypress.ts --bundle --platform=node --format=esm --outfile=scripts/.probe.mjs && node scripts/.probe.mjs
import { World } from '../src/three/World';
import { getRegion } from '../src/three/maps/registry';
import { MAPGEO } from '../src/three/config';

const w = new World(777, { regionId: 'saskatchewan' });
const region = getRegion('saskatchewan');
const m2u = (u: number) => Math.round(u * MAPGEO.metresPerUnit); // world units → metres for readability

// cypress-hills base + its scoop lake centroid (from the anchor outline).
const base = region.anchors!.find((a) => a.id === 'cypress-hills')!;
const outline = base.scoop!.outline!;
const cLat = outline.reduce((s, p) => s + p.lat, 0) / outline.length;
const cLon = outline.reduce((s, p) => s + p.lon, 0) / outline.length;

const basePos = w.toWorld(base.lat, base.lon);
const lakePos = w.toWorld(cLat, cLon);

console.log('world size', Math.round(w.sizeX), 'x', Math.round(w.sizeZ), ' uPerKm', w.unitsPerKm.toFixed(3));
console.log('cypress-hills BASE  lat/lon', base.lat, base.lon, '-> XZ', basePos.x.toFixed(0), basePos.z.toFixed(0));
console.log('  ground@base', m2u(w.groundHeightAt(basePos.x, basePos.z)), 'm  overWater?', w.isOverWater(basePos.x, basePos.z));
console.log('Cypress LAKE centroid lat/lon', cLat.toFixed(3), cLon.toFixed(3), '-> XZ', lakePos.x.toFixed(0), lakePos.z.toFixed(0));
const wl = w.waterLevelAt(lakePos.x, lakePos.z);
console.log('  waterLevel@lake', wl === null ? 'NULL (no water here!)' : m2u(wl) + 'm', ' ground', m2u(w.groundHeightAt(lakePos.x, lakePos.z)), 'm');

// Sample a height grid over a box covering the WHOLE chain to see the range + lake.
const patches = region.heightPatches!;
const pxs = patches.map((p) => w.toWorld(p.lat, p.lon));
const minPX = Math.min(...pxs.map((p) => p.x)), maxPX = Math.max(...pxs.map((p) => p.x));
const minPZ = Math.min(...pxs.map((p) => p.z)), maxPZ = Math.max(...pxs.map((p) => p.z));
const cX = (minPX + maxPX) / 2, cZ = (minPZ + maxPZ) / 2;
const margin = 35 * w.unitsPerKm;
const halfX = (maxPX - minPX) / 2 + margin;
const halfZ = (maxPZ - minPZ) / 2 + margin;
console.log(`\nchain summit span: ${Math.round(maxPX - minPX)}u (E–W) × ${Math.round(maxPZ - minPZ)}u (N–S)`);
const GX = 60, GZ = 30;
let maxH = -1e9, maxAt = { x: 0, z: 0 };
const rows: string[] = [];
for (let gz = 0; gz < GZ; gz++) {
  let row = '';
  const z = cZ - halfZ + (2 * halfZ * gz) / (GZ - 1);
  for (let gx = 0; gx < GX; gx++) {
    const x = cX - halfX + (2 * halfX * gx) / (GX - 1);
    const h = w.groundHeightAt(x, z);
    if (h > maxH) { maxH = h; maxAt = { x, z }; }
    if (Math.hypot(x - basePos.x, z - basePos.z) < 5 * w.unitsPerKm) row += '#';
    else if (Math.hypot(x - lakePos.x, z - lakePos.z) < 5 * w.unitsPerKm) row += '@';
    else if (w.isOverWater(x, z)) row += '~';
    else {
      const mm = h * MAPGEO.metresPerUnit;
      row += mm < 30 ? '.' : mm < 90 ? ':' : mm < 160 ? 'o' : mm < 240 ? 'O' : '8';
    }
  }
  rows.push(row);
}
console.log(`(box ±${Math.round(halfX / w.unitsPerKm)}km E–W × ±${Math.round(halfZ / w.unitsPerKm)}km N–S; N up, '~'=water '#'=base '@'=lake)`);
for (const r of rows) console.log('  ' + r);
console.log(`peak in chain ≈ ${m2u(maxH)} m`);
console.log('legend heights: .<30  :<90  o<160  O<240  8>=240 m');
// Per-summit height (so we can see the chain isn't a single lift + spot the valleys between).
console.log('per-summit ground height:');
for (let i = 0; i < patches.length; i++) {
  const p = patches[i], pp = pxs[i];
  console.log(`  ${i}: lat ${p.lat} lon ${p.lon}  -> ${m2u(w.groundHeightAt(pp.x, pp.z))} m`);
}
