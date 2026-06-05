/**
 * Mission framework types — the data contract for the campaign layer.
 *
 * A `MissionDef` is pure SCENARIO data: which seeded world to build, where the fires /
 * crews / structures sit, and the win/lose rules. It carries NO physics or visual tuning
 * (that stays in `config.ts`) and NO Three.js — `Game` reads a def, resolves its placement
 * specs against the seeded `World`, and feeds a per-frame `MissionSignals` snapshot to
 * `MissionRuntime`, which decides the outcome. This mirrors how the sims stay engine-agnostic.
 *
 * Placement specs are RELATIVE to the generated world's named features (`nearCommunity`,
 * `depot`) so a mission reads like a briefing ("fire near the hamlet, crews to the base")
 * and stays correct whatever the seed grows.
 */

/** Fire size class → ignition disc radius + starting heat (resolved in Game.igniteAt). */
export type SizeClass = 'spot' | 'small' | 'medium' | 'large' | 'mega';

/**
 * A reference to a placed site, resolved by `World.getCommunity` (see scenario.ts). One of:
 *   • a `number` — index into the map's ambient/anchored TOWN sites (legacy index form),
 *   • `'base'` — the mission's HOME base/depot,
 *   • a `string` MapAnchor id ('la-ronge', 'weyakwin', …) — an authored anchored place (regions.ts).
 * The `(string & {})` keeps `'base'` a distinct literal in autocomplete while accepting any anchor id.
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- `string & {}` is the intentional "keep-literal-autocomplete" idiom documented above, not an accidental empty-object type
export type CommunityRef = number | 'base' | (string & {});

/**
 * Time-of-day atmosphere a mission flies under (the sky/sun/fog mood). A pure string key — the
 * actual colour/sun-direction preset lives in `sky/TimeOfDay.ts` (`SKY_PRESETS`), keeping this
 * data contract engine-free. Omit → the campaign's default golden hour. Not every mission is
 * golden hour: a tutorial dawn, a harsh clear noon, a smoke-choked overcast, an ominous dusk.
 */
export type TimeOfDay = 'dawn' | 'day' | 'noon' | 'overcast' | 'golden' | 'dusk';

/**
 * Where a mission seeds a fire (or a cluster of `count` fires).
 *
 * SCALE-INVARIANT AUTHORING (Slice 1b): distances may be given in real KILOMETRES (`offsetKm`,
 * `distanceKm`, `spreadKm`, `lengthKm`) instead of raw world units — `scenario.ts` multiplies them by
 * `world.unitsPerKm`, so a km-authored placement lands at the same real-world distance on ANY map
 * size. A `point` may be given as a real `lat`/`lon` (projected through the world's geo frame). Raw
 * `x`/`z`/`offset`/… still work unchanged (the 8 campaign missions are byte-identical), and where both
 * are present the km/lat-lon form WINS.
 */
export type FirePlacement =
  | { at: 'point'; x?: number; z?: number; lat?: number; lon?: number; size: SizeClass }
  | { at: 'nearCommunity'; community: CommunityRef; offset?: number; offsetKm?: number; size: SizeClass; count?: number }
  | { at: 'random'; count: number; size: SizeClass; minFromOrigin?: number }
  // An AUTHORED fire COMPLEX: `count` heads bunched within `spread` around a deterministic anchor
  // (vs `random`, which scatters independent dots map-wide). The anchor is `origin` (map centre),
  // a `lake` (the complex is placed in the bush right beside the nearest lake → a scoop source on
  // hand), or a `community`. `bearing` (radians) + `distance` (units, or `distanceKm`) push the centre
  // off the anchor. Stays seed-robust: every head is snapped to dry fuel so the blaze always catches.
  | {
      at: 'cluster';
      anchor: 'origin' | 'lake' | { community: CommunityRef };
      bearing?: number;
      distance?: number;
      distanceKm?: number;
      spread?: number;
      spreadKm?: number;
      count?: number;
      size: SizeClass;
    }
  // A continuous fire FRONT: a row of seed discs along a line. `length` is its world-unit extent
  // (default ~90; or `lengthKm`); `angle` the axis in radians — omit to face the front downwind (axis
  // ⟂ wind) so it spreads toward you like a real ridge-line head. Center it either at explicit (x,z) or,
  // to stay seed-robust like the other specs, at a `community` — the line is then placed `offset`
  // units (or `offsetKm`) UPWIND of it so the head advances onto the settlement.
  | {
      at: 'line';
      size: SizeClass;
      length?: number;
      lengthKm?: number;
      angle?: number;
      x?: number;
      z?: number;
      community?: CommunityRef;
      offset?: number;
      offsetKm?: number;
    };

