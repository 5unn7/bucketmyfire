/**
 * Live wildfire tracker — shared types. The tracker pulls TODAY'S real satellite-detected wildfire
 * hotspots (last 24h) for Saskatchewan from CWFIS (Natural Resources Canada) and clusters the raw
 * detections into "active fires" the home screen lists. Pure data — no Three, no DOM — so the
 * normalize core is unit-testable in Node (scripts/verify-livefire.ts).
 */

/** Coarse intensity band derived from a fire's peak head-fire intensity (kW/m, CFFDRS-ish). */
export type FireSeverity = 'low' | 'moderate' | 'high' | 'extreme';

/** One active fire = a cluster of nearby satellite hotspot detections within the last 24h. */
export interface LiveFire {
  id: string; // stable-ish key = rounded centroid "lat,lon" (same fire keeps its id across refreshes)
  lat: number; // cluster centroid
  lon: number;
  detections: number; // how many hotspots fell in this cluster (a rough "how big / how watched")
  intensity: number; // peak head-fire intensity (kW/m) across the cluster
  severity: FireSeverity;
  lastDetect: number; // epoch ms of the most recent detection in the cluster
  place: string; // nearest known SK community (label only — UI renders "near {place}")
  agency: string; // reporting agency of the peak detection (SK, MB, …)
}

/** Where the rendered feed came from — drives the tracker's freshness/offline copy. */
export type FeedSource = 'live' | 'cache' | 'offline';

/** The normalized feed the UI renders. `fires` is already sorted + capped; `totalDetections` is the
 *  raw SK hotspot count (pre-cluster) for the headline. */
export interface LiveFireFeed {
  fires: LiveFire[];
  totalDetections: number;
  fetchedAt: number; // epoch ms the underlying data was fetched (for "updated Xm ago")
  source: FeedSource;
}
