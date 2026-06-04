import type { MissionDef } from './types';

/**
 * The 6-mission solo campaign (pure SCENARIO data — no physics/visual tuning, no Three.js).
 * `Game` resolves each def's placement specs against the seeded `World`, hands it to a
 * `MissionRuntime` (objectives/fails) AND a `MissionDirector` (the reactive `script` — the briefing,
 * live radio comms, and world beats that make each mission talk + react). The arc teaches one idea at
 * a time — fight → ferry → defend → everything-at-once → scale-up → finale — and ramps from a calm
 * checkout flight to a re-flaring Class-F monster under a screaming, shifting wind.
 *
 * Two engine capabilities the campaign leans on (see `types.ts`):
 *   - `loadouts` — a MIXED sortie re-rigs the slung load bucket↔crew while set down at the home base,
 *     so one mission can both FERRY crew and FIGHT fire (the pilot chooses when to swap).
 *   - `addObjective` / `addZone` beats — a rescue can POP UP mid-mission: a new evacuate goal + the
 *     family's cabin appear in the world. Gate these on `firesDoused` (NOT a clock) so they fire while
 *     other goals are still pending — the run finalizes a win the frame every goal latches.
 *
 * Callsign convention: the pilot is "Water-1"; mission control is "Dispatch". A beat fires ONCE the
 * first frame its trigger holds. Seeds are chosen to grow the communities each mission references.
 */
