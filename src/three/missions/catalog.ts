import type { MissionDef } from './types';

/**
 * The 6-mission solo campaign (pure SCENARIO data — no physics/visual tuning, no Three.js).
 * `Game` resolves each def's placement specs against the seeded `World`, hands it to a
 * `MissionRuntime` (objectives/fails) AND a `MissionDirector` (the reactive `script` — the briefing,
 * live radio comms, and world beats that make each mission talk + react). The arc teaches one idea at
 * a time — fight → ferry → defend → rescue-under-fire → scale-up → finale — and ramps from a calm
 * checkout flight to a re-flaring Class-F monster under a screaming, shifting wind.
 *
 * SETTING: northern Saskatchewan. Each mission flies out of a real place — Weyakwin, Missinipe,
 * Denare Beach, Stanley Mission, the Île-à-la-Crosse chain, and La Ronge (the finale) — and `places`
 * PINS those names onto the world (see World.PlacePins) so the briefing and the radar agree. Ambient lakes /
 * towns / highways draw from the `saskatchewan` region pool (`world/regions.ts`); `map` selects it. The
 * mission-select menu groups missions BY `map`, so this whole campaign lives under the Saskatchewan map.
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
    brief: 'Your first flight out of Weyakwin. Scoop from the lake and knock down the ground fire creeping at the cabins. Calm air — learn the aircraft.',
    tagline: 'Dawn over Weyakwin. Learn to fly, and save the cabins.',
    intel:
      'Welcome aboard, Water-1. Bring the rotors up and ease her off the deck. A slow ground fire is working out of the bush toward the cabins at Weyakwin, on the lake’s south shore. Fly low over open water to fill the bucket, then pour it on the flames. Winds are light — a good morning to get the feel of her. Remember: a fire only dies when you put water on it.',
    difficulty: 1,
    seed: 34,
    map: 'saskatchewan',
    homeBase: 'la-ronge',
    timeOfDay: 'dawn',
    wind: { strengthScale: 0.5 },
    fire: { spreadScale: 0.45 }, // barely creeps — the calm-air teaching mission, but not frozen
    bucket: 'bambi',
    fires: [{ at: 'nearCommunity', community: 'weyakwin', offset: 64, size: 'small', count: 3 }],
    structures: { depot: true, groups: [{ community: 'weyakwin', cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend Weyakwin' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, Dispatch — rotors are up, you're cleared to lift. Three spots creeping at the Weyakwin cabins. Fill from the lake and knock them down — take your time." }] },
      // The surprise: the fire fights back the instant you relax — teaches the re-flare truth.
      { id: 'reflare', trigger: { at: 'firesDoused', n: 1 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'weyakwin', offset: 58, size: 'small' } }, { do: 'comms', speaker: 'crew', text: 'It jumped the line — one more lick by the cabins. Get back on it.' }] },
      // Encouragement: a quiet "you've got this" once the second spot is down.
      { id: 'good-start', trigger: { at: 'firesDoused', n: 2 }, actions: [{ do: 'comms', speaker: 'crew', text: "That's the way, Water-1 — clean drop. Keep filling and hitting them." }] },
      { id: 'treeline', trigger: { at: 'threat', min: 0.45 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fire's into the treeline by Weyakwin — mind those cabins." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'All out, cabins standing. Textbook, Water-1. Weyakwin owes you a coffee.' }] },
    ],
  },
  // ── 2 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'hover-training',
    index: 1,
    name: 'Hover Training',
    brief: 'Hover-drop certification across the sector. Board a crew at each base, then HOLD A STEADY HOVER over the marked drop zone for five seconds before setting them down. Five bases — the central hub and one in each corner of the map.',
    tagline: 'Hold a five-second hover at five bases — centre, then every corner.',
    intel:
      "No fire today, Water-1 — hover certification. At each base, set down and board a crew, then lift into a clean HOVER over the marked drop area and HOLD it steady for five seconds before you put them down. Start at the hub, La Ronge, then work the four corners of the sector: Buffalo Narrows in the northwest, Southend in the northeast, Denare Beach out east, and Cypress Hills down in the southwest hill country. Smooth and stable — a good hover is the whole job.",
    difficulty: 1,
    seed: 987,
    map: 'saskatchewan',
    homeBase: 'la-ronge',
    timeOfDay: 'day',
    wind: { strengthScale: 0.4 }, // light air — a fair hover test
    bucket: 'bambi',
    payload: 'crew', // pure crew, one at a time — no bucket work
    // HOVER-TRAINING tour: at each of 5 bases (centre + 4 corners) board a crew (land), then HOLD A HOVER over the
    // marked drop zone for MISSIONS.hoverSec (the `hover:true` flag on the unload). Single zones light ONE AT A TIME
    // in array order, so it's a guided drill: board → hover-drop → on to the next base. No fire, no fail — pure feel.
    fires: [],
    structures: { depot: true },
    zones: [
      { role: 'load', single: true, at: 'nearCommunity', community: 'la-ronge', label: 'La Ronge — board crew' },
      { role: 'unload', single: true, hover: true, at: 'nearCommunity', community: 'la-ronge', offset: 75, bearingDeg: 45, label: 'Hover drop — La Ronge' },
      { role: 'load', single: true, at: 'nearCommunity', community: 'buffalo-narrows', label: 'Buffalo Narrows — board crew' },
      { role: 'unload', single: true, hover: true, at: 'nearCommunity', community: 'buffalo-narrows', offset: 75, bearingDeg: 135, label: 'Hover drop — Buffalo Narrows' },
      { role: 'load', single: true, at: 'nearCommunity', community: 'southend', label: 'Southend — board crew' },
      { role: 'unload', single: true, hover: true, at: 'nearCommunity', community: 'southend', offset: 75, bearingDeg: 225, label: 'Hover drop — Southend' },
      { role: 'load', single: true, at: 'nearCommunity', community: 'denare-beach', label: 'Denare Beach — board crew' },
      { role: 'unload', single: true, hover: true, at: 'nearCommunity', community: 'denare-beach', offset: 75, bearingDeg: 315, label: 'Hover drop — Denare Beach' },
      { role: 'load', single: true, at: 'nearCommunity', community: 'cypress-hills', label: 'Cypress Hills — board crew' },
      { role: 'unload', single: true, hover: true, at: 'nearCommunity', community: 'cypress-hills', offset: 75, bearingDeg: 90, label: 'Hover drop — Cypress Hills' },
    ],
    objectives: [{ kind: 'deliver', n: 5, label: 'Complete the hover drops (5 bases)' }],
    fails: [],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Water-1, hover certification today. Board a crew at each base, then hold a steady five-second hover over the drop zone before you set them down. Start here at La Ronge, then the four corners.' }] },
      { id: 'leg1', trigger: { at: 'crewDelivered', n: 1 }, actions: [{ do: 'comms', speaker: 'crew', text: 'Clean hover — nicely held. Northwest to Buffalo Narrows next.' }] },
      { id: 'leg2', trigger: { at: 'crewDelivered', n: 2 }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Buffalo Narrows signed off. Across the top to Southend in the northeast.' }] },
      { id: 'leg3', trigger: { at: 'crewDelivered', n: 3 }, actions: [{ do: 'comms', speaker: 'crew', text: 'Southend done. Swing east to Denare Beach on the lake.' }] },
      { id: 'leg4', trigger: { at: 'crewDelivered', n: 4 }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'One left — the long run southwest to Cypress Hills, down in the hill country.' }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Five clean hovers, every corner of the sector flown. Certified, Water-1 — that hover will save lives.' }] },
    ],
  },
  // ── 3 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'hold-the-line',
    index: 2,
    name: 'Hold the Line',
    brief: 'Heavy wind, extreme risk. Ground crews are 3 minutes out — keep this fire off Denare Beach until they arrive. Your valve bucket splits a load across passes.',
    tagline: 'Screaming wind. Hold the front off Denare Beach till the crews land.',
    intel:
      'Ground crews are three minutes out. Until they land, you are the only thing between an advancing front and the town of Denare Beach, on the shore of Amisk Lake. Hold the line — the wind is screaming and the fire keeps flanking you, so triage which head threatens a home and split your valve load across passes. You cannot win by clearing it; you win by ENDURING until the crews are down.',
    difficulty: 3,
    seed: 233,
    map: 'saskatchewan',
    homeBase: 'denare-beach',
    timeOfDay: 'day',
    wind: { strengthScale: 1.3 },
    fire: { spreadScale: 0.95 }, // the front genuinely advances on the town
    bucket: 'valve',
    fires: [{ at: 'nearCommunity', community: 'denare-beach', offset: 70, size: 'medium', count: 3 }],
    structures: { depot: true, groups: [{ community: 'denare-beach', cabins: 6 }] },
    objectives: [{ kind: 'survive', seconds: 180, label: 'Hold for 3:00' }],
    fails: [{ kind: 'protect', min: 4, label: 'Defend Denare Beach' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, crews are 3 minutes out. Keep the fire off Denare Beach until they're on the ground. It's blowing hard — hold the line." }] },
      { id: 'flank1', trigger: { at: 'time', seconds: 50 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'denare-beach', offset: 55, size: 'small' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: 'Flare-up on the north flank — get on it before it runs.' }] },
      // Encouragement at the halfway mark — the grind is working, crews are closing.
      { id: 'holding', trigger: { at: 'time', seconds: 90 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "You're holding her, Water-1. Halfway there — crews are closing." }] },
      { id: 'flank2', trigger: { at: 'time', seconds: 120 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'denare-beach', offset: 60, size: 'small', count: 2 } }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "She's pushing hard on the south side — don't let her reach the homes!" }] },
      // Threat-gated: only fires if the town is actually in danger, so a strong pilot may never hear it.
      { id: 'fence', trigger: { at: 'threat', min: 0.6 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "Fire's at the fenceline — push it back NOW!" }] },
      { id: 'inbound', trigger: { at: 'time', seconds: 150 }, actions: [{ do: 'comms', speaker: 'dispatch', text: 'Crews inbound — thirty seconds. Hold what you have.' }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Crews are on the ground — they've got it. You held the line, Water-1." }] },
    ],
  },
  // ── 4 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'doorstep',
    index: 3,
    name: 'Doorstep',
    brief: 'The fire is at the doorsteps of Stanley Mission. Fight the heads near town — and when families are cut off, re-rig to the sling and pull them out while ember spot-fires light behind you.',
    tagline: "Fire at Stanley Mission's doors. Beat it back, lift the families clear.",
    intel:
      'The fire is at the doorsteps of Stanley Mission and Missinipe. Open on the heads near the homes with the bucket and keep them off the cabins. Dispatch is hearing of families getting cut off as the front passes — when that call comes, set down at base, re-rig to the crew sling, and pull them out before the flames reach the last door. Embers are throwing spot fires behind you, and the heavy wind should ease as the front goes through.',
    difficulty: 4,
    seed: 55,
    map: 'saskatchewan',
    homeBase: 'la-ronge',
    timeOfDay: 'dusk',
    wind: { strengthScale: 1.3 }, // heavy, eased to moderate by a beat as the front passes
    fire: { spreadScale: 1.0 },
    bucket: 'valve',
    payload: 'water', // open with the bucket; re-rig to the sling for the rescues
    loadouts: ['water', 'crew'],
    fires: [
      { at: 'nearCommunity', community: 'stanley-mission', offset: 70, size: 'medium', count: 3 },
      { at: 'nearCommunity', community: 'missinipe', offset: 70, size: 'medium', count: 3 },
    ],
    structures: {
      depot: true,
      groups: [
        { community: 'stanley-mission', cabins: 3 },
        { community: 'missinipe', cabins: 3 },
      ],
    },
    // Crew-CAPABLE from the start (the reusable base drop-off) so the pop-up rescue can appear.
    zones: [{ role: 'unload', single: false, at: 'depot', label: 'Base' }],
    objectives: [{ kind: 'extinguishCount', n: 8, label: 'Kill the fires at the doorsteps' }],
    fails: [
      { kind: 'protect', min: 4, label: 'Beat the fire to the doors' },
      { kind: 'rescue', label: 'Get the cut-off families out' }, // lose one to the fire = mission failed
    ],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, the fire's on the doorsteps at Stanley Mission. Work the heads by the cabins — and stand by, we may need you to pull people out." }] },
      // The pop-up RESCUE: three families cut off — a new evacuate goal + their cabins appear. Gated on
      // firesDoused (NOT a clock) so it fires while fires still burn → the win waits on it.
      {
        id: 'cut-off',
        trigger: { at: 'firesDoused', n: 3 },
        actions: [
          { do: 'comms', speaker: 'warning', urgency: 'alert', text: 'Three families are cut off as the front passes! Re-rig to the sling at base and get them out — fast.' },
          { do: 'addObjective', objective: { kind: 'evacuate', n: 3, label: 'Evacuate the cut-off families' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 'stanley-mission', label: 'Family 1' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 'missinipe', label: 'Family 2' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 'stanley-mission', offset: 110, bearingDeg: 60, label: 'Family 3' } },
        ],
      },
      // Ember spot-fires light behind you while you ferry — routing pressure, and they feed the count.
      { id: 'embers', trigger: { at: 'firesDoused', n: 5 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'stanley-mission', offset: 50, size: 'small', count: 2 } }, { do: 'comms', speaker: 'crew', text: 'Embers just lit the brush behind you — spot fires by the cabins.' }] },
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
    brief: 'Two fires near Beauval and Île-à-la-Crosse grow toward each other, MERGE, and the joined front runs at Buffalo Narrows. Triage all three — and pull out two families that get cut off.',
    tagline: 'Two fronts merge into one monster, running at Buffalo Narrows.',
    intel:
      'Two separate fires, two towns — Beauval and Île-à-la-Crosse — and a strong, steady wind carrying them toward each other. They will MERGE into one front, and that front is pointed straight at Buffalo Narrows downwind. You cannot be everywhere: triage the two original heads, then chase the merged monster off Buffalo Narrows. When families get cut off mid-fight, re-rig to the sling and bring them out. This is the widest fight yet.',
    difficulty: 4,
    seed: 377,
    map: 'saskatchewan',
    homeBase: 'buffalo-narrows',
    timeOfDay: 'golden',
    // Fixed wind angle so the two fronts converge the same way every run (deterministic merge geometry).
    wind: { angle: -0.6, strengthScale: 1.4 },
    fire: { spreadScale: 1.05 },
    bucket: 'valve',
    payload: 'water',
    loadouts: ['water', 'crew'],
    fires: [
      { at: 'nearCommunity', community: 'beauval', offset: 66, size: 'medium', count: 2 },
      { at: 'nearCommunity', community: 'ile-a-la-crosse', offset: 66, size: 'medium', count: 2 },
    ],
    structures: {
      depot: true,
      groups: [
        { community: 'beauval', cabins: 3 },
        { community: 'ile-a-la-crosse', cabins: 3 },
        { community: 'buffalo-narrows', cabins: 3 },
      ],
    },
    zones: [{ role: 'unload', single: false, at: 'depot', label: 'Base' }],
    objectives: [{ kind: 'extinguishAll' }],
    fails: [
      { kind: 'protect', min: 6, label: 'Hold all three towns' },
      { kind: 'rescue', label: 'Get the trapped families out' },
    ],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, two fronts and a wind that's joining them up. Triage Beauval and Île-à-la-Crosse — and watch Buffalo Narrows downwind." }] },
      // Threat-gated reinforcement: only once the merged head actually endangers town three.
      { id: 'merge', trigger: { at: 'threat', min: 0.55 }, actions: [{ do: 'ignite', place: { at: 'line', community: 'buffalo-narrows', offset: 85, length: 90, size: 'medium' } }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "The two fires have joined — one front now, and it's running straight at Buffalo Narrows." }] },
      // Two families cut off, popping up mid-fight (gated on progress, not a clock).
      {
        id: 'families',
        trigger: { at: 'firesDoused', n: 4 },
        actions: [
          { do: 'comms', speaker: 'warning', urgency: 'alert', text: 'Two families are trapped between the fronts! Re-rig and pull them out when you can.' },
          { do: 'addObjective', objective: { kind: 'evacuate', n: 2, label: 'Rescue the trapped families' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 'beauval', label: 'Family 1' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 'buffalo-narrows', label: 'Family 2' } },
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
    brief: 'The finale. A Class-F head on La Ronge, the depot itself threatened, a re-flaring monster, a finite tank — and a family to pull out. Everything you have learned, at once.',
    tagline: 'The finale. A firestorm on La Ronge, the depot burning, the tank near dry.',
    intel:
      'This is the big one, Water-1. A Class-F head is sitting on La Ronge and reaching for the depot — the air-attack base is your only fuel and water for the whole sector. It re-flares out of the duff pass after pass under a screaming, shifting wind. Manage your tank, defend the depot, walk the monster down — and when a family gets trapped, re-rig and bring them out. Lose a single structure or run the tank dry and the run is over. Bring it home.',
    difficulty: 5,
    seed: 1597,
    map: 'saskatchewan',
    homeBase: 'la-ronge',
    timeOfDay: 'golden',
    wind: { angle: -1.2, strengthScale: 1.5 }, // fixed start; a gust + a shift turn it onto the depot
    fire: { spreadScale: 1.3 }, // the campaign's fastest spread
    bucket: 'valve',
    fuel: true,
    payload: 'water',
    loadouts: ['water', 'crew'],
    fires: [
      { at: 'nearCommunity', community: 'la-ronge', offset: 80, size: 'mega' },
      { at: 'cluster', anchor: { community: 'la-ronge' }, bearing: 2.2, distance: 220, size: 'large', count: 1 },
    ],
    structures: { depot: true, groups: [{ community: 'la-ronge', cabins: 5 }] },
    zones: [{ role: 'unload', single: false, at: 'depot', label: 'Base' }],
    objectives: [{ kind: 'extinguishAll' }],
    fails: [
      { kind: 'protect', all: true, label: 'Save the depot and La Ronge' },
      { kind: 'fuelOut' },
      { kind: 'rescue', label: 'Get the trapped family out' },
    ],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, conditions are extreme. A monster on La Ronge reaching for the depot, wind gusting and shifting, finite fuel. Everything you've got — good luck out there." }] },
      { id: 'gust', trigger: { at: 'time', seconds: 60 }, actions: [{ do: 'wind', strengthScale: 2.2, ease: 5 }, { do: 'comms', speaker: 'warning', urgency: 'alert', text: "Wind's gusting hard — she's running. Stay ahead of her!" }] },
      // Re-flares scale with YOUR progress — the fire fights hardest as you near victory.
      { id: 'reflare1', trigger: { at: 'firesDoused', n: 8 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'la-ronge', offset: 60, size: 'medium' } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "She's back up out of the peat by the town — get on it!" }] },
      // The pop-up rescue: a family trapped, mid-firestorm.
      {
        id: 'trapped',
        trigger: { at: 'firesDoused', n: 10 },
        actions: [
          { do: 'comms', speaker: 'warning', urgency: 'alert', text: 'A family is trapped at the edge of La Ronge! Re-rig and get them out — now.' },
          { do: 'addObjective', objective: { kind: 'evacuate', n: 1, label: 'Evacuate the trapped family' } },
          { do: 'addZone', zone: { role: 'load', single: true, at: 'nearCommunity', community: 'la-ronge', label: 'Trapped family' } },
        ],
      },
      // Encouragement at the turning point — she's coming down, but the depot fight is still ahead.
      { id: 'closing', trigger: { at: 'firesDoused', n: 15 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "She's coming down — you're winning this, Water-1. Stay on her." }] },
      // The wind shift turns the head onto the depot — threat-gated alert if you let it reach the fence.
      { id: 'shift', trigger: { at: 'time', seconds: 140 }, actions: [{ do: 'wind', angle: 0.3, ease: 6 }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: "Wind's backing — she's turning onto the depot. Get between her and the pumps." }] },
      { id: 'depot', trigger: { at: 'threat', min: 0.6 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "Fire's on the depot fence — that's your only fuel. Push it back!" }] },
      // The fire keeps creeping out of the duff (ignite only — the earlier re-flare line already said it).
      { id: 'reflare2', trigger: { at: 'firesDoused', n: 20 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'la-ronge', offset: 70, size: 'small', count: 2 } }] },
      { id: 'fuel', trigger: { at: 'fuelBelow', frac: 0.25 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fuel's low, Water-1 — make your passes count and mind the run home." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "It's out. All of it. Depot intact, La Ronge standing, family safe — through a firestorm, solo. Outstanding flying, Water-1. That's the campaign." }] },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return CAMPAIGN.find((m) => m.id === id);
}
