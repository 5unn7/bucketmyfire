/**
 * Live wildfire data client — fetches TODAY'S real Saskatchewan wildfire hotspots (last 24h) from
 * CWFIS (Natural Resources Canada) and hands the UI a normalized feed. Pure `fetch`, NO key, NO
 * backend: the CWFIS GeoServer WFS is public, serves GeoJSON, and returns `Access-Control-Allow-Origin: *`
 * (verified), so the browser reads it directly.
 *
 * Best-effort like the leaderboard client: any failure (offline, timeout, CORS, malformed) resolves to
 * a quiet offline/cached feed — it NEVER throws into the home screen. A day-keyed localStorage cache
 * (30-min TTL, stale-while-revalidate) keeps the home banner instant and stops reloads hammering the
 * service. The `VITE_LIVEFIRE_DISABLE=1` env flag is a single incident kill-switch (data is public, so
 * it ships ON by default).
 */
import type { LiveFireFeed } from './types';
import { normalizeFeed, SK_BBOX } from './normalize';

// CWFIS WFS: last-24h hotspots, GeoJSON, CQL-filtered to the SK bbox on the lat/lon attributes (no
// reprojection needed — every feature carries WGS84 lat/lon properties). One swappable source const.
const CQL = `lat>=${SK_BBOX.latMin} AND lat<=${SK_BBOX.latMax} AND lon>=${SK_BBOX.lonMin} AND lon<=${SK_BBOX.lonMax}`;
const LIVEFIRE_SOURCE =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=public:hotspots_last24hrs&outputFormat=application/json&srsName=EPSG:4326' +
  `&CQL_FILTER=${encodeURIComponent(CQL)}`;

/** Source attribution shown in the tracker UI. */
export const LIVEFIRE_CREDIT = 'Source: CWFIS · Natural Resources Canada';

const CACHE_KEY = 'bmf.livefire.v1';
const TTL_MS = 30 * 60 * 1000; // 30 min — beyond this the cache is "stale" and we refetch
const TIMEOUT_MS = 7000;

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
    /* storage blocked (private mode) — fine, we just refetch next time */
  }
}

/** Render a cache entry (or an empty offline feed when there's nothing cached). */
function feedFromCache(e: CacheEntry | null): LiveFireFeed {
  if (!e) return { fires: [], totalDetections: 0, fetchedAt: 0, source: 'offline' };
  return normalizeFeed(e.geojson, { fetchedAt: e.fetchedAt, source: 'cache' });
}

/**
 * Today's SK wildfire feed. Returns the FRESH live feed when reachable, else the most recent cache,
 * else an empty offline feed — never throws. With `force`, bypasses the TTL (the tracker's Refresh).
 */
export async function fetchActiveFires(opts: { force?: boolean } = {}): Promise<LiveFireFeed> {
  if (!isLiveFireEnabled()) return { fires: [], totalDetections: 0, fetchedAt: 0, source: 'offline' };

  const cached = readCache();
  const now = Date.now();
  // Warm cache within TTL → serve it instantly (stale-while-revalidate happens via the caller's choice
  // to call again with force, or naturally on the next reload after TTL).
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
    // Offline / CORS / timeout / parse error → fall back to whatever we last cached (possibly empty).
    return feedFromCache(cached);
  } finally {
    t.done();
  }
}
