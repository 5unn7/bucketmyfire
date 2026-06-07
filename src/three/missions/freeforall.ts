/**
 * Open Skies — the FREE-FOR-ALL endless mode (the planned co-op, reimagined as a same-map score race).
 * Everyone flies the SAME daily-seeded Saskatchewan, the fires never stop coming, and each pilot racks
 * up a personal score from the fires they knock down. There is no win and no lose: it's a sandbox you
 * fly until you leave. (Slice 1 is single-player on a shared, deterministic map; the live board + seeing
 * other pilots in your sky come in later slices — see docs/FREE-FOR-ALL.md.)
 *
 * Like the Daily Burn this is a runtime-built `MissionDef`, not an authored catalog entry, and its id is
 * date-stamped (`ffa-YYYYMMDD`) so it AUTOMATICALLY earns its own per-day leaderboard with no Supabase
 * schema change. `endless: true` flips `Game` into the never-ending spawner + live-score mode. Pure +
 * deterministic (same UTC date in → same world out), so two players on the same day grow an identical map.
 *
 * Engine-agnostic and DOM/Three-free — same date in → same MissionDef out, like daily.ts.
 */
import type { MissionDef } from './types';
import { dailySeed } from './daily';

/** UTC YYYYMMDD — the shared "which day" key (rolls over at the same instant for everyone). */
function ymdUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Today's Open Skies session id, e.g. "ffa-20260607" — doubles as the per-day leaderboard key. */
export function ffaSessionId(date: Date): string {
  return `ffa-${ymdUTC(date)}`;
}

/** True for any Open Skies id — keeps the endless free-for-all OUT of campaign progress/unlocks. */
export function isFfaId(id: string): boolean {
  return id.startsWith('ffa-');
}

/**
 * Build today's Open Skies free-for-all. A distinct seed mix from the Daily Burn so the FFA map differs
 * from the daily challenge. Never-ending: a `survive` objective with an unreachable duration means the
 * runtime never auto-wins, and with no fail conditions it never loses — Game's endless driver (config
 * `FFA`) keeps the fires coming and tallies the live score. `fuel: false` removes range pressure (fly
 * free). `fire` keeps SPOTTING on (no `containAfter`) so the front stays alive; `maxActive` is the pool cap.
 */
export function buildFreeForAll(date: Date): MissionDef {
  const seed = (dailySeed(date) ^ 0x05c1e5) >>> 0; // distinct salt from the daily so the FFA map differs
  return {
    id: ffaSessionId(date),
    index: 0,
    name: 'Open Skies',
    brief: 'Open skies over Saskatchewan. The fires never stop. Knock down all you can.',
    tagline: 'Open Skies · free-for-all',
    situation: 'Free-for-all. Fires keep coming. Build your score.',
    difficulty: 2,
    seed,
    homeBase: 'la-ronge', // central → ambient fires land in-province
    timeOfDay: 'golden',
    endless: true,
    fuel: false, // no range pressure — fly free
    // Lively but bounded: keep ember-spotting (no containAfter), let the active set fill the pool.
    fire: { spreadScale: 0.9 },
    fires: [
      { at: 'random', count: 6, size: 'medium', minFromOrigin: 160 },
      { at: 'random', count: 3, size: 'small', minFromOrigin: 220 },
    ],
    structures: { depot: true },
    objectives: [{ kind: 'survive', seconds: 1e9, label: 'Fly free. Knock down fires.' }],
    fails: [],
  };
}
