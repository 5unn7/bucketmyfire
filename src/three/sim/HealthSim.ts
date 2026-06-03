import { HEALTH } from '../config';

/**
 * Airframe health / damage model (engine-agnostic — imports only `config.ts`, like
 * `FuelSim`/`HelicopterSim`). It owns a single number, `health` 1→0, that `Game` drains
 * from per-frame DAMAGE signals and refills at a base. No Three.js, no DOM.
 *
 * Damage has ONE source: a hard landing — bottoming out on the floor with a high sink rate (a
 * one-shot impact hit above `HEALTH.hardLandingSink`). Flying low through fire, dragging the bucket,
 * and overspeed no longer cook the airframe — FUEL is the resource that ticks down and forces a
 * return to base (see `FuelSim`). So hull stays pristine through normal flying and every refuel
 * touchdown; only a genuine crash dents it. Per-heli `toughness` (HELI_CLASSES) DIVIDES the impact,
 * so a Black Hawk shrugs off what wrecks a 205.
 *
 * `dead` latches at zero; `Game` then crashes the mission (instant fail). Repair happens grounded/
 * slow at a base — `Game` decides that and passes `repairing`; here we just integrate.
 */

export interface HealthDemand {
  impact: number; // sink rate (units/s) at floor contact THIS frame, else 0 (one-shot hard landing)
  repairing: boolean; // grounded + slow within a base's radius this frame
}

export class HealthSim {
  private _health = 1; // 1 = pristine, 0 = wrecked
  private _dead = false;
  /** Per-heli durability — incoming damage is divided by this (≥ small positive). */
  private readonly toughness: number;

  constructor(toughness = 1) {
    this.toughness = Number.isFinite(toughness) && toughness > 0 ? toughness : 1;
  }

  get health(): number {
    return this._health;
  }

  get dead(): boolean {
    return this._dead;
  }

  /** Gauge should flash: below the warn line (and not already wrecked). */
  get low(): boolean {
    return !this._dead && this._health <= HEALTH.lowWarn;
  }

  update(dt: number, d: HealthDemand): void {
    if (!Number.isFinite(dt) || dt <= 0 || this._dead) return;

    // Repairing at a base takes priority — patch up, no damage tallied this frame.
    if (d.repairing) {
      this._health = Math.min(1, this._health + HEALTH.repairPerSec * dt);
      return;
    }

    // The only damage source: a one-shot hard-landing impact above the safe-settle sink rate.
    // Toughness divides it. Normal flying (and gentle refuel touchdowns) tally nothing.
    const impact = Number.isFinite(d.impact) ? d.impact : 0;
    if (impact <= HEALTH.hardLandingSink) return;
    const dmg = (impact - HEALTH.hardLandingSink) * HEALTH.impactDmgPerUnit;

    this._health = Math.max(0, this._health - dmg / this.toughness);
    if (this._health <= 0) this._dead = true;
  }
}
