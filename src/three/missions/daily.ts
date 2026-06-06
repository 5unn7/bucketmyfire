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
 * Synthesize today's Daily Burn via the mission FACTORY (Slice 3). PINNED to the `extinguish` archetype:
 * the Daily Burn is the retention loop's score race, so it stays ALWAYS-WINNABLE (extinguishAll, no
 * hard-fail) and never idle-winnable (fires don't self-extinguish, so doing nothing never "wins"). The day
 * seed still varies the fire load / wind / sky for a fresh map each day on one shared board.
 *
 * Why pinned (not rotated): the factory's `hold-the-line`/`mop-up` archetypes are losable, and a lost daily
 * records no streak/board row — that breaks the "don't break the chain" loop on the most-played surface.
 * Those archetypes are built + oracle-verified and reserved for a separately-labelled challenge / co-op
 * mode once their difficulty floor + deterministic directional wind are tuned. To opt the daily into
 * rotation later, drop `archetypeId` here. Pure + deterministic (same date → same def); feature-relative
 * placements (no World build → cheap on a phone boot); home base La Ronge (central → fires land in-province).
 */
export function buildDailyMission(date: Date): MissionDef {
  const seed = dailySeed(date);
  const label = dailyDateLabel(date);
  const base = generateMission({ kind: 'daily', seed, archetypeId: 'extinguish' });
  return {
    ...base,
    id: dailyMissionId(date),
    name: `Daily Burn — ${label}`,
    tagline: `Daily Burn · ${label}`,
  };
}
