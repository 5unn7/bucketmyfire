/**
 * Live wildfire data client — the fetch layer for the "honest window" tracker. Every source is fetched
 * with plain `fetch`, NO key, NO backend, and returns a feed carrying a per-source `meta` (status +
 * `fromCache` + the SOURCE's publish time) so the UI can be honest about what's live, what's cached, and
 * what's unavailable — NEVER a silent blank. All endpoints are verified keyless + CORS-`*` from the
 * browser (see the recon notes); the one feed that ISN'T browser-fetchable (the CIFFC GeoServer WFS) was
 * the cause of "active fire shows nothing" and is replaced here by the CORS-safe CIFFC dashboard API.
 *
 * Best-effort like the leaderboard client: any failure (offline, timeout, CORS, malformed) degrades to
 * the most recent cache, else an `unavailable` feed — it NEVER throws into the home screen. A localStorage
 * cache (30-min TTL, stale-while-revalidate) keeps the home banner instant. `VITE_LIVEFIRE_DISABLE=1` is
 * the incident kill-switch; when set, every feed reports `status:'disabled'` (intentionally off, not down).
 */
import type {
  LiveFireFeed, CountryFilter, ReportedFeed, ReportedFire, FireStage, Country, FireHistoryPoint,
  NationalSummary, BurnFeed, FeedMeta, SourceStatus, RegionFilter, FireActivity,
} from './types';
import { normalizeFeed, normalizeReported, normalizeSummary, normalizeBurn, parseFwiIssueDate, countryOf, isActiveStage, parseRegion, regionValue, deriveFireActivity } from './normalize';
// The ingestion backend lives in the SAME Supabase project as the leaderboard; reuse its rest accessors
// (the cloud-save module reuses them the same way) rather than re-reading the env vars here.
import { isConfigured as supabaseConfigured, restBase, restHeaders } from '../leaderboard/client';

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

// Remembered REGION (country + optional Canadian province), stored as the encoded value (`'CA:SK'`) under
// its OWN versioned key — the country key above whitelists CA|US|MX|all and would reject a province code.
const REGION_KEY = 'bmf.livefire.region.v1';
export function getRegionPref(): RegionFilter {
  try {
    const v = localStorage.getItem(REGION_KEY);
    if (v) return parseRegion(v); // parseRegion is junk-safe → always a valid RegionFilter
  } catch {
    /* storage blocked — fall through */
  }
  return { country: getCountryPref() }; // legacy migration: inherit the old country-only pref
}
export function setRegionPref(r: RegionFilter): void {
  try {
    localStorage.setItem(REGION_KEY, regionValue(r));
  } catch {
    /* ignore */
  }
  setCountryPref(r.country); // keep the legacy country key coherent (the home banner still reads it)
}

// ── Source endpoints (each a single swappable const; all keyless + CORS-`*` from the browser) ─────────

// CWFIS WFS: last-24h satellite hotspots, GeoJSON, WGS84, the FULL continent-wide feed (no CQL filter).
export const LIVEFIRE_SOURCE =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=public:hotspots_last24hrs&outputFormat=application/json&srsName=EPSG:4326';

// CIFFC dashboard summary (the "Current fires / Year-to-date" panel). Keyless JSON, CORS `*`, ~190 B.
export const SUMMARY_SOURCE = 'https://api.ciffc.net/v1/dashboard/summary';

// CIFFC active-fire roll — the AUTHORITATIVE "Active Wildland Fires" list. The GeoServer WFS
// (geoserver.ciffc.net ciffc:ytd_fires) carries the SAME data but is CORS-BLOCKED in the browser (no
// Access-Control-Allow-Origin even with an Origin header) — that was the "active fire shows nothing" bug.
// This dashboard API on api.ciffc.net IS CORS-`*` (same host as the summary above). It returns the FULL
// year-to-date list (~1700 features incl. OUT) with NO server-side stage filter, so we fetch it all and
// `normalizeReported` filters to the active stages (OC/BH/UC) client-side. NOTE: its GeoJSON geometry is
// corrupt (duplicates latitude) — `parseReportedFires` reads the field_latitude/field_longitude props.
export const REPORTED_FIRES_SOURCE = 'https://api.ciffc.net/v1/dashboard/fires';

// CWFIS satellite-mapped burn perimeters (the TRUE footprint shapes). GeoJSON polygons, WGS84.
export const BURN_PERIM_SOURCE =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=public:m3_polygons_current&outputFormat=application/json&srsName=EPSG:4326&count=1500';


