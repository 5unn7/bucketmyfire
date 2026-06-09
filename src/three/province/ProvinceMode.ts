/**
 * ProvinceMode — the Living Province controller `Game` composes (parallel to the FFA `stepEndless`
 * path). It owns the deterministic `DispatchDirector` + the `ProvinceState` memory and, each frame,
 * turns the world snapshot into: the `MissionAction[]` Game runs through its EXISTING action switch
 * (`runMissionAction` — comms + ignite, the same plumbing the campaign uses), a live HUD shift tracker,
 * and the stood-down signal that ends the run.
 *
 * Engine-agnostic (numbers/POJOs only). Game stays the only Three-touching layer: it builds the town
 * list (from `MapContext`), feeds the snapshot, executes the returned actions, and reads the tracker.
 */
import type { MissionAction, ScoreGrade } from '../missions/types';
import { DispatchDirector, type DispatchTown, type DispatchEvent } from './DispatchDirector';
import { OnboardingScript } from './OnboardingScript';
import { ProvinceState, shiftGrade, type ProvinceSignals, type TownStatus } from './ProvinceState';
import { PROVINCE_COPY } from './strings';

/** A radar marker for one protected town, coloured by its live status (the HUD draws it). A town under an
 *  active town-threat dispatch call reads as `threatened`, so this layer IS the dispatch-call indicator
 *  for town threats; bush spot-fire calls have no fixed location and surface as ordinary red fire blips. */
export interface TownPin {
  x: number;
  z: number;
  status: TownStatus;
}

/** The compact in-flight shift readout (the HUD's Living-Province status panel). */
export interface ShiftReadout {
  reputation: number;
  health: number; // 0..1 province health (the stood-down meter)
  townsStanding: number;
  townsTotal: number;
  activeCalls: number;
}

export interface ProvinceUpdate {
  actions: readonly MissionAction[]; // comms + ignite bundles to run via Game.runMissionAction
  justStoodDown: boolean; // the frame the province was overrun → Game ends the shift as a LOSS
  justComplete: boolean; // the frame the shift's last call resolved → Game ends the shift as a WIN
  justOnboarded: boolean; // the frame the teaching arc hands off → Game marks the pilot onboarded
}

/** The end-of-shift tally for the debrief + the career log (Game reads it when the shift ends). */
export interface ShiftResult {
  completed: boolean; // rode out the whole quota of calls (win) vs overrun (loss)
  grade: ScoreGrade;
  callsHeld: number;
  callsTotal: number;
  townsStanding: number;
  townsTotal: number;
  reputation: number;
}

export class ProvinceMode {
  private readonly seed: number;
  private director: DispatchDirector | null; // null only while the onboarding arc runs (created at handoff)
  private onboard: OnboardingScript | null; // a new pilot's first-shift teaching arc; null once handed off
  private pendingHandoffComms = false; // capstone deferred to ride the FIRST open call (not stacked on beat 2)
  private readonly state: ProvinceState;
  private readonly towns: readonly DispatchTown[];
  private readonly endless: boolean; // shared Open Skies: the dispatch never exhausts → the run is neverending.
  //                                    A SOLO round leaves this false → a bounded shift (limited calls → reset).
  private ended = false;
  private outcome: 'none' | 'complete' | 'stooddown' = 'none'; // how the shift ended (win vs overrun)

  constructor(seed: number, towns: readonly DispatchTown[], onboarding = false, endless = false) {
    this.seed = seed;
    this.towns = towns;
    this.endless = endless;
    this.state = new ProvinceState(towns.map((t) => t.ref));
    // A brand-new pilot (career.onboarded false) flies the reactive teaching arc first; the open regime
    // is created at the handoff (so its first call lands AFTER teaching, via DispatchDirector startAt).
    this.onboard = onboarding ? new OnboardingScript(seed, towns) : null;
    this.director = onboarding ? null : new DispatchDirector(seed, towns, 0, endless);
  }

