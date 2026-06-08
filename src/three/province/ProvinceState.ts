/**
 * ProvinceState — "the world remembers" (the sim-boundary law: numbers/POJOs only, no Three/World/DOM).
 * It tracks the live shift: the dispatch CALLS in flight (answered / still burning / missed), each TOWN's
 * status (standing → threatened → damaged), the province HEALTH meter (hits 0 → you're stood down), and
 * the REPUTATION you bank. Game feeds it a per-frame snapshot; it never touches the world directly.
 *
 * Call resolution is a deterministic PROXY for Phase 1 (no per-fire identity yet): each new fire the
 * player knocks down (`doused` rising) is credited to the OLDEST active call, which then reads as
 * answered; a call left burning past its weather-scaled deadline counts as MISSED and bleeds health.
 * (Phase 2 will match douses to a call's actual fire.)
 */
import { PROVINCE } from '../config';
import type { ScoreGrade } from '../missions/types';
import type { DispatchEvent } from './DispatchDirector';

export type TownStatus = 'standing' | 'threatened' | 'damaged';
export type CallStatus = 'active' | 'answered' | 'missed';

/** Grade a finished shift S..D from how it went (PURE — the gate asserts the thresholds). Calls HELD is the
 *  bulk of it (it's the job), towns standing + province health round it out; an overrun shift is a flat D. */
export function shiftGrade(answered: number, total: number, townsStanding: number, townsTotal: number, health: number, stoodDown: boolean): ScoreGrade {
  if (stoodDown) return 'D';
  const callQ = total > 0 ? answered / total : 1;
  const townQ = townsTotal > 0 ? townsStanding / townsTotal : 1;
  const q = 0.55 * callQ + 0.3 * townQ + 0.15 * Math.max(0, Math.min(1, health));
  return q >= 0.92 ? 'S' : q >= 0.78 ? 'A' : q >= 0.6 ? 'B' : q >= 0.4 ? 'C' : 'D';
}

interface Call {
  ev: DispatchEvent;
  status: CallStatus;
}

/** The per-frame world snapshot ProvinceState consumes (a subset of MissionSignals + run counters). */
export interface ProvinceSignals {
  shiftElapsed: number; // seconds since the shift began
  doused: number; // cumulative fires water-killed (FireSystem.doused)
  dropsEffective: number; // cumulative effective water drops (steady-work bonus)
  structuresAlive: number;
  structuresTotal: number;
}

export class ProvinceState {
  private calls: Call[] = [];
  private readonly townStatus = new Map<string, TownStatus>();
  private creditedDoused = 0; // douses already attributed to a call (FIFO credit pointer)
  private lastStructLost = 0; // structures destroyed as of last frame (to charge only the delta)
  private answered = 0;
  private missed = 0;
  private _health = 1;

  constructor(townRefs: readonly string[]) {
    for (const ref of townRefs) this.townStatus.set(ref, 'standing');
  }

  /** Register a freshly-issued dispatch call (Game passes the director's new events straight through). */
  add(ev: DispatchEvent): void {
    this.calls.push({ ev, status: 'active' });
    if (ev.kind === 'townThreat' && ev.townRef && this.townStatus.get(ev.townRef) === 'standing') {
      this.townStatus.set(ev.townRef, 'threatened');
    }
  }

  /** Advance the shift one frame from the world snapshot: resolve calls, age out misses, bleed health. */
  update(s: ProvinceSignals): void {
    // Credit each new douse to the oldest still-burning call → it reads as answered (a held line).
    let fresh = Math.max(0, s.doused - this.creditedDoused);
    while (fresh > 0) {
      const call = this.calls.find((c) => c.status === 'active');
      if (!call) break;
      call.status = 'answered';
      this.answered++;
      this.creditedDoused++;
      fresh--;
      // Clear a threatened town back to standing ONLY when this was its LAST open call (peak weather can
      // stack two calls on one town) — and never un-damage a town that already lost cabins to a miss.
      const ref = call.ev.townRef;
      if (ref && this.townStatus.get(ref) === 'threatened' && !this.calls.some((c) => c.status === 'active' && c.ev.townRef === ref)) {
        this.townStatus.set(ref, 'standing');
      }
    }
    // Any leftover douses are bush work with no open call — still credited so they don't bank later.
    this.creditedDoused = Math.max(this.creditedDoused, s.doused - this.activeCount);

    // Age out unanswered calls past their weather-scaled deadline → a miss that costs health.
    const f = Math.min(1, s.shiftElapsed / Math.max(1, PROVINCE.fwiPeakSec));
    const deadline = PROVINCE.callDeadlineCalm + (PROVINCE.callDeadlinePeak - PROVINCE.callDeadlineCalm) * f;
    for (const c of this.calls) {
      if (c.status !== 'active') continue;
      if (s.shiftElapsed - c.ev.bornAt > deadline) {
        c.status = 'missed';
        this.missed++;
        this._health -= PROVINCE.healthPerMiss * (0.5 + c.ev.severity);
        if (c.ev.townRef) this.townStatus.set(c.ev.townRef, 'damaged');
      }
    }

    // Structures the fire actually destroyed bleed health directly (charge only the new losses).
    const lost = Math.max(0, s.structuresTotal - s.structuresAlive);
    if (lost > this.lastStructLost) {
      this._health -= PROVINCE.healthPerStructure * (lost - this.lastStructLost);
      this.lastStructLost = lost;
    }
    this._health = Math.max(0, Math.min(1, this._health));

    // Reputation: the base fire-fighting score plus a bonus per dispatch call held (scaled by its stakes).
    this._reputation = s.doused * PROVINCE.repPerFire + s.dropsEffective * PROVINCE.repPerHit + this.answeredRep;
  }

  private _reputation = 0;
  private get answeredRep(): number {
    let r = 0;
    for (const c of this.calls) if (c.status === 'answered') r += PROVINCE.repPerCallAnswered * (0.5 + c.ev.severity);
    return r;
  }

  get health(): number {
    return this._health;
  }
  get reputation(): number {
    return Math.round(this._reputation);
  }
  get activeCount(): number {
    return this.calls.filter((c) => c.status === 'active').length;
  }
  /** Total dispatch calls issued this shift (the shift-report denominator: "calls held X / total"). */
  get totalCalls(): number {
    return this.calls.length;
  }
  get activeCalls(): readonly DispatchEvent[] {
    return this.calls.filter((c) => c.status === 'active').map((c) => c.ev);
  }
  get answeredCount(): number {
    return this.answered;
  }
  get missedCount(): number {
    return this.missed;
  }
  /** Towns still standing (status !== 'damaged'). */
  get townsStanding(): number {
    let n = 0;
    for (const st of this.townStatus.values()) if (st !== 'damaged') n++;
    return n;
  }
  get townsTotal(): number {
    return this.townStatus.size;
  }
  statusOf(ref: string): TownStatus {
    return this.townStatus.get(ref) ?? 'standing';
  }

  /** Stood down: the province is overrun. Gated by a fairness floor so a calm opening can't collapse early
   *  (the gate asserts this) — health can read 0 transiently but the run only ends after `minShiftSec`. */
  standDown(shiftElapsed: number): boolean {
    return this._health <= 0 && shiftElapsed >= PROVINCE.minShiftSec;
  }
}