// CWFIS Fire Weather Index raster (a Leaflet WMS tile overlay — the orange-shaded fire-danger field).
export const FWI_WMS_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms';
// The OBSERVED grid (`fwi_current`) is interpolated from sparse weather STATIONS → patchy, with big gaps
// between stations (the "missing coverage"). The time-enabled `fwi` layer's near-term FORECAST is the
// CONTINUOUS model grid (full coverage over all fuelled land), so we draw that — keyless + CORS-`*`, same
// service. Honestly labeled a forecast in the chip + ledger.
export const FWI_WMS_LAYER = 'public:fwi';
/** WMS TIME (yyyy-mm-dd) for the FWI layer: today's value is still the patchy station ANALYSIS, so we ask
 *  for a near-term FORECAST day, which is the continuous model grid. Shared by the tile layer + the ledger
 *  label so they always name the same day. */
export function fwiForecastTime(now: number = Date.now()): string {
  return new Date(now + 86_400_000).toISOString().slice(0, 10); // today + 1 day (UTC)
}
// The FWI raster has no per-feature timestamp; its issue date lives in the WMS layer <Title> ("… - YYYY-MM-DD").
const FWI_CAPS_SOURCE = `${FWI_WMS_URL}?service=WMS&version=1.3.0&request=GetCapabilities`;

// ECCC GeoMet WMS — the surface-smoke FORECAST raster (FireWork / RAQDPS-FW PM2.5). Keyless, CORS-`*`, and
// it exposes an hourly TIME dimension, so the layer ANIMATES: pass &TIME=<iso hour> per frame. It is a
// FORECAST (a model prediction), not an observation — the UI labels it so. firesmoke.ca itself is
// CORS-blocked, so this Canadian-government WMS is the honest, browser-fetchable equivalent.
export const GEOMET_WMS_URL = 'https://geo.weather.gc.ca/geomet';
export const SMOKE_WMS_LAYER = 'RAQDPS.Sfc_PM2.5-WildfireSmokePlume';
// White→grey SHADED ramp rendered SERVER-SIDE via a custom SLD (GeoMet honors `SLD_BODY` — verified live).
// The layer's BUILT-IN styles are an AQI rainbow whose low end is a dark BLUE that's near-invisible on the
// dark basemap; this maps PM2.5 (µg/m³) to a smoke-true grey→white that deepens — lighter AND more opaque —
// with DENSITY, so a thin trail reads as soft grey haze and a dense plume as bright white. Sent as the
// `sld_body` GetMap param (with `styles=` empty); minified to keep the per-tile GET URL short. Retint by
// editing the ColorMap — the layer/time wiring is unchanged.
export const SMOKE_WMS_SLD =
  '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld">' +
  '<NamedLayer><Name>RAQDPS.Sfc_PM2.5-WildfireSmokePlume</Name><UserStyle><FeatureTypeStyle><Rule>' +
  '<RasterSymbolizer><Opacity>1</Opacity><ColorMap type="ramp">' +
  '<ColorMapEntry color="#b9c0c5" quantity="1" opacity="0"/>' + // below ~1 µg/m³ → fully clear (no fog everywhere)
  '<ColorMapEntry color="#c4cbd0" quantity="6" opacity="0.38"/>' + // thin haze: soft mid-grey, just readable
  '<ColorMapEntry color="#d9dee2" quantity="30" opacity="0.64"/>' + // moderate smoke: lighter grey
  '<ColorMapEntry color="#eef1f3" quantity="90" opacity="0.83"/>' + // dense: near-white
  '<ColorMapEntry color="#ffffff" quantity="250" opacity="0.95"/>' + // thickest core: bright white
  '</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>';

// FWI danger ramp rendered SERVER-SIDE via SLD (CWFIS GeoServer honors `SLD_BODY`). The DEFAULT
// `public:fwi` style is a 16-COLOUR (4-bit-palette) classified PNG with SEMI-TRANSPARENT fills — the
// 16-colour palette can't hold smooth alpha, so GeoServer ordered-DITHERS it, and that pixel dither
// magnifies into huge black octagons when draped on the close globe. A continuous `type="ramp"` forces
// a 256-colour palette where every entry carries its OWN alpha (no dither) AND lets us brand the
// colours: a warm DANGER heat-field on the "fight" register — calm green (low) → ember → red (extreme),
// each stop's opacity rising with danger so low FWI is a faint wash and extreme reads hot. The globe
// (per-stop alpha + a gentle global dimmer) and the flat map (a low-opacity tint) share this one SLD.
export const FWI_WMS_SLD =
  '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld">' +
  '<NamedLayer><Name>public:fwi</Name><UserStyle><FeatureTypeStyle><Rule>' +
  '<RasterSymbolizer><Opacity>1</Opacity><ColorMap type="ramp">' +
  '<ColorMapEntry color="#63d68a" quantity="0" opacity="0"/>' + // no/low danger → clear (lets the map read)
  '<ColorMapEntry color="#7fcf86" quantity="2" opacity="0.16"/>' + // low: a faint calm-green wash
  '<ColorMapEntry color="#ffc861" quantity="9" opacity="0.34"/>' + // moderate: caution amber
  '<ColorMapEntry color="#ff7a45" quantity="18" opacity="0.52"/>' + // high: fire orange
  '<ColorMapEntry color="#ff5d4d" quantity="30" opacity="0.68"/>' + // very high: warn red
  '<ColorMapEntry color="#e23a2a" quantity="45" opacity="0.84"/>' + // extreme: deep red, hottest + most opaque
  '</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>';

