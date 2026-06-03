import { HEALTH, BUCKET3D } from '../config';

/**
 * Airframe health / damage model (engine-agnostic — imports only `config.ts`, like
 * `FuelSim`/`HelicopterSim`). It owns a single number, `health` 1→0, that `Game` drains
 * from per-frame DAMAGE signals and refills at the depot. No Three.js, no DOM.
 *
 * Damage has four sources (all metered, not a wall clock, so flying clean costs nothing):
 *   - fire heat   : flying LOW over a blaze cooks the airframe (Game gates the AGL + reach).
 *   - bucket scrape: dragging the slung bucket through terrain/canopy fast stresses the airframe
 *                    (the same scrape that already slops water — only above BUCKET3D.spillDragMin).
 *   - overspeed   : holding a committed dive PAST the speed cap over-stresses the rotor/airframe.
 *   - hard landing: bottoming out on the floor with a high sink rate — a one-shot impact hit.
 * Per-heli `toughness` (HELI_CLASSES) DIVIDES all of it, so a Black Hawk shrugs off what wrecks a 205.
 *
 * `dead` latches at zero; `Game` then crashes the mission (instant fail). Repair happens grounded/
 * slow at the depot — `Game` decides that and passes `repairing`; here we just integrate.
 */

export interface HealthDemand {
  fireHeat: number; // 0..1 fire-heat exposure this frame (Game has already AGL-gated it)
  scrapeSpeed: number; // units/s the bucket is scraping (0 when not in contact)
  overspeed: number; // 0..1 how far past the heli's effective max speed it's pushing
  impact: number; // sink rate (units/s) at floor contact THIS frame, else 0 (one-shot hard landing)
  repairing: boolean; // grounded + slow within the depot radius this frame
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

    // Repairing at the depot takes priority — patch up, no damage tallied this frame.
    if (d.repairing) {
      this._health = Math.min(1, this._health + HEALTH.repairPerSec * dt);
      return;
    }

    const fireHeat = clamp01(d.fireHeat);
    const overspeed = clamp01(d.overspeed);
    const scrape = Math.max(0, (Number.isFinite(d.scrapeSpeed) ? d.scrapeSpeed : 0) - BUCKET3D.spillDragMin);

    // Continuous damage (per second), then the one-shot hard-landing impact. Toughness divides all.
    let dmg =
      (HEALTH.fireDmgPerSec * fireHeat +
        HEALTH.scrapeDmgPerUnit * scrape +
        HEALTH.overspeedDmgPerSec * overspeed) *
      dt;
    const impact = Number.isFinite(d.impact) ? d.impact : 0;
    if (impact > HEALTH.hardLandingSink) dmg += (impact - HEALTH.hardLandingSink) * HEALTH.impactDmgPerUnit;

    this._health = Math.max(0, this._health - dmg / this.toughness);
    if (this._health <= 0) this._dead = true;
  }
}

function clamp01(v: number): number {
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
}