  /** Advance one frame: emit any due dispatch calls (onboarding arc, then the open schedule), fold them +
   *  the world snapshot into the province memory, and report the actions to run + whether the shift ended. */
  update(s: ProvinceSignals): ProvinceUpdate {
    const actions: MissionAction[] = [];
    let justOnboarded = false;
    if (!this.ended) {
      if (this.onboard) {
        for (const ev of this.onboard.update(s.shiftElapsed, this.state.answeredCount)) {
          this.state.add(ev);
          for (const a of ev.actions) actions.push(a);
        }
        if (this.onboard.done) {
          // Teaching's over: open the floodgates. The director continues the schedule from NOW so the
          // first open call lands a grace after the last lesson, not retroactively, then it climbs as ever.
          this.director = new DispatchDirector(this.seed, this.towns, s.shiftElapsed, this.endless);
          this.onboard = null;
          this.pendingHandoffComms = true; // the capstone rides the first open call, not beat 2's frame
          justOnboarded = true; // Game marks the pilot onboarded (teaching complete → never replays)
        }
      } else if (this.director) {
        const evs = this.director.update(s.shiftElapsed);
        // Land the "you've got the hang of it, the calls won't stop" capstone WITH the first open call,
        // so it pairs with a real new dispatch instead of stacking on the just-issued protect threat.
        if (evs.length && this.pendingHandoffComms) {
          this.pendingHandoffComms = false;
          actions.push({ do: 'comms', speaker: 'dispatch', text: PROVINCE_COPY.onbHandoff, urgency: 'info' });
        }
        for (const ev of evs) {
          this.state.add(ev);
          for (const a of ev.actions) actions.push(a);
        }
      }
    }
    this.state.update(s);

    // Outcome (checked once, stand-down LOSS takes precedence over a same-frame complete). Stand-down =
    // overrun (health hit 0 past the fairness floor). Complete = the director issued its whole quota AND
    // every call is resolved → the pilot rode out the shift: a WIN with a grade (the achievement beat).
    // In `endless` (shared Open Skies) the director never reports `exhausted`, so the complete branch can
    // never fire — the only end is a stand-down (or a heli crash in Game): the live world is neverending.
    let justStoodDown = false;
    let justComplete = false;
    if (!this.ended && this.state.standDown(s.shiftElapsed)) {
      this.ended = true;
      this.outcome = 'stooddown';
      justStoodDown = true;
      actions.push({ do: 'comms', speaker: 'dispatch', text: PROVINCE_COPY.standDown, urgency: 'alert' });
    } else if (!this.ended && !this.onboard && this.director?.exhausted && this.state.totalCalls > 0 && this.state.activeCount === 0) {
      this.ended = true;
      this.outcome = 'complete';
      justComplete = true;
      actions.push({ do: 'comms', speaker: 'dispatch', text: PROVINCE_COPY.shiftComplete, urgency: 'info' });
    }
    return { actions, justStoodDown, justComplete, justOnboarded };
  }

  get reputation(): number {
    return this.state.reputation;
  }
  get stoodDown(): boolean {
    return this.outcome === 'stooddown';
  }
  get completed(): boolean {
    return this.outcome === 'complete';
  }

  /** The end-of-shift tally for the debrief + the career log. Grade falls to D when overrun. */
  shiftResult(): ShiftResult {
    return {
      completed: this.outcome === 'complete',
      grade: shiftGrade(this.state.answeredCount, this.state.totalCalls, this.state.townsStanding, this.state.townsTotal, this.state.health, this.outcome === 'stooddown'),
      callsHeld: this.state.answeredCount,
      callsTotal: this.state.totalCalls,
      townsStanding: this.state.townsStanding,
      townsTotal: this.state.townsTotal,
      reputation: this.state.reputation,
    };
  }
  /** Dispatch calls held / lost this shift — the season-log tally (province/career.ts). */
  get answered(): number {
    return this.state.answeredCount;
  }
  get missed(): number {
    return this.state.missedCount;
  }
  /** Active town-threat calls with a known location — for the radar dispatch pins (Phase 1d). */
  get activeCalls(): readonly DispatchEvent[] {
    return this.state.activeCalls;
  }

  /** Radar markers for every protected town, coloured by live status (drawn by the HUD radar). Mutates
   *  the caller's reused buffer IN PLACE (reuse a slot, allocate only to grow, trim the tail) so a
   *  per-frame call adds no GC pressure — the 60fps radar-feed invariant. */
  townPins(out: TownPin[]): TownPin[] {
    const n = this.towns.length;
    for (let i = 0; i < n; i++) {
      const t = this.towns[i];
      const status = this.state.statusOf(t.ref);
      const slot = out[i];
      if (slot) {
        slot.x = t.x;
        slot.z = t.z;
        slot.status = status;
      } else {
        out[i] = { x: t.x, z: t.z, status };
      }
    }
    if (out.length > n) out.length = n;
    return out;
  }

  /** The compact in-flight shift readout (the HUD's Living-Province status panel). */
  shift(): ShiftReadout {
    return {
      reputation: this.state.reputation,
      health: this.state.health,
      townsStanding: this.state.townsStanding,
      townsTotal: this.state.townsTotal,
      activeCalls: this.state.activeCount,
    };
  }
}
