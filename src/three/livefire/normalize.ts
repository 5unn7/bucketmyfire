/**
 * Pure normalize core for the live wildfire tracker. Turns a raw CWFIS hotspots GeoJSON
 * (`public:hotspots_last24hrs`, satellite thermal detections, last 24h) into a sorted, capped list of
 * "active fires" — single-linkage clusters of nearby detections, each labelled by its nearest SK town.
 *
 * NO Three, NO DOM, NO Date.now() — deterministic from its inputs, so scripts/verify-livefire.ts can
 * assert the numbers in Node against committed fixtures. Defensive throughout: a missing/odd field
 * degrades (never throws), so a malformed payload yields an empty feed rather than a crash.
 */
import type { LiveFire, FireSeverity, LiveFireFeed, FeedSource } from './types';
import { SK_PLACES, type Place } from './places';

/** Saskatchewan lat/lon bounding box (matches maps/saskatchewan SASKATCHEWAN_GEO). The server already
 *  CQL-filters to this, but we re-check client-side so a stray cross-border detection can't sneak in. */
export const SK_BBOX = { latMin: 49, latMax: 60, lonMin: -110, lonMax: -101.36 } as const;

const CLUSTER_KM = 6; // detections within this radius of a cluster centroid join it (one "fire")
const MAX_FIRES = 24; // cap the rendered list (the overlay shows the top ~10 + "+N more")
const MAX_DETECTIONS = 2000; // hard guard so a freak busy day can't blow up the O(n²) clustering

/** One parsed hotspot detection (the fields we actually use). */
interface Detection {
  lat: number;
  lon: number;
  hfi: number; // head-fire intensity (kW/m) — our severity signal
  at: number; // epoch ms (rep_date), 0 if unparseable
  agency: string;
}

/** Great-circle distance in km (haversine). */
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** kW/m → coarse band (simplified CFFDRS head-fire intensity classes). */
export function severityFor(hfi: number): FireSeverity {
  if (hfi >= 10000) return 'extreme';
  if (hfi >= 4000) return 'high';
  if (hfi >= 500) return 'moderate';
  return 'low';
}

const SEV_RANK: Record<FireSeverity, number> = { low: 0, moderate: 1, high: 2, extreme: 3 };

/** Nearest community label for a point (always returns one — SK_PLACES blankets the province). */
export function nearestPlace(lat: number, lon: number, places: readonly Place[] = SK_PLACES): string {
  let best = places[0]?.name ?? 'Saskatchewan';
  let bestKm = Infinity;
  for (const p of places) {
    const d = haversineKm(lat, lon, p.lat, p.lon);
    if (d < bestKm) {
      bestKm = d;
      best = p.name;
    }
  }
  return best;
}

/** Pull the detections we care about out of a GeoJSON FeatureCollection. Tolerates a non-collection
 *  (→ []), reads lat/lon from properties (fallback to point geometry), drops out-of-bbox + invalid. */
export function parseHotspots(geojson: unknown): Detection[] {
  const fc = geojson as { features?: unknown };
  const feats = Array.isArray(fc?.features) ? fc.features : [];
  const out: Detection[] = [];
  for (const f of feats) {
    const feat = f as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };
    const p = feat?.properties ?? {};
    let lat = num(p.lat);
    let lon = num(p.lon);
    // Fallback to a [lon,lat] point geometry if the props are missing.
    if ((lat == null || lon == null) && Array.isArray(feat?.geometry?.coordinates)) {
      const c = feat.geometry!.coordinates as unknown[];
      lon = lon ?? num(c[0]);
      lat = lat ?? num(c[1]);
    }
    if (lat == null || lon == null) continue;
    if (lat < SK_BBOX.latMin || lat > SK_BBOX.latMax || lon < SK_BBOX.lonMin || lon > SK_BBOX.lonMax) continue;
    const at = typeof p.rep_date === 'string' ? Date.parse(p.rep_date) : NaN;
    out.push({
      lat,
      lon,
      hfi: Math.max(0, num(p.hfi) ?? 0),
      at: Number.isFinite(at) ? at : 0,
      agency: typeof p.agency === 'string' ? p.agency : '',
    });
    if (out.length >= MAX_DETECTIONS) break;
  }
  return out;
}

/** A mutable cluster accumulator. */
interface Cluster {
  sumLat: number;
  sumLon: number;
  n: number;
  cLat: number; // running centroid
  cLon: number;
  peakHfi: number;
  peakAgency: string;
  lastAt: number;
}

/** Single-linkage cluster the detections (seed from the hottest first), then resolve each to a
 *  LiveFire labelled + scored. Sorted by severity, then size, then recency; capped to MAX_FIRES. */
export function clusterFires(detections: Detection[], places: readonly Place[] = SK_PLACES): LiveFire[] {
  // Hottest first so a high-intensity detection anchors its cluster centroid.
  const sorted = [...detections].sort((a, b) => b.hfi - a.hfi);
  const clusters: Cluster[] = [];
  for (const d of sorted) {
    let join: Cluster | null = null;
    for (const c of clusters) {
      if (haversineKm(d.lat, d.lon, c.cLat, c.cLon) <= CLUSTER_KM) {
        join = c;
        break;
      }
    }
    if (!join) {
      clusters.push({ sumLat: d.lat, sumLon: d.lon, n: 1, cLat: d.lat, cLon: d.lon, peakHfi: d.hfi, peakAgency: d.agency, lastAt: d.at });
      continue;
    }
    join.sumLat += d.lat;
    join.sumLon += d.lon;
    join.n += 1;
    join.cLat = join.sumLat / join.n;
    join.cLon = join.sumLon / join.n;
    if (d.hfi > join.peakHfi) {
      join.peakHfi = d.hfi;
      join.peakAgency = d.agency;
    }
    if (d.at > join.lastAt) join.lastAt = d.at;
  }

  const fires: LiveFire[] = clusters.map((c) => ({
    id: `${c.cLat.toFixed(2)},${c.cLon.toFixed(2)}`,
    lat: c.cLat,
    lon: c.cLon,
    detections: c.n,
    intensity: Math.round(c.peakHfi),
    severity: severityFor(c.peakHfi),
    lastDetect: c.lastAt,
    place: nearestPlace(c.cLat, c.cLon, places),
    agency: c.peakAgency,
  }));

  fires.sort(
    (a, b) =>
      SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.detections - a.detections || b.lastDetect - a.lastDetect,
  );
  return fires.slice(0, MAX_FIRES);
}

/** The one-call pipeline used by the client AND the verify gate: raw GeoJSON → rendered feed.
 *  `fetchedAt` / `source` are passed in (the pure core never reads the clock). */
export function normalizeFeed(
  geojson: unknown,
  opts: { fetchedAt: number; source: FeedSource; places?: readonly Place[] },
): LiveFireFeed {
  const detections = parseHotspots(geojson);
  const fires = clusterFires(detections, opts.places ?? SK_PLACES);
  return { fires, totalDetections: detections.length, fetchedAt: opts.fetchedAt, source: opts.source };
}
