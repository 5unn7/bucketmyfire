/**
 * Pure normalize core for the live wildfire tracker. Turns the raw CWFIS hotspots GeoJSON
 * (`hotspots_last24hrs`, continent-wide thermal detections) into `Hotspot[]` for the map — KEEPING every
 * CWFIS field verbatim in `props` so the detail panel can show the full record. No bbox filter and no
 * curated place list (the map shows location); the only derived values are the plot/colour helpers and a
 * clustered "distinct fires" count for the headline.
 *
 * NO Three, NO DOM, NO Date.now() — deterministic from its inputs, so scripts/verify-livefire.ts can
 * assert it in Node against committed fixtures. Defensive throughout: malformed input yields an empty
 * feed, never a throw.
 */
import type {
  Hotspot, FireSeverity, LiveFireFeed, FeedSource, Country, CountryFilter,
  FireStage, ReportedFire, ReportedFeed, BurnPolygon, NationalSummary,
} from './types';

const CLUSTER_KM = 6; // detections within this radius count as the same fire (headline number only)
const MAX_DETECTIONS = 8000; // guard so a freak day can't blow up the O(n²) count

// CWFIS reports `agency` as a Canadian province/territory code, a US state code, or MX. Classify by it.
const CA_AGENCIES = new Set(['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'PEI', 'NL', 'NF', 'YT', 'NT', 'NU', 'PC']);

/** Country a detection belongs to, from its agency code. 2-letter non-Canada/MX = a US state. */
export function countryOf(agency: string): Country {
  const a = (agency || '').toUpperCase();
  if (CA_AGENCIES.has(a)) return 'CA';
  if (a === 'MX') return 'MX';
  if (a.length === 2) return 'US';
  return 'OT';
}

/** The selectable country filters, in dropdown order (Canada leads — the game's home turf). */
export const COUNTRIES: { id: CountryFilter; label: string }[] = [
  { id: 'CA', label: 'Canada' },
  { id: 'US', label: 'United States' },
  { id: 'MX', label: 'Mexico' },
  { id: 'all', label: 'All North America' },
];

export function countryLabel(id: CountryFilter): string {
  return COUNTRIES.find((c) => c.id === id)?.label ?? 'All';
}

/** Filter hotspots to a country (or 'all' = the whole feed). */
export function filterCountry(hotspots: Hotspot[], country: CountryFilter): Hotspot[] {
  return country === 'all' ? hotspots : hotspots.filter((h) => h.country === country);
}

/** Filter reported fires to a country (or 'all'). Same contract as `filterCountry` for the dropdown. */
export function filterReportedCountry(fires: ReportedFire[], country: CountryFilter): ReportedFire[] {
  return country === 'all' ? fires : fires.filter((f) => f.country === country);
}

function asNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
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

/** kW/m → coarse band (simplified CFFDRS head-fire intensity classes). Drives the map dot colour/size. */
export function severityFor(hfi: number): FireSeverity {
  if (hfi >= 10000) return 'extreme';
  if (hfi >= 4000) return 'high';
  if (hfi >= 500) return 'moderate';
  return 'low';
}

/** Parse the GeoJSON FeatureCollection into plottable hotspots, KEEPING the full property bag. Tolerates
 *  a non-collection (→ []); reads lat/lon from properties (fallback to a [lon,lat] point geometry); drops
 *  only features with no usable coordinate. NO geographic filter — every valid detection is kept. */
export function parseHotspots(geojson: unknown): Hotspot[] {
  const fc = geojson as { features?: unknown };
  const feats = Array.isArray(fc?.features) ? fc.features : [];
  const out: Hotspot[] = [];
  for (const f of feats) {
    const feat = f as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };
    const p = feat?.properties ?? {};
    let lat = asNum(p.lat);
    let lon = asNum(p.lon);
    if ((lat == null || lon == null) && Array.isArray(feat?.geometry?.coordinates)) {
      const c = feat.geometry!.coordinates as unknown[];
      lon = lon ?? asNum(c[0]);
      lat = lat ?? asNum(c[1]);
    }
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const hfi = Math.max(0, asNum(p.hfi) ?? 0);
    const at = typeof p.rep_date === 'string' ? Date.parse(p.rep_date) : NaN;
    const agency = typeof p.agency === 'string' ? p.agency : '';
    out.push({
      lat,
      lon,
      hfi,
      severity: severityFor(hfi),
      at: Number.isFinite(at) ? at : 0,
      agency,
      country: countryOf(agency),
      props: p,
    });
    if (out.length >= MAX_DETECTIONS) break;
  }
  return out;
}

/** Estimate the number of DISTINCT fires: single-linkage cluster the detections by 6 km and count the
 *  clusters (the headline reads "N active fires" rather than the larger raw-detection count). */
export function countFires(hotspots: Hotspot[]): number {
  const centroids: { lat: number; lon: number; n: number }[] = [];
  for (const h of hotspots) {
    let joined = false;
    for (const c of centroids) {
      if (haversineKm(h.lat, h.lon, c.lat, c.lon) <= CLUSTER_KM) {
        c.lat = (c.lat * c.n + h.lat) / (c.n + 1);
        c.lon = (c.lon * c.n + h.lon) / (c.n + 1);
        c.n += 1;
        joined = true;
        break;
      }
    }
    if (!joined) centroids.push({ lat: h.lat, lon: h.lon, n: 1 });
  }
  return centroids.length;
}

/** The one-call pipeline used by the client AND the verify gate: raw GeoJSON → rendered feed.
 *  `fetchedAt` / `source` are passed in (the pure core never reads the clock). */
export function normalizeFeed(
  geojson: unknown,
  opts: { fetchedAt: number; source: FeedSource },
): LiveFireFeed {
  const hotspots = parseHotspots(geojson);
  return {
    hotspots,
    fireCount: countFires(hotspots),
    totalDetections: hotspots.length,
    fetchedAt: opts.fetchedAt,
    source: opts.source,
  };
}

// ════════════════ The AUTHORITATIVE reported-fire layer (CIFFC) ════════════════
// Parsers for the official agency-reported data: the active-fire list (stage of control + hectares),
// the national summary numbers, and the satellite-mapped burn perimeters. Same defensive contract as
// the hotspot parsers — junk in → empty out, never a throw — so the verify gate can assert them.

/** Stages drawn on the map (everything but extinguished/blank). Order = legend order, danger-first. */
export const ACTIVE_STAGES: FireStage[] = ['OC', 'BH', 'UC'];

/** Normalize a raw stage-of-control code to a `FireStage` (`UNK` for blank/unrecognized). */
export function stageOf(code: unknown): FireStage {
  const s = String(code ?? '').trim().toUpperCase();
  if (s === 'OC' || s === 'BH' || s === 'UC' || s === 'OUT') return s;
  return 'UNK';
}

/** Is this stage one the active-fire map plots? (OC / BH / UC — not OUT, not blank.) */
export function isActiveStage(s: FireStage): boolean {
  return s === 'OC' || s === 'BH' || s === 'UC';
}

/** Disc radius (metres) whose ground AREA equals `ha` hectares — so the shaded footprint is honest
 *  (1 ha = 10 000 m²; r = √(area/π)). Clamps junk/negative sizes to a small visible minimum. */
export function radiusMetersForHa(ha: number): number {
  const a = Number.isFinite(ha) && ha > 0 ? ha : 0;
  return Math.sqrt((a * 10000) / Math.PI);
}

/** Parse the CIFFC `ytd_fires` GeoJSON into reported fires, KEEPING the full property bag. Reads
 *  lat/lon from the `field_latitude/longitude` props (fallback to point geometry); drops only features
 *  with no usable coordinate. NO stage filter here — callers decide active-vs-all. */
export function parseReportedFires(geojson: unknown): ReportedFire[] {
  const fc = geojson as { features?: unknown };
  const feats = Array.isArray(fc?.features) ? fc.features : [];
  const out: ReportedFire[] = [];
  for (const f of feats) {
    const feat = f as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };
    const p = feat?.properties ?? {};
    let lat = asNum(p.field_latitude);
    let lon = asNum(p.field_longitude);
    if ((lat == null || lon == null) && Array.isArray(feat?.geometry?.coordinates)) {
      const c = feat.geometry!.coordinates as unknown[];
      lon = lon ?? asNum(c[0]);
      lat = lat ?? asNum(c[1]);
    }
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const at = typeof p.field_situation_report_date === 'string' ? Date.parse(p.field_situation_report_date) : NaN;
    const agency = typeof p.field_agency_code === 'string' ? p.field_agency_code : '';
    const fireId =
      (typeof p.field_system_fire_id === 'string' && p.field_system_fire_id) ||
      (typeof p.field_agency_fire_id === 'string' && p.field_agency_fire_id) ||
      '';
    out.push({
      lat,
      lon,
      sizeHa: asNum(p.field_fire_size) ?? -1,
      stage: stageOf(p.field_stage_of_control_status),
      agency,
      country: countryOf(agency),
      at: Number.isFinite(at) ? at : 0,
      fireId,
      props: p,
    });
    if (out.length >= MAX_DETECTIONS) break;
  }
  return out;
}

