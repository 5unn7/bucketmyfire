/**
 * DispatchDirector — the heart of the Living Province. It REPLACES the flat Open-Skies spawner: instead
 * of topping fires up to a fixed pool on a constant cadence, it emits DISPATCH CALLS over time, each a
 * fire + a radio line, paced and sized by a climbing Fire-Weather Index (FWI). Early shift = sparse small
 * bush fires; peak = relentless town-threats. This is what turns the endless sandbox into a shift with an
 * arc.
 *
 * ENGINE-AGNOSTIC + DETERMINISTIC (the sim-boundary law). It owns only numbers/POJOs — no Three, no World,
 * no DOM. Every call's TIME and CONTENTS are a PURE FUNCTION of `(seed, event index)`, so the schedule is
 * independent of frame timing: `update(shiftElapsed)` simply catches the schedule up to the clock and
 * returns the calls that crossed it this tick. Because of that purity, two peers flying the same
 * daily-seeded province (the shared wall-clock feeds `shiftElapsed`) get the IDENTICAL call sequence —
 * exactly how `Wind` stays shareable — so the live board + ghost pilots stay correct. (No `Math.random`,
 * no `Date.now` in here.)
 *
 * Each emitted `DispatchEvent` carries the `MissionAction[]` bundle (comms + ignite) that Game runs
 * through its EXISTING action switch (`runMissionAction`) — the same plumbing the campaign's
 * `MissionDirector` beats use — so a dispatch call ignites with the same vocabulary + fuel-snapping as an
 * authored fire. Resolution against the real map happens in Game via `igniteFromPlacement(place)`.
 */
import type { FirePlacement, MissionAction, SizeClass } from '../missions/types';
import { PROVINCE } from '../config';

/** A town the director can threaten — a defensible, cabin-bearing community (built by Game from MapContext). */
export interface DispatchTown {
  ref: string; // CommunityRef (the MapAnchor id) usable directly in a placement
  name: string;
  x: number;
  z: number;
}

export type DispatchKind = 'spotFire' | 'townThreat';

/** One dispatch call: a fire to fight + the radio line that announces it. */
export interface DispatchEvent {
  id: string; // stable per shift ('disp-0', 'disp-1', …) — the latch/answer key
  kind: DispatchKind;
  bornAt: number; // shift seconds when the call went out
  severity: number; // 0..1 — drives reward + how hard a miss hurts
  townRef?: string; // for townThreat: which town is in danger
  townName?: string;
  // A representative location for the radar pin. For a town-threat it's the town; for a bush spot the
  // exact spot isn't known until `igniteFromPlacement` snaps it to fuel, so it's left undefined.
  pinX?: number;
  pinZ?: number;
  place: FirePlacement; // resolved + ignited by Game (igniteFromPlacement)
  actions: MissionAction[]; // [comms, {do:'ignite', place}] — run through Game.runMissionAction
}

