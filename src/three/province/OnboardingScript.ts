/**
 * OnboardingScript — a brand-new pilot's FIRST Living Province shift, as a short REACTIVE teaching arc
 * that replaces the retired campaign tutorial. It folds the campaign's opening lessons (scoop a lake →
 * drop on a fire → protect a town) into the SAME dispatch-call vocabulary the open regime uses, so the
 * pilot learns on the real instruments: the calls, the radar town-status rings, the reputation. When the
 * arc finishes, ProvinceMode hands off to the open `DispatchDirector`.
 *
 * Engine-agnostic (numbers/POJOs, no Three/World/DOM) — it emits the SAME `DispatchEvent`s the director
 * does, so ProvinceState folds them in identically. Unlike the open schedule (pure fn of time, for
 * multiplayer determinism), onboarding is REACTIVE and single-player: each beat waits for the PRIOR to
 * be answered (`answeredCount`) before the next goes out, with a `onboardMaxWaitSec` backstop so a
 * fumbling pilot still progresses (never a soft-lock). A first run diverges from the shared seed by
 * design — it's personal, and `career.onboarded` flips after it, so every later shift is the standard
 * shared schedule.
 */
import type { FirePlacement } from '../missions/types';
import type { DispatchEvent, DispatchTown } from './DispatchDirector';
import { PROVINCE } from '../config';
import { PROVINCE_COPY } from './strings';

const BEATS = 3; // scoop→drop, reinforce, protect-a-town — then the open regime takes over

export class OnboardingScript {
  private idx = 0; // next beat to emit
  private lastEmitAt = -Infinity; // shift seconds the last beat went out (the max-wait anchor)
  private readonly protectTown: DispatchTown | null;

  constructor(_seed: number, towns: readonly DispatchTown[]) {
    void _seed; // accepted for call-site symmetry with DispatchDirector (the arc itself is fixed/deterministic)
    // The protect beat threatens the town NEAREST the map origin (closest to home base) — a gentle first
    // defend. Null when a region has no town set yet → the arc stays all-spot-fire (still completable).
    this.protectTown = towns.length ? towns.reduce((a, b) => (b.x * b.x + b.z * b.z < a.x * a.x + a.z * a.z ? b : a)) : null;
  }

  /** Emit any teaching calls now due. Beat 0 fires at `onboardFirstSec`; each later beat fires once the
   *  prior is ANSWERED (a fire knocked down) OR `onboardMaxWaitSec` has passed since the last one. */
  update(shiftElapsed: number, answeredCount: number): DispatchEvent[] {
    const out: DispatchEvent[] = [];
    while (this.idx < BEATS) {
      const due =
        this.idx === 0
          ? shiftElapsed >= PROVINCE.onboardFirstSec
          : answeredCount >= this.idx || shiftElapsed >= this.lastEmitAt + PROVINCE.onboardMaxWaitSec;
      if (!due) break;
      const at = this.idx === 0 ? Math.max(shiftElapsed, PROVINCE.onboardFirstSec) : shiftElapsed;
      out.push(this.emit(this.idx, at));
      this.lastEmitAt = at;
      this.idx++;
    }
    return out;
  }

  /** True once every teaching beat has gone out → ProvinceMode begins the open regime. */
  get done(): boolean {
    return this.idx >= BEATS;
  }
  /** How many teaching calls have been issued (diagnostics + the gate). */
  get issued(): number {
    return this.idx;
  }

  private emit(idx: number, at: number): DispatchEvent {
    const id = `onb-${idx}`;
    if (idx < 2 || !this.protectTown) {
      // Scoop→drop: a small fire right beside the nearest lake (a scoop source on hand → learn the cycle).
      const place: FirePlacement = { at: 'cluster', anchor: 'lake', count: 1, size: 'small' };
      const text = idx === 0 ? PROVINCE_COPY.onbIntro : PROVINCE_COPY.onbReinforce;
      return {
        id,
        kind: 'spotFire',
        bornAt: at,
        severity: 0.25, // gentle — a fumbled first drop barely dents province health
        place,
        actions: [{ do: 'comms', speaker: 'dispatch', text, urgency: 'info' }, { do: 'ignite', place }],
      };
    }
    // Protect a town: a town-threat on the nearest town — lights the radar's threatened ring + teaches the
    // stakes the same way the open regime will, so the lesson transfers directly.
    const town = this.protectTown;
    const place: FirePlacement = { at: 'nearCommunity', community: town.ref, offset: PROVINCE.townLineOffsetCalm, size: 'medium', count: 1 };
    const text = `${town.name} dispatch. Fire's near the cabins. Knock it down before it reaches them.`;
    return {
      id,
      kind: 'townThreat',
      bornAt: at,
      severity: 0.4,
      townRef: town.ref,
      townName: town.name,
      pinX: town.x,
      pinZ: town.z,
      place,
      actions: [{ do: 'comms', speaker: 'dispatch', text, urgency: 'warn' }, { do: 'ignite', place }],
    };
  }
}
