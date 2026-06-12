// fwi-frame — a read-only, PUBLIC caching proxy for the Fire-Weather-Index forecast frames.
//
// The flat-map FWI day-scrubber morphs by stepping ONE GetMap PNG per day per source (Canada CWFIS +
// global GWIS — see src/three/livefire/FireMap.ts FwiForecastLayer + client.ts fwiFrameUrl). This function
// fetches that day's PNG SERVER-SIDE and returns it with long cache headers, so:
//   • one fetch warms the CDN/browser cache for the whole audience (not one upstream hit per visitor),
//   • the bytes are served same-origin-ish + reliably (no dependence on the upstream's CORS/uptime per call).
//
// It writes NOTHING — no table, no Storage, no cron, no secret. It only proxies PUBLIC government imagery.
// The client (client.ts `fwiFrameUrl`) routes here only when `FWI_PROXY_DEPLOYED` is flipped true AFTER this
// is deployed; until then it hits CWFIS/GWIS directly, so the map works with or without this function.
//
// Auth: PUBLIC (no JWT) — it returns only public imagery and mutates nothing.
// Deploy:  supabase functions deploy fwi-frame --no-verify-jwt --project-ref wnorrtfkfqrgipmggfwh

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const FETCH_TIMEOUT_MS = 15000;

// ── Vendored upstream constants (mirror src/three/livefire/client.ts — keep in lockstep) ──────────
const FWI_WMS_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms';
const FWI_WMS_LAYER = 'public:fwi';
const GWIS_FWI_WMS_URL = 'https://ies-ows.jrc.ec.europa.eu/gwis';
const GWIS_FWI_LAYER = 'ecmwf.fwi';
// The brand FWI danger ramp (continuous → 256-colour, per-stop alpha, no dither), rendered server-side via
// SLD_BODY. Identical to client.ts FWI_WMS_SLD.
const FWI_WMS_SLD =
  '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld">' +
  '<NamedLayer><Name>public:fwi</Name><UserStyle><FeatureTypeStyle><Rule>' +
  '<RasterSymbolizer><Opacity>1</Opacity><ColorMap type="ramp">' +
  '<ColorMapEntry color="#63d68a" quantity="0" opacity="0"/>' +
  '<ColorMapEntry color="#7fcf86" quantity="2" opacity="0.16"/>' +
  '<ColorMapEntry color="#ffc861" quantity="9" opacity="0.34"/>' +
  '<ColorMapEntry color="#ff7a45" quantity="18" opacity="0.52"/>' +
  '<ColorMapEntry color="#ff5d4d" quantity="30" opacity="0.68"/>' +
  '<ColorMapEntry color="#e23a2a" quantity="45" opacity="0.84"/>' +
  '</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>';
const GWIS_FWI_SLD = FWI_WMS_SLD.replace('public:fwi', GWIS_FWI_LAYER);

type Box = { lonMin: number; latMin: number; lonMax: number; latMax: number };
const FWI_BOX: Box = { lonMin: -141, latMin: 40, lonMax: -50, latMax: 84 };
const FWI_GLOBE_BOX: Box = { lonMin: -180, latMin: -90, lonMax: 180, latMax: 90 };

/** Single-image WMS GetMap URL (v1.1.1 → bbox lon-first), height following the bbox aspect. */
function wmsUrl(base: string, layer: string, sld: string, box: Box, day: string, width: number): string {
  const lonSpan = box.lonMax - box.lonMin;
  const latSpan = box.latMax - box.latMin;
  const height = Math.round((width * latSpan) / lonSpan);
  const p = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', layers: layer, styles: '',
    format: 'image/png', transparent: 'true', srs: 'EPSG:4326',
    bbox: `${box.lonMin},${box.latMin},${box.lonMax},${box.latMax}`,
    width: String(width), height: String(height), time: day, sld_body: sld,
  });
  return `${base}?${p.toString()}`;
}

// In-isolate LRU so a WARM isolate skips the upstream refetch for a hot (src, day, width). A forecast PNG is
// tens-to-hundreds of KB; ~24 entries is a few MB, fine for an edge isolate (and dropped on cold start). The
// CDN s-maxage does the real cross-visitor caching; this just smooths bursts within one isolate.
const CACHE = new Map<string, Uint8Array>();
const CACHE_MAX = 24;
function cacheGet(key: string): Uint8Array | undefined {
  const v = CACHE.get(key);
  if (v) { CACHE.delete(key); CACHE.set(key, v); } // LRU touch
  return v;
}
function cacheSet(key: string, val: Uint8Array): void {
  CACHE.set(key, val);
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}

/** Accept only a real yyyy-mm-dd within ±31 days of today (UTC) — the 7-day forecast + slack, never arbitrary. */
function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const DAY = 86_400_000;
  const now = Date.now();
  return t > now - 31 * DAY && t < now + 31 * DAY;
}

function bad(msg: string): Response {
  return new Response(msg, { status: 400, headers: CORS });
}
function pngResponse(buf: Uint8Array): Response {
  return new Response(buf, {
    headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=21600, s-maxage=86400' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405, headers: CORS });

  const url = new URL(req.url);
  const src = url.searchParams.get('src') ?? '';
  const day = url.searchParams.get('day') ?? '';
  const width = Math.min(4096, Math.max(256, parseInt(url.searchParams.get('w') ?? '2048', 10) || 2048));

  if (src !== 'cwfis' && src !== 'gwis') return bad('src must be "cwfis" or "gwis"');
  if (!validDay(day)) return bad('day must be yyyy-mm-dd within ±31 days');

  const key = `${src}:${day}:${width}`;
  const hit = cacheGet(key);
  if (hit) return pngResponse(hit);

  const upstream = src === 'cwfis'
    ? wmsUrl(FWI_WMS_URL, FWI_WMS_LAYER, FWI_WMS_SLD, FWI_BOX, day, width)
    : wmsUrl(GWIS_FWI_WMS_URL, GWIS_FWI_LAYER, GWIS_FWI_SLD, FWI_GLOBE_BOX, day, width);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(upstream, { signal: ctl.signal });
    if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502, headers: CORS });
    const ct = res.headers.get('content-type') ?? '';
    const buf = new Uint8Array(await res.arrayBuffer());
    // Some WMS servers answer an error as a 200 text/XML ServiceException — don't cache/serve that as a PNG.
    if (!ct.includes('image')) return new Response('upstream did not return an image', { status: 502, headers: CORS });
    cacheSet(key, buf);
    return pngResponse(buf);
  } catch (_e) {
    return new Response('upstream unreachable or timed out', { status: 502, headers: CORS });
  } finally {
    clearTimeout(timer);
  }
});