/** Which structures a mission places (explicit — not the sandbox auto-generation). */
export interface StructureSpec {
  depot?: boolean; // place the lakeside base/depot (the refuel + crew base point). Default true.
  groups?: { community: CommunityRef; cabins?: number }[]; // hamlets to populate with cabins
  extraCabins?: number; // lone bush cabins via World.placement.fireSite
}

/** A crew transport endpoint (land here to work it). `load` = pick up here; `unload` = drop off here. */
export type ZoneRole = 'load' | 'unload';
export interface ZonePlacement {
  role: ZoneRole;
  single: boolean; // single-use endpoint (counts toward crewsTotal) vs reusable (the base)
  at: 'point' | 'nearCommunity' | 'depot';
  x?: number;
  z?: number;
  lat?: number; // a `point` zone may be given as real lat/lon (projected through the world geo frame); wins over x/z
  lon?: number;
  community?: CommunityRef;
  offset?: number; // push the pad this many units off the community along `bearingDeg` (flank an LZ without a new anchor)
  offsetKm?: number; // same flank offset in real KILOMETRES (× world.unitsPerKm) — scale-invariant; wins over `offset`
  bearingDeg?: number; // compass bearing of that offset (0 = N, 90 = E); omit → 0 (due north)
  hover?: boolean; // deliver by HOLDING A HOVER over the spot for MISSIONS.hoverSec (vs landing) — hover-training drops
  lowHover?: boolean; // PRECISION LOW HOVER: hold near-ground AGL (0..lowHoverAglMax) for MISSIONS.lowHoverSec. No crew needed.
  label?: string; // shown on the zone marker / HUD ("LZ Alpha", "Cabin 2")
}

/** Win requirements — ALL must complete for a mission win. */
export type ObjectiveKind = 'extinguishAll' | 'extinguishCount' | 'deliver' | 'evacuate' | 'survive' | 'backburn';
export interface Objective {
  kind: ObjectiveKind;
  n?: number; // target count (extinguishCount / deliver / evacuate / backburn segments); defaults to crewsTotal for crews, the control line's length for backburn
  seconds?: number; // survive duration
  label?: string; // override the auto label
}

/**
 * A backburn CONTROL LINE: an ordered row of ignition points the pilot lights (torch loadout) to lay
 * a deliberate firebreak between an advancing head fire and a settlement. Resolved by `scenario.ts`
 * (`backburnLine`) against the seeded World. Like fire/zone placements it's RELATIVE to a named
 * feature so it stays seed-robust: the line is centred `offset` units from `community` toward the
 * head (UPWIND by default, or along `bearingDeg`), spans `length` units, and is sampled into `points`
 * evenly-spaced segments (each snapped to dry fuel so its backfire catches).
 */
export interface ControlLinePlacement {
  community: CommunityRef; // the settlement the line protects (its head-side flank)
  offset?: number; // distance from the community to the line centre (default ~110)
  offsetKm?: number; // same offset in real KILOMETRES (× world.unitsPerKm) — scale-invariant; wins over `offset`
  bearingDeg?: number; // compass bearing community→line centre (0 = N, 90 = E); omit → upwind (toward the head)
  length?: number; // the line's world-unit span (default ~140)
  lengthKm?: number; // same span in real KILOMETRES (× world.unitsPerKm) — scale-invariant; wins over `length`
  points?: number; // how many segments to light (default 5)
}

/** Loss conditions — ANY triggers a mission loss. */
export type FailKind = 'protect' | 'timeout' | 'fuelOut' | 'rescue';
export interface FailCondition {
  kind: FailKind;
  min?: number; // protect: minimum structures that must survive (default 1)
  all?: boolean; // protect: every structure must survive (min = total)
  seconds?: number; // timeout: lose if not won by this elapsed time
  n?: number; // rescue: how many trapped families may be lost before failing (default 0 — lose ANY = fail)
  label?: string;
}

