/**
 * Live wildfire tracker — copy + small presentation helpers. Copy is tight + declarative per the
 * brand (the fight is real). Severity maps onto EXISTING `.bmf-app` token classes (no new colours) so
 * the tracker reads in the warm "fight" register without hard-coding any value.
 */
import type { FireSeverity } from './types';

export const LIVEFIRE_COPY = {
  title: 'Live wildfires',
  // Banner sub on the home screen (n = active fires). Honest qualifier: these are last-24h detections.
  bannerSub: (n: number) => (n === 1 ? '1 burning in Saskatchewan now' : `${n} burning in Saskatchewan now`),
  bannerQuiet: 'No active fires right now',
  bannerLoading: 'Checking the latest satellite pass…',
  bannerOffline: 'Tap to view the fire map',
  // Overlay
  overlayTitle: 'Wildfires',
  head: (n: number) => `${n} active ${n === 1 ? 'fire' : 'fires'} · Saskatchewan`,
  sub: 'Satellite-detected · last 24 hours',
  emptyTitle: 'No active wildfires',
  emptyBody: 'Nothing burning in Saskatchewan on the last satellite pass. All clear.',
  offlineTitle: 'Live data unavailable',
  offlineBody: 'Couldn’t reach the fire service. Check your connection and try again.',
  refresh: 'Refresh',
  near: (place: string) => `near ${place}`,
} as const;

/** Source attribution (re-exported from the client so the UI imports copy from one place). */
export { LIVEFIRE_CREDIT } from './client';

const SEV_LABEL: Record<FireSeverity, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extreme: 'Extreme',
};
export function severityLabel(s: FireSeverity): string {
  return SEV_LABEL[s];
}

/** Severity → an existing badge/chip class (warm for the dangerous end, ghost for low). */
const SEV_CLASS: Record<FireSeverity, string> = {
  low: 'badge',
  moderate: 'badge',
  high: 'badge fire',
  extreme: 'badge fire',
};
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
