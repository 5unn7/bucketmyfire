/**
 * Pilot RANK — a 5-tier ladder earned by CAREER POINTS (the sum of your best score on each
 * mission). The tier colour is a "heat ramp": ash → ember → flame → gold → white-hot, i.e. the
 * badge shows how hot you burn. Pure data + math (no DOM, no Three), keyed off `progress`.
 *
 * Career points = Σ best-per-mission (the same aggregation `menuShared.pilotRecord` uses). Tier
 * thresholds are deliberately round and easy to retune. Colours live here (data, like HELIS' accent
 * hexes in profile.ts) rather than theme.ts — they are a per-tier rank palette, not UI chrome.
 */
import { getProgress } from './progress';

export interface RankTier {
  key: string;
  name: string;
  color: string;
  min: number; // career points required to reach this tier
}

export const RANK_TIERS: RankTier[] = [
  { key: 'recruit', name: 'Recruit', color: '#9aa7b0', min: 0 },
  { key: 'hotshot', name: 'Hotshot', color: '#ff7a45', min: 12000 },
  { key: 'veteran', name: 'Veteran', color: '#ffa033', min: 30000 },
  { key: 'captain', name: 'Captain', color: '#ffc24a', min: 60000 },
  { key: 'chief', name: 'Chief', color: '#fff0c0', min: 100000 },
];

/** Σ of best-per-mission score across the campaign (the player's career points). */
export function careerScore(): number {
  return Object.values(getProgress().best).reduce((a, b) => a + b, 0);
}

/** The highest tier whose threshold the points have reached. */
export function rankFor(points: number): RankTier {
  let tier = RANK_TIERS[0];
  for (const r of RANK_TIERS) if (points >= r.min) tier = r;
  return tier;
}

/** Progress toward the next tier: the next tier (or null at Chief), the 0..1 bar fraction, and the
 *  points still owed. */
export function nextRankProgress(points: number): { next: RankTier | null; frac: number; remaining: number } {
  const cur = rankFor(points);
  const next = RANK_TIERS[RANK_TIERS.indexOf(cur) + 1] ?? null;
  if (!next) return { next: null, frac: 1, remaining: 0 };
  const span = next.min - cur.min;
  const into = points - cur.min;
  return { next, frac: Math.max(0, Math.min(1, span > 0 ? into / span : 1)), remaining: Math.max(0, next.min - points) };
}
