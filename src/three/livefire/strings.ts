/**
 * Live wildfire tracker — copy + small presentation helpers. Tight + declarative per the brand. Severity
 * + stage map onto EXISTING `.bmf-app` token classes (no new colours) for the detail panel's badge.
 */
import type { FireSeverity, FireStage, NationalSummary, FeedMeta, AlertLevel, BanType } from './types';

/** Whole-number with thousands separators ("148,939"). */
export function fmtInt(n: number): string {
  return Math.round(Number.isFinite(n) ? n : 0).toLocaleString();
}
/** Hectares, compacted past 10k into "Nk ha" so the stat strip never overflows on a phone. */
export function fmtHa(ha: number): string {
  const n = Number.isFinite(ha) ? Math.max(0, ha) : 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ha`;
  if (n >= 100_000) return `${Math.round(n / 1000)}k ha`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k ha`;
  return `${fmtInt(n)} ha`;
}

export const LIVEFIRE_COPY = {
  title: 'Live wildfires',
  // Home banner sub — authoritative CIFFC national numbers (active reported fires + season area burned).
  bannerSummary: (s: NationalSummary) =>
    `${fmtInt(s.activeFires)} active ${s.activeFires === 1 ? 'fire' : 'fires'} · ${fmtHa(s.areaBurnedHa)} burned this year`,
  // Fallback when the summary is unreachable but the satellite feed gave a clustered count.
  bannerSub: (n: number, label: string) => `${n.toLocaleString()} active ${n === 1 ? 'fire' : 'fires'} in ${label}`,
  bannerQuiet: (label: string) => `No active fires in ${label}`,
  bannerLoading: 'Loading the live fire map…',
  bannerOffline: 'Tap to open the fire map',
  // Map overlay
  overlayTitle: 'Live fire map',
  // Headline = authoritative reported active fires for the chosen country (the "real" fire count).
  head: (fires: number, label: string) => `${fires.toLocaleString()} active ${fires === 1 ? 'fire' : 'fires'} · ${label}`,
  subStats: (dets: number, freshness: string) => `${dets.toLocaleString()} satellite detections · ${freshness || 'last 24h'}`,
  // Layer toggle labels (the chips that show/hide each data layer).
  layers: {
    reported: 'Active fires',
    out: 'Out fires',
    hotspots: 'Hotspots',
    perimeters: 'Burn area',
    fwi: 'Fire weather',
    smoke: 'Smoke',
    alerts: 'Alerts',
    bans: 'Fire bans',
  },
  layerHint: {
    reported: 'Agency-reported fires, sized by area & coloured by stage of control',
    out: 'Fires reported out (extinguished) this year',
    hotspots: 'Raw satellite heat detections, last 24 hours',
    perimeters: 'Satellite-mapped burn footprints',
    fwi: 'Fire Weather Index — continuous national forecast (full coverage)',
    smoke: 'Surface-smoke forecast (ECCC FireWork) — drag the timeline to see it move',
    alerts: 'Active wildfire & evacuation alerts (SaskAlert) — tap for the official notice',
    bans: 'Provincial fire bans & open-fire restrictions (SK)',
  },
  // National summary stat-strip labels (the CIFFC "Current fires / Year-to-date" panel).
  stat: { today: 'Reported today', active: 'Active', out: 'Out', total: 'Total', area: 'Area burned', prep: 'Prep level' },
  prepLevel: (n: number) => (n > 0 ? `Level ${n}` : '—'),
  // Redesigned data strip: three HEADLINE numbers ("how bad, right now") + a demoted season subline.
  // The whole strip holds a STABLE height across states — US/MX and down become a same-height note, never
  // a silent collapse that jumps the header.
  strip: {
    active: 'Active fires',
    today: 'Reported today',
    area: 'Burned this year',
    // Demoted secondary tier — out / total / prep, plus the source "as of" stamp.
    season: (out: string, total: string, prep: string, asOf: string) =>
      `Out ${out} · Total ${total} · ${prep}${asOf ? ` · ${asOf}` : ''}`,
    caOnly: 'Season totals are Canada only',
    down: 'Live totals unavailable',
  },
  // Layer grouping (Watch-Duty-style tiers) + the summoned-sheet control labels.
  tiers: { fires: 'Fires', weather: 'Weather', local: 'Local' },
  tierScope: { fires: '', weather: 'Canada', local: 'Saskatchewan' } as Record<string, string>,
  // Why a tier is greyed out when the country filter leaves its coverage area.
  disabledReason: { weather: 'Canada only', local: 'Saskatchewan only' } as Record<string, string>,
  layersBtn: 'Layers',
  sourcesBtn: 'Sources',
  legendTitle: 'Legend',
  layersTitle: 'Map layers',
  layersSub: 'Choose what the map draws',
  // Plain-language gloss for the stage-of-control jargon (shown once in the legend).
  stageGloss: 'Being held = not expected to grow under current conditions',
  sub: 'Satellite-detected · last 24 hours',
  hint: 'Tap a fire for its full detail',
  emptyTitle: 'No active fires',
  emptyBody: 'Nothing detected on the last satellite pass.',
  offlineTitle: 'Live data unavailable',
  offlineBody: 'Couldn’t reach the fire service. Check your connection and tap Refresh.',
  refresh: 'Refresh',
  detail: 'Fire detail',
  fireSize: (ha: number) => (ha >= 0 ? fmtHa(ha) : 'Size unknown'),
  coords: (lat: number, lon: number) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`,
} as const;

// ── Stage of control — labels + an existing-badge mapping (danger→safe, no new colours) ──
const STAGE_LABEL: Record<FireStage, string> = {
  OC: 'Out of control',
  BH: 'Being held',
  UC: 'Under control',
  OUT: 'Out',
  UNK: 'Unknown',
};
export function stageLabel(s: unknown): string {
  const k = String(s ?? '').trim().toUpperCase() as FireStage;
  return STAGE_LABEL[k] ?? 'Unknown';
}
/** Short legend label. */
const STAGE_SHORT: Record<FireStage, string> = { OC: 'Out of control', BH: 'Being held', UC: 'Under control', OUT: 'Out', UNK: 'Unknown' };
export function stageShort(s: FireStage): string {
  return STAGE_SHORT[s] ?? 'Unknown';
}
/** Stage → a kit badge tone, matching the SAME warn/caution/ok ramp the map dots + legend use, so one
 *  fire reads one colour everywhere: OC danger-red, BH amber, UC cleared-green, OUT/UNK neutral. */
const STAGE_CLASS: Record<FireStage, string> = { OC: 'badge warn', BH: 'badge caution', UC: 'badge ok', OUT: 'badge neutral', UNK: 'badge neutral' };
export function stageClass(s: FireStage): string {
  return STAGE_CLASS[s] ?? 'badge';
}

/** Source attribution (re-exported from the client so the UI imports copy from one place). */
export { LIVEFIRE_CREDIT } from './client';

const SEV_LABEL: Record<FireSeverity, string> = { low: 'Low', moderate: 'Moderate', high: 'High', extreme: 'Extreme' };
export function severityLabel(s: FireSeverity): string {
  return SEV_LABEL[s];
}

/** Severity → an existing badge class (warm for the dangerous end). */
const SEV_CLASS: Record<FireSeverity, string> = { low: 'badge', moderate: 'badge', high: 'badge fire', extreme: 'badge fire' };
export function severityClass(s: FireSeverity): string {
  return SEV_CLASS[s];
}

/** "3m ago" / "2h ago" / "just now" from an epoch ms; empty for an unknown time. */
export function relTime(ms: number, now: number = Date.now()): string {
  if (!ms || ms <= 0) return '';
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Source honesty copy (the "honest window" — never confuse stale/down/off with "no fires") ──────────

/** A SOURCE publish time as user-facing freshness: "updated 2h ago" for recent data, "as of 8 Jun" for
 *  date-only/older data, and an explicit "publish time unknown" rather than a fabricated time. */
export function publishedWhen(ms: number, now: number = Date.now()): string {
  if (!ms || ms <= 0) return 'publish time unknown';
  if (now - ms < 36 * 60 * 60 * 1000) return `updated ${relTime(ms, now)}`;
  return `as of ${new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** One-line freshness for the source ledger: "Live · updated 2h ago" / "Cached · as of 8 Jun" /
 *  "Unavailable — couldn’t reach the source" / "Turned off". This is what makes the screen honest. */
export function freshnessLine(meta: FeedMeta): string {
  if (meta.status === 'disabled') return 'Turned off';
  if (meta.status === 'unavailable') return 'Unavailable — couldn’t reach the source';
  return `${meta.fromCache ? 'Cached' : 'Live'} · ${publishedWhen(meta.publishedAt)}`;
}

/** A short status word for a layer chip. */
export function statusWord(meta: FeedMeta): string {
  if (meta.status === 'disabled') return 'off';
  if (meta.status === 'unavailable') return 'unavailable';
  return meta.fromCache ? 'cached' : 'live';
}

/** The status-dot modifier class (maps to .sdot tones in styles.ts): live=ok, cached=caution, down/off=dim. */
export function statusDotClass(meta: FeedMeta): string {
  if (meta.status === 'disabled') return 'off';
  if (meta.status === 'unavailable') return 'down';
  return meta.fromCache ? 'cache' : 'live';
}

/** Static descriptors for each source the ledger lists (label + what-it-is + link to the authoritative
 *  origin). Combined with the live `FeedMeta` at render time. SK SPSA is a link-out only — its live feed
 *  is token-gated + CORS-blocked, so we point at the official viewer rather than fake a live layer. */
export interface SourceInfo {
  label: string;
  what: string;
  url: string;
}
export const LIVEFIRE_SOURCES: Record<'reported' | 'hotspots' | 'perimeters' | 'fwi' | 'smoke' | 'alerts' | 'bans' | 'summary', SourceInfo> = {
  reported: { label: 'Active fires', what: 'Agency-reported fires, stage of control + size — CIFFC', url: 'https://ciffc.net' },
  hotspots: { label: 'Satellite hotspots', what: 'Last-24h thermal detections — CWFIS (NRCan)', url: 'https://cwfis.cfs.nrcan.gc.ca' },
  perimeters: { label: 'Burn area', what: 'Satellite-mapped fire footprints — CWFIS M3', url: 'https://cwfis.cfs.nrcan.gc.ca' },
  fwi: { label: 'Fire weather', what: 'Fire Weather Index — continuous national FORECAST grid — CWFIS', url: 'https://cwfis.cfs.nrcan.gc.ca' },
  smoke: { label: 'Smoke forecast', what: 'Surface PM2.5 wildfire-smoke FORECAST — ECCC FireWork', url: 'https://eccc-msc.github.io/open-data/msc-data/nwp_raqdps-fw/readme_raqdps-fw_en/' },
  alerts: { label: 'Alerts', what: 'Wildfire & evacuation alerts — SaskAlert', url: 'https://emergencyalert.saskatchewan.ca' },
  bans: { label: 'Fire bans', what: 'Provincial fire bans & restrictions — SK SPSA', url: 'https://www.saskatchewan.ca/residents/environment-public-health-and-safety/wildfire-management' },
  summary: { label: 'National totals', what: 'Year-to-date national summary — CIFFC', url: 'https://ciffc.net' },
};

// ── Alert + fire-ban presentation (tones from the existing badge ramp; no new tokens) ────────────────

/** SaskAlert level → kit badge tone: critical = danger (warn), advisory = caution, info/unknown = neutral. */
export function alertLevelClass(l: AlertLevel): string {
  if (l === 'critical') return 'badge warn';
  if (l === 'advisory') return 'badge caution';
  return 'badge';
}
export function alertLevelLabel(l: AlertLevel): string {
  return l === 'unknown' ? 'Alert' : l.charAt(0).toUpperCase() + l.slice(1);
}
/** Title-case an issuer's event code for display ("evacuation order" → "Evacuation order"); shown verbatim otherwise. */
export function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
/** Fire-ban type → kit badge tone: Ban = danger, Restriction = caution, else neutral. */
export function banTypeClass(t: BanType): string {
  if (t === 'Ban') return 'badge warn';
  if (t === 'Restriction') return 'badge caution';
  return 'badge';
}

/** Ledger freshness for fire bans: 0 bans is the HONEST "no ban in effect" state, never a stale timestamp. */
export function banFreshness(meta: FeedMeta, count: number): string {
  if (meta.status !== 'live') return freshnessLine(meta);
  return count > 0 ? `${count} in effect · ${publishedWhen(meta.publishedAt)}` : 'No provincial ban in effect';
}
/** Ledger freshness for alerts: 0 is the honest "none active" state (the feed publish time still applies). */
export function alertFreshness(meta: FeedMeta, count: number): string {
  if (meta.status !== 'live') return freshnessLine(meta);
  return count > 0 ? `${count} active · ${publishedWhen(meta.publishedAt)}` : `No wildfire alerts · ${publishedWhen(meta.publishedAt)}`;
}

/** A smoke scrubber frame's valid time, in the viewer's local zone: "Mon 6 PM". */
export function frameTimeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' });
}

/** Ledger freshness for the smoke layer: it's a FORECAST (no fetched publish time), so name it a forecast
 *  and show the frame currently in view, e.g. "Forecast · Mon 6 PM" (never a fake "updated X ago"). */
export function smokeFreshness(currentFrameIso: string | null): string {
  return currentFrameIso ? `Forecast · ${frameTimeLabel(currentFrameIso)}` : 'Forecast';
}

/** Ledger freshness for the FWI raster: we draw the CONTINUOUS national-grid FORECAST (the observed
 *  station grid is patchy, full of gaps between weather stations), so name it a forecast + the day in
 *  view, e.g. "Forecast · Jun 10" — never a fake observed "updated X ago". */
export function fwiFreshness(meta: FeedMeta, dayLabel: string): string {
  if (meta.status !== 'live') return freshnessLine(meta);
  return dayLabel ? `Forecast · ${dayLabel}` : 'Forecast';
}

/** The standing honesty line — this is a window onto real data, NOT an emergency tool. */
export const NOT_FOR_EMERGENCY = 'A window onto real data — not an emergency tool. Always follow official sources and local authorities.';
/** Where to go for the authoritative Saskatchewan picture (SPSA's own live feed isn't browser-fetchable). */
export const SK_OFFICIAL = { label: 'Saskatchewan (SPSA) active fire map', url: 'https://gisappl.saskatchewan.ca/Html5Ext/?viewer=wfmpublic' };