/** Build the reported-fire feed for the active-fire MAP: keep the plottable stages (OC/BH/UC), tally
 *  every parsed stage for the legend. `fetchedAt` / `source` are passed in (pure core, no clock). */
export function normalizeReported(
  geojson: unknown,
  opts: { fetchedAt: number; source: FeedSource },
): ReportedFeed {
  const all = parseReportedFires(geojson);
  const byStage: Record<FireStage, number> = { OC: 0, BH: 0, UC: 0, OUT: 0, UNK: 0 };
  for (const f of all) byStage[f.stage]++;
  return {
    fires: all.filter((f) => isActiveStage(f.stage)),
    byStage,
    fetchedAt: opts.fetchedAt,
    source: opts.source,
  };
}

/** Parse the CIFFC dashboard summary JSON into the national panel numbers. Missing/junk fields → 0;
 *  `ytdOut` is derived (total − active, floored at 0). Never throws. */
export function normalizeSummary(
  json: unknown,
  opts: { fetchedAt: number; source: FeedSource },
): NationalSummary {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const total = Math.max(0, asNum(j.fire_count) ?? 0);
  const active = Math.max(0, asNum(j.active_fires) ?? 0);
  return {
    firesToday: Math.max(0, asNum(j.fires_today) ?? 0),
    activeFires: active,
    ytdTotal: total,
    ytdOut: Math.max(0, total - active),
    areaBurnedHa: Math.max(0, asNum(j.area_burned) ?? 0),
    prepLevel: Math.max(0, asNum(j.preparedness_level) ?? 0),
    fetchedAt: opts.fetchedAt,
    source: opts.source,
  };
}

