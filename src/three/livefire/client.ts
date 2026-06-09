/**
 * Live wildfire data client — fetches the live CWFIS (Natural Resources Canada) satellite hotspot feed
 * (`hotspots_last24hrs`, continent-wide, last 24h) and hands the UI a normalized feed. Pure `fetch`, NO
 * key, NO backend: the CWFIS GeoServer WFS is public, serves GeoJSON, and returns
 * `Access-Control-Allow-Origin: *` (verified), so the browser reads it directly. The WHOLE feed is
 * fetched (no geographic filter) — every detection across Canada + the US is plotted on the map.
 *
 * Best-effort like the leaderboard client: any failure (offline, timeout, CORS, malformed) resolves to a
 * quiet cached/offline feed — it NEVER throws into the home screen. A localStorage cache (30-min TTL,
 * stale-while-revalidate) keeps the home banner instant and stops reloads hammering the service. The
 * `VITE_LIVEFIRE_DISABLE=1` env flag is a single incident kill-switch (data is public, so it ships ON).
 */
import type { LiveFireFeed, CountryFilter, ReportedFeed, NationalSummary, BurnPolygon, FeedSource } from './types';
import { normalizeFeed, normalizeReported, normalizeSummary, parseBurnPolygons } from './normalize';

// Remembered country filter for the map + home banner. Defaults to Canada (the game's home turf).
const COUNTRY_KEY = 'bmf.livefire.country.v1';
export function getCountryPref(): CountryFilter {
  try {
    const v = localStorage.getItem(COUNTRY_KEY);
    if (v === 'CA' || v === 'US' || v === 'MX' || v === 'all') return v;
  } catch {
    /* storage blocked — fall through to the default */
  }
  return 'CA';
}
export function setCountryPref(c: CountryFilter): void {
  try {
    localStorage.setItem(COUNTRY_KEY, c);
  } catch {
    /* ignore */
  }
}

// CWFIS WFS: last-24h hotspots, GeoJSON, WGS84, the FULL feed (no CQL filter). One swappable source const.
export const LIVEFIRE_SOURCE =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=public:hotspots_last24hrs&outputFormat=application/json&srsName=EPSG:4326';

// CIFFC dashboard summary (the "Current fires / Year-to-date" panel). Keyless JSON, CORS `*`, ~187 B.
export const SUMMARY_SOURCE = 'https://api.ciffc.net/v1/dashboard/summary';

// CIFFC active-fire roll (the AUTHORITATIVE "Active Wildland Fires" map). Filtered server-side to the
// plottable stages (Out of Control / Being Held / Under Control) so we pull ~100 features, not the
// whole year-to-date list. Carries stage of control + hectares + agency per fire. Keyless, CORS `*`.
export const REPORTED_FIRES_SOURCE =
  'https://geoserver.ciffc.net/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=ciffc:ytd_fires&outputFormat=application/json&srsName=EPSG:4326&count=2000' +
  "&CQL_FILTER=field_stage_of_control_status%20IN%20('OC','BH','UC')";

// CWFIS satellite-mapped burn perimeters (the TRUE footprint shapes). GeoJSON polygons, WGS84.
export const BURN_PERIM_SOURCE =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=public:m3_polygons_current&outputFormat=application/json&srsName=EPSG:4326&count=1500';

// CWFIS Fire Weather Index raster (a Leaflet WMS tile overlay — the orange-shaded fire-danger field).
export const FWI_WMS_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms';
export const FWI_WMS_LAYER = 'public:fwi_current';

/** Source attribution shown in the tracker UI. */
export const LIVEFIRE_CREDIT = 'Sources: CWFIS (NRCan) · CIFFC';

const CACHE_KEY = 'bmf.livefire.v2'; // v2: full-feed shape (v1 was the SK-only list)
const TTL_MS = 30 * 60 * 1000; // 30 min — beyond this the cache is "stale" and we refetch
const TIMEOUT_MS = 12000; // the full feed is ~750 KB, give a flaky mobile link room

/** Ships ON unless explicitly disabled (the data is public + the whole client degrades to offline). */
export function isLiveFireEnabled(): boolean {
  return import.meta.env.VITE_LIVEFIRE_DISABLE !== '1';
}

/** Abort a hung request so the home banner never waits forever. (Mirrors leaderboard/client.withTimeout.) */
function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

interface CacheEntry {
  fetchedAt: number;
  geojson: unknown;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry;
    if (typeof e?.fetchedAt !== 'number' || !e.geojson) return null;
    return e;
  } catch {
    return null;
  }
}

function writeCache(e: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(e));
  } catch {
    /* storage blocked / quota (private mode, big feed) — fine, we just refetch next time */
  }
}

/** Render a cache entry (or an empty offline feed when there's nothing cached). */
function feedFromCache(e: CacheEntry | null): LiveFireFeed {
  if (!e) return { hotspots: [], fireCount: 0, totalDetections: 0, fetchedAt: 0, source: 'offline' };
  return normalizeFeed(e.geojson, { fetchedAt: e.fetchedAt, source: 'cache' });
}

