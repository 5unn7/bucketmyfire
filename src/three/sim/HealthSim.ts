import { HEALTH } from '../config';

/**
 * Airframe health / damage model (engine-agnostic — imports only `config.ts`, like
 * `FuelSim`/`HelicopterSim`). It owns a single number, `health` 1→0, that `Game` drains
 * from per-frame DAMAGE signals and refills at a base. No Three.js, no DOM.
 *
 * Damage has ONE source: a hard landing — bottoming out on the floor with a high sink rate (a
 * one-shot impact hit above `HEALTH.hardLandingSink`). The impact's SEVERITY ramps 0→1 across
 * [hardLandingSink … fatalSink]; once it crosses `HEALTH.explodeSeverity` the landing is unsurvivable
 * — the airframe is destroyed outright (a slam, not a slow bleed) and `fatal` latches for that frame so
 * `Game` can blow it up. A softer-but-still-hard landing only DENTS the airframe, divided by
 * per-heli `toughness` (so a Black Hawk shrugs off what wrecks a 205); the explosion gate ignores
 * toughness — a vertical slam is a slam. Flying low through fire, dragging the bucket, and overspeed
 * no longer cook the airframe — FUEL is the resource that ticks down (see `FuelSim`).
 *
 * `dead` latches at zero (either an explosive impact OR the airframe ground down across several bad
 * landings); `Game` then crashes the mission (instant fail). Repair happens grounded/slow at a base —
 * `Game` decides that and passes `repairing`; here we just integrate.
 */

export interface HealthDemand {
  impact: number; // sink rate (units/s) at floor contact THIS frame, else 0 (one-shot hard landing)
  repairing: boolean; // grounded + slow within a base's radius this frame
  overWater?: boolean; // the contact was on the WATER floor (a scoop) — cushioned: it can dent, but never EXPLODE
}

export class HealthSim {
  private _health = 1; // 1 = pristine, 0 = wrecked
  private _dead = false;
  private _fatalImpact = false; // this frame's impact was an unsurvivable slam (explosion), not a dent
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

  /** True only on the frame an unsurvivable hard-landing slam destroyed the airframe (severity past
   *  `HEALTH.explodeSeverity`). `Game` reads it to choose the explosion VFX + "heavy impact" copy. */
  get fatalImpact(): boolean {
    return this._fatalImpact;
  }

  /** Gauge should flash: below the warn line (and not already wrecked). */
  get low(): boolean {
    return !this._dead && this._health <= HEALTH.lowWarn;
  }

  update(dt: number, d: HealthDemand): void {
    this._fatalImpact = false; // one-shot — set only on a frame that detonates the airframe
    if (!Number.isFinite(dt) || dt <= 0 || this._dead) return;

    // Repairing at a base takes priority — patch up, no damage tallied this frame.
    if (d.repairing) {
      this._health = Math.min(1, this._health + HEALTH.repairPerSec * dt);
      return;
    }

    // The only damage source: a one-shot hard-landing impact above the safe-settle sink rate.
    // Normal flying (and gentle refuel touchdowns) tally nothing.
    const impact = Number.isFinite(d.impact) ? d.impact : 0;
    if (impact <= HEALTH.hardLandingSink) return;

    // Catastrophic-impact gate: severity ramps 0→1 across [hardLandingSink … fatalSink]. Past
    // `explodeSeverity` the arrival is a slam — the airframe is destroyed outright (toughness does NOT
    // save you from a vertical impact) and `fatalImpact` latches so Game blows it up in place. A
    // contact on the WATER floor (a scoop) is cushioned — it still dents below, but never explodes,
    // so a firm scoop descent is forgiven (the explosion is for slamming the GROUND).
    const span = Math.max(0.001, HEALTH.fatalSink - HEALTH.hardLandingSink);
    const severity = Math.min(1, (impact - HEALTH.hardLandingSink) / span);
    if (!d.overWater && severity >= HEALTH.explodeSeverity) {
      this._health = 0;
      this._dead = true;
      this._fatalImpact = true;
      return;
    }

    // Survivable hard landing — a toughness-divided dent. Several of these can still grind the airframe
    // to zero (also a crash, just not an explosive one — Game detonates either way).
    const dmg = (impact - HEALTH.hardLandingSink) * HEALTH.impactDmgPerUnit;
    this._health = Math.max(0, this._health - dmg / this.toughness);
    if (this._health <= 0) this._dead = true;
  }
}
