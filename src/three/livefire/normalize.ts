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
  Hotspot, FireSeverity, LiveFireFeed, SourceStatus, FeedMeta, Country, CountryFilter,
  FireStage, ReportedFire, ReportedFeed, BurnPolygon, BurnFeed, NationalSummary, RegionFilter, RegionStats,
} from './types';

/** What the fetch layer hands the pure normalizers: the fetch-level outcome (status/fromCache/fetchedAt).
 *  `publishedAt` is NOT passed in — each normalizer derives it from the SOURCE data it's parsing. */
export interface NormalizeOpts {
  fetchedAt: number;
  status: SourceStatus;
  fromCache: boolean;
}

/** Largest positive `at` (epoch ms) across items — the freshest SOURCE timestamp in a feed (0 if none). */
function maxAt(items: { at: number }[]): number {
  let m = 0;
  for (const it of items) if (Number.isFinite(it.at) && it.at > m) m = it.at;
  return m;
}

/** Assemble the per-source honesty meta from the fetch outcome + the derived source publish time. */
function metaFrom(opts: NormalizeOpts, publishedAt: number): FeedMeta {
  return { status: opts.status, fromCache: opts.fromCache, publishedAt, fetchedAt: opts.fetchedAt };
}

/** Parse a date/datetime string to epoch ms (0 if unparseable). These gov feeds (CIFFC sitrep/status
 *  dates, CWFIS rep_date) publish in UTC but OMIT the zone designator — and JS parses a zone-LESS
 *  date-TIME as the RUNTIME's LOCAL time, which shifts every value by the viewer's offset (in
 *  Saskatchewan, +6h: a 5-hour-old report would render an hour in the FUTURE). So a zone-less datetime is
 *  read as UTC here; a bare YYYY-MM-DD (already UTC in JS) and a zone-stamped string (`Z` or `±hh:mm`)
 *  pass through untouched. */