// ── GWIS: the GLOBAL Fire Weather Index forecast (EC JRC — Global Wildfire Information System) ───────
// CWFIS's FWI grid is Canada-only; GWIS computes the SAME Canadian FWI index WORLDWIDE from the ECMWF
// 8 km model (1–9 day forecast). Keyless, CORS-`*`, and it honors `sld_body` (all verified live against
// the GetCapabilities + sample GetMaps). We draw it as a WHOLE-PLANET wash BENEATH the finer CWFIS Canada
// drape — the danger field colours the entire globe while Canada keeps its higher-resolution national grid
// on top. Same TIME (yyyy-mm-dd) param + same brand ramp as CWFIS. Its data window is rolling/near-real-
// time, so a future-dated request returns a blank tile and the drape degrades silently (no hard error).
export const GWIS_FWI_WMS_URL = 'https://ies-ows.jrc.ec.europa.eu/gwis';
export const GWIS_FWI_LAYER = 'ecmwf.fwi';
// The brand ramp re-pointed at the GWIS layer name (an SLD's NamedLayer Name must match the layer it styles).
export const GWIS_FWI_SLD = FWI_WMS_SLD.replace('public:fwi', GWIS_FWI_LAYER);

// ── FWI forecast FRAMES (the flat-map day-scrubber morph) ───────────────────────────────────────────
// The map animates the Fire-Weather-Index forecast by stepping a day-scrubber. Driving a TILED WMS layer's
// TIME param per step STROBES — Leaflet drops the old tiles the instant the param changes and blanks the
// danger field until the new tiles load. A single GetMap IMAGE per day instead crossfades + preloads cleanly
// (one image morphs/warms; tiles can't). FWI rises/falls IN PLACE, so a temporal cross-dissolve is the honest
// morph. These helpers build the per-day image URL for the two sources (Canada CWFIS + whole-planet GWIS).
export type DrapeBox = { lonMin: number; latMin: number; lonMax: number; latMax: number };
/** The two FWI GetMap windows: the CWFIS Canada box + the whole-planet GWIS box. */
export const FWI_BOX: DrapeBox = { lonMin: -141, latMin: 40, lonMax: -50, latMax: 84 };
export const FWI_GLOBE_BOX: DrapeBox = { lonMin: -180, latMin: -90, lonMax: 180, latMax: 90 };

// Web Mercator (EPSG:3857) — the slippy map's OWN projection. The FWI GetMap must be requested in 3857, not
// 4326: a single equirectangular (4326) image stretched onto a mercator map drifts in latitude (worse toward
// the poles), so the danger field slides off the basemap (the "fire weather not mapped to the flat map" bug).
// Requesting 3857 makes the image match the map; the lat/lon overlay bounds — clamped to MERC_LAT_MAX, since
// mercator can't reach the poles — then line up pixel-true. Consumers that place the image (FireMap's
// FwiForecastLayer) must clamp their bounds to MERC_LAT_MAX too, so image extent and overlay box agree.
export const MERC_LAT_MAX = 85.0511287798066;
const mercX = (lon: number): number => (lon / 180) * 20037508.342789244;
const mercY = (lat: number): number => {
  const c = Math.max(-MERC_LAT_MAX, Math.min(MERC_LAT_MAX, lat));
  return 6378137 * Math.log(Math.tan(Math.PI / 4 + (c * Math.PI) / 360));
};

/** A single-image WMS GetMap URL (v1.1.1, EPSG:3857) over a lat/lon box — see MERC_LAT_MAX above for why
 *  mercator. The PNG height follows the box's MERCATOR aspect so the image isn't vertically squashed. */