// --- Reactive mission SCRIPT (the experience layer) ------------------------
// A mission is a FULL ARC: a briefing, escalating beats that react to play + the fire, narrated by
// radio comms, then a debrief. The script is authored DATA (catalog.ts) evaluated by the pure
// `MissionDirector` (numbers/POJOs, like MissionRuntime); only Game turns the resulting actions into
// Three/DOM/audio. Each beat fires its actions ONCE, the first frame its trigger becomes true.

/** Who is on the radio. Drives the comms-line colour + label (DISPATCH cyan / CREW amber / WARNING red). */
export type CommsSpeaker = 'dispatch' | 'crew' | 'warning' | 'pilot';

/** Comms urgency → the squelch tone + how insistently the line reads. */
export type CommsUrgency = 'info' | 'warn' | 'alert';

/**
 * When a beat fires. All conditions read the live `MissionSignals` (+ the runtime ledger for
 * objective/outcome triggers); a beat latches the first frame its condition holds.
 */
export type MissionTrigger =
  | { at: 'start' } // the mission begins (briefing line)
  | { at: 'time'; seconds: number } // mission-elapsed ≥ seconds
  | { at: 'firesDoused'; n: number } // cumulative fires water-killed ≥ n
  | { at: 'firesLeft'; n: number } // active fire clusters ≤ n (and the mission is underway)
  | { at: 'threat'; min: number } // a structure's danger gauge ≥ min (0..1)
  | { at: 'structureLost'; n?: number } // total structures destroyed ≥ n (default 1)
  | { at: 'crewDelivered'; n: number } // crews delivered ≥ n
  | { at: 'fuelBelow'; frac: number } // fuel fraction < frac
  | { at: 'objectiveDone'; id?: string } // a goal sub-task latched done (optional specific id)
  | { at: 'won' }
  | { at: 'lost' };

/** What a beat does. `comms` always; `ignite`/`wind`/`addObjective`/`addZone` are the world REACTIONS. */
export type MissionAction =
  | { do: 'comms'; speaker: CommsSpeaker; text: string; urgency?: CommsUrgency }
  // A flare-up / new spot fire / re-spread. Reuses the FirePlacement vocabulary + scenario resolution,
  // so a beat can ignite anything the opening fires can (a cluster downwind, a fire near a community…).
  | { do: 'ignite'; place: FirePlacement }
  // Shift the wind (the "wind-shift" beat): ease the heading toward `angle` and/or the gust strength
  // toward `strengthScale×` over `ease` seconds. Either is optional.
  | { do: 'wind'; angle?: number; strengthScale?: number; ease?: number }
  // Spawn a NEW goal mid-mission — a rescue/task that "pops up". The runtime appends it as a pending
  // sub-task, so the mission can't be WON until it's also met. Fire it on a trigger that holds WHILE
  // other goals are still pending (the runtime finalizes a win the frame all goals latch). Pair with
  // `addZone` so the new objective has somewhere to work.
  | { do: 'addObjective'; objective: Objective }
  // Reveal a NEW crew endpoint mid-mission (the pop-up rescue's cabin, or its drop-off). Appended to
  // the live CrewTransport; a single load/unload bumps the crew total + draws its marker. Requires the
  // mission to be crew-CAPABLE from the start (a `zones` base endpoint present) so the transport exists.
  | { do: 'addZone'; zone: ZonePlacement };

/** One authored beat: when it fires (once) and what it does. */
export interface MissionBeat {
  id: string; // stable per mission (for the latch + headless assertions)
  trigger: MissionTrigger;
  actions: MissionAction[];
}

