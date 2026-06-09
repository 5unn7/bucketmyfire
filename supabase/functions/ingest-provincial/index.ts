// ingest-provincial — per-province wildfire-agency ingestion (the richer layer on top of national CIFFC).
//
// CIFFC (ingest-fires) is the national baseline that already covers all 13 jurisdictions. Each PROVINCE
// also runs its own wildfire service with MORE detail (cause, response type, geographic description, and
// sometimes a per-fire official URL). This function holds an ADAPTER per source: fetch the province's
// KEYLESS feed, normalize the shared SPINE (id, name, lat/lon, size, status→stage, dates), and keep EVERY
// source field verbatim in `props`. All adapters write into public.provincial_fires keyed by
// (source, source_fire_id). Each adapter is independently try/caught — one failing never blocks the rest.
//
// COVERAGE (verified keyless endpoints, 2026-06): BC, AB, ON, QC, NB, NS, NL, YT, NT.
// NO public provincial point feed (covered by CIFFC only): SK, MB, PE, NU.
// Provincial OWN servers are often token-gated (e.g. Alberta's titan) — every endpoint here was verified
// keyless against a live curl. ArcGIS Online "PublicView"/hosted services + a couple of self-hosted
// ArcGIS Servers + one plain-JSON file (NWT).
//
// Auth: verify_jwt = FALSE; if INGEST_SECRET is set, callers must send it as x-ingest-secret.
// Deploy:  supabase functions deploy ingest-provincial --no-verify-jwt --project-ref wnorrtfkfqrgipmggfwh

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INGEST_SECRET = Deno.env.get('INGEST_SECRET') ?? '';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FETCH_TIMEOUT_MS = 25000;

function asNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
/** Epoch-ms number OR date string → ISO (UTC), or null. ArcGIS dates are epoch ms (unambiguous); a
 *  zone-less datetime string is read as UTC (not the host's local TZ) so the stamp doesn't depend on
 *  where this runs — see the same guard in ingest-fires. */
function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === 'string' && v) {
    const s = v.trim();
    const zoneless = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
    const t = Date.parse(zoneless ? `${s.replace(' ', 'T')}Z` : s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}
/** First field whose value is present + non-blank, as a trimmed string. */
function firstStr(p: Record<string, unknown>, fields: string[]): string {
  for (const f of fields) {
    const v = p[f];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url.slice(0, 80)}… → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

type Stage = 'OC' | 'BH' | 'UC' | 'OUT' | 'UNK';

/** Generic status → CIFFC stage. Handles English phrases, CIFFC letter codes, ON/enum codes, French
 *  (SOPFEU), and YT "CODE - Label" strings. Order matters: "not under control"/"out of control" before
 *  the bare "under control"/"control" checks (substring traps). Unknown/monitored → UNK. */
function stageFromText(v: unknown): Stage {
  const s = String(v ?? '').trim().toLowerCase().replace(/_/g, ' ');
  if (!s) return 'UNK';
  if (s.includes('out of control') || s.includes('not under control') || s === 'oc' || s === 'nuc' || s.includes('hors contrôle') || s.includes('hors controle') || s.includes('en activité') || s.includes('en activite')) return 'OC';
  if (s.includes('being held') || s.includes('contained') || s === 'bh' || s === 'bhe' || s.includes('contenu')) return 'BH';
  if (s.includes('under control') || s === 'uc' || s === 'uco' || s.includes('maîtrisé') || s.includes('maitrise')) return 'UC';
  if (s.includes('declared out') || s.includes('extinguish') || s.includes('- out') || s === 'out' || s === 'ex' || s === 'éteint' || s === 'eteint') return 'OUT';
  return 'UNK'; // "being observed" / "being actioned" / "new" / unmapped
}

/** Newfoundland uses overloaded single-letter STATUS codes (legend unconfirmed): best-effort, not authoritative. */
function nlStage(v: unknown): Stage {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'O') return 'OC'; // active-fire layer ⇒ treat 'O' as out-of-control (ambiguous w/ "Out")
  if (s === 'C') return 'BH'; // Contained
  if (s === 'U') return 'UC'; // Under control
  if (s === 'X' || s === 'E') return 'OUT';
  return stageFromText(v);
}

// ── The normalized spine every adapter emits. `props` keeps the source record whole. ─────────────────
interface ProvRow {
  source: string;
  source_fire_id: string;
  agency: string;
  name: string | null;
  lat: number;
  lon: number;
  size_ha: number | null;
  status: string | null;
  stage: string | null;
  discovered_at: string | null;
  updated_at_src: string | null;
  props: Record<string, unknown>;
}
interface Adapter {
  source: string;
  fetchRows: () => Promise<ProvRow[]>;
}

// ── Paginated ArcGIS FeatureServer/MapServer GeoJSON fetch (handles exceededTransferLimit) ───────────
async function fetchArcgisGeojson(queryUrlBase: string, pageSize = 1000, cap = 20000): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < cap; offset += pageSize) {
    const url = `${queryUrlBase}&resultRecordCount=${pageSize}&resultOffset=${offset}`;
    const json = (await fetchJson(url)) as { features?: unknown };
    const feats = Array.isArray(json?.features) ? (json.features as Record<string, unknown>[]) : [];
    if (!feats.length) break;
    out.push(...feats);
    if (feats.length < pageSize) break;
  }
  return out;
}