export function wmsUrl(base: string, layer: string, box: DrapeBox, opts: { time?: string; sld?: string; width: number }): string {
  const minX = mercX(box.lonMin), maxX = mercX(box.lonMax);
  const minY = mercY(box.latMin), maxY = mercY(box.latMax);
  const h = Math.round((opts.width * (maxY - minY)) / (maxX - minX));
  const p = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', layers: layer, styles: '',
    format: 'image/png', transparent: 'true', srs: 'EPSG:3857',
    bbox: `${minX},${minY},${maxX},${maxY}`,
    width: String(opts.width), height: String(h),
  });
  if (opts.time) p.set('time', opts.time);
  if (opts.sld) p.set('sld_body', opts.sld);
  return `${base}?${p.toString()}`;
}

// A Supabase edge function (`fwi-frame`) caches these PNGs server-side (reliable, CORS-clean, one fetch serves
// everyone instead of per-visitor upstream hits). When true + Supabase configured, frames route through it;
// else we hit CWFIS/GWIS DIRECTLY — same images. Re-deployed 2026-06-11 as v2 with the EPSG:3857 projection
// fix (it now mirrors wmsUrl's mercator math), smoke-tested serving 512×705 mercator PNGs, so the cache is
// back on. Flip false to fall back to the direct upstream if the proxy ever regresses.
const FWI_PROXY_DEPLOYED: boolean = true;

/** The GetMap PNG URL for ONE FWI forecast day + source — the cached proxy when deployed + configured, else
 *  the direct CWFIS/GWIS upstream. `day` is yyyy-mm-dd (UTC); `width` sets the PNG width (height follows bbox). */
export function fwiFrameUrl(src: 'cwfis' | 'gwis', day: string, width: number): string {
  if (FWI_PROXY_DEPLOYED && supabaseConfigured()) {
    return `${restBase()}/functions/v1/fwi-frame?src=${src}&day=${day}&w=${width}`;
  }
  return src === 'cwfis'
    ? wmsUrl(FWI_WMS_URL, FWI_WMS_LAYER, FWI_BOX, { time: day, sld: FWI_WMS_SLD, width })
    : wmsUrl(GWIS_FWI_WMS_URL, GWIS_FWI_LAYER, FWI_GLOBE_BOX, { time: day, sld: GWIS_FWI_SLD, width });
}

/** Source attribution shown in the tracker UI. */
export const LIVEFIRE_CREDIT = 'Sources: CWFIS (NRCan) · CIFFC · ECCC · GWIS (EC JRC)';

// ── Cache + timing ────────────────────────────────────────────────────────────────────────────────
const HOTSPOT_CACHE = 'bmf.livefire.v3'; // v3: raw-json shape + meta model (v1 SK list, v2 geojson key)
const SUMMARY_CACHE = 'bmf.livefire.summary.v1';
const REPORTED_CACHE = 'bmf.livefire.reported.v2'; // v2 caches the NORMALIZED feed (the raw roll is ~965 KB)
const PERIM_CACHE = 'bmf.livefire.perim.v1';
const FWI_META_CACHE = 'bmf.livefire.fwi.v1';
const TTL_MS = 30 * 60 * 1000; // 30 min — beyond this the cache is "stale" and we refetch
const FWI_TTL_MS = 6 * 60 * 60 * 1000; // the FWI issue date changes daily — re-derive at most every 6h
const TIMEOUT_MS = 12000; // the hotspot feed is ~750 KB, give a flaky mobile link room
const REPORTED_TIMEOUT_MS = 15000; // the CIFFC roll is ~965 KB

/** Ships ON unless explicitly disabled (the data is public + the whole client degrades to offline). */
export function isLiveFireEnabled(): boolean {
  return import.meta.env.VITE_LIVEFIRE_DISABLE !== '1';
}

/** The kill-switch meta: a feed that's intentionally OFF (never confused with "down" in the ledger). */
const DISABLED_META: FeedMeta = { status: 'disabled', fromCache: false, publishedAt: 0, fetchedAt: 0 };
/** Honest empty feeds for the disabled/unavailable states (publishedAt 0 = unknown). */
const offMeta = (status: SourceStatus): FeedMeta => ({ status, fromCache: false, publishedAt: 0, fetchedAt: 0 });

/** Abort a hung request so the home banner never waits forever. (Mirrors leaderboard/client.withTimeout.) */
function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

