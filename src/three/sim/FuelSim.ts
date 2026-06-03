import { MISSIONS } from '../config';

/**
 * Fuel / range model (Track C6) — engine-agnostic, numbers only (imports just `config.ts`,
 * like `HelicopterSim`/`FireSystem`). Only missions with `fuel:true` construct one; the
 * others never see it.
 *
 * Burn is metered by THRUST + PAYLOAD, not a wall clock, so flying hard and heavy is visibly
 * thirsty while an economical loiter lasts far longer — the ~2.5-min working endurance is the
 * average, not a fixed countdown the player can't influence. Calibrated to the hero Bell
 * 205A-1 at 60× time compression (full bucket + full power ≈ 2.5 min, light loiter ≈ 4.2 min).
 *
 * `starved` latches at empty; `Game` then forces a sinking collective (engine cut → forced
 * landing). Refuel happens grounded/slow at the depot — `Game` decides that and passes
 * `refueling`, here we just integrate.
 */

export interface FuelDemand {
  throttle01: number; // |throttle| 0..1
  climbUp: number; // upward collective demand 0..1 (0 when level/descending)
  payloadRatio: number; // water / capacity 0..1 (the heavy-lift premium)
  refueling: boolean; // grounded + slow within the depot radius this frame
}

export class FuelSim {
  private _fuel: number = MISSIONS.startFuel;
  private _starved = false;

  get fuel(): number {
    return this._fuel;
  }

  get starved(): boolean {
    return this._starved;
  }

  /** Gauge should flash: below the reserve warn line (and not already dry). */
  get low(): boolean {
    return this._fuel <= MISSIONS.lowWarn;
  }

  update(dt: number, p: FuelDemand): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    if (p.refueling) {
      this._fuel = Math.min(1, this._fuel + MISSIONS.refuelPerSec * dt);
      if (this._fuel > 0) this._starved = false;
      return;
    }

    const demand = 0.5 * clamp01(p.throttle01) + 0.5 * clamp01(p.climbUp);
    const rate = MISSIONS.idleBurn + MISSIONS.thrustBurn * demand * (1 + MISSIONS.payloadBurn * clamp01(p.payloadRatio));
    this._fuel = Math.max(0, this._fuel - rate * dt);
    if (this._fuel <= 0) this._starved = true;
  }
}

function clamp01(v: number): number {
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
}