/** Parse CWFIS `m3_polygons_current` GeoJSON into burn-perimeter rings ([lat,lon] order for Leaflet).
 *  Handles Polygon + MultiPolygon (outer rings only); drops rings with < 3 vertices. Caps the vertex
 *  count per ring so a freak mega-perimeter can't choke the canvas. Defensive throughout. */
export function parseBurnPolygons(geojson: unknown): BurnPolygon[] {
  const fc = geojson as { features?: unknown };
  const feats = Array.isArray(fc?.features) ? fc.features : [];
  const out: BurnPolygon[] = [];
  const ringFrom = (coords: unknown): [number, number][] => {
    const ring: [number, number][] = [];
    if (!Array.isArray(coords)) return ring;
    for (const pt of coords) {
      if (!Array.isArray(pt)) continue;
      const lon = asNum(pt[0]);
      const lat = asNum(pt[1]);
      if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      ring.push([lat, lon]);
      if (ring.length >= 4000) break; // sane per-ring cap
    }
    return ring;
  };
  for (const f of feats) {
    const feat = f as { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } };
    const g = feat?.geometry;
    const p = feat?.properties ?? {};
    const areaHa = Math.max(0, asNum(p.area) ?? 0);
    const at = typeof p.lastdate === 'string' ? Date.parse(p.lastdate) : NaN;
    const stamp = Number.isFinite(at) ? at : 0;
    const push = (ring: [number, number][]): void => {
      if (ring.length >= 3) out.push({ ring, areaHa, at: stamp });
    };
    if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) {
      push(ringFrom(g.coordinates[0]));
    } else if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates as unknown[]) {
        if (Array.isArray(poly)) push(ringFrom((poly as unknown[])[0]));
      }
    }
    if (out.length >= MAX_DETECTIONS) break;
  }
  return out;
}