// ── Generic cached RAW-json fetch (hotspots / summary / perimeters) ───────────────────────────────
// Outcome model (the honesty spine): status 'live' = we have usable data (fresh OR cached); 'unavailable'
// = failed AND nothing cached. `fromCache` is orthogonal (a live feed can be served from cache, incl. a
// stale cache after a failed refresh — publishedAt then reveals its true age). NEVER throws.
interface RawEntry {
  fetchedAt: number;
  json: unknown;
}
interface RawOutcome {
  json: unknown | null;
  fetchedAt: number;
  status: SourceStatus;
  fromCache: boolean;
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
async function loadCachedRaw(url: string, key: string, ttlMs: number, timeoutMs: number, force: boolean): Promise<RawOutcome> {
  const cached = readRaw(key);
  const fromCacheOutcome = (): RawOutcome =>
    cached
      ? { json: cached.json, fetchedAt: cached.fetchedAt, status: 'live', fromCache: true }
      : { json: null, fetchedAt: 0, status: 'unavailable', fromCache: false };
  if (!force && cached && Date.now() - cached.fetchedAt < ttlMs) return fromCacheOutcome();

  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return fromCacheOutcome();
    const json = (await res.json()) as unknown;
    const fetchedAt = Date.now();
    writeRaw(key, { fetchedAt, json });
    return { json, fetchedAt, status: 'live', fromCache: false };
  } catch {
    return fromCacheOutcome(); // offline / CORS / timeout → serve the most recent cache (stale-but-honest)
  } finally {
    t.done();
  }
}

/**
 * The live continent-wide satellite hotspot feed. Fresh-when-reachable, else cache, else `unavailable` —
 * never throws. With `force`, bypasses the TTL (the map's Refresh).
 */
export async function fetchActiveFires(opts: { force?: boolean } = {}): Promise<LiveFireFeed> {
  const empty = (meta: FeedMeta): LiveFireFeed => ({ hotspots: [], fireCount: 0, totalDetections: 0, meta });
  if (!isLiveFireEnabled()) return empty(DISABLED_META);
  const r = await loadCachedRaw(LIVEFIRE_SOURCE, HOTSPOT_CACHE, TTL_MS, TIMEOUT_MS, !!opts.force);
  if (r.json == null) return empty(offMeta('unavailable'));
  return normalizeFeed(r.json, { fetchedAt: r.fetchedAt, status: r.status, fromCache: r.fromCache });
}

/** The national summary panel (CIFFC) — Reported today / Active / YTD totals / Area burned / prep level. */
export async function fetchSummary(opts: { force?: boolean } = {}): Promise<NationalSummary> {
  const empty = (meta: FeedMeta): NationalSummary => ({ firesToday: 0, activeFires: 0, ytdTotal: 0, ytdOut: 0, areaBurnedHa: 0, prepLevel: 0, meta });
  if (!isLiveFireEnabled()) return empty(DISABLED_META);
  const r = await loadCachedRaw(SUMMARY_SOURCE, SUMMARY_CACHE, TTL_MS, 8000, !!opts.force);
  if (r.json == null) return empty(offMeta('unavailable'));
  return normalizeSummary(r.json, { fetchedAt: r.fetchedAt, status: r.status, fromCache: r.fromCache });
}

// ── Reported active fires (CIFFC dashboard API) — cached NORMALIZED (the raw roll is ~965 KB) ─────────
interface ReportedCacheEntry {
  fetchedAt: number;
  feed: ReportedFeed;
}
function readReportedCache(): ReportedCacheEntry | null {
  try {
    const raw = localStorage.getItem(REPORTED_CACHE);
    if (!raw) return null;
    const e = JSON.parse(raw) as ReportedCacheEntry;
    if (typeof e?.fetchedAt !== 'number' || !e.feed || !Array.isArray(e.feed.fires) || !Array.isArray(e.feed.out) || !e.feed.meta) return null;
    return e;
  } catch {
    return null;
  }
}
/** Re-stamp a cached feed as served-from-cache (status stays live; publishedAt is the data's own time). */
function reportedFromCache(e: ReportedCacheEntry): ReportedFeed {
  return { ...e.feed, meta: { ...e.feed.meta, fromCache: true, status: 'live' } };
}

/** The authoritative reported active-fire roll (CIFFC) — stage of control + hectares per fire. Fetches the
 *  full YTD list, filters to active stages, and caches the (small) normalized feed — never the 965 KB raw. */
