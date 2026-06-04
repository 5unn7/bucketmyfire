import { MISSIONS } from '../config';

/**
 * Crew transport (the campaign's delivery + evacuation mechanic) — engine-agnostic, numbers only
 * (the sim boundary): it imports only `config.ts`, owns no Three.js scene and no DOM. `Game` reads
 * its state each frame to show/hide the crew figures at each zone, tint the landing-zone markers,
 * and feed `crewsDelivered` into the mission signals.
 *
 * A landing zone is a world point with a role: `load` (pick a crew up here) or `unload` (set
 * one down here). You work a zone by LANDING on it — set the skids down within its radius and
 * bring the aircraft to a stop — then holding the touchdown for a short dwell while the crew
 * board or step off (no slung basket; they ride in the cabin). You carry ONE crew at a time:
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
  active: boolean; // THE single next target given the carry state (highlighted) — one at a time
  home: boolean; // the reusable base endpoint — always marked uniquely (persistent home beacon)
}

export class CrewTransport {
  private readonly zones: CrewZone[];
  private readonly done: boolean[];
  private _carrying = false;
  private _delivered = 0;
  private _dwell = 0; // seconds held on the current zone
  private active = -1; // index of the zone currently being worked, or -1
  private _total: number; // single-use endpoint count — grows if a pop-up rescue zone is added

  constructor(zones: CrewZone[], startCarrying = false) {
    // Own a COPY — never alias the caller's array. Game passes its own `crewZones` in and also keeps
    // pushing pop-up rescue zones onto it; sharing the reference would double-append here (the sim
    // would see every runtime zone twice and desync `done`/markers). The sim owns its zone list.
    this.zones = [...zones];
    this.done = this.zones.map(() => false);
    this._total = zones.filter((z) => z.single).length;
    // Some missions begin with the first crew already aboard (skip the opening base pickup) — the
    // first targetable zone is then an UNLOAD, so the player flies straight out to set them down.
    this._carrying = startCarrying;
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

  /**
   * Append a crew endpoint at runtime — a mid-mission pop-up rescue (its cabin + the family). A
   * single-use endpoint bumps `total` (so an `evacuate n` objective added alongside has somewhere to
   * be satisfied). The renderer keeps its marker/figure arrays parallel by appending in lock-step.
   */
  addZone(zone: CrewZone): void {
    this.zones.push(zone);
    this.done.push(false);
    if (zone.single) this._total++;
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

  /** Index of the zone currently being worked (loading/unloading), or -1 — drives the board/disembark animation. */
  get activeZone(): number {
    return this.active;
  }

  /** Number of crew currently in the cabin (0 or 1 — one at a time). Drives the HUD crew-count icon. */
  get onboard(): number {
    return this._carrying ? 1 : 0;
  }

  /**
   * What the heli is doing on the zone it's working RIGHT NOW: `boarding` (a crew is climbing in at a
   * load zone) or `disembarking` (stepping off at an unload zone), or null when not actively working a
   * zone. Drives the HUD "CREW BOARDING / DISEMBARKING" progress bar (paired with `progress`).
   */
  get mode(): 'boarding' | 'disembarking' | null {
    if (this.active < 0) return null;
    return this._carrying ? 'disembarking' : 'boarding';
  }

  /** Zones with live flags for the markers + radar. */
  get views(): CrewZoneView[] {
    return this.zones.map((z, i) => ({
      ...z,
      done: this.done[i],
      active: this.isTargetable(i),
      home: !z.single, // the reusable base — always the "home" endpoint
    }));
  }

  /** A short guidance line for the HUD hint (null when there's nothing to do right now). */
  hint(): string | null {
    if (this._delivered >= this._total) return null;
    if (this.active >= 0) return this._carrying ? 'Crew disembarking — hold it on the deck' : 'Crew boarding — hold it on the deck';
    if (this._carrying) {
      const tgt = this.zones.find((z, i) => z.role === 'unload' && !(z.single && this.done[i]));
      return tgt ? `Land at ${tgt.label} to drop the crew` : null;
    }
    const src = this.zones.find((z, i) => z.role === 'load' && !(z.single && this.done[i]));
    return src ? `Land at ${src.label} to pick up a crew` : null;
  }

  /**
   * Step the transport. `agl` is the heli's height above the (eased) flight floor and `speed` its
   * airspeed (both already computed by the flight sim); a zone only progresses while the heli is
   * LANDED on it — skids down (agl ≤ landAgl) and stopped (speed ≤ landSpeed). One crew at a time;
   * loading toggles `carrying`, unloading delivers.
   */
  update(dt: number, x: number, z: number, agl: number, speed: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const working = agl <= MISSIONS.landAgl && speed <= MISSIONS.landSpeed;

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

  /**
   * Is zone `i` THE next target given the current carry state? Single-use endpoints light ONE AT A
   * TIME, in array order (so a pickup leaves exactly one LZ lit — the guidance the player follows);
   * the reusable base is always available for its role (and is marked separately as "home").
   */
  private isTargetable(i: number): boolean {
    const zn = this.zones[i];
    if (zn.single && this.done[i]) return false;
    const need: 'load' | 'unload' = this._carrying ? 'unload' : 'load';
    if (zn.role !== need) return false;
    if (!zn.single) return true; // the reusable base is always a valid endpoint for its role
    return i === this.nextSingleIndex(need); // single endpoints are sequential — only the next one
  }

  /** Array index of the first not-done single-use zone of `role` (the next in sequence), or -1. */
  private nextSingleIndex(role: 'load' | 'unload'): number {
    for (let i = 0; i < this.zones.length; i++) {
      if (this.zones[i].single && this.zones[i].role === role && !this.done[i]) return i;
    }
    return -1;
  }
}
