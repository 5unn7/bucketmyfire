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
import type { MissionDef, TimeOfDay } from './types';

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

/** A tiny mulberry32 PRNG so the daily PARAMETERS (fire load, wind, sky) vary deterministically per
 *  day, independent of the WORLD seed the def hands to World. Same date → same numbers. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMES: readonly TimeOfDay[] = ['dawn', 'day', 'noon', 'overcast', 'golden', 'dusk'];

/**
 * Synthesize today's Daily Burn. A pure score chase: `extinguishAll` with NO hard-fail (so every
 * seed is winnable), the fire load / wind / sky varied by the day's seed for a fresh challenge. Fires
 * are lake-anchored clusters (a scoop source always on hand) plus a scatter of spots; both placement
 * specs snap to dry fuel and are seed-robust, so the day always catches and is always clearable.
 */
export function buildDailyMission(date: Date): MissionDef {
  const seed = dailySeed(date);
  const r = rng(seed ^ 0xa5a5a5a5);
  const tier = r(); // 0..1 overall intensity for the day
  const clusters = 2 + Math.floor(r() * 2); // 2..3 lake-anchored complexes
  const spots = 2 + Math.floor(r() * 4); // 2..5 scattered spot fires
  const spreadScale = 0.55 + tier * 0.6; // 0.55..1.15 — calm day to a real runner
  const windScale = 0.4 + r() * 0.9; // 0.4..1.3
  const windAngle = r() * Math.PI * 2;
  const timeOfDay = TIMES[Math.floor(r() * TIMES.length)];
  const size: 'small' | 'medium' = tier > 0.66 ? 'medium' : 'small';
  const label = dailyDateLabel(date);

  return {
    id: dailyMissionId(date),
    index: 0,
    name: `Daily Burn — ${label}`,
    brief:
      "Today's burn: clear every fire across the bush. Fast, clean drops score highest — a fresh map every day, one shared board.",
    tagline: `Daily Burn · ${label}`,
    difficulty: (1 + Math.round(tier * 4)) as 1 | 2 | 3 | 4 | 5,
    seed,
    map: 'saskatchewan',
    homeBase: 'la-ronge',
    timeOfDay,
    wind: { angle: windAngle, strengthScale: windScale },
    fire: { spreadScale },
    bucket: 'bambi',
    fires: [
      { at: 'cluster', anchor: 'lake', spread: 60, count: clusters, size },
      { at: 'random', count: spots, size: 'small', minFromOrigin: 120 },
    ],
    structures: { depot: true }, // a base to scoop/rearm near; no protect-fail (pure score chase)
    objectives: [{ kind: 'extinguishAll' }],
    fails: [], // every seed must be winnable — the daily is a score race, not a defense
  };
}