// ── Config-driven ArcGIS adapter (most provinces are the same keyless f=geojson shape) ───────────────
interface ArcgisCfg {
  source: string;
  agency: string;
  url: string; // full /query URL WITHOUT the paging params (where/outFields/f/outSR included)
  idFields: string[];
  nameFields: string[];
  sizeField: string;
  statusField: string;
  latField?: string; // fallback when geometry is absent
  lonField?: string;
  discoveredField?: string;
  updatedField?: string;
  stageFn?: (v: unknown) => Stage;
}

function arcgisAdapter(cfg: ArcgisCfg): Adapter {
  const stageFn = cfg.stageFn ?? stageFromText;
  return {
    source: cfg.source,
    async fetchRows() {
      const feats = await fetchArcgisGeojson(cfg.url);
      const rows: ProvRow[] = [];
      for (const ft of feats) {
        const p = (ft.properties ?? {}) as Record<string, unknown>;
        const geom = ft.geometry as { coordinates?: unknown } | undefined;
        const coords = Array.isArray(geom?.coordinates) ? (geom!.coordinates as unknown[]) : null;
        let lon = asNum(coords?.[0]);
        let lat = asNum(coords?.[1]);
        if ((lat == null || lon == null) && cfg.latField) {
          lat = asNum(p[cfg.latField]);
          lon = cfg.lonField ? asNum(p[cfg.lonField]) : null;
        }
        if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
        const id = firstStr(p, cfg.idFields);
        if (!id) continue;
        const size = asNum(p[cfg.sizeField]);
        const statusRaw = p[cfg.statusField];
        rows.push({
          source: cfg.source,
          source_fire_id: id,
          agency: cfg.agency,
          name: firstStr(p, cfg.nameFields) || null,
          lat,
          lon,
          size_ha: size != null && size >= 0 ? size : null,
          status: statusRaw != null && String(statusRaw).trim() !== '' ? String(statusRaw) : null,
          stage: stageFn(statusRaw),
          discovered_at: cfg.discoveredField ? toIso(p[cfg.discoveredField]) : null,
          updated_at_src: cfg.updatedField ? toIso(p[cfg.updatedField]) : null,
          props: p,
        });
      }
      return rows;
    },
  };
}

const Q = '?where=1%3D1&outFields=*&f=geojson&outSR=4326';

const ARCGIS_CFGS: ArcgisCfg[] = [
  {
    source: 'bc-wildfire', agency: 'BC',
    url: `https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_ActiveFires_PublicView/FeatureServer/0/query${Q}`,
    idFields: ['FIRE_NUMBER', 'INCIDENT_NAME'], nameFields: ['GEOGRAPHIC_DESCRIPTION', 'INCIDENT_NAME'],
    sizeField: 'CURRENT_SIZE', statusField: 'FIRE_STATUS', latField: 'LATITUDE', lonField: 'LONGITUDE',
    discoveredField: 'IGNITION_DATE', updatedField: 'FIRE_OUT_DATE',
  },
  {
    source: 'ab-wildfire', agency: 'AB',
    url: `https://services.arcgis.com/Eb8P5h4CJk8utIBz/arcgis/rest/services/wildfire_location_active/FeatureServer/0/query${Q}`,
    idFields: ['FIRE_NUMBER', 'ID', 'OBJECTID'], nameFields: ['LABEL'],
    sizeField: 'AREA_ESTIMATE', statusField: 'FIRE_STATUS', latField: 'LATITUDE', lonField: 'LONGITUDE',
    discoveredField: 'FIRE_STATUS_DATE',
  },
  {
    source: 'on-mnrf', agency: 'ON',
    url: `https://ws.lioservices.lrc.gov.on.ca/arcgis1061a/rest/services/MNRF/Ontario_Fires_Map/MapServer/32/query${Q}`,
    idFields: ['FIRE_NUMBER', 'FIREID'], nameFields: ['FIRE_NAME'],
    sizeField: 'CURRENT_SIZE', statusField: 'CONDITION_DESCRIPTION', discoveredField: 'CONFIRMED_DATE',
  },
  {
    source: 'qc-sopfeu', agency: 'QC',
    url: `https://services9.arcgis.com/imvTcGaHLMSgKhXe/arcgis/rest/services/Localisation_des_feux_au_Qu%C3%A9bec/FeatureServer/0/query${Q}`,
    idFields: ['numero'], nameFields: ['mun_nom', 'nommrc'],
    sizeField: 'sup_ha', statusField: 'etat', discoveredField: 'd_debut', updatedField: 'date_update',
  },
  {
    source: 'nb-dnr', agency: 'NB',
    url: `https://gis-erd-der.gnb.ca/gisserver/rest/services/New_Brunswick_Fires/New_Brunswick_Fire_Locations/FeatureServer/0/query${Q}`,
    idFields: ['FIELD_AGENCY_FIRE_ID', 'FIELD_FIRE_NUMBER'], nameFields: ['FIELD_FIRE_NAME'],
    sizeField: 'FIELD_FIRE_SIZE', statusField: 'FIELD_STAGE_OF_CONTROL', latField: 'FIELD_LAT', lonField: 'FIELD_LONG',
  },
  {
    source: 'ns-dnrr', agency: 'NS',
    url: `https://services7.arcgis.com/guiEgv5T1fmjU8SW/arcgis/rest/services/FOR_Fire_Locations_UT83_Prod/FeatureServer/0/query${Q}`,
    idFields: ['FireNumber'], nameFields: ['County'],
    sizeField: 'Area', statusField: 'StageOfControl', latField: 'Latitude', lonField: 'Longitude',
  },
  {
    source: 'nl-ffa', agency: 'NL',
    url: `https://services8.arcgis.com/aCyQID5qQcyrJMm2/arcgis/rest/services/FFA_Wildfire/FeatureServer/1/query${Q}`,
    idFields: ['PROVFIRENUM', 'FIREID'], nameFields: ['NAME'],
    sizeField: 'AREAEST', statusField: 'STATUS', latField: 'LATITUDE', lonField: 'LONGITUDE', stageFn: nlStage,
  },
  {
    source: 'yt-wildfire', agency: 'YT',
    url: `https://services.arcgis.com/bwohQix8s7zRvYC9/arcgis/rest/services/WildfireStatus_view/FeatureServer/0/query${Q}`,
    idFields: ['FIRE_ID'], nameFields: ['FIRE_NAME'], sizeField: 'FIRE_SIZE', statusField: 'FIRE_STATUS',
  },
];

