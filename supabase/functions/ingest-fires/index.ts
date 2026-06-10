// ingest-fires — the server-side ingestion engine for the live wildfire "honest window".
//
// pg_cron pings this every ~20 min (see the scheduling block at the bottom of supabase/schema.sql).
// It pulls the AUTHORITATIVE CIFFC reported-fire roll + national summary SERVER-SIDE (no CORS limit,
// one fetch for the whole audience instead of one per visitor) and writes with the service role:
//   • public.fires            — upsert current state, one row per fire (keyed on the CIFFC fire id)
//   • public.fire_snapshots   — APPEND a row only when a fire's stage or size MOVED (or it's new) →
//                               the per-fire history the browser-only MVP could never keep
//   • public.national_summary — APPEND a row when the CIFFC sitrep date advances (the season trend)
//
// Raw hotspots / FWI / smoke rasters are deliberately NOT ingested — they are "now"-only and the
// client keeps fetching them directly (history of a raw thermal pixel is meaningless).
//
// Auth: deployed with verify_jwt = FALSE (a pg_cron / browser ping can't carry a Supabase JWT), so a
// shared secret guards writes instead. FAIL CLOSED: callers MUST send INGEST_SECRET as `x-ingest-secret`,
// and if INGEST_SECRET is unset the function refuses every request — a misconfigured deploy can never run
// open to anonymous public POSTs. Set INGEST_SECRET in the function env before the first call.
//
// Deploy:  supabase functions deploy ingest-fires --no-verify-jwt --project-ref wnorrtfkfqrgipmggfwh

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INGEST_SECRET = Deno.env.get('INGEST_SECRET') ?? '';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Same CIFFC dashboard endpoints the client used (CORS-`*`, keyless). Fetched here once for everyone.
const REPORTED_FIRES_SOURCE = 'https://api.ciffc.net/v1/dashboard/fires';
const SUMMARY_SOURCE = 'https://api.ciffc.net/v1/dashboard/summary';
const FETCH_TIMEOUT_MS = 20000;