export async function fetchReportedFires(opts: { force?: boolean } = {}): Promise<ReportedFeed> {
  const empty = (meta: FeedMeta): ReportedFeed => ({ fires: [], out: [], byStage: { OC: 0, BH: 0, UC: 0, OUT: 0, UNK: 0 }, meta });
  if (!isLiveFireEnabled()) return empty(DISABLED_META);

  // Backend-preferred: read our own ingestion store (one server-side fetch serves everyone, it's the
  // source of per-fire HISTORY, and it survives a CIFFC schema change). If it's unconfigured, down, or
  // empty (e.g. before the first ingest), fall through to the direct CIFFC roll below — never blank.
  if (supabaseConfigured()) {
    const backend = await fetchReportedFromBackend();
    if (backend && (backend.fires.length || backend.out.length)) return backend;
  }

  const cached = readReportedCache();
  if (!opts.force && cached && Date.now() - cached.fetchedAt < TTL_MS) return reportedFromCache(cached);

  const t = withTimeout(REPORTED_TIMEOUT_MS);
  try {
    const res = await fetch(REPORTED_FIRES_SOURCE, { signal: t.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return cached ? reportedFromCache(cached) : empty(offMeta('unavailable'));
    const json = (await res.json()) as unknown;
    const fetchedAt = Date.now();
    const feed = normalizeReported(json, { fetchedAt, status: 'live', fromCache: false });
    try {
      localStorage.setItem(REPORTED_CACHE, JSON.stringify({ fetchedAt, feed } satisfies ReportedCacheEntry));
    } catch {
      /* quota — fine, we refetch next time */
    }
    return feed;
  } catch {
    return cached ? reportedFromCache(cached) : empty(offMeta('unavailable')); // offline/CORS/timeout → stale cache or honest unavailable
  } finally {
    t.done();
  }
}

// ── Ingestion-backend reads (Phases 1–3) ─────────────────────────────────────────────────────────
// Our own Supabase store, populated server-side by the ingest-fires Edge Function on a pg_cron
// schedule (supabase/functions/ingest-fires + the scheduling block in supabase/schema.sql). Same
// plain-fetch / PostgREST / anon-key pattern as the leaderboard. All best-effort: a failure here
// returns null/[] and the reported-fire reader falls back to the direct CIFFC roll.

interface FireRow {
  fire_id: string;
  lat: number;
  lon: number;
  agency: string | null;
  country: string | null;
  stage: string;
  size_ha: number | null;
  props: Record<string, unknown> | null;
  reported_at: string | null;
}
interface ProvFireRow {
  source: string;
  source_fire_id: string;
  agency: string | null;
  name: string | null;
  lat: number;
  lon: number;
  stage: string | null;
  size_ha: number | null;
  props: Record<string, unknown> | null;
  discovered_at: string | null;
  updated_at_src: string | null;
}

/** Map a `public.fires` (national CIFFC) row to the SAME ReportedFire shape `normalizeReported` produces,
 *  so the map + detail panel render identically whichever path served the data. */
function rowToReported(r: FireRow): ReportedFire {
  const agency = r.agency ?? '';
  const at = r.reported_at ? Date.parse(r.reported_at) || 0 : 0;
  return {
    lat: r.lat,
    lon: r.lon,
    sizeHa: typeof r.size_ha === 'number' ? r.size_ha : -1,
    stage: r.stage as FireStage,
    agency,
    country: (r.country as Country) || countryOf(agency),
    at: Number.isFinite(at) ? at : 0,
    fireId: r.fire_id ?? '',
    props: r.props ?? {},
  };
}

/** Map a `public.provincial_fires` row → ReportedFire, tagged with its `source` + `name` so the detail
 *  panel can render the richer provincial record (cause, response, per-fire official URL, …). */
function provRowToReported(r: ProvFireRow): ReportedFire {
  const agency = r.agency ?? '';
  const at = Date.parse(r.updated_at_src ?? r.discovered_at ?? '') || 0;
  return {
    lat: r.lat,
    lon: r.lon,
    sizeHa: typeof r.size_ha === 'number' ? r.size_ha : -1,
    stage: (r.stage as FireStage) || 'UNK',
    agency,
    country: countryOf(agency),
    at: Number.isFinite(at) ? at : 0,
    fireId: r.source_fire_id ?? '',
    props: r.props ?? {},
    source: r.source,
    name: r.name ?? undefined,
  };
}

/** Provincial sources we DON'T prefer over CIFFC yet (their rows still ingest; the national roll covers
 *  those provinces meanwhile). NL's stage codes are now mapped CORRECTLY (O=Out per the FFA_Wildfire
 *  domain — see ingest-provincial nlStage), but it stays gated for a separate reason: its feed carries
 *  MULTI-YEAR history (2024/2025 fires) and ~886 Out records, unlike the current-season provincial feeds.
 *  Remove 'nl-ffa' here to show NL's (currently 2) real active fires once that feed shape is handled. */
const UNTRUSTED_PROVINCIAL = new Set(['nl-ffa']);

async function fetchBackendRows<T>(table: string, query: string): Promise<T[] | null> {
  const t = withTimeout(8000);
  try {
    const res = await fetch(`${restBase()}/rest/v1/${table}?${query}`, { headers: restHeaders(), signal: t.signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as T[];
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/**
 * Reported-fire roll from our ingestion backend, PREFER-PROVINCIAL per province: a province with its own
 * agency feed (BC/AB/ON/…) is shown from THAT feed (richer — cause, official URL); provinces without one
 * (SK/MB/PE/NU) fall back to the national CIFFC roll. Returns null only when BOTH backend reads yield
 * nothing (→ the caller then falls back to the direct CIFFC fetch, so the map is never blank).
 */
async function fetchReportedFromBackend(): Promise<ReportedFeed | null> {
  const [ciffcRows, provRows] = await Promise.all([
    fetchBackendRows<FireRow>('fires', 'select=fire_id,lat,lon,agency,country,stage,size_ha,props,reported_at&stage=in.(OC,BH,UC,OUT)&order=size_ha.desc.nullslast&limit=5000'),
    fetchBackendRows<ProvFireRow>('provincial_fires', 'select=source,source_fire_id,agency,name,lat,lon,stage,size_ha,props,discovered_at,updated_at_src&order=size_ha.desc.nullslast&limit=8000'),
  ]);

  const prov = (provRows ?? []).filter((r) => !UNTRUSTED_PROVINCIAL.has(r.source)).map(provRowToReported);
  if ((ciffcRows == null || ciffcRows.length === 0) && prov.length === 0) return null;

  // Provinces with trusted provincial coverage → drop CIFFC's rows for those (prefer provincial).
  const covered = new Set(prov.map((f) => f.agency.toUpperCase()).filter(Boolean));
  const ciffcKept = (ciffcRows ?? []).map(rowToReported).filter((f) => !covered.has(f.agency.toUpperCase()));
  const all = [...prov, ...ciffcKept];

  const byStage: Record<FireStage, number> = { OC: 0, BH: 0, UC: 0, OUT: 0, UNK: 0 };
  let publishedAt = 0;
  for (const f of all) {
    byStage[f.stage]++;
    if (f.at > publishedAt) publishedAt = f.at;
  }
  return {
    fires: all.filter((f) => isActiveStage(f.stage)),
    out: all.filter((f) => f.stage === 'OUT'),
    byStage,
    meta: { status: 'live', fromCache: false, publishedAt, fetchedAt: Date.now() },
  };
}

/** A fire's tracked HISTORY (size + stage over time) from the ingestion backend. The browser-only feed
 *  can't produce this — it only ever sees "now". A provincial fire (BC/AB/ON/… shown via the
 *  prefer-provincial path) carries its own `source` + provincial id and lives in provincial_fire_snapshots;
 *  a national CIFFC fire is keyed by fire_id in fire_snapshots — `source` picks the table. Returns NULL when
 *  the backend is unavailable (unconfigured / down) so the panel omits the block as before; an empty ARRAY
 *  means the backend answered but has no snapshot for this fire yet (a brand-new fire) — distinct states. */
export async function fetchFireHistory(fireId: string, source?: string): Promise<FireHistoryPoint[] | null> {
  if (!isLiveFireEnabled() || !supabaseConfigured() || !fireId) return null;
  const sel = 'select=stage,size_ha,reported_at,observed_at&order=observed_at.asc&limit=500';
  const url = source
    ? `${restBase()}/rest/v1/provincial_fire_snapshots?source=eq.${encodeURIComponent(source)}&source_fire_id=eq.${encodeURIComponent(fireId)}&${sel}`
    : `${restBase()}/rest/v1/fire_snapshots?fire_id=eq.${encodeURIComponent(fireId)}&${sel}`;
  const t = withTimeout(8000);
  try {
    const res = await fetch(url, { headers: restHeaders(), signal: t.signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as { stage: string; size_ha: number | null; reported_at: string | null; observed_at: string }[];
    if (!Array.isArray(rows)) return null;
    return rows.map((r) => ({
      stage: r.stage as FireStage,
      sizeHa: typeof r.size_ha === 'number' ? r.size_ha : -1,
      reportedAt: r.reported_at ? Date.parse(r.reported_at) || 0 : 0,
      observedAt: Date.parse(r.observed_at) || 0,
    }));
  } catch {
    return null;
  } finally {
    t.done();
  }
}

// The WHOLE-SEASON hotspot archive (`public:hotspots`, multi-year, 17M+ rows) — same GeoServer as the
// last-24h layer, keyless + CORS-`*`. Queried per-fire with a tight bbox; `propertyName=rep_date` slims
// each row to just the detection time (~130 B/row) and `sortBy=rep_date D` makes the row cap clip the
// OLDEST data first (so what survives is always the most recent activity). NOTE the bbox axis order:
// with the URN CRS form GeoServer wants lat,lon — a lon,lat box silently matches nothing.
const HOTSPOT_ARCHIVE_SOURCE =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=public:hotspots&outputFormat=application/json&srsName=EPSG:4326' +
  '&propertyName=rep_date&sortBy=rep_date+D';
const ACTIVITY_ROW_CAP = 3000; // ≈ 400 KB worst case; `clipped` keeps the UI honest when a mega-fire hits it
const ACTIVITY_BOX_KM = 10; // half-width of the search box around the reported location

/** A fire's satellite ACTIVITY this season — heat detections within ~10 km of the reported location,
 *  from the whole-season CWFIS archive (the agency feeds carry no discovery date and our snapshot
 *  backend only reaches back to when its ingest began — this is the only public per-fire record that
 *  predates both). Null = source unavailable or nothing detected in-season (the panel omits the block). */
export async function fetchFireActivity(lat: number, lon: number, now: number = Date.now()): Promise<FireActivity | null> {
  if (!isLiveFireEnabled() || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const dLat = ACTIVITY_BOX_KM / 111;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const bbox = `${(lat - dLat).toFixed(4)},${(lon - dLon).toFixed(4)},${(lat + dLat).toFixed(4)},${(lon + dLon).toFixed(4)},urn:ogc:def:crs:EPSG::4326`;
  const url = `${HOTSPOT_ARCHIVE_SOURCE}&count=${ACTIVITY_ROW_CAP}&bbox=${encodeURIComponent(bbox)}`;
  const t = withTimeout(12000);
  try {
    const res = await fetch(url, { signal: t.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return deriveFireActivity(await res.json(), Date.UTC(new Date(now).getUTCFullYear(), 0, 1), ACTIVITY_ROW_CAP);
  } catch {
    return null;
  } finally {
    t.done();
  }
}

/** Satellite-mapped burn perimeters (CWFIS M3) — the true footprint shapes + freshness meta. */
export async function fetchBurnPerimeters(opts: { force?: boolean } = {}): Promise<BurnFeed> {
  if (!isLiveFireEnabled()) return { polys: [], meta: DISABLED_META };
  const r = await loadCachedRaw(BURN_PERIM_SOURCE, PERIM_CACHE, TTL_MS, 15000, !!opts.force);
  if (r.json == null) return { polys: [], meta: offMeta('unavailable') };
  return normalizeBurn(r.json, { fetchedAt: r.fetchedAt, status: r.status, fromCache: r.fromCache });
}

// ── FWI raster issue date (no per-feature JSON — parse the dated WMS <Title>) ──────────────────────
interface FwiMetaCache {
  fetchedAt: number;
  publishedAt: number;
}
/** Freshness meta for the Fire-Weather-Index raster layer (for the source ledger). Caches just the parsed
 *  issue date (the GetCapabilities doc is ~295 KB — never cached), re-derived at most every 6h. */
export async function fetchFwiMeta(opts: { force?: boolean } = {}): Promise<FeedMeta> {
  if (!isLiveFireEnabled()) return DISABLED_META;
  let cached: FwiMetaCache | null = null;
  try {
    const raw = localStorage.getItem(FWI_META_CACHE);
    if (raw) {
      const e = JSON.parse(raw) as FwiMetaCache;
      if (typeof e?.fetchedAt === 'number' && typeof e?.publishedAt === 'number') cached = e;
    }
  } catch {
    /* ignore */
  }
  if (!opts.force && cached && Date.now() - cached.fetchedAt < FWI_TTL_MS) {
    return { status: 'live', fromCache: true, publishedAt: cached.publishedAt, fetchedAt: cached.fetchedAt };
  }
  const t = withTimeout(15000);
  try {
    const res = await fetch(FWI_CAPS_SOURCE, { signal: t.signal });
    if (!res.ok) throw new Error('caps');
    const xml = await res.text();
    const publishedAt = parseFwiIssueDate(xml);
    const fetchedAt = Date.now();
    try {
      localStorage.setItem(FWI_META_CACHE, JSON.stringify({ fetchedAt, publishedAt } satisfies FwiMetaCache));
    } catch {
      /* quota — fine */
    }
    return { status: 'live', fromCache: false, publishedAt, fetchedAt };
  } catch {
    return cached
      ? { status: 'live', fromCache: true, publishedAt: cached.publishedAt, fetchedAt: cached.fetchedAt }
      : offMeta('unavailable');
  } finally {
    t.done();
  }
}