// ── NWT — a static plain-JSON file (NOT ArcGIS): fetch whole, no /query. ─────────────────────────────
const NT_URL = 'https://www.gov.nt.ca/ecc/services/wildfire-update/sites/default/files/firedata/fires.json';
const ntAdapter: Adapter = {
  source: 'nt-ecc',
  async fetchRows() {
    const json = await fetchJson(NT_URL);
    const arr = Array.isArray(json)
      ? json
      : Array.isArray((json as { features?: unknown })?.features)
        ? ((json as { features: unknown[] }).features)
        : [];
    const rows: ProvRow[] = [];
    for (const it of arr as Record<string, unknown>[]) {
      const o = (it.properties ?? it) as Record<string, unknown>;
      const lat = asNum(o.latitude);
      const lon = asNum(o.longitude);
      if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      const id = firstStr(o, ['title', 'fireid', 'id']);
      if (!id) continue;
      const size = asNum(o.currentsize);
      rows.push({
        source: 'nt-ecc', source_fire_id: id, agency: 'NT',
        name: firstStr(o, ['title']) || null, lat, lon,
        size_ha: size != null && size >= 0 ? size : null,
        status: o.status != null ? String(o.status) : null,
        stage: stageFromText(o.status), discovered_at: toIso(o.startdate ?? o.discoverydate),
        updated_at_src: toIso(o.lastupdated ?? o.statusdate), props: o,
      });
    }
    return rows;
  },
};

const ADAPTERS: Adapter[] = [...ARCGIS_CFGS.map(arcgisAdapter), ntAdapter];

async function upsertChunked(rows: ProvRow[]): Promise<void> {
  const now = new Date().toISOString();
  // Dedupe within the batch: a source can repeat a fire id across features, and a Postgres upsert rejects
  // the same ON CONFLICT target appearing twice in one statement. Keep the last occurrence per id.
  const byId = new Map<string, ProvRow>();
  for (const r of rows) byId.set(r.source_fire_id, r);
  const deduped = [...byId.values()];
  for (let i = 0; i < deduped.length; i += 500) {
    const chunk = deduped.slice(i, i + 500).map((r) => ({ ...r, last_updated: now }));
    const { error } = await admin.from('provincial_fires').upsert(chunk, { onConflict: 'source,source_fire_id' });
    if (error) throw new Error(error.message || JSON.stringify(error)); // surface PostgrestError text, not [object Object]
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  if (INGEST_SECRET && req.headers.get('x-ingest-secret') !== INGEST_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Run adapters concurrently; one failing only nulls its own entry.
  const results = await Promise.all(
    ADAPTERS.map(async (adapter) => {
      try {
        const rows = await adapter.fetchRows();
        if (rows.length) await upsertChunked(rows);
        return { source: adapter.source, count: rows.length, error: null as string | null };
      } catch (e) {
        return { source: adapter.source, count: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const perSource: Record<string, number> = {};
  const errors: string[] = [];
  for (const r of results) {
    perSource[r.source] = r.count;
    if (r.error) errors.push(`${r.source}: ${r.error}`);
  }
  const any = Object.values(perSource).some((n) => n > 0);
  return new Response(JSON.stringify({ perSource, errors }), {
    status: errors.length && !any ? 502 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
