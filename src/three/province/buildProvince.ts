/**
 * buildProvince — the Living Province scenario (the "the map just opens" mode). Like Open Skies' FFA def
 * it's a runtime-built `MissionDef`, not an authored catalog entry, and its id is date-stamped so it earns
 * its own per-day leaderboard for free. It sets BOTH `endless` (to reuse the shared-wall-clock wind +
 * respawn-on-crash + presence + board plumbing) AND `living` (so Game builds a `ProvinceMode` — the
 * DispatchDirector + the shift/stakes — instead of the flat FFA spawner).
 *
 * The one substantive difference from FFA: it populates real town CABINS across the province, so the
 * director's town-threat calls have something to protect (FFA has only the depot, hence no stakes). The
 * town set is the province's anchored, defensible communities; Game intersects it with the live map's
 * MapContext so only towns that actually built cabins get threatened.
 *
 * Engine-agnostic + deterministic (same date + region in → same def out), like daily.ts / freeforall.ts.
 */
import type { MissionDef } from '../missions/types';
import { dailySeed } from '../missions/daily';
import { PROVINCE_COPY, regionDisplayName } from './strings';

/** UTC YYYYMMDD — the shared "which day" key (rolls over together for everyone). */
function ymdUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Today's Living Province session id, e.g. "prov-saskatchewan-20260608" — doubles as the board key. */
export function provinceSessionId(date: Date, regionId = 'saskatchewan'): string {
  return `prov-${regionId}-${ymdUTC(date)}`;
}

/** True for any Living Province id — keeps the open-world shift OUT of campaign progress/unlocks (like FFA). */
export function isProvinceId(id: string): boolean {
  return id.startsWith('prov-');
}

/**
 * The anchored, protectable towns per region — the candidates for town cabins + dispatch town-threats.
 * Saskatchewan's defensible communities (the same anchors the campaign protected); other regions have no
 * authored town set yet, so they run a spot-fire-only province until they get one. `structurePlan` and
 * `MapContext` both skip any ref that doesn't resolve, so a stale entry is harmless.
 */
export function provinceTownRefs(regionId = 'saskatchewan'): string[] {
  if (regionId === 'saskatchewan') {
    return ['weyakwin', 'missinipe', 'stanley-mission', 'denare-beach', 'buffalo-narrows', 'beauval', 'ile-a-la-crosse'];
  }
  return [];
}

/** Build today's Living Province for a region. Endless + living; fly-free (no fuel); towns to hold. */
export function buildProvince(date: Date, regionId = 'saskatchewan'): MissionDef {
  const seed = (dailySeed(date) ^ 0x1209ce) >>> 0; // distinct salt from FFA/daily so the province map differs
  const towns = provinceTownRefs(regionId);
  return {
    id: provinceSessionId(date, regionId),
    index: 0,
    name: regionDisplayName(regionId), // the briefing title is the place you picked ("Saskatchewan")
    brief: PROVINCE_COPY.brief,
    tagline: PROVINCE_COPY.tagline,
    situation: PROVINCE_COPY.situation,
    difficulty: 2,
    seed,
    map: regionId,
    homeBase: 'la-ronge', // central → ambient fires + calls land in-province
    timeOfDay: 'golden',
    endless: true, // reuse the shared-clock wind + respawn-on-crash + presence + per-day board
    living: true, // → Game builds a ProvinceMode (DispatchDirector + shift/stakes) instead of the flat spawner
    fuel: false, // fly free — no range pressure (Open Skies has none; the campaign taught it)
    fire: { spreadScale: 0.9 }, // lively front; the director escalates via call cadence + size, not per-fire spread
    // A couple of opening fires so the world isn't dead before the first dispatch call (firstCallSec).
    fires: [{ at: 'random', count: 2, size: 'small', minFromOrigin: 180 }],
    structures: {
      depot: true,
      groups: towns.map((community) => ({ community, cabins: 3 })),
    },
    objectives: [{ kind: 'survive', seconds: 1e9, label: 'Hold the province.' }], // never met → runtime never ends; ProvinceMode owns the outcome
    fails: [],
  };
}