// ── Vendored parse helpers (mirror src/three/livefire/normalize.ts — kept tiny + pure) ────────────
const CA_AGENCIES = new Set(['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'PEI', 'NL', 'NF', 'YT', 'NT', 'NU', 'PC']);
type Stage = 'OC' | 'BH' | 'UC' | 'OUT' | 'UNK';

function countryOf(agency: string): string {
  const a = (agency || '').toUpperCase();
  if (CA_AGENCIES.has(a)) return 'CA';
  if (a === 'MX') return 'MX';
  if (a.length === 2) return 'US';
  return 'OT';
}
function stageOf(code: unknown): Stage {
  const s = String(code ?? '').trim().toUpperCase();
  return s === 'OC' || s === 'BH' || s === 'UC' || s === 'OUT' ? (s as Stage) : 'UNK';
}
function asNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
/** Date string → ISO (UTC) for a timestamptz column, or null. CIFFC sitrep dates are UTC but OMIT the
 *  zone; JS parses a zone-less datetime as the runtime's LOCAL time, so make UTC explicit rather than
 *  rely on the host TZ (Supabase Edge runs UTC today — a non-UTC host would skew every stamp). */
function toIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const s = v.trim();
  const zoneless = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const t = Date.parse(zoneless ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

interface ParsedFire {
  fire_id: string;
  lat: number;
  lon: number;
  agency: string;
  country: string;
  stage: Stage;
  size_ha: number | null;
  props: Record<string, unknown>;
  reported_at: string | null;
}

/** Parse the CIFFC ytd_fires GeoJSON. NOTE: its geometry duplicates latitude (corrupt) — read the
 *  field_latitude/field_longitude props, exactly like the client's parseReportedFires. Skips features
 *  with no usable coordinate OR no fire id (a fire needs identity to carry history). */
function parseReportedFires(geojson: unknown): ParsedFire[] {
  const fc = geojson as { features?: unknown };
  const feats = Array.isArray(fc?.features) ? fc.features : [];
  const out: ParsedFire[] = [];
  for (const f of feats) {
    const feat = f as { properties?: Record<string, unknown> };
    const p = feat?.properties ?? {};
    const lat = asNum(p.field_latitude);
    const lon = asNum(p.field_longitude);
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const fire_id =
      (typeof p.field_system_fire_id === 'string' && p.field_system_fire_id) ||
      (typeof p.field_agency_fire_id === 'string' && p.field_agency_fire_id) ||
      '';
    if (!fire_id) continue;
    const agency = typeof p.field_agency_code === 'string' ? p.field_agency_code : '';
    const size = asNum(p.field_fire_size);
    out.push({
      fire_id,
      lat,
      lon,
      agency,
      country: countryOf(agency),
      stage: stageOf(p.field_stage_of_control_status),
      size_ha: size != null && size >= 0 ? size : null,
      props: p,
      reported_at: toIso(p.field_situation_report_date),
    });
  }
  return out;
}

interface ParsedSummary {
  fires_today: number;
  active_fires: number;
  ytd_total: number;
  area_burned_ha: number;
  prep_level: number;
  published_at: string | null;
}
function parseSummary(json: unknown): ParsedSummary {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const sitrep = (j.sitrep && typeof j.sitrep === 'object' ? j.sitrep : {}) as Record<string, unknown>;
  return {
    fires_today: Math.max(0, asNum(j.fires_today) ?? 0),
    active_fires: Math.max(0, asNum(j.active_fires) ?? 0),
    ytd_total: Math.max(0, asNum(j.fire_count) ?? 0),
    area_burned_ha: Math.max(0, asNum(j.area_burned) ?? 0),
    prep_level: Math.max(0, asNum(j.preparedness_level) ?? asNum(sitrep.preparedness_level) ?? 0),
    published_at: toIso(sitrep.date),
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** True if a fire's tracked state moved enough to be worth a new history point. */
function changed(prev: { stage: string; size_ha: number | null } | undefined, next: ParsedFire): boolean {
  if (!prev) return true; // brand-new fire
  if (prev.stage !== next.stage) return true;
  const a = prev.size_ha, b = next.size_ha;
  if (a == null || b == null) return a !== b; // a size appearing/disappearing is a change
  return Math.abs(a - b) > 0.01; // ignore float noise
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  // Shared-secret gate — FAIL CLOSED: if INGEST_SECRET is unset the function refuses to run at all,
  // so a misconfigured deploy can never be driven open by anonymous public POSTs. Set INGEST_SECRET
  // in the function env BEFORE the first call (including a manual smoke test).
  if (!INGEST_SECRET || req.headers.get('x-ingest-secret') !== INGEST_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const report = { fires: 0, snapshots: 0, summary: false, errors: [] as string[] };

  // ── Reported fires → upsert state, append history on change ──
  try {
    const parsed = parseReportedFires(await fetchJson(REPORTED_FIRES_SOURCE));
    // Dedupe incoming by fire_id (keep the last occurrence).
    const byId = new Map<string, ParsedFire>();
    for (const f of parsed) byId.set(f.fire_id, f);
    const fires = [...byId.values()];

    if (fires.length) {
      // What do we already have? (only the fields we diff on, to keep the read tiny)
      const { data: existing, error: readErr } = await admin.from('fires').select('fire_id, stage, size_ha');
      if (readErr) throw readErr;
      const prevById = new Map((existing ?? []).map((r) => [r.fire_id as string, r as { stage: string; size_ha: number | null }]));

      const now = new Date().toISOString();
      const rows = fires.map((f) => ({
        fire_id: f.fire_id, lat: f.lat, lon: f.lon, agency: f.agency, country: f.country,
        stage: f.stage, size_ha: f.size_ha, props: f.props, reported_at: f.reported_at, last_updated: now,
      }));
      const { error: upErr } = await admin.from('fires').upsert(rows, { onConflict: 'fire_id' });
      if (upErr) throw upErr;
      report.fires = rows.length;

      const snaps = fires
        .filter((f) => changed(prevById.get(f.fire_id), f))
        .map((f) => ({ fire_id: f.fire_id, stage: f.stage, size_ha: f.size_ha, reported_at: f.reported_at }));
      if (snaps.length) {
        const { error: snapErr } = await admin.from('fire_snapshots').insert(snaps);
        if (snapErr) throw snapErr;
        report.snapshots = snaps.length;
      }
    }
  } catch (e) {
    report.errors.push(`fires: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── National summary → append only when the sitrep date advances ──
  try {
    const s = parseSummary(await fetchJson(SUMMARY_SOURCE));
    const { data: latest } = await admin
      .from('national_summary').select('published_at').order('observed_at', { ascending: false }).limit(1);
    const prevPub = latest?.[0]?.published_at ?? null;
    if (s.published_at !== prevPub) {
      const { error } = await admin.from('national_summary').insert({
        fires_today: s.fires_today, active_fires: s.active_fires, ytd_total: s.ytd_total,
        area_burned_ha: s.area_burned_ha, prep_level: s.prep_level, published_at: s.published_at,
      });
      if (error) throw error;
      report.summary = true;
    }
  } catch (e) {
    report.errors.push(`summary: ${e instanceof Error ? e.message : String(e)}`);
  }

  return new Response(JSON.stringify(report), {
    status: report.errors.length && !report.fires ? 502 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
