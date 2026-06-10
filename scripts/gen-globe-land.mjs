/**
 * gen-globe-land.mjs — bake the live-fire GLOBE's basemap outlines into a committed JSON.
 *
 * The 3D tracker globe (src/three/livefire/FireGlobe.ts) paints its earth texture at runtime from
 * vector outlines — procedural-first, no downloaded basemap imagery. This script is the one-time
 * (re)bake: it pulls Natural Earth data (PUBLIC DOMAIN — naturalearthdata.com), decodes/simplifies
 * it, and writes a compact delta-encoded JSON the globe chunk bundles:
 *
 *   • land      — world land polygons (Natural Earth 50m, via the world-atlas TopoJSON mirror)
 *   • borders   — international boundaries (Natural Earth 110m countries; shared-arc extraction)
 *   • provinces — Canadian province/territory boundaries (Natural Earth 50m admin-1 lines)
 *
 * Run: node scripts/gen-globe-land.mjs   (network required; output is committed, builds never fetch)
 * Output: src/three/livefire/globe/land.json (+ ATTRIBUTION.md beside it)
 *
 * Encoding: rings/lines quantized to 0.01° and delta-encoded as flat int arrays
 * [x0, y0, dx1, dy1, …] (lon, lat × 100) — small JSON, a 10-line decoder in basemap.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'three', 'livefire', 'globe');

const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json';
const COUNTRIES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
const PROVINCES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';

// Simplification tolerances (degrees). The texture is 2048px/360° ≈ 0.18°/px, so anything much
// below ~0.05° is sub-pixel; these keep the coastline crisp at max zoom without bloating the JSON.
const TOL_LAND = 0.04;
const TOL_BORDERS = 0.02;
const TOL_PROV = 0.04;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// ── Minimal TopoJSON decode (delta-encoded quantized arcs → lon/lat polylines) ──────────────────
function decodeArcs(topo) {
  const t = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
}

/** Stitch a TopoJSON ring (list of arc indices; ~i = reversed arc) into one [lon,lat] polyline. */
function stitchRing(indices, arcs) {
  const pts = [];
  for (const i of indices) {
    const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]); // skip duplicated joint
  }
  return pts;
}

// ── Douglas–Peucker simplification (iterative; degrees-space — fine for display outlines) ───────
function simplify(pts, tol) {
  if (pts.length <= 4 || tol <= 0) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = px - (ax + t * dx);
      const ey = py - (ay + t * dy);
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tol * tol) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Quantize to 0.01° + delta-encode as a flat int array [x0,y0,dx1,dy1,…]; drops degenerate runs. */
function encode(pts) {
  const out = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = Math.round(pts[i][0] * 100);
    const y = Math.round(pts[i][1] * 100);
    if (i > 0 && x === px && y === py) continue; // quantization collapsed a step — drop it
    out.push(i === 0 ? x : x - px, i === 0 ? y : y - py);
    px = x;
    py = y;
  }
  return out;
}

const encodeAll = (lines, tol, minPts) =>
  lines
    .map((l) => simplify(l, tol))
    .filter((l) => l.length >= minPts)
    .map(encode)
    .filter((e) => e.length >= minPts * 2);

async function main() {
  console.log('fetching Natural Earth sources…');
  const [landTopo, countriesTopo, provGeo] = await Promise.all([
    fetchJson(LAND_URL),
    fetchJson(COUNTRIES_URL),
    fetchJson(PROVINCES_URL).catch((e) => {
      console.warn(`provinces fetch failed (${e.message}) — baking without province lines`);
      return null;
    }),
  ]);

  // Land: every polygon ring (exterior + holes — the painter fills with the evenodd rule).
  // world-atlas wraps the land in a GeometryCollection of (Multi)Polygons; flatten all of them.
  const landArcs = decodeArcs(landTopo);
  const landRings = [];
  const addGeom = (g) => {
    if (g.type === 'Polygon') for (const ring of g.arcs) landRings.push(stitchRing(ring, landArcs));
    else if (g.type === 'MultiPolygon') for (const poly of g.arcs) for (const ring of poly) landRings.push(stitchRing(ring, landArcs));
    else if (g.type === 'GeometryCollection') for (const sub of g.geometries) addGeom(sub);
  };
  addGeom(landTopo.objects.land);

  // International borders: arcs shared by ≥2 country geometries are interior boundaries; arcs used
  // once are coastline (already drawn by the land layer), so we keep only the shared ones.
  const cArcs = decodeArcs(countriesTopo);
  const use = new Map();
  const visit = (arcsOf) => {
    for (const ring of arcsOf) for (const i of ring) use.set(i < 0 ? ~i : i, (use.get(i < 0 ? ~i : i) ?? 0) + 1);
  };
  for (const g of countriesTopo.objects.countries.geometries) {
    if (g.type === 'Polygon') visit(g.arcs);
    else if (g.type === 'MultiPolygon') for (const p of g.arcs) visit(p);
  }
  const borderLines = [...use.entries()].filter(([, n]) => n >= 2).map(([i]) => cArcs[i]);

  // Canadian province/territory boundary lines (admin-1), straight from the GeoJSON line features.
  const provLines = [];
  if (provGeo) {
    for (const f of provGeo.features ?? []) {
      const p = f.properties ?? {};
      if ((p.adm0_a3 ?? p.ADM0_A3) !== 'CAN') continue;
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'LineString') provLines.push(g.coordinates);
      else if (g.type === 'MultiLineString') provLines.push(...g.coordinates);
    }
  }

  const data = {
    v: 1,
    q: 100, // quantization: ints are degrees × 100 (0.01° ≈ 1.1 km)
    land: encodeAll(landRings, TOL_LAND, 4),
    borders: encodeAll(borderLines, TOL_BORDERS, 2),
    provinces: encodeAll(provLines, TOL_PROV, 2),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'land.json');
  fs.writeFileSync(outFile, JSON.stringify(data));
  const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
  console.log(
    `wrote ${path.relative(ROOT, outFile)} — ${kb} KB ` +
      `(${data.land.length} land rings, ${data.borders.length} border lines, ${data.provinces.length} province lines)`,
  );

  fs.writeFileSync(
    path.join(OUT_DIR, 'ATTRIBUTION.md'),
    `# Globe basemap outline data

\`land.json\` is baked by \`scripts/gen-globe-land.mjs\` from **Natural Earth** vector data
(https://www.naturalearthdata.com — public domain; no attribution required, credited anyway):

- World land polygons: Natural Earth 1:50m \`land\`, via the world-atlas TopoJSON mirror
  (https://github.com/topojson/world-atlas).
- International boundaries: Natural Earth 1:110m \`countries\` (shared-arc extraction).
- Canadian province/territory boundaries: Natural Earth 1:50m \`admin_1_states_provinces_lines\`.

The outlines are simplified (Douglas–Peucker) and delta-encoded; the globe paints its earth
texture from them at runtime — no basemap imagery is downloaded or shipped.
`,
  );
  console.log('wrote ATTRIBUTION.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
