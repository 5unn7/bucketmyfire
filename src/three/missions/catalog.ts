import type { MissionDef } from './types';

/**
 * The 10-mission campaign (pure SCENARIO data — no physics/visual tuning, no Three.js).
 * `Game` resolves each def's placement specs against the seeded `World` and hands it to a
 * `MissionRuntime`. Difficulty ramps from a calm 3-fire sortie to a wind-driven Class-F
 * firestorm, exercising every mechanic: water firefighting, structure defence, crew
 * insertion + evacuation (the slung crew basket), fuel/range pressure, and survive timers.
 *
 * Placement is relative to the generated world's named features (`nearCommunity`, `depot`,
 * `random`) so each mission reads like a briefing and stays valid whatever its seed grows.
 * Each mission carries its OWN seed (the "future maps" seam) so the maps feel distinct.
 */
export const CAMPAIGN: MissionDef[] = [
  {
    id: 'first-sortie',
    index: 0,
    name: 'First Sortie',
    brief: 'Three spot fires in the bush by a lake. Scoop from the water and drop on the flames. Calm air — get a feel for the bucket.',
    difficulty: 1,
    seed: 21,
    wind: { strengthScale: 0.4 },
    bucket: 'bambi',
    // One coherent 3-head spot fire in the bush right beside a lake — a scoop source on hand for the
    // tutorial (vs the old scatter of independent dots across the whole map).
    fires: [{ at: 'cluster', anchor: 'lake', distance: 220, spread: 38, count: 3, size: 'small' }],
    objectives: [{ kind: 'extinguishAll' }],
  },
  {
    id: 'cabin-country',
    index: 1,
    name: 'Cabin Country',
    brief: 'A fire is creeping toward a trapper hamlet. Knock it down before the cabins burn.',
    difficulty: 1,
    seed: 34,
    wind: { strengthScale: 0.6 },
    bucket: 'bambi',
    fires: [{ at: 'nearCommunity', community: 0, offset: 64, size: 'small', count: 3 }],
    structures: { depot: true, groups: [{ community: 0, cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend the hamlet' }],
  },
  {
    id: 'crew-insertion',
    index: 2,
    name: 'Crew Insertion',
    brief: 'Sling three fire crews from the base out to the landing zones on the ridge before the front builds. Fly low and slow over each LZ to set them down.',
    difficulty: 2,
    seed: 55,
    payload: 'crew',
    fires: [],
    structures: { depot: true },
    zones: [
      { role: 'load', single: false, at: 'depot', label: 'Base' },
      { role: 'unload', single: true, at: 'nearCommunity', community: 0, label: 'LZ Alpha' },
      { role: 'unload', single: true, at: 'nearCommunity', community: 1, label: 'LZ Bravo' },
      { role: 'unload', single: true, at: 'nearCommunity', community: 2, label: 'LZ Charlie' },
    ],
    objectives: [{ kind: 'deliver', n: 3 }],
  },
  {
    id: 'wind-shift',
    index: 3,
    name: 'Wind Shift',
    brief: 'A hard, shifting wind is driving the head fire at a hamlet. Read the wind, hit it upwind, and put it out before it arrives.',
    difficulty: 2,
    seed: 89,
    wind: { strengthScale: 1.6 },
    bucket: 'bambi',
    // A genuine head-fire FRONT: a line of fire set upwind of the hamlet, running onto it with the
    // wind. Hit it upwind / on the flanks before it arrives — exactly what the brief asks.
    fires: [{ at: 'line', community: 0, offset: 95, length: 110, size: 'medium' }],
    structures: { depot: true, groups: [{ community: 0, cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 3, label: 'Defend the hamlet' }],
  },
  {
    id: 'long-haul',
    index: 4,
    name: 'The Long Haul',
    brief: 'A fire deep in the backcountry, far from any water. Watch the fuel gauge — refuel at the base and don’t get caught dry.',
    difficulty: 3,
    seed: 144,
    bucket: 'bambi',
    fuel: true,
    // A single 2-head complex deep in the backcountry, far from spawn and water — the long-range,
    // watch-your-fuel haul the brief promises (one authored blaze, not two stray dots).
    fires: [{ at: 'cluster', anchor: 'origin', bearing: 2.3, distance: 430, spread: 52, count: 2, size: 'medium' }],
    structures: { depot: true },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'fuelOut' }],
  },
  {
    id: 'hold-the-line',
    index: 5,
    name: 'Hold the Line',
    brief: 'Ground crews are three minutes out. Keep the fire off the town until they arrive. You can split a valve load across passes.',
    difficulty: 3,
    seed: 233,
    wind: { strengthScale: 1.3 },
    bucket: 'valve',
    fires: [{ at: 'nearCommunity', community: 0, offset: 70, size: 'medium', count: 3 }],
    structures: { depot: true, groups: [{ community: 0, cabins: 6 }] },
    objectives: [{ kind: 'survive', seconds: 180, label: 'Hold for 3:00' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend the town' }],
  },
  {
    id: 'evacuation',
    index: 6,
    name: 'Evacuation',
    brief: 'No time to fight this one. Pick up the families from three cut-off cabins and fly them back to base before the fire reaches them.',
    difficulty: 3,
    seed: 377,
    payload: 'crew',
    wind: { strengthScale: 1.0 },
    fires: [{ at: 'nearCommunity', community: 0, offset: 90, size: 'medium', count: 2 }],
    structures: {
      depot: true,
      groups: [
        { community: 0, cabins: 1 },
        { community: 1, cabins: 1 },
        { community: 2, cabins: 1 },
      ],
    },
    zones: [
      { role: 'load', single: true, at: 'nearCommunity', community: 0, label: 'Cabin 1' },
      { role: 'load', single: true, at: 'nearCommunity', community: 1, label: 'Cabin 2' },
      { role: 'load', single: true, at: 'nearCommunity', community: 2, label: 'Cabin 3' },
      { role: 'unload', single: false, at: 'depot', label: 'Base' },
    ],
    objectives: [{ kind: 'evacuate', n: 3 }],
    fails: [{ kind: 'protect', min: 1, label: 'Reach them in time' }],
  },
  {
    id: 'mega-fire',
    index: 7,
    name: 'Mega-Fire',
    brief: 'A Class-F monster has set up next to the base. One tank won’t do it — it re-flares. Work it down pass after pass and keep it off the depot.',
    difficulty: 4,
    seed: 610,
    wind: { strengthScale: 1.1 },
    bucket: 'valve',
    fires: [{ at: 'nearCommunity', community: 'base', offset: 95, size: 'mega' }],
    structures: { depot: true },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', all: true, label: 'Save the depot' }],
  },
  {
    id: 'multi-front',
    index: 8,
    name: 'Multi-Front',
    brief: 'Two communities, two fires, one helicopter. Triage between the fronts and keep both hamlets standing.',
    difficulty: 4,
    seed: 987,
    wind: { strengthScale: 1.2 },
    bucket: 'bambi',
    fires: [
      { at: 'nearCommunity', community: 0, offset: 66, size: 'medium', count: 2 },
      { at: 'nearCommunity', community: 1, offset: 66, size: 'medium', count: 2 },
    ],
    structures: {
      depot: true,
      groups: [
        { community: 0, cabins: 4 },
        { community: 1, cabins: 4 },
      ],
    },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 6, label: 'Defend both hamlets' }],
  },
  {
    id: 'firestorm',
    index: 9,
    name: 'Firestorm',
    brief: 'Everything at once: multiple blazes, a screaming wind, a town in the path, and a finite tank of fuel. This is the big one.',
    difficulty: 5,
    seed: 1597,
    wind: { strengthScale: 1.7 },
    bucket: 'valve',
    fuel: true,
    fires: [
      { at: 'nearCommunity', community: 0, offset: 80, size: 'mega' },
      { at: 'nearCommunity', community: 1, offset: 80, size: 'large' },
      // A third, coherent secondary complex out in the bush (not two stray random dots).
      { at: 'cluster', anchor: 'origin', bearing: -1.2, distance: 300, spread: 58, count: 2, size: 'medium' },
    ],
    structures: { depot: true, groups: [{ community: 0, cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [
      { kind: 'protect', min: 4, label: 'Defend the town' },
      { kind: 'fuelOut' },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return CAMPAIGN.find((m) => m.id === id);
}
