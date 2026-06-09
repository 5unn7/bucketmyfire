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

// ── Public alerts (SaskAlert) + fire bans (SK SPSA) ─────────────────────────────────────────────────
// These are the highest-stakes layers: getting an evacuation alert wrong is the worst possible trust
// failure. So we NEVER re-classify — we surface the issuer's own words + level + a link to the official
// incident page, and the tracker carries the standing "not an emergency tool, follow official sources" line.

/** SaskAlert priority → severity ramp (critical = danger, advisory = caution, info = neutral). */
export type AlertLevel = 'critical' | 'advisory' | 'info' | 'unknown';

/** One active SaskAlert public alert, filtered to wildfire/evacuation-relevant + plotted as a pin. The
 *  fields are the issuer's verbatim words — we don't paraphrase or re-label (e.g. never invent "ORDER"). */
export interface AlertItem {
  lat: number;
  lon: number;
  level: AlertLevel;
  event: string; // event_en — the issuer's event name (verbatim)
  summary: string; // summary_en
  coverage: string; // coverage_en — the affected area, plain text
  sentAt: number; // `sent` epoch ms (0 if unparseable)
  lifecycle: string; // type_en — Issued / Update
  author: string; // author_en — who issued it (e.g. an agency)
  url: string; // html_link — the official incident page (the authority)
  id: string;
}
export interface AlertFeed {
  alerts: AlertItem[];
  meta: FeedMeta;
}

/** SK SPSA fire-ban `Type`: a hard ban, a partial restriction, or an advisory. */
export type BanType = 'Ban' | 'Restriction' | 'Advisory' | 'Other';

/** One provincial fire-ban / open-fire-restriction area (a polygon). `ring` is the outer ring [lat,lon];
 *  MultiPolygons flatten to one BanArea per outer ring (shared type/date). An EMPTY feed means "no ban
 *  in effect" — a VALID state, never confused with the feed being down. */
export interface BanArea {
  ring: [number, number][];
  type: BanType;
  startAt: number; // Start_Date (YYYYMMDD) → epoch ms (0 if unknown) — "in effect since"
  comment: string; // Comment (e.g. "Full Ban")
}
export interface BanFeed {
  bans: BanArea[];
  meta: FeedMeta;
}
