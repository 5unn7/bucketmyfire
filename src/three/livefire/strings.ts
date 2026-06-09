/**
 * Live wildfire tracker — copy + small presentation helpers. Tight + declarative per the brand. Severity
 * + stage map onto EXISTING `.bmf-app` token classes (no new colours) for the detail panel's badge.
 */
import type { FireSeverity, FireStage, NationalSummary } from './types';

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
  subStats: (dets: number, rel: string) => `${dets.toLocaleString()} satellite detections · ${rel ? `updated ${rel}` : 'last 24h'}`,
  // Layer toggle labels (the chips that show/hide each data layer).
  layers: {
    reported: 'Active fires',
    hotspots: 'Hotspots',
    perimeters: 'Burn area',
    fwi: 'Fire weather',
  },
  layerHint: {
    reported: 'Agency-reported fires, sized by area & coloured by stage of control',
    hotspots: 'Raw satellite heat detections, last 24 hours',
    perimeters: 'Satellite-mapped burn footprints',
    fwi: 'Fire Weather Index: the fire-danger field',
  },
  // National summary stat-strip labels (the CIFFC "Current fires / Year-to-date" panel).
  stat: { today: 'Reported today', active: 'Active', out: 'Out', total: 'Total', area: 'Area burned', prep: 'Prep level' },
  prepLevel: (n: number) => (n > 0 ? `Level ${n}` : '—'),
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
  return `${hrs}h ago`;
}
