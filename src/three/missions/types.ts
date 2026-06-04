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

/** Where a mission seeds a fire (or a cluster of `count` fires). */
export type FirePlacement =
  | { at: 'point'; x: number; z: number; size: SizeClass }
  | { at: 'nearCommunity'; community: number | 'base'; offset?: number; size: SizeClass; count?: number }
  | { at: 'random'; count: number; size: SizeClass; minFromOrigin?: number }
  // An AUTHORED fire COMPLEX: `count` heads bunched within `spread` around a deterministic anchor
  // (vs `random`, which scatters independent dots map-wide). The anchor is `origin` (map centre),
  // a `lake` (the complex is placed in the bush right beside the nearest lake → a scoop source on
  // hand), or a `community`. `bearing` (radians) + `distance` (units) push the centre off the
  // anchor. Stays seed-robust: every head is snapped to dry fuel so the blaze always catches.
  | {
      at: 'cluster';
      anchor: 'origin' | 'lake' | { community: number | 'base' };
      bearing?: number;
      distance?: number;
      spread?: number;
      count?: number;
      size: SizeClass;
    }
  // A continuous fire FRONT: a row of seed discs along a line. `length` is its world-unit extent
  // (default ~90); `angle` the axis in radians — omit to face the front downwind (axis ⟂ wind) so
  // it spreads toward you like a real ridge-line head. Center it either at explicit (x,z) or, to
  // stay seed-robust like the other specs, at a `community` — the line is then placed `offset`
  // units UPWIND of it so the head advances onto the settlement.
  | {
      at: 'line';
      size: SizeClass;
      length?: number;
      angle?: number;
      x?: number;
      z?: number;
      community?: number | 'base';
      offset?: number;
    };

/** Which structures a mission places (explicit — not the sandbox auto-generation). */
export interface StructureSpec {
  depot?: boolean; // place the lakeside base/depot (the refuel + crew base point). Default true.
  groups?: { community: number | 'base'; cabins?: number }[]; // hamlets to populate with cabins
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
  community?: number | 'base';
  label?: string; // shown on the zone marker / HUD ("LZ Alpha", "Cabin 2")
}

/** Win requirements — ALL must complete for a mission win. */
export type ObjectiveKind = 'extinguishAll' | 'extinguishCount' | 'deliver' | 'evacuate' | 'survive';
export interface Objective {
  kind: ObjectiveKind;
  n?: number; // target count (extinguishCount / deliver / evacuate); defaults to crewsTotal for crews
  seconds?: number; // survive duration
  label?: string; // override the auto label
}

/** Loss conditions — ANY triggers a mission loss. */
export type FailKind = 'protect' | 'timeout' | 'fuelOut';
export interface FailCondition {
  kind: FailKind;
  min?: number; // protect: minimum structures that must survive (default 1)
  all?: boolean; // protect: every structure must survive (min = total)
  seconds?: number; // timeout: lose if not won by this elapsed time
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

/** What a beat does. `comms` always; `ignite`/`wind` are the world REACTIONS (decided: scripted beats). */
export type MissionAction =
  | { do: 'comms'; speaker: CommsSpeaker; text: string; urgency?: CommsUrgency }
  // A flare-up / new spot fire / re-spread. Reuses the FirePlacement vocabulary + scenario resolution,
  // so a beat can ignite anything the opening fires can (a cluster downwind, a fire near a community…).
  | { do: 'ignite'; place: FirePlacement }
  // Shift the wind (the "wind-shift" beat): ease the heading toward `angle` and/or the gust strength
  // toward `strengthScale×` over `ease` seconds. Either is optional.
  | { do: 'wind'; angle?: number; strengthScale?: number; ease?: number };

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
  brief: string; // 1–2 line briefing shown in the menu + start card
  intel?: string; // longer pre-flight briefing paragraph (the briefing card body; falls back to brief)
  difficulty: 1 | 2 | 3 | 4 | 5;
  seed: number; // world seed — each mission grows its own boreal map
  wind?: { angle?: number; strengthScale?: number };
  // Per-mission fire-spread pacing. `spreadScale` multiplies the calm `FIRE3D` baseline spread
  // (pre-heat creep + ember spotting), so the SAME fire model reads as a near-static tutorial spot
  // (~0.25) up to a screaming firestorm (~1.3). 1 = the config baseline; omit → 1. This is how
  // "spread according to the mission" is dialled, mirroring `wind.strengthScale`. (FireSystem reads it.)
  fire?: { spreadScale?: number };
  bucket?: 'bambi' | 'valve';
  payload?: 'water' | 'crew'; // crew → no bucket/longline; the heli LANDS at zones to board/unload crew
  startLoaded?: boolean; // crew payload: spawn with the FIRST crew already aboard (skip the opening base pickup → fly straight to the first LZ)
  fuel?: boolean; // enable the FuelSim range model
  fires: FirePlacement[];
  structures?: StructureSpec;
  zones?: ZonePlacement[];
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
  hardLandings: number; // hull-denting touchdowns (penalty)
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
  subtasks: { label: string; completedAt: number | null }[];
}