/**
 * The live continent-wide wildfire feed. Returns the FRESH live feed when reachable, else the most
 * recent cache, else an empty offline feed — never throws. With `force`, bypasses the TTL (the map's
 * Refresh).
 */
export async function fetchActiveFires(opts: { force?: boolean } = {}): Promise<LiveFireFeed> {
  if (!isLiveFireEnabled()) return { hotspots: [], fireCount: 0, totalDetections: 0, fetchedAt: 0, source: 'offline' };

  const cached = readCache();
  const now = Date.now();
  if (!opts.force && cached && now - cached.fetchedAt < TTL_MS) return feedFromCache(cached);

  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(LIVEFIRE_SOURCE, { signal: t.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return feedFromCache(cached);
    const geojson = (await res.json()) as unknown;
    const fetchedAt = Date.now();
    writeCache({ fetchedAt, geojson });
    return normalizeFeed(geojson, { fetchedAt, source: 'live' });
  } catch {
    return feedFromCache(cached);
  } finally {
    t.done();
  }
}

// ── Generic cached JSON fetch (shared by the reported-fire / summary / perimeter feeds) ──────────
// Same best-effort contract as fetchActiveFires: fresh-when-reachable, else the most recent cache,
// else a null/offline result — it NEVER throws into the UI. Each feed owns its own localStorage key.
interface RawEntry {
  fetchedAt: number;
  json: unknown;
}
function readRaw(key: string): RawEntry | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const e = JSON.parse(raw) as RawEntry;
    if (typeof e?.fetchedAt !== 'number' || e.json == null) return null;
    return e;
  } catch {
    return null;
  }
}
function writeRaw(key: string, e: RawEntry): void {
  try {
    localStorage.setItem(key, JSON.stringify(e));
  } catch {
    /* storage blocked / quota — fine, we just refetch next time */
  }
}

/** Fetch + cache a JSON URL, degrading to cache then offline. Returns the raw parsed JSON plus the
 *  freshness metadata the normalizers need. `null` json ⇒ nothing live and nothing cached. */
async function fetchJsonCached(
  url: string,
  key: string,
  ttlMs: number,
  timeoutMs: number,
  force: boolean,
): Promise<{ json: unknown | null; fetchedAt: number; source: FeedSource }> {
  const cached = readRaw(key);
  const fromCache = (): { json: unknown | null; fetchedAt: number; source: FeedSource } =>
    cached ? { json: cached.json, fetchedAt: cached.fetchedAt, source: 'cache' } : { json: null, fetchedAt: 0, source: 'offline' };
  if (!force && cached && Date.now() - cached.fetchedAt < ttlMs) return fromCache();

  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return fromCache();
    const json = (await res.json()) as unknown;
    const fetchedAt = Date.now();
    writeRaw(key, { fetchedAt, json });
    return { json, fetchedAt, source: 'live' };
  } catch {
    return fromCache();
  } finally {
    t.done();
  }
}

const SUMMARY_CACHE = 'bmf.livefire.summary.v1';
const REPORTED_CACHE = 'bmf.livefire.reported.v1';
const PERIM_CACHE = 'bmf.livefire.perim.v1';

/** The national summary panel (CIFFC) — Reported today / Active / YTD totals / Area burned / prep level. */
export async function fetchSummary(opts: { force?: boolean } = {}): Promise<NationalSummary> {
  const off: NationalSummary = { firesToday: 0, activeFires: 0, ytdTotal: 0, ytdOut: 0, areaBurnedHa: 0, prepLevel: 0, fetchedAt: 0, source: 'offline' };
  if (!isLiveFireEnabled()) return off;
  const { json, fetchedAt, source } = await fetchJsonCached(SUMMARY_SOURCE, SUMMARY_CACHE, TTL_MS, 8000, !!opts.force);
  if (json == null) return off;
  return normalizeSummary(json, { fetchedAt, source });
}

/** The authoritative reported active-fire roll (CIFFC) — stage of control + hectares per fire. */
export async function fetchReportedFires(opts: { force?: boolean } = {}): Promise<ReportedFeed> {
  const off: ReportedFeed = { fires: [], byStage: { OC: 0, BH: 0, UC: 0, OUT: 0, UNK: 0 }, fetchedAt: 0, source: 'offline' };
  if (!isLiveFireEnabled()) return off;
  const { json, fetchedAt, source } = await fetchJsonCached(REPORTED_FIRES_SOURCE, REPORTED_CACHE, TTL_MS, TIMEOUT_MS, !!opts.force);
  if (json == null) return off;
  return normalizeReported(json, { fetchedAt, source });
}

/** Satellite-mapped burn perimeters (CWFIS M3) — the true footprint shapes. Best-effort: [] when down. */
export async function fetchBurnPerimeters(opts: { force?: boolean } = {}): Promise<BurnPolygon[]> {
  if (!isLiveFireEnabled()) return [];
  const { json } = await fetchJsonCached(BURN_PERIM_SOURCE, PERIM_CACHE, TTL_MS, 15000, !!opts.force);
  if (json == null) return [];
  return parseBurnPolygons(json);
}
