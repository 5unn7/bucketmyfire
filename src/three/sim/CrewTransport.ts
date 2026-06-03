import { MISSIONS } from '../config';

/**
 * Crew / cargo sling transport (the campaign's delivery + evacuation mechanic) — engine-
 * agnostic, numbers only (the sim boundary): it imports only `config.ts`, owns no Three.js
 * scene and no DOM. `Game` reads its state each frame to pose the slung crew basket, tint the
 * landing-zone markers, and feed `crewsDelivered` into the mission signals.
 *
 * A landing zone is a world point with a role: `load` (pick a crew up here) or `unload` (set
 * one down here). You work a zone the same way you scoop — hold a LOW + SLOW hover within its
 * radius — for a short dwell. You carry ONE crew at a time:
 *
 *   - INSERTION: the base is a reusable `load` zone; the LZs are single-use `unload` zones.
 *     Load at base → fly to an LZ → unload (that LZ is done). `total` = the single unload zones.
 *   - EVACUATION: each threatened cabin is a single-use `load` zone; the base is a reusable
 *     `unload` zone. Load at a cabin (consumed) → fly home → unload. `total` = the single loads.
 *
 * Either way a successful unload increments `delivered`, and `total` is the count of single-use
 * endpoints — so the same machine powers both directions with one objective number.
 */

export interface CrewZone {
  x: number;
  z: number;
  role: 'load' | 'unload';
  single: boolean; // single-use endpoint (counts toward `total`) vs reusable (the base)
  label: string;
}

/** A zone as the renderer/HUD sees it — with live done/active flags for marker tinting. */
export interface CrewZoneView extends CrewZone {
  done: boolean; // a single zone that's been satisfied (greyed out)
  active: boolean; // a valid next target given the current carry state (highlighted)
}

export class CrewTransport {
  private readonly zones: CrewZone[];
  private readonly done: boolean[];
  private _carrying = false;
  private _delivered = 0;
  private _dwell = 0; // seconds held on the current zone
  private active = -1; // index of the zone currently being worked, or -1
  private readonly _total: number;

  constructor(zones: CrewZone[]) {
    this.zones = zones;
    this.done = zones.map(() => false);
    this._total = zones.filter((z) => z.single).length;
  }

  get carrying(): boolean {
    return this._carrying;
  }

  get delivered(): number {
    return this._delivered;
  }

  get total(): number {
    return this._total;
  }

  /** 0..1 progress of the dwell on the zone being worked (drives a "loading…" readout). */
  get progress(): number {
    if (this.active < 0) return 0;
    const need = this._carrying ? MISSIONS.dropSec : MISSIONS.pickupSec;
    return Math.min(1, this._dwell / need);
  }

  /** True while the heli is actively loading/unloading a crew on a zone (for HUD + audio). */
  get working(): boolean {
    return this.active >= 0;
  }

  /** Zones with live flags for the markers + radar. */
  get views(): CrewZoneView[] {
    return this.zones.map((z, i) => ({
      ...z,
      done: this.done[i],
      active: this.isTargetable(i),
    }));
  }

  /** A short guidance line for the HUD hint (null when there's nothing to do right now). */
  hint(): string | null {
    if (this._delivered >= this._total) return null;
    if (this.active >= 0) return this._carrying ? 'Setting down — hold the hover' : 'Loading crew — hold the hover';
    if (this._carrying) {
      const tgt = this.zones.find((z, i) => z.role === 'unload' && !(z.single && this.done[i]));
      return tgt ? `Carry crew to ${tgt.label}` : null;
    }
    const src = this.zones.find((z, i) => z.role === 'load' && !(z.single && this.done[i]));
    return src ? `Pick up a crew at ${src.label}` : null;
  }

  /**
   * Step the transport. `agl` is the heli's height above the flight floor and `speed` its
   * airspeed (both already computed by the flight sim); a zone only progresses while the heli
   * is low + slow over it. One crew at a time; loading toggles `carrying`, unloading delivers.
   */
  update(dt: number, x: number, z: number, agl: number, speed: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const working = agl <= MISSIONS.hoverAgl && speed <= MISSIONS.hoverSpeed;

    // Find the nearest zone we can act on given the carry state.
    let target = -1;
    let bestD: number = MISSIONS.lzRadius;
    for (let i = 0; i < this.zones.length; i++) {
      if (!this.isTargetable(i)) continue;
      const d = Math.hypot(this.zones[i].x - x, this.zones[i].z - z);
      if (d <= bestD) {
        bestD = d;
        target = i;
      }
    }

    if (target < 0 || !working) {
      this.active = -1;
      this._dwell = 0;
      return;
    }

    if (target !== this.active) {
      this.active = target;
      this._dwell = 0;
    }
    this._dwell += dt;
    const need = this._carrying ? MISSIONS.dropSec : MISSIONS.pickupSec;
    if (this._dwell >= need) {
      if (this._carrying) {
        this._carrying = false;
        if (this.zones[target].single) this.done[target] = true;
        this._delivered++;
      } else {
        this._carrying = true;
        if (this.zones[target].single) this.done[target] = true;
      }
      this.active = -1;
      this._dwell = 0;
    }
  }

  /** Is zone `i` a valid next target given the current carry state (and not already done)? */
  private isTargetable(i: number): boolean {
    const zn = this.zones[i];
    if (zn.single && this.done[i]) return false;
    return this._carrying ? zn.role === 'unload' : zn.role === 'load';
  }
}
