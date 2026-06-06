/**
 * Mission ARCHETYPES (Slice 3 — the factory's templates). Each archetype is a parametric recipe distilled
 * from a proven hand-authored campaign mission: given a deterministic `rng` and an `intensity` knob (0..1,
 * the day's overall heat), it emits the SCENARIO-shaping fields of a `MissionDef` (fires / objectives /
 * fails / payload / wind / structures …). The factory `index.ts` wraps those with the id / seed / map /
 * homeBase / name to produce a complete, EXISTING `MissionDef` — so nothing downstream (Game, runtime,
 * scoring, HUD) changes; the factory is purely a PRODUCER.
 *
 * COMPLETABILITY BY CONSTRUCTION: every placement is feature-RELATIVE + self-snapping (`anchor:'lake'`,
 * `community:'base'`, `random`) so a solution always exists on any seed/map without querying the World — the
 * runtime daily never builds a World (the mobile must-fix). An optional `MapContext` (build-time / co-op
 * only) lets an archetype pick a specific DEFENSIBLE town instead of the home base. The oracle
 * (`missions/oracle.ts`) verifies construct-correctness OFFLINE across many seeds (see verify-campaign).
 */
import type { FirePlacement, Objective, FailCondition, StructureSpec, SizeClass } from '../types';
import type { MapContext } from './MapContext';

/** The scenario-shaping half of a MissionDef the factory's index.ts merges with id/seed/map/homeBase/name. */
export interface ArchetypeOutput {
  fires: FirePlacement[];
  objectives: Objective[];
  fails: FailCondition[];
  structures?: StructureSpec;
  payload?: 'water' | 'crew' | 'torch';
  bucket?: 'bambi' | 'valve';
  fuel?: boolean;
  fire: { spreadScale: number };
  wind: { angle?: number; strengthScale: number };
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** The in-game voice for this generated sortie (the factory uses these for the briefing/tagline). */
  flavor: { kind: string; brief: string; tagline: string };
}

export interface Archetype {
  id: string;
  build(rng: () => number, intensity: number, ctx?: MapContext): ArchetypeOutput;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampDiff = (n: number): 1 | 2 | 3 | 4 | 5 => Math.max(1, Math.min(5, Math.round(n))) as 1 | 2 | 3 | 4 | 5;

/** EXTINGUISH — the open score-chase (← Daily Burn / First Light): lake-anchored complexes + scattered
 *  spots, clear every fire, no hard-fail (every seed winnable). The factory's default flavor. */
const extinguish: Archetype = {
  id: 'extinguish',
  build(rng, intensity) {
    const clusters = 2 + Math.floor(rng() * 2); // 2..3 lake-anchored complexes (a scoop source on hand)
    const spots = 2 + Math.floor(rng() * 4); // 2..5 scattered spot fires
    const size: SizeClass = intensity > 0.66 ? 'medium' : 'small';
    return {
      fires: [
        { at: 'cluster', anchor: 'lake', spread: 60, count: clusters, size },
        { at: 'random', count: spots, size: 'small', minFromOrigin: 120 },
      ],
      objectives: [{ kind: 'extinguishAll' }],
      fails: [], // pure score race — always winnable
      structures: { depot: true },
      bucket: 'bambi',
      fire: { spreadScale: lerp(0.55, 1.15, intensity) },
      wind: { strengthScale: lerp(0.4, 1.3, rng()) },
      difficulty: clampDiff(1 + intensity * 4),
      flavor: {
        kind: 'extinguish',
        brief: "Clear every fire across the bush. Fast, clean drops score highest — fill from the lakes and knock them down.",
        tagline: 'Clear the bush — every fire, fastest line.',
      },
    };
  },
};

/** MOP-UP — the long patrol (← After Burn): a tight grid of small smouldering hotspots by a lake, calm
 *  spread, but FUEL pressure (refuel at base) so it's a methodical range game. Valve for splittable dabs. */
const mopUp: Archetype = {
  id: 'mop-up',
  build(rng, intensity) {
    const count = 4 + Math.floor(rng() * 3); // 4..6 hotspots in the black
    return {
      fires: [
        { at: 'cluster', anchor: 'lake', spread: lerp(70, 110, intensity), count, size: 'small' },
        { at: 'nearCommunity', community: 'base', offset: 55, size: 'small', count: 2 }, // dangerous ones by the base
      ],
      objectives: [{ kind: 'extinguishAll' }],
      fails: [{ kind: 'fuelOut' }], // mop-up is a fuel-hungry patrol — run dry and you lose
      structures: { depot: true },
      payload: 'water',
      bucket: 'valve',
      fuel: true,
      fire: { spreadScale: lerp(0.35, 0.6, intensity) }, // smoulder, don't run
      wind: { strengthScale: lerp(0.3, 0.7, rng()) },
      difficulty: clampDiff(2 + intensity * 2),
      flavor: {
        kind: 'mop-up',
        brief: "The front's through — now the black. Grid it, find every smouldering hotspot, and drown it cold before a holdover re-flares. Mind your fuel.",
        tagline: "Mop up the black before it wakes.",
      },
    };
  },
};

/** HOLD-THE-LINE — defend (← Hold the Line): a wind-driven front pressing the HOME BASE (always lakeside,
 *  so scoopable), survive until the clock runs out, protect the structures. With a MapContext, target a
 *  defensible TOWN instead. Valve to split a load across passes. */
const holdTheLine: Archetype = {
  id: 'hold-the-line',
  build(rng, intensity, ctx) {
    // Pick the place to defend: a random DEFENSIBLE town if we have a MapContext (build-time / co-op),
    // else the home base (always on a lake → scoopable, so always defensible without a World query).
    const towns = ctx?.defensibleTowns() ?? [];
    const target = towns.length ? towns[Math.floor(rng() * towns.length)].ref : 'base';
    const seconds = Math.round(lerp(150, 210, intensity)); // 2:30 .. 3:30 to hold
    return {
      // The front is authored as a cluster biased toward the defended place (self-snaps to dry fuel,
      // in-province on a true-shape map). It advances onto the settlement under the strong wind.
      fires: [{ at: 'cluster', anchor: typeof target === 'string' && target !== 'base' ? { community: target } : { community: 'base' }, distance: 70, spread: 50, count: 3, size: 'medium' }],
      objectives: [{ kind: 'survive', seconds, label: `Hold for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }],
      fails: [{ kind: 'protect', min: 3, label: 'Defend the community' }],
      structures: { depot: true, groups: [{ community: target, cabins: 5 }] },
      payload: 'water',
      bucket: 'valve',
      fire: { spreadScale: lerp(0.8, 1.0, intensity) },
      wind: { strengthScale: lerp(1.1, 1.4, intensity) }, // it's blowing hard
      difficulty: clampDiff(3 + intensity * 2),
      flavor: {
        kind: 'hold-the-line',
        brief: "Heavy wind, a front on the move. Crews are minutes out — keep this fire off the community until they land. You win by ENDURING, not by clearing it.",
        tagline: 'Hold the front off the town till the crews land.',
      },
    };
  },
};

/** The factory's archetype catalog (MVP: 3). Daily rotates across these; co-op/campaign add more later. */
export const ARCHETYPES: readonly Archetype[] = [extinguish, mopUp, holdTheLine];

export function archetypeById(id: string): Archetype | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}
