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

/** Where the rendered feed came from — drives the tracker's freshness/offline copy. */
export type FeedSource = 'live' | 'cache' | 'offline';

/** The normalized feed the map + banner render. `hotspots` is every valid detection (plotted on the
 *  map); `fireCount` is the clustered "distinct fires" estimate (the friendlier headline number). */
export interface LiveFireFeed {
  hotspots: Hotspot[];
  fireCount: number;
  totalDetections: number;
  fetchedAt: number; // epoch ms the underlying data was fetched (for "updated Xm ago")
  source: FeedSource;
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

/** The reported-fire feed: the active fires + the per-stage tallies the legend + headline read. */
export interface ReportedFeed {
  fires: ReportedFire[];
  byStage: Record<FireStage, number>; // count per stage (for the legend)
  fetchedAt: number;
  source: FeedSource;
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
  fetchedAt: number;
  source: FeedSource;
}
