/**
 * Daily Burn — the retention keystone (audit FIX #1/#8). A single, world-wide-shared "clear every
 * fire" sortie whose world + difficulty are derived deterministically from TODAY'S DATE, so everyone
 * plays the same fresh map each day and races one daily leaderboard. It reuses 100% of the mission
 * framework (seeded World gen, FireSystem, the pure scorer, MissionRuntime, the HUD) — a Daily Burn is
 * just a `MissionDef` built at runtime instead of authored in `catalog.ts`.
 *
 * Two deliberate design choices make it safe to bolt onto the existing systems with almost no wiring:
 *   1. The mission id is date-stamped (`daily-YYYYMMDD`). The leaderboard is already keyed per mission
 *      id, so each day automatically gets its OWN board — no Supabase schema change.
 *   2. `isDailyId()` lets the campaign progress layer IGNORE daily wins, so topping the daily board
 *      never inflates the linear-unlock count that gates helicopters (see progress.recordWin).
 *
 * Engine-agnostic and pure (no Three.js / DOM) — same date in → same MissionDef out.
 */
import type { MissionDef } from './types';
import { generateMission } from './factory';

/** Days since the Unix epoch in UTC — the canonical "which day is it" key, shared world-wide so the
 *  Daily Burn rolls over at the same instant for everyone regardless of timezone. */
export function dayNumberUTC(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

function ymdUTC(date: Date): { y: number; m: number; d: number } {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** Stable per-day world seed from the UTC day number (integer-hash mixed for good spread). */
export function dailySeed(date: Date): number {
  let a = (dayNumberUTC(date) ^ 0x9e3779b9) >>> 0;
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b) >>> 0;
  return (a ^ (a >>> 16)) >>> 0;
}

/** The per-day mission id, e.g. "daily-20260604". Doubles as the leaderboard key (each day = its own
 *  board) AND the marker that keeps daily wins out of campaign progression (see `isDailyId`). */
export function dailyMissionId(date: Date): string {
  const { y, m, d } = ymdUTC(date);
  return `daily-${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

/** True for any Daily-Burn mission id — used to KEEP daily wins out of campaign progress/unlocks. */
export function isDailyId(id: string): boolean {
  return id.startsWith('daily-');
}

/** Human-facing date for the briefing/board title, e.g. "Jun 4, 2026". */
export function dailyDateLabel(date: Date): string {
  const { y, m, d } = ymdUTC(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/**
 * Synthesize today's Daily Burn via the mission FACTORY (Slice 3). The day seed picks + dials ONE
 * archetype (extinguish / mop-up / hold-the-line), so each day is a fresh FLAVOR — not always the same
 * clear-the-bush — on a fresh map, racing one shared board. Pure + deterministic (same date → same def),
 * feature-relative placements (no World build → cheap on a phone boot), home base La Ronge (central, so
 * every archetype's fires land in-province on the true-shape map). The factory wraps everything; here we
 * only stamp the date-keyed id / branding.
 *
 * NOTE (product): rotating archetypes means a hold-the-line / mop-up daily CAN be lost, unlike the old
 * always-winnable score-chase. To pin the daily back to the pure score race, force the archetype:
 * `generateMission({ kind: 'daily', seed, archetypeId: 'extinguish' })`. Every generated daily is proven
 * COMPLETABLE by the oracle sweep in verify-campaign.
 */
export function buildDailyMission(date: Date): MissionDef {
  const seed = dailySeed(date);
  const label = dailyDateLabel(date);
  const base = generateMission({ kind: 'daily', seed });
  return {
    ...base,
    id: dailyMissionId(date),
    name: `Daily Burn — ${label}`,
    tagline: `Daily Burn · ${label}`,
  };
}