export interface MissionDef {
  id: string;
  index: number; // campaign order (drives linear unlock)
  name: string;
  brief: string; // 1–2 line briefing shown in the start/briefing card (the in-game voice)
  tagline?: string; // ONE punchy line for the mission-select CARD (marketing voice); falls back to brief
  intel?: string; // longer pre-flight briefing paragraph (the briefing card body; falls back to brief)
  difficulty: 1 | 2 | 3 | 4 | 5;
  seed: number; // world seed — each mission grows its own boreal map
  // Which MAP/region this mission is set in (see world/regions.ts REGIONS; shares ids with the
  // ui/profile.ts MAPS picker). Drives the place-name pools. Omit → the default Saskatchewan map.
  map?: string;
  // Which fire BASE the sortie spawns / refuels from — a MapAnchor id in the `map` region
  // (see world/regions.ts ANCHORS: 'la-ronge', 'denare-beach', 'buffalo-narrows', …). The home
  // depot is NAMED from this anchor today; Phase 1 (docs/MAPS.md) will also POSITION it there.
  // Distinct from `places.communities`, which name the towns you PROTECT. Omit → the region's
  // `home` anchor (La Ronge on saskatchewan), else the seeded largest-lake base.
  homeBase?: string;
  // Authored place names PINNED onto the world so the briefing matches the radar (A5). `communities[i]`
  // names the i-th town the mission references; `base` names the home depot. Everything left unpinned
  // keeps its seeded region name. See World.PlacePins.
  places?: { base?: string; communities?: string[] };
  timeOfDay?: TimeOfDay; // sky/sun/fog mood (sky/TimeOfDay.ts SKY_PRESETS); omit → golden hour
  wind?: { angle?: number; strengthScale?: number };
  // Per-mission fire-spread pacing. `spreadScale` multiplies the calm `FIRE3D` baseline spread
  // (pre-heat creep + ember spotting), so the SAME fire model reads as a near-static tutorial spot
  // (~0.25) up to a screaming firestorm (~1.3). 1 = the config baseline; omit → 1. This is how
  // "spread according to the mission" is dialled, mirroring `wind.strengthScale`. (FireSystem reads it.)
  fire?: { spreadScale?: number };
  bucket?: 'bambi' | 'valve';
  // The slung loadout. `water` = the Bambi/valve bucket (scoop + drop). `crew` = no bucket/longline;
  // the heli LANDS at zones to board/unload crew. `torch` = a helitorch ignition rig: no scoop/drop,
  // the DROP button becomes IGNITE and lays a backfire along a marked control line (see `controlLine`).
  payload?: 'water' | 'crew' | 'torch';
  // Available loadouts for a MIXED sortie (do more than one job in one flight). When >1, the pilot
  // RE-RIGS the slung load while set down at the home base (a deliberate swap, so the control scheme is
  // never two things at once). `payload` is the STARTING loadout; omit `loadouts` (or give one) → a
  // single-loadout mission, exactly as before. Order is the swap cycle order. (e.g. ['torch','water']
  // = backburn the line, then re-rig to the bucket to guard.)
  loadouts?: ('water' | 'crew' | 'torch')[];
  startLoaded?: boolean; // crew payload: spawn with the FIRST crew already aboard (skip the opening base pickup → fly straight to the first LZ)
  fuel?: boolean; // enable the FuelSim range model
  fires: FirePlacement[];
  structures?: StructureSpec;
  zones?: ZonePlacement[];
  controlLine?: ControlLinePlacement; // a backburn firebreak to lay (torch loadout + `backburn` objective)
  objectives: Objective[];
  fails?: FailCondition[];
  script?: MissionBeat[]; // the reactive arc: briefing/beats/debrief comms + world reactions
}

/** A radio comms line surfaced to the HUD log + a squelch (emitted by the MissionDirector via Game). */
export interface CommsLine {
  speaker: CommsSpeaker;
  text: string;
  urgency: CommsUrgency;
}

/** Per-frame world snapshot Game hands to MissionRuntime (it already computes most of this). */
export interface MissionSignals {
  firesActive: number;
  firesInitial: number; // active count captured at mission start
  firesDoused: number; // fires killed with water (FireSystem.doused)
  structuresAlive: number;
  structuresTotal: number;
  crewsDelivered: number;
  crewsTotal: number;
  crewsLost: number; // trapped families the FIRE reached before pickup (drives the `rescue` fail)
  backburnLit: number; // backburn control-line segments laid so far (drives the `backburn` objective)
  elapsed: number; // seconds since the mission became active
  fuel: number; // 0..1 (1 when no FuelSim)
  starved: boolean; // ran the tank dry
  threat: number; // 0..1 — most-endangered structure's danger (drives 'threat' beats); 0 when none
  windAngle: number; // current wind heading (rad) — for flavour/diagnostics in beats
  tally: ScoreTally; // run aggregates the scorer reads at the win/lose frame (see missions/score.ts)
}