export const CAMPAIGN: MissionDef[] = [
  // ── 1 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'first-light',
    index: 0,
    name: 'First Light',
    brief: 'Your first flight. Hold START to spin up, lift off, then scoop from the lake and knock down the ground fire creeping at the hamlet. Calm air — learn the aircraft.',
    intel:
      'Welcome aboard, Water-1. Hold the START dial to bring the rotors up, then ease her off the deck. A slow ground fire is working out of the bush toward the McKay cabins by the lake. Fly low over open water to fill the Bambi bucket, then hit DROP over the flames. Winds are light — a good morning to get the feel of her. Remember: a fire only dies when you put water on it.',
    difficulty: 1,
    seed: 34,
    timeOfDay: 'dawn',
    wind: { strengthScale: 0.5 },
    fire: { spreadScale: 0.45 }, // barely creeps — the calm-air teaching mission, but not frozen
    bucket: 'bambi',
    fires: [{ at: 'nearCommunity', community: 0, offset: 64, size: 'small', count: 3 }],
    structures: { depot: true, groups: [{ community: 0, cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend the hamlet' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, Dispatch — rotors are up, you're cleared to lift. Three spots creeping at the McKay cabins. Fill from the lake and knock them down — take your time." }] },
      // The surprise: the fire fights back the instant you relax — teaches the re-flare truth.
      { id: 'reflare', trigger: { at: 'firesDoused', n: 1 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 58, size: 'small' } }, { do: 'comms', speaker: 'crew', text: 'It jumped the line — one more lick by the cabins. Get back on it.' }] },
      { id: 'treeline', trigger: { at: 'threat', min: 0.45 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fire's into the treeline by the hamlet — mind those cabins." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "All out, cabins standing. Textbook, Water-1. The McKays owe you a coffee." }] },
    ],
  },
  // ── 2 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'crews-to-the-road',
    index: 1,
    name: 'Crews to the Road',
    brief: 'Ferry two initial-attack crews out to the road, then RE-RIG to the bucket at base and knock down the fire astride it. Set down at base to swap the sling crew↔bucket.',
    intel:
      'Two IA crews need setting down on the cleared pads flanking the access road before they can work the fire on it. You start with the crew sling rigged — run both teams out to the LZs. Then return to base and SWAP to the Bambi bucket (set down on the home pad, hit ⇄ SWAP / G) and put water on the three heads on the road. A medium wind is starting to push them, so mind your approach.',
    difficulty: 2,
    seed: 987,
    timeOfDay: 'day',
    wind: { strengthScale: 0.9 },
    fire: { spreadScale: 0.7 },
    bucket: 'bambi',
    payload: 'crew', // start rigged for the crews
    loadouts: ['crew', 'water'], // … then re-rig to the bucket at base for the firefight
    fires: [{ at: 'nearCommunity', community: 0, offset: 70, size: 'small', count: 3 }],
    structures: { depot: true, groups: [{ community: 0, cabins: 3 }] },
    zones: [
      { role: 'load', single: false, at: 'depot', label: 'Base' },
      { role: 'unload', single: true, at: 'nearCommunity', community: 0, label: 'Road LZ North' },
      { role: 'unload', single: true, at: 'nearCommunity', community: 1, label: 'Road LZ South' },
    ],
    objectives: [
      { kind: 'deliver', n: 2, label: 'Insert both road crews' },
      { kind: 'extinguishCount', n: 3, label: 'Knock down the road fire' },
    ],
    fails: [{ kind: 'protect', min: 1, label: 'Keep the LZs reachable' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, two crews for the road — North and South. Set them both down, then re-rig to the bucket at base and work the heads on the road." }] },
      { id: 'crew1', trigger: { at: 'crewDelivered', n: 1 }, actions: [{ do: 'comms', speaker: 'crew', text: "We're on the ground, thanks. One more team to set down." }] },
      // The surprise: the head doubles across the road the moment the second crew is clear.
      { id: 'crews-down', trigger: { at: 'crewDelivered', n: 2 }, actions: [{ do: 'ignite', place: { at: 'line', community: 0, offset: 70, length: 90, size: 'medium' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: 'Crews are clear — and the head just doubled across the road. Re-rig to the bucket and get on it.' }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Crews inserted, fire knocked down. Two jobs, one sortie — nicely flown, Water-1.' }] },
    ],
  },
  // ── 3 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'hold-the-line',
    index: 2,
    name: 'Hold the Line',
    brief: 'Heavy wind, extreme risk. Ground crews are 3:20 out — keep this fire off the town until they arrive. Your valve bucket splits a load across passes.',
    intel:
      'Ground crews are three minutes out. Until they land, you are the only thing between an advancing front and the town of Birchbank. Hold the line — the wind is screaming and the fire keeps flanking you, so triage which head threatens a cabin and split your valve load across passes. You cannot win by clearing it; you win by ENDURING until the crews are down.',
    difficulty: 3,
    seed: 233,
    timeOfDay: 'day',
    wind: { strengthScale: 1.3 },
    fire: { spreadScale: 0.95 }, // the front genuinely advances on the town
    bucket: 'valve',
    fires: [{ at: 'nearCommunity', community: 0, offset: 70, size: 'medium', count: 3 }],
    structures: { depot: true, groups: [{ community: 0, cabins: 6 }] },
    objectives: [{ kind: 'survive', seconds: 200, label: 'Hold for 3:20' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend the town' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, crews are 3:20 out. Keep the fire off Birchbank until they're on the ground. It's blowing hard — hold the line." }] },
      { id: 'flank1', trigger: { at: 'time', seconds: 50 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 55, size: 'small' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "Flare-up on the north flank — get on it." }] },
      { id: 'flank2', trigger: { at: 'time', seconds: 120 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 60, size: 'small', count: 2 } }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "She's pushing hard on the town — hold!" }] },
      // Threat-gated: only fires if the town is actually in danger, so a strong pilot may never hear it.
      { id: 'fence', trigger: { at: 'threat', min: 0.6 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "Fire's at the fenceline — push it back NOW!" }] },
      { id: 'inbound', trigger: { at: 'time', seconds: 170 }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Crews inbound — thirty seconds. Hold what you have.' }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Crews are on the ground — they've got it. You held the line, Water-1." }] },
    ],
  },
  // ── 4 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'doorstep',
    index: 3,
    name: 'Doorstep',
    brief: 'The fire is at the doorsteps. Fight the heads near town — and when families are cut off, RE-RIG to the sling and pull them out while ember spot-fires light behind you.',
    intel:
      'The fire is at the doorsteps. Open on the heads near town with the bucket and keep them off the cabins. Dispatch is hearing of families getting cut off as the front passes — when that call comes, set down at base, swap to the crew sling, and pull them out before the flames reach the last door. Embers are throwing spot fires behind you, and the heavy wind is forecast to ease as the front goes through.',
    difficulty: 4,
    seed: 55,
    timeOfDay: 'dusk',
    wind: { strengthScale: 1.3 }, // heavy, eased to moderate by a beat as the front passes
    fire: { spreadScale: 1.0 },
    bucket: 'valve',
    payload: 'water', // open with the bucket; re-rig to the sling for the rescues
    loadouts: ['water', 'crew'],
    fires: [
      { at: 'nearCommunity', community: 0, offset: 70, size: 'medium', count: 3 },
      { at: 'nearCommunity', community: 1, offset: 70, size: 'medium', count: 3 },
    ],
    structures: {
      depot: true,
      groups: [
        { community: 0, cabins: 3 },
        { community: 1, cabins: 3 },
      ],
    },
    // Crew-CAPABLE from the start (the reusable base drop-off) so the pop-up rescue can appear.
    zones: [{ role: 'unload', single: false, at: 'depot', label: 'Base' }],
    objectives: [{ kind: 'extinguishCount', n: 8, label: 'Kill the fires at the doorsteps' }],
    fails: [{ kind: 'protect', min: 4, label: 'Beat the fire to the doors' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, the fire's on the doorsteps. Work the heads by the cabins — and stand by, we may need you to pull people out." }] },
      // The pop-up RESCUE: three families cut off — a new evacuate goal + their cabins appear. Gated on
      // firesDoused (NOT a clock) so it fires while fires still burn → the win waits on it.
      {
        id: 'cut-off',
        trigger: { at: 'firesDoused', n: 3 },
        actions: [
          { do: 'comms', speaker: 'warning', urgency: 'alert', text: 'Three families are cut off as the front passes! Re-rig to the sling at base and get them out — fast.' },
          { do: 'addObjective', objective: { kind: 'evacuate', n: 3, label: 'Evacuate the cut-off families' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 0, label: 'Family 1' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 1, label: 'Family 2' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 2, label: 'Family 3' } },
        ],
      },
      // Ember spot-fires light behind you while you ferry — routing pressure, and they feed the count.
      { id: 'embers', trigger: { at: 'firesDoused', n: 5 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 50, size: 'small', count: 2 } }, { do: 'comms', speaker: 'crew', text: 'Embers just lit the brush behind you — spot fires by the cabins.' }] },
      // The wind eases as the front passes — a window to grab the last family.
      { id: 'front-passes', trigger: { at: 'time', seconds: 90 }, actions: [{ do: 'wind', strengthScale: 0.85, ease: 8 }, { do: 'comms', speaker: 'dispatch', text: "Front's passing — wind's backing off. That's your window for the last door." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Fires down and every family's out. You beat the fire to the last door, Water-1. Lives saved today." }] },
    ],
  },
  // ── 5 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'three-towns',
    index: 4,
    name: 'Three Towns',
    brief: 'Two fires near two towns grow toward each other, MERGE, and the joined front runs at a third town. Triage all three — and pull out two families that get cut off.',
    intel:
      'Two separate fires, two towns — and a strong, steady wind carrying them toward each other. They will MERGE into one front, and that front is pointed straight at a third town downwind. You cannot be everywhere: triage the two original heads, then chase the merged monster off the third town. When families get cut off mid-fight, re-rig to the sling and bring them out. This is the widest fight yet.',
    difficulty: 4,
    seed: 377,
    timeOfDay: 'golden',
    // Fixed wind angle so the two fronts converge the same way every run (deterministic merge geometry).
    wind: { angle: -0.6, strengthScale: 1.4 },
    fire: { spreadScale: 1.05 },
    bucket: 'valve',
    payload: 'water',
    loadouts: ['water', 'crew'],
    fires: [
      { at: 'nearCommunity', community: 0, offset: 66, size: 'medium', count: 2 },
      { at: 'nearCommunity', community: 1, offset: 66, size: 'medium', count: 2 },
    ],
    structures: {
      depot: true,
      groups: [
        { community: 0, cabins: 3 },
        { community: 1, cabins: 3 },
        { community: 2, cabins: 3 },
      ],
    },
    zones: [{ role: 'unload', single: false, at: 'depot', label: 'Base' }],
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 6, label: 'Hold all three towns' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, two fronts and a wind that's joining them up. Triage both — and watch the third town downwind." }] },
      // Threat-gated reinforcement: only once the merged head actually endangers town three.
      { id: 'merge', trigger: { at: 'threat', min: 0.55 }, actions: [{ do: 'ignite', place: { at: 'line', community: 2, offset: 85, length: 90, size: 'medium' } }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "The two fires have joined — one front now, and it's running straight at the third town." }] },
      // Two families cut off, popping up mid-fight (gated on progress, not a clock).
      {
        id: 'families',
        trigger: { at: 'firesDoused', n: 4 },
        actions: [
          { do: 'comms', speaker: 'warning', urgency: 'alert', text: 'Two families are trapped between the fronts! Re-rig and pull them out when you can.' },
          { do: 'addObjective', objective: { kind: 'evacuate', n: 2, label: 'Rescue the trapped families' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 0, label: 'Family 1' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 2, label: 'Family 2' } },
        ],
      },
      { id: 'gust', trigger: { at: 'time', seconds: 90 }, actions: [{ do: 'wind', strengthScale: 1.7, ease: 6 }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: 'Wind gusting — the merged head is running. Stay ahead of it.' }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'All three towns standing, families out, fire dead. One helicopter against three towns — extraordinary, Water-1.' }] },
    ],
  },
  // ── 6 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'everything-at-once',
    index: 5,
    name: 'Everything at Once',
    brief: 'The finale. A Class-F head on the town, the depot itself threatened, a re-flaring monster, a finite tank — and a family to pull out. Everything you have learned, at once.',
    intel:
      'This is the big one, Water-1. A Class-F head is sitting on the town and reaching for the depot — your only fuel and water for the whole sector. It re-flares out of the duff pass after pass under a screaming, shifting wind. Manage your tank, defend the depot, walk the monster down — and when a family gets trapped, re-rig and bring them out. Lose a single structure or run the tank dry and the run is over. Bring it home.',
    difficulty: 5,
    seed: 1597,
    timeOfDay: 'golden',
    wind: { angle: -1.2, strengthScale: 1.5 }, // fixed start; a gust + a shift turn it onto the depot
    fire: { spreadScale: 1.3 }, // the campaign's fastest spread
    bucket: 'valve',
    fuel: true,
    payload: 'water',
    loadouts: ['water', 'crew'],
    fires: [
      { at: 'nearCommunity', community: 0, offset: 80, size: 'mega' },
      { at: 'nearCommunity', community: 1, offset: 80, size: 'large' },
    ],
    structures: { depot: true, groups: [{ community: 0, cabins: 5 }] },
    zones: [{ role: 'unload', single: false, at: 'depot', label: 'Base' }],
    objectives: [{ kind: 'extinguishAll' }],
    fails: [
      { kind: 'protect', all: true, label: 'Save the depot and town' },
      { kind: 'fuelOut' },
    ],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, conditions are extreme. A monster on the town reaching for the depot, wind gusting and shifting, finite fuel. Everything you've got — good luck out there." }] },
      { id: 'gust', trigger: { at: 'time', seconds: 60 }, actions: [{ do: 'wind', strengthScale: 2.2, ease: 5 }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "Wind's gusting hard — she's running. Stay ahead of her!" }] },
      // Re-flares scale with YOUR progress — the fire fights hardest as you near victory.
      { id: 'reflare1', trigger: { at: 'firesDoused', n: 8 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 60, size: 'medium' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "She's back up out of the peat by the town — get on it!" }] },
      // The pop-up rescue: a family trapped, mid-firestorm.
      {
        id: 'trapped',
        trigger: { at: 'firesDoused', n: 10 },
        actions: [
          { do: 'comms', speaker: 'warning', urgency: 'alert', text: 'A family is trapped at the edge of town! Re-rig and get them out — now.' },
          { do: 'addObjective', objective: { kind: 'evacuate', n: 1, label: 'Evacuate the trapped family' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 0, label: 'Trapped family' } },
        ],
      },
      // The wind shift turns the head onto the depot — threat-gated alert if you let it reach the fence.
      { id: 'shift', trigger: { at: 'time', seconds: 140 }, actions: [{ do: 'wind', angle: 0.3, ease: 6 }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "Wind's backing — she's turning onto the depot. Get between her and the pumps." }] },
      { id: 'depot', trigger: { at: 'threat', min: 0.6 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "Fire's on the depot fence — that's your only fuel. Push it back!" }] },
      { id: 'reflare2', trigger: { at: 'firesDoused', n: 20 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 70, size: 'small', count: 2 } }, { do: 'comms', speaker: 'crew', text: 'It keeps creeping out of the duff — stay on the hot edge.' }] },
      { id: 'fuel', trigger: { at: 'fuelBelow', frac: 0.25 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fuel's low, Water-1 — make your passes count and mind the run home." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "It's out. All of it. Depot intact, town standing, family safe — through a firestorm, solo. Outstanding flying, Water-1. That's the campaign." }] },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return CAMPAIGN.find((m) => m.id === id);
}
