import type { MissionDef } from '../../missions/types';

/**
 * The 8-mission solo campaign (pure SCENARIO data — no physics/visual tuning, no Three.js).
 * `Game` resolves each def's placement specs against the seeded `World`, hands it to a
 * `MissionRuntime` (objectives/fails) AND a `MissionDirector` (the reactive `script` — the briefing,
 * live radio comms, and world beats that make each mission talk + react). The arc teaches one idea at a
 * time — fight → ferry → defend → backburn → rescue-under-fire → scale-up → mop-up → finale — and ramps
 * from a calm checkout flight to a re-flaring Class-F monster under a screaming, shifting wind. Two
 * missions make a real wildland tactic the SUBJECT, not a gotcha: BACKBURN (the helitorch / `torch`
 * loadout — you can't out-bomb the head, so you lay a control-line backfire to STARVE it), and AFTER
 * BURN (mop-up — a fire isn't out when the flames drop, only when the last holdover is drowned; it also
 * introduces the fuel/range model right before the finale leans on it).
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
export const SASKATCHEWAN_MISSIONS: MissionDef[] = [
  // ── 1 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'first-light',
    index: 0,
    name: 'First Light',
    brief: 'Your first flight out of Weyakwin. Fill from the lake and knock down the ground fire creeping at the cabins. Calm air — learn the aircraft.',
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
    name: 'Low Hover Drill',
    brief: 'Precision low-hover certification. Fly to five marked clearings on land and hold a steady hover three feet off the ground for twelve seconds at each — skids off the dirt, NOT touching, NOT climbing.',
    tagline: 'Three feet off the ground. Don\'t touch. Five clearings.',
    intel:
      "No bucket today, Water-1 — fundamentals. A precision low hover is the hardest thing you can do with this aircraft: you're three feet from the rotor wash hitting dirt, ground effect pushing back, every control input amplified. We've marked five clearings across the sector — La Ronge first, then the four corners: Buffalo Narrows, Southend, Denare Beach, Cypress Hills. Fly to each, descend to three feet, and HOLD it for twelve seconds. Don't touch the ground. Don't drift. Don't climb. When the timer clears, move on.",
    difficulty: 1,
    seed: 987,
    map: 'saskatchewan',
    homeBase: 'la-ronge',
    timeOfDay: 'day',
    wind: { strengthScale: 0.3 }, // light air — fair test without punishing drift
    payload: 'crew', // activates CrewTransport for the low-hover zone mechanic (no actual crew/bucket)
    // LOW HOVER DRILL: five clearings on land, each requiring a 12-second steady 3-ft hover.
    // All zones are `lowHover:true` — no load/carry cycle, just fly to each spot, descend, and hold.
    // The land-guarantee in resolveCrewZone snaps any water-adjacent point to nearby dry ground.
    fires: [],
    structures: { depot: true },
    zones: [
      { role: 'unload', single: true, lowHover: true, at: 'nearCommunity', community: 'la-ronge',      offset: 65, bearingDeg: 45,  label: 'La Ronge Clearing' },
      { role: 'unload', single: true, lowHover: true, at: 'nearCommunity', community: 'buffalo-narrows', offset: 65, bearingDeg: 135, label: 'Buffalo Narrows Clearing' },
      { role: 'unload', single: true, lowHover: true, at: 'nearCommunity', community: 'southend',      offset: 65, bearingDeg: 225, label: 'Southend Clearing' },
      { role: 'unload', single: true, lowHover: true, at: 'nearCommunity', community: 'denare-beach',  offset: 65, bearingDeg: 315, label: 'Denare Beach Clearing' },
      { role: 'unload', single: true, lowHover: true, at: 'nearCommunity', community: 'cypress-hills', offset: 65, bearingDeg: 90,  label: 'Cypress Hills Clearing' },
    ],
    objectives: [{ kind: 'deliver', n: 5, label: 'Complete all five low-hover drills' }],
    fails: [],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, low-hover certification today. Fly to each marked clearing, descend to three feet, and hold it for twelve seconds without touching. La Ronge first — the four corners after." }] },
      { id: 'leg1', trigger: { at: 'crewDelivered', n: 1 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Twelve seconds clean — good hold. Northwest to Buffalo Narrows next." }] },
      { id: 'leg2', trigger: { at: 'crewDelivered', n: 2 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Buffalo Narrows. Across the top to Southend in the northeast." }] },
      { id: 'leg3', trigger: { at: 'crewDelivered', n: 3 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Southend. Swing east to Denare Beach." }] },
      { id: 'leg4', trigger: { at: 'crewDelivered', n: 4 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "One left — the run southwest to Cypress Hills." }] },
      { id: 'won',  trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Five clean holds across the sector. That low hover will save a life, Water-1. Certified." }] },
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
    // Denare Beach sits on the eastern (Manitoba) border — only ~40u of land east of it — so the front is
    // authored on the INLAND (west) side as a cluster and runs east onto the lakeside town (real: fire in the
    // bush, town on the water). A full ring here would push a head off the province edge into the fogged void.
    fires: [{ at: 'cluster', anchor: { community: 'denare-beach' }, bearing: 3.4, distance: 55, spread: 45, count: 3, size: 'medium' }],
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
  // BACKBURN — the helitorch / aerial-ignition tactic. The campaign's one mission you canNOT win with
  // water: a wind-driven head is running on Missinipe too big and too fast to out-bomb. The only way to
  // stop it is to STARVE it — fly the torch loadout and lay a deliberate backfire along a control line
  // between the head and the town, burning the fuel out ahead of it so the wildfire arrives at black
  // ground and dies. Fly each control-line marker LOW with IGNITE held; the laid backfire scorches a
  // permanent break (spent fuel can't re-ignite). The objective is simply to lay the whole line before
  // the head reaches the homes — you win the instant the last segment catches. The gate that proves it:
  // a no-op run never lays the line, the head runs into town, and `protect` trips → lost; the pilot who
  // walks the line in time wins. Fighting fire WITH fire — the tactic every wildland crew respects.
  {
    id: 'backburn',
    index: 3,
    name: 'Backburn',
    brief: "You can't out-bomb this head — it's too big, running downwind on Missinipe. Stop it with fire: fly the torch and lay a backburn along the control line, starving the wildfire before it reaches the homes. Fly the markers low, IGNITE held.",
    tagline: 'Fight fire with fire. Lay a backburn and starve the head before it reaches town.',
    intel:
      "Water won't hold this one, Water-1 — the head's too big and the wind's behind it, driving it onto Missinipe. So we starve it. You're rigged with the helitorch today: fly the marked control line between the fire and the town and lay a backburn — a deliberate fire that burns the fuel out ahead of the wildfire. When the head arrives, it hits your black and lies down with nothing left to eat. Fly each marker LOW with IGNITE held to light it; walk the whole line before the head gets there. This is the tactic the ground crews respect most — fire against fire. Don't leave a gap.",
    difficulty: 3,
    seed: 89,
    map: 'saskatchewan',
    homeBase: 'missinipe',
    timeOfDay: 'dusk', // a classic evening burn — the air lies down and the ember line glows orange
    // Fixed wind angle so the head + the (upwind) control-line geometry are deterministic every run.
    wind: { angle: 0.8, strengthScale: 1.1 },
    fire: { spreadScale: 1.15 }, // a genuine running head bearing onto the homes — you can't douse it, only starve it
    payload: 'torch', // the helitorch rig — no scoop/drop; DROP becomes IGNITE (single loadout, no swap)
    // The HEAD: a wide Class-F front close on Missinipe's upwind flank — left alone it overruns the homes
    // (a no-op run loses); you can't douse it, only starve it. This is a last-line-of-defence backburn.
    fires: [{ at: 'line', community: 'missinipe', offset: 95, length: 150, size: 'mega' }],
    structures: { depot: true, groups: [{ community: 'missinipe', cabins: 5 }] },
    // The control line: 5 segments to torch, ~50u upwind of the town — between it and the head, the
    // defensible line where you lay the backfire so the head meets black before it meets the homes.
    controlLine: { community: 'missinipe', offset: 50, length: 150, points: 5 },
    objectives: [{ kind: 'backburn', n: 5, label: 'Lay the backburn line (5 segments)' }],
    fails: [{ kind: 'protect', min: 4, label: 'Keep the head off Missinipe' }],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, you can't out-bomb this one — she's too big and the wind's behind her. We starve her instead. You're on the helitorch: fly the control line and lay a backburn. Light each marker low, IGNITE held. Walk the whole line before she gets there." }] },
      { id: 'catching', trigger: { at: 'time', seconds: 30 }, actions: [{ do: 'comms', speaker: 'crew', text: "Your line's catching — the backfire's drawing toward the head, just like it should. Keep walking it, don't leave a gap." }] },
      // Threat-gated: only if the head is actually testing the town's flank (a fast, clean lay never hears it).
      { id: 'testing', trigger: { at: 'threat', min: 0.5 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "The head's at your line — if there's a gap she'll punch through. Close it, NOW!" }] },
      { id: 'drawing', trigger: { at: 'time', seconds: 60 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Wind's steady on the line and she's drawing your backfire in. Hold your nerve and finish the burn." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "The head ran straight into your black and lay down — nothing left to burn. You stopped a wildfire with fire, Water-1. That's the one the crews tell stories about." }] },
    ],
  },
  // ── 5 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'doorstep',
    index: 4,
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
  // ── 6 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'three-towns',
    index: 5,
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
  // ── 7 ─────────────────────────────────────────────────────────────────────────────────────────
  // AFTER BURN — the morning-after MOP-UP (a deliberate breather before the finale, and the fuel/range
  // model's first appearance — right before the finale leans on it). The campaign's defining truth made
  // explicit: a fire is NOT out when the flames die down. A front has passed over Denare Beach and left a
  // smoking black; the work now is mop-up — grid the burn scar, find every smouldering hotspot, and drown
  // it before a hidden holdover re-flares out of the duff and runs again. Calm air, smoke-choked overcast
  // light, a finite tank. The re-flare beats wake "sleeper" fires on YOUR progress, so the count is never
  // fixed — you patrol, you don't clear a list. The gate that proves it: hotspots sit close enough to town
  // that an IGNORED one re-establishes and runs at the cabins → a no-op run trips `protect` and loses,
  // while the diligent pilot drowns them all and wins. The mop-up truth, encoded.
  {
    id: 'after-burn',
    index: 6,
    name: 'After Burn',
    brief: 'The front has passed Denare Beach — now the long work. Grid the black for smouldering hotspots and drown every one before a holdover re-flares out of the duff and runs again. Finite fuel: patrol smart, refuel at base.',
    tagline: "The fire isn't out when the flames die. Mop up the black before it wakes.",
    intel:
      'You held the line at Denare Beach, Water-1 — but a fire is never out when the flames die down. The front has passed and left a smoking black, and somewhere in it root systems and stumps are still burning underground. Those are holdovers: leave one and the noon wind will fan it back into a running fire on the town. Grid the burn scar, find every hotspot, and drown it cold. Use the valve to split a load across several spots — you don’t need a full dump on a smouldering stump. Watch your fuel and refuel at base; mop-up is a long patrol. Don’t call it out until every last one is dead.',
    difficulty: 3,
    seed: 144,
    map: 'saskatchewan',
    homeBase: 'denare-beach',
    timeOfDay: 'overcast', // smoke-choked morning-after — grey, low light over the black
    wind: { strengthScale: 0.4 }, // calm now — but a beat lifts it as the day heats up
    fire: { spreadScale: 0.5 }, // hotspots SMOULDER, not run — but an ignored one re-establishes onto town
    bucket: 'valve', // precise, splittable dabs — the mop-up tool
    payload: 'water',
    fuel: true, // first taste of the range model: mop-up is a long, fuel-hungry patrol
    fires: [
      // The burn scar: a patch of smouldering hotspots in the black, biased INLAND (Denare Beach hugs the
      // eastern border — ~40u of land east of it) with a scoop source (Amisk Lake) on hand. bearing≈195° (WSW)
      // keeps the whole complex on real province land; an unbiased (due-east) cluster would smoulder in the void.
      { at: 'cluster', anchor: { community: 'denare-beach' }, bearing: 3.4, distance: 75, spread: 70, count: 5, size: 'small' },
      // Two hotspots closer to the cabins — the dangerous ones that re-establish onto town if ignored (inland-biased).
      { at: 'cluster', anchor: { community: 'denare-beach' }, bearing: 2.7, distance: 45, spread: 30, count: 2, size: 'small' },
    ],
    structures: { depot: true, groups: [{ community: 'denare-beach', cabins: 5 }] },
    objectives: [{ kind: 'extinguishAll' }],
    fails: [
      { kind: 'protect', min: 4, label: 'Keep the black off Denare Beach' },
      { kind: 'fuelOut' },
    ],
    script: [
      { id: 'start', trigger: { at: 'start' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Water-1, the front's through Denare Beach — but she's not out. The black's full of hotspots smouldering in the duff. Grid it and drown every one before the wind comes up. Mind your fuel out there." }] },
      // Sleeper #1 wakes once you've put a couple down — the re-flare truth, made the whole job.
      { id: 'sleeper1', trigger: { at: 'firesDoused', n: 2 }, actions: [{ do: 'ignite', place: { at: 'cluster', anchor: { community: 'denare-beach' }, bearing: 1.6, distance: 130, spread: 60, count: 1, size: 'small' } }, { do: 'comms', speaker: 'crew', text: 'Smoke just came up on the east edge — a stump woke back up. They hide for hours, this is the job.' }] },
      // Encouragement — the methodical grind is working.
      { id: 'gridding', trigger: { at: 'firesDoused', n: 4 }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Good grid, Water-1 — you're walking it cold. Keep working the black." }] },
      // Sleeper #2: a holdover carried under the line by a root system — closer to town, more urgent.
      { id: 'sleeper2', trigger: { at: 'firesDoused', n: 5 }, actions: [{ do: 'ignite', place: { at: 'nearCommunity', community: 'denare-beach', offset: 55, size: 'small', count: 2 } }, { do: 'comms', speaker: 'warning', urgency: 'warn', text: 'Holdover by the cabins — root fire carried it back under the line. Get on it before it re-establishes.' }] },
      // Threat-gated: only if a hotspot is actually re-establishing toward a home (a sharp pilot never hears it).
      { id: 'reflare', trigger: { at: 'threat', min: 0.45 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'alert', text: "One's coming back up at the treeline — don't let her re-take that ground!" }] },
      // The noon wind: the classic mop-up race — finish the black before the day heats up and fans the holdovers.
      { id: 'noon-wind', trigger: { at: 'time', seconds: 120 }, actions: [{ do: 'wind', strengthScale: 0.9, ease: 8 }, { do: 'comms', speaker: 'dispatch', text: "Wind's lifting as the day heats up — that's what wakes the sleepers. Last hotspots now, Water-1." }] },
      { id: 'fuel', trigger: { at: 'fuelBelow', frac: 0.25 }, actions: [{ do: 'comms', speaker: 'warning', urgency: 'warn', text: "Fuel's getting low — top up at base, then back on the patrol. Don't strand yourself out in the black." }] },
      { id: 'won', trigger: { at: 'won' }, actions: [{ do: 'comms', speaker: 'dispatch', text: "Every hotspot cold — she's declared out, Water-1. That's how fires are really won: not when the flames drop, but when the last ember dies. Textbook mop-up." }] },
    ],
  },
  // ── 8 ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'everything-at-once',
    index: 7,
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