// --- Scoring (the reworked breakdown) --------------------------------------
// The score is computed once at the win/lose transition by the pure `missions/score.ts` from a
// `ScoreTally` Game accumulates over the run. It produces a line-itemed `ScoreBreakdown` (+ an
// S/A/B/C grade) the HUD renders on the end banner. Engine-agnostic — numbers only, like the sims.

/** The run aggregates the scorer needs — measured by Game over the mission, snapshotted each frame. */
export interface ScoreTally {
  firesDoused: number; // fires killed with water
  firesBurnedOut: number; // fires that consumed their own fuel (no reward; blocks the flawless bonus)
  firesInitial: number; // fires active at the start (par-time input)
  structuresSaved: number; // standing at the end
  structuresTotal: number;
  structuresLost: number; // total − saved
  structuresPristine: number; // saved at health ≥ SCORE.pristineHealth (the fire never reached them)
  crewsDelivered: number;
  crewsTotal: number;
  drops: number; // committed water drops (pours that actually released water)
  dropsEffective: number; // drops that knocked down meaningful heat (a "hit")
  dropsWasted: number; // drops that missed or dispersed too high
  peakThreat: number; // 0..1 — worst structure threat survived (dynamic hardship)
  peakFireLoad: number; // most fires active at once (dynamic hardship)
  fuelEnd: number; // 0..1 fuel remaining at the end (range bonus, fuel missions only)
  hardLandings: number; // airframe-denting touchdowns (penalty)
  crashed: boolean; // airframe destroyed (terminal — the run scores 0 via Game, breakdown is null)
}

export type ScoreGrade = 'S' | 'A' | 'B' | 'C' | 'D';

/** One row in the end-banner breakdown. `mul` rows render as "×1.4"; `add`/`sub` as signed points. */
export interface ScoreLine {
  label: string;
  value: number; // points (signed) for add/sub; the multiplier for mul rows
  kind: 'add' | 'sub' | 'mul';
  note?: string; // small trailing detail ("91% hits", "beat par")
}

export interface ScoreBreakdown {
  lines: ScoreLine[];
  total: number; // the final score (floored at 0)
  grade: ScoreGrade | null; // null on a loss (no grade for a failed mission)
  stars: 1 | 2 | 3 | null; // cosmetic medal: 1=cleared, 2=clean, 3=excellent; null on a loss
}

export type MissionState = 'active' | 'won' | 'lost';

/** One line in the HUD objective checklist (goals + protect/timer constraints). */
export interface TrackerItem {
  label: string;
  current?: number;
  target?: number;
  timeLeft?: number; // seconds (survive / timeout) → rendered mm:ss
  done: boolean;
  failed: boolean;
  kind: 'goal' | 'constraint';
  completedAt?: number; // mission-elapsed seconds when this latched done/failed (for the HUD ✓ time)
}

// --- Completion tracking (the latched ledger) ------------------------------
// The runtime models each objective/fail as a SUB-TASK whose completion is LATCHED the
// moment it's first met (it can't un-complete), recording WHEN. A mission is verified
// complete only when every goal sub-task is latched done. The event log gives an auditable
// timeline (sub-task done/failed → mission won/lost) for the HUD, debug, and persistence.

export type SubTaskStatus = 'pending' | 'done' | 'failed';

export interface SubTask {
  id: string; // stable per mission (e.g. 'g0', 'c1')
  label: string;
  kind: 'goal' | 'constraint';
  status: SubTaskStatus;
  current?: number;
  target?: number;
  timeLeft?: number;
  completedAt?: number; // mission-elapsed seconds when it latched (undefined while pending)
}

export interface LedgerEvent {
  at: number; // mission-elapsed seconds
  type: 'done' | 'failed' | 'won' | 'lost';
  id: string; // sub-task id, or 'mission' for won/lost
  label: string;
}

/** A finished run's record (persisted on a win; surfaced in the menu / debug). */
export interface CompletionRecord {
  wonAt: number; // mission-elapsed seconds at the win
  score: number;
  grade: ScoreGrade | null; // run rank (null on a loss)
  stars?: 1 | 2 | 3 | null; // cosmetic 1..3 medal for the best run (optional: pre-field records default to 1)
  subtasks: { label: string; completedAt: number | null }[];
}
