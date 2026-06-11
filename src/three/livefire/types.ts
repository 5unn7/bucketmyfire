/**
 * Live wildfire tracker — shared types. The tracker pulls the live CWFIS (Natural Resources Canada)
 * satellite hotspot feed (`hotspots_last24hrs`) — continent-wide thermal detections from the last 24h,
 * each carrying CWFIS's FULL ~35-field record (location, satellite/sensor, agency, weather, the FWI
 * System codes, and fire-behaviour outputs). We keep every field verbatim so the map's detail panel can
 * show the gold-standard record CWFIS publishes — nothing is thrown away.
 *
 * Pure data — no Three, no DOM, no Leaflet — so the normalize core is unit-testable in Node.
 */

/** Coarse intensity band derived from head-fire intensity (kW/m, CFFDRS-ish) — drives the dot colour. */
export type FireSeverity = 'low' | 'moderate' | 'high' | 'extreme';

/** Country a detection belongs to, classified from its CWFIS `agency` code (province vs state vs MX). */
export type Country = 'CA' | 'US' | 'MX' | 'OT';
/** The map's country filter — a country or 'all' (the whole continent). */
export type CountryFilter = Country | 'all';

/** The tracker's region selection: a country (or 'all') optionally narrowed to one Canadian province.
 *  `agency` is a CIFFC province code (SK/BC/AB/…) and is ONLY meaningful when `country === 'CA'` — the
 *  CIFFC reported feed is Canada-only, so no other country has province granularity. Encoded as a
 *  `<select>` value via `regionValue()` (`'CA'`, `'CA:SK'`, `'US'`, `'all'`) and parsed by `parseRegion()`. */
export interface RegionFilter {
  country: CountryFilter;
  agency?: string;
}

/** One satellite hotspot detection. `props` is the UNTOUCHED CWFIS property bag (all ~35 fields) so the
 *  detail panel renders the full record; the top-level fields are just the few we need to plot + colour. */
export interface Hotspot {
  lat: number;
  lon: number;
  hfi: number; // head-fire intensity (kW/m)
  severity: FireSeverity;
  at: number; // rep_date as epoch ms (0 if unparseable)
  agency: string;
  country: Country; // classified from `agency` — drives the country filter
  props: Record<string, unknown>;
}

/**
 * Per-source honesty model — the spine of the "honest window". `status` is the fetch-level outcome:
 *   • live        — we have usable data (freshly fetched OR served from cache)
 *   • unavailable — the source failed AND we have nothing cached to fall back on (NOT "no fires" — see
 *                   the UI layer, which separately renders "none in view" when a LIVE feed has 0 results)
 *   • disabled    — the VITE_LIVEFIRE_DISABLE kill-switch is on (intentionally off, NOT broken)
 * `fromCache` is ORTHOGONAL to status (a live feed can be served from a recent cache). `publishedAt` is
 * the SOURCE's own publish/observation time (drives ALL user-facing freshness copy); `fetchedAt` is only
 * when WE called (cache-TTL math, never shown). 0 = unknown. This is the per-LiveSource snapshot the
 * source-ledger reads; "empty ≠ down ≠ off" is enforced by combining status with the in-view count.
 */
export type SourceStatus = 'live' | 'unavailable' | 'disabled';
export interface FeedMeta {
  status: SourceStatus;
  fromCache: boolean;
  publishedAt: number; // epoch ms — the SOURCE's publish time (0 = unknown)
  fetchedAt: number; // epoch ms — when WE fetched (cache math only, never shown)
}

/** The normalized feed the map + banner render. `hotspots` is every valid detection (plotted on the
 *  map); `fireCount` is the clustered "distinct fires" estimate (the friendlier headline number). */
export interface LiveFireFeed {
  hotspots: Hotspot[];
  fireCount: number;
  totalDetections: number;
  meta: FeedMeta;
}

// ── The AUTHORITATIVE reported-fire layer (CIFFC) ───────────────────────────────────────────────
// The satellite `Hotspot` feed above is raw thermal detections. The data below is the OFFICIAL roll
// the agencies report to CIFFC: named, sized (hectares), and tagged with a stage of control. This is
// the "Active Wildland Fires" map (stage-of-control dots) + the national summary panel.

/** Fire stage of control (CIFFC `field_stage_of_control_status`). The danger ramp the dots colour by:
 *  Out of Control → Being Held → Under Control → Out (extinguished). `UNK` = an unmapped/blank code. */
export type FireStage = 'OC' | 'BH' | 'UC' | 'OUT' | 'UNK';

/** One agency-reported active fire (a CIFFC `ytd_fires` feature). The `props` bag is kept verbatim so
 *  the detail panel can render the full record; the top-level fields are the few we plot + classify. */