export function parseMs(v: unknown): number {
  if (typeof v !== 'string' || !v) return 0;
  const s = v.trim();
  const zoneless = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const t = Date.parse(zoneless ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? t : 0;
}

/** A URL safe to drop into an `href`: only http(s) passes; everything else (a `javascript:`/`data:` scheme,
 *  junk, non-string) → '' so the link is dropped. The SaskAlert `html_link` is FEED-controlled, so it must
 *  pass through here before it reaches an attribute — esc() stops attribute-breakout but not a `javascript:`
 *  URL. Pure, so the verify gate can assert it. */
export function safeUrl(u: unknown): string {
  const s = typeof u === 'string' ? u.trim() : '';
  return /^https?:\/\//i.test(s) ? s : '';
}

/** Build the smoke layer's hourly forecast timeline: ISO8601-UTC hour strings from `now` (floored to the
 *  hour) forward `hours` hours, inclusive. Each is the GeoMet WMS `TIME=` param for one frame
 *  (e.g. "2026-06-10T00:00:00Z"). Pure (takes `now`) so the verify gate can assert it; the UI passes
 *  Date.now(). Starting at `now` keeps every frame inside the current model run's valid window (the run
 *  reaches ~72h ahead), so frames don't 404 the way pre-run-start hours would. */
export function smokeForecastFrames(now: number, hours: number): string[] {
  const HOUR = 3_600_000;
  const start = Math.floor(now / HOUR) * HOUR;
  const n = Math.max(0, Math.floor(Number.isFinite(hours) ? hours : 0));
  const out: string[] = [];
  for (let i = 0; i <= n; i++) out.push(new Date(start + i * HOUR).toISOString().replace(/\.000Z$/, 'Z'));
  return out;
}

/** The forecast frame's LEAD time as a compact chip — the scrubber frames are hourly from "now", so the
 *  frame INDEX is the hours ahead: 0 → "Now", 6 → "+6 h", 26 → "+1 d 2 h". Pure (the UI passes the scrubber
 *  index) so the verify gate can assert it; reads alongside the absolute time ("Mon 6 PM"). Lives here with
 *  `smokeForecastFrames` (its sibling timeline math), NOT in strings.ts — strings re-exports from client.ts,
 *  which is browser-only (`import.meta.env`) and would break the Node verify bundle. */
export function forecastLeadLabel(hoursAhead: number): string {
  if (!Number.isFinite(hoursAhead) || hoursAhead <= 0) return 'Now';
  const h = Math.round(hoursAhead);
  if (h < 24) return `+${h} h`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return r ? `+${d} d ${r} h` : `+${d} d`;
}

/** Pull the FWI raster's issue date out of the CWFIS WMS GetCapabilities XML: the `fwi_current` layer's
 *  <Title> ends in " - YYYY-MM-DD". Returns epoch ms, or 0 if the suffix is missing (the UI then says
 *  "issue time unavailable" — we never fabricate a time). Pure + defensive so the verify gate can assert it. */
export function parseFwiIssueDate(capsXml: string): number {
  if (typeof capsXml !== 'string' || !capsXml) return 0;
  // WMS sequences <Name> before <Title>; find the fwi_current layer then its nearby Title.
  const m = /<Name>\s*(?:public:)?fwi_current\s*<\/Name>[\s\S]{0,600}?<Title>([\s\S]*?)<\/Title>/i.exec(capsXml);
  const title = (m?.[1] ?? '').trim();
  const d = /(\d{4}-\d{2}-\d{2})\s*$/.exec(title) ?? /(\d{4}-\d{2}-\d{2})/.exec(title);
  return d ? parseMs(d[1]) : 0;
}

const CLUSTER_KM = 6; // detections within this radius count as the same fire (headline number only)
const MAX_DETECTIONS = 8000; // guard so a freak day can't blow up the O(n²) count

// CWFIS reports `agency` as a Canadian province/territory code, a US state code, or MX. Classify by it.
// Exported so the region helpers below (province granularity) share ONE source of truth for "is CA".
export const CA_AGENCIES = new Set(['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'PEI', 'NL', 'NF', 'YT', 'NT', 'NU', 'PC']);

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

// ── Region (country + optional Canadian province) — the tracker's region selection ──────────────────
// The CIFFC reported feed is Canada-only and each fire carries an `agency` province code, so we can
// narrow within Canada to one province. The filters DELEGATE to the country filters above (byte-identical
// country contract) then narrow by agency. `now` is always passed in (deterministic for the gate).
const DAY_MS = 86_400_000;

/** CIFFC agency code → province display name (covers both alternate codes the feed uses). */
export const PROVINCE_LABEL: Record<string, string> = {
  BC: 'British Columbia', AB: 'Alberta', SK: 'Saskatchewan', MB: 'Manitoba', ON: 'Ontario',
  QC: 'Quebec', NB: 'New Brunswick', NS: 'Nova Scotia', PE: 'Prince Edward Island', PEI: 'Prince Edward Island',
  NL: 'Newfoundland and Labrador', NF: 'Newfoundland and Labrador', YT: 'Yukon', NT: 'Northwest Territories',
  NU: 'Nunavut', PC: 'Parks Canada',
};

/** Parse a `<select>` value (`'all'|'US'|'MX'|'CA'|'CA:SK'…`) into a RegionFilter. Junk / illegal
 *  combos (`'US:SK'`, `'CA:ZZ'`, `''`) degrade to Canada-all — never throws. */
export function parseRegion(value: string): RegionFilter {
  const raw = (value || '').trim();
  if (raw === 'US' || raw === 'MX' || raw === 'all') return { country: raw };
  if (raw.startsWith('CA:')) {
    const ag = raw.slice(3).toUpperCase();
    return CA_AGENCIES.has(ag) ? { country: 'CA', agency: ag } : { country: 'CA' };
  }
  return { country: 'CA' };
}

/** RegionFilter → the encoded `<select>` value (the inverse of parseRegion). */
export function regionValue(r: RegionFilter): string {
  return r.country === 'CA' && r.agency ? `CA:${r.agency}` : r.country;
}

/** RegionFilter → display name (province name when narrowed, else the country label). */
export function regionLabel(r: RegionFilter): string {
  if (r.country === 'CA' && r.agency) return PROVINCE_LABEL[r.agency] ?? r.agency;
  return countryLabel(r.country);
}

/** Filter reported fires to a region: country first, then the province agency if present. */
export function filterReportedRegion(fires: ReportedFire[], r: RegionFilter): ReportedFire[] {
  const byCountry = filterReportedCountry(fires, r.country);
  return r.agency ? byCountry.filter((f) => (f.agency || '').toUpperCase() === r.agency) : byCountry;
}

/** Filter hotspots to a region: country first, then the province agency if present. */
export function filterRegionHotspots(hotspots: Hotspot[], r: RegionFilter): Hotspot[] {
  const byCountry = filterCountry(hotspots, r.country);
  return r.agency ? byCountry.filter((h) => (h.agency || '').toUpperCase() === r.agency) : byCountry;
}

/** The selectable regions for the dropdown: Canada-all + the provinces ACTUALLY PRESENT in the current
 *  reported feed (never a dead "0 fires" province), in canonical CA_AGENCIES order, then US / MX / all.
 *  `group` lets the selector build optgroups. */
export function regionOptions(reportedFeed: ReportedFeed): { value: string; label: string; group: string }[] {
  const present = new Set<string>();
  for (const f of reportedFeed.fires) {
    const a = (f.agency || '').toUpperCase();
    if (CA_AGENCIES.has(a)) present.add(a);
  }
  const out: { value: string; label: string; group: string }[] = [{ value: 'CA', label: 'Canada — all', group: 'Canada' }];
  for (const a of CA_AGENCIES) if (present.has(a)) out.push({ value: `CA:${a}`, label: PROVINCE_LABEL[a] ?? a, group: 'Canada' });
  out.push({ value: 'US', label: 'United States', group: 'Other' });
  out.push({ value: 'MX', label: 'Mexico', group: 'Other' });
  out.push({ value: 'all', label: 'All North America', group: 'Other' });
  return out;
}

/** Count OC/BH/UC among already-active reported fires (the feed's `fires` array is active-only). */
function tallyStages(fires: ReportedFire[]): { OC: number; BH: number; UC: number } {
  const t = { OC: 0, BH: 0, UC: 0 };
  for (const f of fires) if (f.stage === 'OC' || f.stage === 'BH' || f.stage === 'UC') t[f.stage] += 1;
  return t;
}

function downStats(label: string): RegionStats {
  return { scope: 'down', label, active: null, byStage: null, reportedToday: null, areaBurnedHa: null, prepLevel: null, ytdTotal: null, ytdOut: null, hotspots: null, asOfMs: 0 };
}

/** The HEART of the region-accurate firestats bar: produce the honest per-region stats from whatever
 *  source is authoritative at that scope. A `null` field = "no per-region source" → the ticker renders
 *  "Data not available" (NEVER a Canada number under another label). See RegionStats for the scope rules.
 *    • US / MX → no reported feed exists → active/stage/today all null; satellite `hotspots` is the metric.
 *    • A Canadian province → active/stage/today DERIVED from the agency-filtered reported feed;
 *      area-burned / prep / season-total are national-only → null.
 *    • Canada-all (or 'all') → the authoritative CIFFC summary, with a reported-feed fallback for `active`. */
export function deriveRegionStats(
  region: RegionFilter,
  reportedFeed: ReportedFeed,
  hsFeed: LiveFireFeed,
  summary: NationalSummary | null,
  now: number,
): RegionStats {
  const label = regionLabel(region);
  const repLive = reportedFeed.meta.status === 'live';
  const hsLive = hsFeed.meta.status === 'live';
  const sumLive = !!summary && summary.meta.status === 'live';
  const hotspots = hsLive ? countFires(filterRegionHotspots(hsFeed.hotspots, region)) : null;

  // US / MX — the CIFFC reported feed is Canada-only, so the only honest number is satellite detections.
  if (region.country === 'US' || region.country === 'MX') {
    if (!hsLive) return downStats(label);
    return { scope: 'foreign', label, active: null, byStage: null, reportedToday: null, areaBurnedHa: null, prepLevel: null, ytdTotal: null, ytdOut: null, hotspots, asOfMs: hsFeed.meta.publishedAt };
  }

  // A specific Canadian province — derive from the agency-filtered reported feed.
  if (region.agency) {
    if (!repLive) return hsLive ? { ...downStats(label), scope: 'down', hotspots, asOfMs: hsFeed.meta.publishedAt } : downStats(label);
    const fires = filterReportedRegion(reportedFeed.fires, region);
    return {
      scope: 'ca-province', label,
      active: fires.length,
      byStage: tallyStages(fires),
      reportedToday: fires.filter((f) => f.at > 0 && now - f.at < DAY_MS).length,
      areaBurnedHa: null, prepLevel: null, ytdTotal: null, ytdOut: null, // national-only metrics → Data not available
      hotspots,
      asOfMs: fires.reduce((m, f) => (f.at > m ? f.at : m), 0) || reportedFeed.meta.publishedAt,
    };
  }

  // Canada-all (or 'all') — the authoritative national summary, with a reported-feed fallback for active.
  if (!sumLive && !repLive && !hsLive) return downStats(label);
  const caReported = repLive ? filterReportedCountry(reportedFeed.fires, region.country) : [];
  return {
    scope: sumLive || repLive ? 'ca-national' : 'down',
    label,
    active: sumLive ? summary!.activeFires : repLive ? caReported.length : null,
    byStage: repLive ? tallyStages(caReported) : null,
    reportedToday: sumLive ? summary!.firesToday : null,
    areaBurnedHa: sumLive ? summary!.areaBurnedHa : null,
    prepLevel: sumLive && summary!.prepLevel > 0 ? summary!.prepLevel : null, // 0 = unknown → Data not available
    ytdTotal: sumLive ? summary!.ytdTotal : null,
    ytdOut: sumLive ? summary!.ytdOut : null,
    hotspots,
    asOfMs: sumLive ? summary!.meta.publishedAt : repLive ? caReported.reduce((m, f) => (f.at > m ? f.at : m), 0) : 0,
  };
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
    const at = parseMs(p.rep_date);
    const agency = typeof p.agency === 'string' ? p.agency : '';
    out.push({
      lat,
      lon,
      hfi,
      severity: severityFor(hfi),
      at,
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
export function normalizeFeed(geojson: unknown, opts: NormalizeOpts): LiveFireFeed {
  const hotspots = parseHotspots(geojson);
  return {
    hotspots,
    fireCount: countFires(hotspots),
    totalDetections: hotspots.length,
    // publishedAt = the freshest satellite detection time (rep_date) — the SOURCE's currency, honestly.
    meta: metaFrom(opts, maxAt(hotspots)),
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
    const at = parseMs(p.field_situation_report_date);
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
      at,
      fireId,
      props: p,
    });
    if (out.length >= MAX_DETECTIONS) break;
  }
  return out;
}

/** Build the reported-fire feed for the active-fire MAP: keep the plottable stages (OC/BH/UC), tally
 *  every parsed stage for the legend. `fetchedAt` / `source` are passed in (pure core, no clock). */
export function normalizeReported(geojson: unknown, opts: NormalizeOpts): ReportedFeed {
  const all = parseReportedFires(geojson);
  const byStage: Record<FireStage, number> = { OC: 0, BH: 0, UC: 0, OUT: 0, UNK: 0 };
  for (const f of all) byStage[f.stage]++;
  return {
    fires: all.filter((f) => isActiveStage(f.stage)), // ACTIVE (OC/BH/UC) — default layer + headline
    out: all.filter((f) => f.stage === 'OUT'), // EXTINGUISHED this season — the opt-in "Out fires" layer
    byStage,
    // publishedAt = the latest situation-report date across the roll — the CIFFC sitrep cycle, honestly.
    meta: metaFrom(opts, maxAt(all)),
  };
}

/** Parse the CIFFC dashboard summary JSON into the national panel numbers. Missing/junk fields → 0;
 *  `ytdOut` is derived (total − active, floored at 0). Never throws. */
export function normalizeSummary(json: unknown, opts: NormalizeOpts): NationalSummary {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const sitrep = (j.sitrep && typeof j.sitrep === 'object' ? j.sitrep : {}) as Record<string, unknown>;
  const total = Math.max(0, asNum(j.fire_count) ?? 0);
  const active = Math.max(0, asNum(j.active_fires) ?? 0);
  // publishedAt = the CIFFC situation-report date (`sitrep.date`, a bare YYYY-MM-DD) — the day these
  // national numbers are "as of". prepLevel prefers the top-level value, falling back to the sitrep's.
  const publishedAt = parseMs(sitrep.date);
  return {
    firesToday: Math.max(0, asNum(j.fires_today) ?? 0),
    activeFires: active,
    ytdTotal: total,
    ytdOut: Math.max(0, total - active),
    areaBurnedHa: Math.max(0, asNum(j.area_burned) ?? 0),
    prepLevel: Math.max(0, asNum(j.preparedness_level) ?? asNum(sitrep.preparedness_level) ?? 0),
    meta: metaFrom(opts, publishedAt),
  };
}

/** Build the burn-perimeter feed: parse the M3 polygons + derive publishedAt from the freshest `lastdate`. */
export function normalizeBurn(geojson: unknown, opts: NormalizeOpts): BurnFeed {
  const polys = parseBurnPolygons(geojson);
  return { polys, meta: metaFrom(opts, maxAt(polys)) };
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
    const stamp = parseMs(p.lastdate);
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

