/**
 * Globe basemap — decodes the baked Natural Earth outlines (`land.json`, see ATTRIBUTION.md +
 * scripts/gen-globe-land.mjs) and paints the earth's equirectangular FILL texture at runtime, the
 * procedural-first way: vector data → canvas, no downloaded imagery.
 *
 * Split of duties with FireGlobe:
 *   • this canvas = area fills only (ocean depth + landmass), which upscale softly and read fine;
 *   • EDGES (coastlines, borders, provinces) are returned as polylines and drawn by FireGlobe as
 *     real 3D line geometry, so they stay 1px-crisp at every zoom (a raster stroke would blur).
 *
 * Pure data + 2D canvas — no Three — so it stays unit-testable and the globe chunk owns all GL.
 */
import { GLOBE } from '../../ui/theme';
import LAND from './land.json';

interface LandData {
  v: number;
  q: number; // quantization divisor (ints are degrees × q)
  land: number[][];
  borders: number[][];
  provinces: number[][];
}
const DATA = LAND as LandData;

/** Decode one delta-encoded flat int array [x0,y0,dx1,dy1,…] → [lon,lat][] in degrees. */
function decode(e: number[], q: number): [number, number][] {
  const pts: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < e.length; i += 2) {
    x = i === 0 ? e[0] : x + e[i];
    y = i === 0 ? e[1] : y + e[i + 1];
    pts.push([x / q, y / q]);
  }
  return pts;
}

const decodeAll = (lines: number[][]): [number, number][][] => lines.map((l) => decode(l, DATA.q));

// ── Antimeridian repair (FILL ONLY) ─────────────────────────────────────────────────────────────
// world-atlas dissolves Natural Earth's ±180° cut when it merges `land`, so three rings (Wrangel,
// the Eurasia mainland, Antarctica) WRAP the antimeridian. Drawn naively on an equirect canvas the
// wrap is a full-width chord and the evenodd fill flips into polar bands (the proven dark-arc bug).
// The 3D coastline LINES are fine unwrapped (the wrap segment is a short true neighbour on the
// sphere — splitting would add a fake pole-to-pole "coast" along ±180°), so only the painter splits.

/** Sutherland–Hodgman clip of a polygon against the vertical half-plane x ≥ bound (or ≤). */
function clipX(pts: [number, number][], bound: number, keepGreater: boolean): [number, number][] {
  const out: [number, number][] = [];
  const inside = (p: [number, number]): boolean => (keepGreater ? p[0] >= bound : p[0] <= bound);
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const prev = pts[(i + pts.length - 1) % pts.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      const t = (bound - prev[0]) / (cur[0] - prev[0]);
      out.push([bound, prev[1] + t * (cur[1] - prev[1])]);
    }
    if (curIn) out.push(cur);
  }
  return out;
}

/** Split a ring that crosses the antimeridian into closed polygons fully inside [−180, 180]. A ring
 *  whose unwrapped winding nets ±360° encircles a pole (Antarctica) and is first closed over it. */
function splitRing(ring: [number, number][]): [number, number][][] {
  let crosses = false;
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) { crosses = true; break; }
  }
  if (!crosses) return [ring];
  // Unwrap into continuous longitude space.
  const un: [number, number][] = [ring[0]];
  let off = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) off -= 360;
    else if (d < -180) off += 360;
    un.push([ring[i][0] + off, ring[i][1]]);
  }
  const net = un[un.length - 1][0] - un[0][0];
  if (Math.abs(net) > 180) {
    let latSum = 0;
    for (const p of un) latSum += p[1];
    const pole = latSum / un.length < 0 ? -90 : 90;
    un.push([un[un.length - 1][0], pole], [un[0][0], pole]);
  }
  // Clip into the three 360°-wide zones and shift each piece back into [−180, 180].
  const out: [number, number][][] = [];
  for (const z of [-360, 0, 360]) {
    let poly = clipX(un, -180 + z, true);
    if (poly.length >= 3) poly = clipX(poly, 180 + z, false);
    if (poly.length >= 3) out.push(poly.map(([lo, la]) => [lo - z, la] as [number, number]));
  }
  return out;
}

/** The vector EDGE sets FireGlobe extrudes into crisp 3D lines (degrees, [lon,lat]). */
export function landEdges(): { coasts: [number, number][][]; borders: [number, number][][]; provinces: [number, number][][] } {
  return { coasts: decodeAll(DATA.land), borders: decodeAll(DATA.borders), provinces: decodeAll(DATA.provinces) };
}

/**
 * Paint the equirectangular base FILL texture (lon −180→180 left→right, lat 90→−90 top→bottom):
 * a deep ocean with a soft centre sheen, and the landmasses filled with the cool slate (evenodd so
 * lake/sea holes inside land rings stay ocean). One-time at globe construction — never per frame.
 */
export function paintBasemap(w = 2048, h = 1024): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;

  // Ocean: vertical depth ramp (slightly lifted at the equator band, darker at the poles) — reads
  // as a recessed instrument well, and keeps the texture's poles from banding bright.
  const sea = ctx.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, GLOBE.ocean);
  sea.addColorStop(0.5, GLOBE.oceanHi);
  sea.addColorStop(1, GLOBE.ocean);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, w, h);

  // Land: ALL rings in one path, filled evenodd (exterior rings fill, hole rings cut back to ocean).
  const toX = (lon: number): number => ((lon + 180) / 360) * w;
  const toY = (lat: number): number => ((90 - lat) / 180) * h;
  const path = new Path2D();
  for (const raw of decodeAll(DATA.land)) {
    for (const ring of splitRing(raw)) {
      path.moveTo(toX(ring[0][0]), toY(ring[0][1]));
      for (let i = 1; i < ring.length; i++) path.lineTo(toX(ring[i][0]), toY(ring[i][1]));
      path.closePath();
    }
  }
  const landFill = ctx.createLinearGradient(0, 0, 0, h);
  landFill.addColorStop(0, GLOBE.landHi); // a faint top-lit sheen — north reads a touch lighter
  landFill.addColorStop(0.45, GLOBE.land);
  landFill.addColorStop(1, GLOBE.land);
  ctx.fillStyle = landFill;
  ctx.fill(path, 'evenodd');

  return cv;
}
