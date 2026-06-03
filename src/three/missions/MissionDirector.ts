import type { MissionDef, MissionSignals, MissionBeat, MissionAction, MissionTrigger } from './types';
import type { MissionRuntime } from './MissionRuntime';

/**
 * The mission EXPERIENCE engine — engine-agnostic (numbers/POJOs, no Three.js / DOM), exactly like
 * `MissionRuntime`. It turns a mission's authored `script` (a list of `MissionBeat`s) into a live,
 * reactive arc: each beat's trigger is probed every frame against the same `MissionSignals` the
 * runtime sees (plus the runtime's ledger for objective/outcome triggers), and the first frame a
 * trigger holds, the beat FIRES ONCE — its actions are returned for `Game` to execute (post a radio
 * line, ignite a flare-up, shift the wind). Firing is LATCHED (a `Set` of fired ids), so beats are
 * deterministic and headless-testable in `verify-campaign` — the campaign verifier runs this and
 * executes its world actions, proving every mission still completes with its dynamics live.
 *
 * `Game` is the only side that touches Three/DOM/audio; the director just decides WHAT happens WHEN.
 */
export class MissionDirector {
  private readonly beats: readonly MissionBeat[];
  private readonly fired = new Set<string>();

  constructor(def: MissionDef) {
    this.beats = def.script ?? [];
  }

  /**
   * Probe every un-fired beat; return the actions of those that fire THIS frame (each beat once).
   * Returns a shared empty array when nothing fires — no per-frame allocation in the common case.
   */
  update(s: MissionSignals, runtime: MissionRuntime): readonly MissionAction[] {
    if (this.beats.length === 0 || this.fired.size === this.beats.length) return EMPTY;
    let out: MissionAction[] | null = null;
    for (const b of this.beats) {
      if (this.fired.has(b.id)) continue;
      if (triggered(b.trigger, s, runtime)) {
        this.fired.add(b.id);
        (out ??= []).push(...b.actions);
      }
    }
    return out ?? EMPTY;
  }

  /** Has every authored beat fired? (Lets Game stop calling once the script is spent.) */
  get spent(): boolean {
    return this.fired.size === this.beats.length;
  }
}

const EMPTY: readonly MissionAction[] = Object.freeze([]);

/** Is this trigger's condition met this frame? Pure read over the signals + the runtime ledger. */
function triggered(t: MissionTrigger, s: MissionSignals, runtime: MissionRuntime): boolean {
  switch (t.at) {
    case 'start':
      return true; // fires on the first update (latched thereafter) → the briefing line
    case 'time':
      return s.elapsed >= t.seconds;
    case 'firesDoused':
      return s.firesDoused >= t.n;
    case 'firesLeft':
      // A knock-DOWN to ≤n, not the opening state — require the player to have doused something
      // (or a little time to pass) so a single-cluster blaze doesn't trip it on frame one.
      return s.firesActive <= t.n && (s.firesDoused > 0 || s.elapsed > 8);
    case 'threat':
      return s.threat >= t.min;
    case 'structureLost':
      return s.structuresTotal - s.structuresAlive >= (t.n ?? 1);
    case 'crewDelivered':
      return s.crewsDelivered >= t.n;
    case 'fuelBelow':
      return s.fuel < t.frac;
    case 'objectiveDone':
      return runtime.events.some((e) => e.type === 'done' && (t.id === undefined || e.id === t.id));
    case 'won':
      return runtime.state === 'won';
    case 'lost':
      return runtime.state === 'lost';
  }
}