/** Mulberry32 — the project's deterministic PRNG (same family as the world gen / factory). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

export class DispatchDirector {
  private counter = 0; // how many calls emitted so far (the per-event RNG key)
  private nextAt: number; // shift seconds the NEXT call goes out (advances deterministically)

  constructor(
    private readonly seed: number,
    private readonly towns: readonly DispatchTown[],
    startAt = 0, // shift seconds the schedule begins from (the onboarding handoff passes the elapsed clock so
    //              the first open call lands `firstCallSec` AFTER teaching ends, not retroactively at 12s)
    private readonly endless = false, // shared Open Skies: the calls NEVER stop (no `shiftCalls` cap, never
    //                                   `exhausted`) so the live world is neverending. A SOLO round leaves this
    //                                   false → a bounded shift (limited calls → "shift complete" → reset).
  ) {
    this.nextAt = startAt + PROVINCE.firstCallSec;
  }

  /** Fire-Weather Index 0..1 — a linear climb to peak over `fwiPeakSec`, then plateau. The escalation. */
  fwi(shiftElapsed: number): number {
    return clamp01(shiftElapsed / Math.max(1, PROVINCE.fwiPeakSec));
  }

  /** Catch the deterministic schedule up to `shiftElapsed`; return the calls that crossed it this tick.
   *  Frame-rate independent: the same shift time yields the same set whether stepped in one big dt or many
   *  small ones (the determinism the gate + multiplayer rely on). A guard caps catch-up after a long stall. */
  update(shiftElapsed: number): DispatchEvent[] {
    const out: DispatchEvent[] = [];
    let guard = 0;
    // A bounded SOLO shift is a run of `shiftCalls` calls (the achievement cap): once the director has issued
    // them all it goes quiet, and the shift COMPLETES when those calls are resolved (ProvinceState). The SHARED
    // Open Skies world is `endless` — that cap is lifted, so the calls keep coming and the run never auto-ends.
    while ((this.endless || this.counter < PROVINCE.shiftCalls) && shiftElapsed >= this.nextAt && guard++ < 64) {
      out.push(this.emit(this.counter, this.nextAt));
      this.counter++;
      const f = this.fwi(this.nextAt);
      // Calls come faster as the weather worsens.
      this.nextAt += lerp(PROVINCE.callIntervalCalm, PROVINCE.callIntervalPeak, f);
    }
    return out;
  }

  /** How many calls have been issued (diagnostics + the gate). */
  get issued(): number {
    return this.counter;
  }

  /** True once the shift's full quota of calls has gone out — no more will come (ProvinceMode watches this
   *  plus "no active calls" to declare the shift COMPLETE). Always false in `endless` (Open Skies) mode, so
   *  the shared world never auto-completes — it just keeps dispatching until the pilot is overrun or crashes. */
  get exhausted(): boolean {
    return !this.endless && this.counter >= PROVINCE.shiftCalls;
  }

  /** Build call #i, scheduled for time `at`. Pure: its RNG is keyed by (seed, i), so the call's town,
   *  kind, and size are identical on every peer and every replay. */
  private emit(i: number, at: number): DispatchEvent {
    const rng = mulberry32((this.seed ^ 0x9e3779b1 ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0);
    const f = this.fwi(at);
    const severity = clamp01(0.25 + f * 0.6 + (rng() - 0.5) * 0.2);
    const id = `disp-${i}`;

    const wantTown = this.towns.length > 0 && rng() < lerp(PROVINCE.townThreatChanceCalm, PROVINCE.townThreatChancePeak, f);
    if (wantTown) {
      const town = this.towns[Math.floor(rng() * this.towns.length) % this.towns.length];
      const size = townThreatSize(f);
      const offset = lerp(PROVINCE.townLineOffsetCalm, PROVINCE.townLineOffsetPeak, f);
      // A group of fires on the town's doorstep (NOT a `line`: nearCommunity fuel-snaps EACH fire
      // in-province, so a fire near a border town can't spill off the map's edge the way a line's far
      // disc would). It grows from one to a cluster as the weather worsens.
      const count = f < 0.5 ? 1 : 2;
      const place: FirePlacement = { at: 'nearCommunity', community: town.ref, offset, size, count };
      const text = `${town.name} dispatch. Fire's on the town's doorstep. Knock it down before it reaches the cabins.`;
      return {
        id,
        kind: 'townThreat',
        bornAt: at,
        severity,
        townRef: town.ref,
        townName: town.name,
        pinX: town.x,
        pinZ: town.z,
        place,
        actions: [{ do: 'comms', speaker: 'dispatch', text, urgency: f > 0.6 ? 'alert' : 'warn' }, { do: 'ignite', place }],
      };
    }

    // A bush spot fire — douse it before it spreads. Exact site is fuel-snapped at ignite, so no pin.
    const size = spotSize(f);
    const place: FirePlacement = { at: 'random', count: 1, size, minFromOrigin: 160 };
    const text = 'Smoke reported in the bush. A new spot fire. Get on it before it runs.';
    return {
      id,
      kind: 'spotFire',
      bornAt: at,
      severity,
      place,
      actions: [{ do: 'comms', speaker: 'dispatch', text, urgency: 'info' }, { do: 'ignite', place }],
    };
  }
}

/** Bush spot fire size — small early, up to medium as the weather dries. */
function spotSize(f: number): SizeClass {
  return f < 0.33 ? 'small' : f < 0.7 ? 'medium' : 'large';
}

/** A town-threat is one class bigger than a spot at the same weather (it's the serious call). */
function townThreatSize(f: number): SizeClass {
  return f < 0.33 ? 'medium' : f < 0.7 ? 'large' : 'mega';
}
