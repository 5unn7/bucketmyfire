import type { MissionDef } from './types';

/**
 * The 10-mission campaign (pure SCENARIO data — no physics/visual tuning, no Three.js).
 * `Game` resolves each def's placement specs against the seeded `World`, hands it to a
 * `MissionRuntime` (objectives/fails) AND a `MissionDirector` (the reactive `script` — the
 * briefing, live radio comms, and world beats that make each mission talk + react). Difficulty
 * ramps from a calm 3-fire sortie to a wind-driven Class-F firestorm, exercising every mechanic.
 *
 * Each mission carries: a menu `brief` (one-liner), an `intel` paragraph (the briefing card body),
 * static placement (`fires`/`structures`/`zones`), win `objectives` + lose `fails`, and a `script`
 * of beats. A beat fires ONCE the first frame its trigger holds — `start` opens with a DISPATCH
 * line, mid-mission beats radio chatter + ignite flare-ups / shift the wind, and `won` signs off.
 * Callsign convention: the pilot is "Water-1"; mission control is "Dispatch".
 */
export const CAMPAIGN: MissionDef[] = [
  {
    id: 'first-sortie',
    index: 0,
    name: 'Checkout Flight',
    brief: 'Your first flight. Hold START to spin up the rotors, lift off from base, then scoop from the lake and douse three spot fires. Calm air — learn the aircraft.',
    intel:
      'Welcome aboard, Water-1. First things first — hold the START dial to bring the rotors up to speed, then ease her off the deck. Three spot fires are smouldering in the bush beside the lake to the north. Fly low over open water to fill the Bambi bucket, then hit DROP to release it over the flames. Winds are light today — a good morning to get the feel of the aircraft.',
    difficulty: 1,
    seed: 21,
    wind: { strengthScale: 0.4 },
    fire: { spreadScale: 0.25 }, // near-static spots — the tutorial: practice the bucket, no race
    bucket: 'bambi',
    // One coherent 3-head spot fire in the bush right beside a lake — a scoop source on hand for the
    // tutorial (vs the old scatter of independent dots across the whole map).
    fires: [{ at: 'cluster', anchor: 'lake', distance: 220, spread: 38, count: 3, size: 'small' }],
    objectives: [{ kind: 'extinguishAll' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, Dispatch — rotors are up, you're cleared to lift. Three spots by the lake, grid north. Fill from the water and knock them down — take your time." }] },
      { id: 'first-out', trigger: { at: 'firesDoused', n: 1 }, actions: [{ do: 'comms', speaker: 'crew', text: 'Good drop, Water-1 — that flank is knocked down. Keep at it.' }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'All fires out. Textbook, Water-1. Bring her home.' }] },
    ],
  },
  {
    id: 'cabin-country',
    index: 1,
    name: 'Cabin Country',
    brief: 'A fire is creeping toward a trapper hamlet. Knock it down before the cabins burn.',
    intel:
      'A ground fire is working through black spruce toward the McKay trapline — five cabins in a clearing. It is slow now, but it is heading straight for them. Get water on it before it reaches the treeline by the hamlet.',
    difficulty: 1,
    seed: 34,
    wind: { strengthScale: 0.6 },
    fire: { spreadScale: 0.4 }, // a slow ground fire creeping at the cabins — time to read it and act
    bucket: 'bambi',
    fires: [{ at: 'nearCommunity', community: 0, offset: 64, size: 'small', count: 3 }],
    structures: { depot: true, groups: [{ community: 0, cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend the hamlet' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Water-1, fire is creeping toward the McKay cabins. Knock it down before it hits the clearing.' }] },
      { id: 'treeline', trigger: { at: 'threat', min: 0.45 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fire's into the treeline by the hamlet — those cabins are in the path now." }] },
      { id: 'lost', trigger: { at: 'structureLost', n: 1 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "We've lost a cabin. Protect what's still standing!" }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Fire's out, cabins are standing. The McKays owe you a coffee, Water-1." }] },
    ],
  },
  {
    id: 'crew-insertion',
    index: 2,
    name: 'Crew Insertion',
    brief: 'Ferry three fire crews from the base out to the landing zones on the ridge before the front builds. Land at each LZ, let the crew off, then go back for the next.',
    intel:
      'No fire to fight today — yet. Three initial-attack crews need inserting on the ridge before the front builds. Pick a crew up at base, fly out to its landing zone — Alpha, Bravo, Charlie — and SET DOWN on the cleared pad to let them off. One crew at a time; mind the narrow clearing.',
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
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, you've got three crews for the ridge — Alpha, Bravo, Charlie. Get them in before the wind turns." }] },
      { id: 'crew1', trigger: { at: 'crewDelivered', n: 1 }, actions: [{ do: 'comms', speaker: 'crew', text: "We're on the ground, thanks for the lift. Go get the others." }] },
      { id: 'crew2', trigger: { at: 'crewDelivered', n: 2 }, actions: [{ do: 'comms', speaker: 'crew', text: "Second team's set. One crew left to insert." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "All crews inserted. Nicely flown, Water-1 — they'll hold that ridge." }] },
    ],
  },
  {
    id: 'wind-shift',
    index: 3,
    name: 'Wind Shift',
    brief: 'A hard, shifting wind is driving the head fire at a hamlet. Read the wind, hit it upwind, and put it out before it arrives.',
    intel:
      'A head fire is running on the Sproule hamlet, pushed by a stiff westerly. Hit it upwind and on the flanks while you can — and watch the sky. The wind is forecast to back hard. When it turns, the fire turns with it.',
    difficulty: 2,
    seed: 89,
    // Fixed opening wind so the head-fire line + the scripted shift read consistently every run.
    wind: { angle: -2.4, strengthScale: 1.6 },
    fire: { spreadScale: 0.8 }, // a real wind-driven head, but readable — hit it upwind before it arrives
    bucket: 'bambi',
    // A genuine head-fire FRONT: a line of fire set upwind of the hamlet, running onto it with the
    // wind. Hit it upwind / on the flanks before it arrives — exactly what the brief asks.
    fires: [{ at: 'line', community: 0, offset: 95, length: 110, size: 'medium' }],
    structures: { depot: true, groups: [{ community: 0, cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 3, label: 'Defend the hamlet' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Water-1, head fire inbound on Sproule. Work it upwind while the wind holds.' }] },
      {
        id: 'the-shift',
        trigger: { at: 'time', seconds: 65 },
        actions: [
          { do: 'wind', angle: 0.7, strengthScale: 2.0, ease: 6 },
          { do: 'comms', speaker: 'warning', urgency: 'alert', text: "Wind shift! She's backing to the southeast — the front is turning onto Sproule. Reposition, now!" },
          { do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 70, size: 'small' } },
        ],
      },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Fire's out and Sproule is clear. You read that wind like a veteran, Water-1." }] },
    ],
  },
  {
    id: 'long-haul',
    index: 4,
    name: 'The Long Haul',
    brief: "A fire deep in the backcountry, far from any water. Watch the fuel gauge — refuel at the base and don't get caught dry.",
    intel:
      'A blaze is burning deep in the backcountry, a long way from any water and farther still from fuel. Manage your tank carefully — top up at the base and do not get caught dry out there. It is a long walk home if the engine quits.',
    difficulty: 3,
    seed: 144,
    fire: { spreadScale: 0.6 }, // backcountry fire spreads slowly — the challenge is range/fuel, not the race
    bucket: 'bambi',
    fuel: true,
    // A single 2-head complex deep in the backcountry, far from spawn and water — the long-range,
    // watch-your-fuel haul the brief promises (one authored blaze, not two stray dots).
    fires: [{ at: 'cluster', anchor: 'origin', bearing: 2.3, distance: 430, spread: 52, count: 2, size: 'medium' }],
    structures: { depot: true },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'fuelOut' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, fire's a long run to the southwest. Mind your fuel — the depot is the only pump for miles." }] },
      { id: 'spot', trigger: { at: 'time', seconds: 90 }, actions: [{ do: 'ignite', place: { at: 'cluster', anchor: 'origin', bearing: 2.0, distance: 380, size: 'small' } }, { do: 'comms', speaker: 'crew', text: 'Spot fire has broken out downwind — embers carried. Add it to the list.' }] },
      { id: 'fuel-half', trigger: { at: 'fuelBelow', frac: 0.4 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fuel's under half, Water-1. Start thinking about the run back to the depot." }] },
      { id: 'fuel-reserve', trigger: { at: 'fuelBelow', frac: 0.18 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "You're on the reserve. Get to the pump." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Fire's out and you've still got fumes in the tank. Well managed, Water-1." }] },
    ],
  },
  {
    id: 'hold-the-line',
    index: 5,
    name: 'Hold the Line',
    brief: 'Ground crews are three minutes out. Keep the fire off the town until they arrive. You can split a valve load across passes.',
    intel:
      'Ground crews are three minutes out. Until they arrive, you are the only thing between this fire and the town of Birchbank. Hold the line — your valve bucket can split a load across several passes, so make each one count.',
    difficulty: 3,
    seed: 233,
    wind: { strengthScale: 1.3 },
    fire: { spreadScale: 0.9 }, // pushes hard toward the town — you're holding a real advancing line
    bucket: 'valve',
    fires: [{ at: 'nearCommunity', community: 0, offset: 70, size: 'medium', count: 3 }],
    structures: { depot: true, groups: [{ community: 0, cabins: 6 }] },
    objectives: [{ kind: 'survive', seconds: 180, label: 'Hold for 3:00' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend the town' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Water-1, crews are three minutes out. Keep the fire off Birchbank until they are on the ground.' }] },
      { id: 'flank1', trigger: { at: 'time', seconds: 45 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 55, size: 'small' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fire's flaring on the north flank — get on it." }] },
      { id: 'flank2', trigger: { at: 'time', seconds: 110 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 0, offset: 60, size: 'small', count: 2 } }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "She's pushing hard on the town now — hold the line!" }] },
      { id: 'inbound', trigger: { at: 'time', seconds: 150 }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Crews inbound — thirty seconds. Hold what you have.' }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Crews are on the ground — they've got it from here. You held the line, Water-1." }] },
    ],
  },
  {
    id: 'evacuation',
    index: 6,
    name: 'Evacuation',
    brief: 'No time to fight this one. Land at three cut-off cabins, get the families aboard, and fly them back to base before the fire reaches them.',
    intel:
      'No time to fight this one — the fire is already at the doorsteps. Three families are cut off in cabins on the lakeshore. Set down at each cabin, get them aboard, and fly them back to base one at a time — beat the flames to the last door.',
    difficulty: 3,
    seed: 377,
    payload: 'crew',
    wind: { strengthScale: 1.0 },
    fire: { spreadScale: 0.85 }, // the fire is closing on the cabins — beat it to the last door
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
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, this is an evac — three cabins, families waiting. Get them out, the fire's closing fast." }] },
      { id: 'evac1', trigger: { at: 'crewDelivered', n: 1 }, actions: [{ do: 'comms', speaker: 'crew', text: "Family's safe at base. Two more still out there — go." }] },
      { id: 'closing', trigger: { at: 'time', seconds: 70 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 2, offset: 32, size: 'small' } }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "Fire's reached Cabin 3 — move, move, move!" }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Everyone's out. You beat the fire to them, Water-1. That's lives saved today." }] },
    ],
  },
  {
    id: 'mega-fire',
    index: 7,
    name: 'Mega-Fire',
    brief: "A Class-F monster has set up next to the base. One tank won't do it — it re-flares. Work it down pass after pass and keep it off the depot.",
    intel:
      'A Class-F monster has set up right next to the base. One tank will not kill it — knock it down and it flares back up out of the duff. Work it pass after pass, and whatever happens, keep it off the depot — that is your only fuel and water for the whole sector.',
    difficulty: 4,
    seed: 610,
    wind: { strengthScale: 1.1 },
    fire: { spreadScale: 1.0 }, // full baseline pace — a Class-F monster that re-flares out of the duff
    bucket: 'valve',
    fires: [{ at: 'nearCommunity', community: 'base', offset: 95, size: 'mega' }],
    structures: { depot: true },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', all: true, label: 'Save the depot' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, that monster is on the depot's doorstep. One load won't do it — keep hammering and don't let it reach the pumps." }] },
      { id: 'reflare1', trigger: { at: 'firesDoused', n: 8 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'base', offset: 60, size: 'medium' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "She's flaring back up by the depot — get back on it!" }] },
      { id: 'fence', trigger: { at: 'threat', min: 0.6 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "Fire's on the depot fence — push it back NOW." }] },
      { id: 'reflare2', trigger: { at: 'firesDoused', n: 18 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'base', offset: 70, size: 'small', count: 2 } }, { do: 'comms', speaker: 'crew', text: "It keeps creeping out of the peat — stay on the hot edge." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "She's finally down and the depot's intact. That was a fight, Water-1. Outstanding." }] },
    ],
  },
  {
    id: 'multi-front',
    index: 8,
    name: 'Multi-Front',
    brief: 'Two communities, two fires, one helicopter. Triage between the fronts and keep both hamlets standing.',
    intel:
      'Two fires, two communities, one helicopter — Cedar and Willow. You cannot be both places at once, so triage. Knock down what you can on one front, then swing to the other before either hamlet is overrun.',
    difficulty: 4,
    seed: 987,
    wind: { strengthScale: 1.2 },
    fire: { spreadScale: 1.0 }, // two fronts running at baseline pace — you can't be both places at once
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
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, two fronts — Cedar and Willow. Triage them. Don't let either get away from you." }] },
      { id: 'other-side', trigger: { at: 'time', seconds: 75 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 1, offset: 55, size: 'small', count: 2 } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "While you're on one front, the other's flaring up. Don't forget Willow." }] },
      { id: 'lost', trigger: { at: 'structureLost', n: 1 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "We've lost a building. Tighten it up — both hamlets need you." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Both fronts out, both hamlets standing. That was a juggling act, Water-1.' }] },
    ],
  },
  {
    id: 'firestorm',
    index: 9,
    name: 'Firestorm',
    brief: 'Everything at once: multiple blazes, a screaming wind, a town in the path, and a finite tank of fuel. This is the big one.',
    intel:
      'This is the big one. Multiple blazes, a screaming wind, the town of Ash Lake squarely in the path, and a finite tank of fuel. Everything you have learned, all at once. Read the wind, protect the town, watch your fuel — and bring it home.',
    difficulty: 5,
    seed: 1597,
    wind: { strengthScale: 1.7 },
    fire: { spreadScale: 1.3 }, // the big one — fronts run hard; the fastest spread in the campaign
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
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Water-1, conditions are extreme. Three fronts, wind gusting hard, Ash Lake in the path. Watch your fuel. Good luck out there.' }] },
      { id: 'gust', trigger: { at: 'time', seconds: 50 }, actions: [{ do: 'wind', strengthScale: 2.2, ease: 5 }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "Wind's gusting — the fronts are running. Stay ahead of them!" }] },
      { id: 'spot', trigger: { at: 'time', seconds: 95 }, actions: [{ do: 'ignite', place: { at: 'cluster', anchor: 'origin', bearing: -1.0, distance: 260, size: 'small' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: 'Spot fire downwind of Ash Lake — embers are jumping the gaps.' }] },
      { id: 'town', trigger: { at: 'threat', min: 0.6 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: 'Ash Lake is under threat — protect the town!' }] },
      { id: 'fuel', trigger: { at: 'fuelBelow', frac: 0.25 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fuel's low, Water-1 — make your passes count." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "It's out. All of it. You held Ash Lake through a firestorm. Outstanding flying, Water-1." }] },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return CAMPAIGN.find((m) => m.id === id);
}