export interface ReportedFire {
  lat: number;
  lon: number;
  sizeHa: number; // field_fire_size — hectares (drives the area-accurate disc radius). <0 = unknown.
  stage: FireStage; // field_stage_of_control_status — drives the dot colour
  agency: string; // field_agency_code (lowercase province/territory, e.g. 'sk')
  country: Country; // classified from agency
  at: number; // field_situation_report_date as epoch ms (0 if unparseable)
  fireId: string; // field_system_fire_id (else agency fire id) — the headline identifier
  props: Record<string, unknown>;
  // Provenance — set when this fire came from a PROVINCIAL agency feed (e.g. 'bc-wildfire') rather than
  // the national CIFFC roll; lets the detail panel render the richer provincial record + name. Undefined = CIFFC.
  source?: string;
  name?: string; // human fire name/label (provincial feeds carry one; CIFFC fires are id-only)
}

/** One satellite-mapped burn perimeter (a CWFIS `m3_polygons_current` feature) — the TRUE footprint
 *  shape where hotspots have been clustered into a polygon. `ring` is the outer ring as [lat,lon]. */
export interface BurnPolygon {
  ring: [number, number][]; // outer ring, [lat, lon] (Leaflet order)
  areaHa: number; // CWFIS `area` (hectares)
  at: number; // `lastdate` as epoch ms (0 if unparseable)
}

/** The reported-fire feed: the active fires + the extinguished ("out") fires + per-stage tallies. */
export interface ReportedFeed {
  fires: ReportedFire[]; // ACTIVE fires (OC/BH/UC) — the default map layer + headline
  out: ReportedFire[]; // EXTINGUISHED fires (OUT) reported this season — an opt-in "Out fires" layer
  byStage: Record<FireStage, number>; // count per stage (for the legend + the season totals)
  meta: FeedMeta;
}

/** The satellite-mapped burn-perimeter feed (CWFIS M3) — the polygons + freshness meta for the ledger. */
export interface BurnFeed {
  polys: BurnPolygon[];
  meta: FeedMeta;
}

/** One point in a fire's tracked HISTORY (a `public.fire_snapshots` row from the ingestion backend).
 *  This is the thing the browser-only feed can't produce: the same fire observed at successive times,
 *  so the detail panel can draw size-over-time + a stage timeline. Backend-only (no client fallback). */
export interface FireHistoryPoint {
  stage: FireStage;
  sizeHa: number; // -1 = unknown at this observation
  reportedAt: number; // source sitrep date, epoch ms (0 unknown)
  observedAt: number; // when our ingest recorded it, epoch ms
}

/** The national summary panel (CIFFC `/v1/dashboard/summary`) — the "Current fires / Year-to-date"
 *  numbers. `ytdOut` is derived (total − active). `prepLevel` is the national preparedness level 1–5. */
export interface NationalSummary {
  firesToday: number; // reported in the last day
  activeFires: number; // currently active (OC + BH + UC)
  ytdTotal: number; // total fires this season
  ytdOut: number; // extinguished this season (ytdTotal − activeFires)
  areaBurnedHa: number; // season area burned (ha)
  prepLevel: number; // national preparedness level 1–5 (0 = unknown)
  meta: FeedMeta;
}

/** Region-scoped stats for the firestats ticker — the HONEST per-region view `deriveRegionStats`
 *  produces from whatever source is authoritative at that scope. A `null` field means "no per-region
 *  source exists" → the ticker renders "Data not available", never a Canada number under another label.
 *    • ca-national — Canada-all (or 'all'): the authoritative CIFFC `NationalSummary` numbers.
 *    • ca-province — one province: active/stage/today DERIVED from the agency-filtered reported feed;
 *                    area-burned/prep/season-total are national-only metrics → null.
 *    • foreign     — US/MX: no reported feed → active/stage/today null; `hotspots` is the honest metric.
 *    • down        — every backing feed unavailable → all headline numbers null. */
export interface RegionStats {
  scope: 'ca-national' | 'ca-province' | 'foreign' | 'down';
  label: string; // the region's display name (regionLabel)
  active: number | null; // active reported fires (OC+BH+UC); null = no reported source for this region
  byStage: { OC: number; BH: number; UC: number } | null;
  reportedToday: number | null; // fires whose sitrep is < 24h old
  areaBurnedHa: number | null; // season area burned — national-only metric
  prepLevel: number | null; // national preparedness 1–5 — national-only metric
  ytdTotal: number | null;
  ytdOut: number | null;
  hotspots: number | null; // satellite detections (clustered) in-region — the honest US/MX metric
  asOfMs: number; // freshest SOURCE publish time backing these numbers (0 = unknown)
}

