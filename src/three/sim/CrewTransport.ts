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
  hover?: boolean; // deliver by HOLDING A HOVER over the spot for MISSIONS.hoverSec (airborne, near-still) vs landing
  lowHover?: boolean; // precision low hover drill — hold near-ground AGL for MISSIONS.lowHoverSec, no crew
}

/** A zone as the renderer/HUD sees it — with live done/active flags for marker tinting. */
export interface CrewZoneView extends CrewZone {
  done: boolean; // a single zone that's been satisfied (greyed out)
  active: boolean; // THE single next target given the carry state (highlighted) — one at a time
  home: boolean; // the reusable base endpoint — always marked uniquely (persistent home beacon)
  lost: boolean; // a trapped family the fire reached first (the zone is dead — marker out, crew gone)
}

export class CrewTransport {
  private readonly zones: CrewZone[];
  private readonly done: boolean[];
  private readonly lost: boolean[]; // single LOAD zones the fire overran before pickup (family lost)
  private readonly exposure: number[]; // per-zone seconds of sustained fire heat (resets when doused)
  private _lostCount = 0;
  private _carrying = false;
  private _delivered = 0;
  private _dwell = 0; // seconds held on the current zone
  private _breach = 0; // seconds since a low-hover hold lapsed (drift/climb/overspeed) — within grace it only PAUSES the dwell
  private active = -1; // index of the zone currently being worked, or -1
  private _total: number; // single-use endpoint count — grows if a pop-up rescue zone is added

  constructor(zones: CrewZone[], startCarrying = false) {
    // Own a COPY — never alias the caller's array. Game passes its own `crewZones` in and also keeps
    // pushing pop-up rescue zones onto it; sharing the reference would double-append here (the sim
    // would see every runtime zone twice and desync `done`/markers). The sim owns its zone list.
    this.zones = [...zones];
    this.done = this.zones.map(() => false);
    this.lost = this.zones.map(() => false);
    this.exposure = this.zones.map(() => 0);
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

  /** Trapped families the fire reached before pickup (drives the `rescue` mission fail). */
  get lostCount(): number {
    return this._lostCount;
  }

  /**
   * Append a crew endpoint at runtime — a mid-mission pop-up rescue (its cabin + the family). A
   * single-use endpoint bumps `total` (so an `evacuate n` objective added alongside has somewhere to
   * be satisfied). The renderer keeps its marker/figure arrays parallel by appending in lock-step.
   */
  addZone(zone: CrewZone): void {
    this.zones.push(zone);
    this.done.push(false);
    this.lost.push(false);
    this.exposure.push(0);
    if (zone.single) this._total++;
  }

  /**
   * Fire-overrun check for trapped families. Each pending single LOAD zone (a family awaiting pickup)
   * accrues exposure while fire heat at its spot is at/above `MISSIONS.casualtyHeat`; past
   * `casualtyGrace` seconds it's LOST — the fire reached them first. Heat dropping (you doused near
   * them, or the front moved) RESETS the timer, so watering a trapped family buys time to reach them.
   * The zone you're actively boarding is spared (you're on it). Returns `{ lost, danger }` indices of
   * a family lost / newly endangered THIS frame (or -1 each) so Game can fire the radio + marker.
   * `heatAt` is the live fire field; call once per frame while the mission is underway.
   */
  checkCasualties(heatAt: (x: number, z: number) => number, dt: number): { lost: number; danger: number } {
    let lost = -1;
    let danger = -1;
    if (!Number.isFinite(dt) || dt <= 0) return { lost, danger };
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      if (zn.role !== 'load' || !zn.single || this.done[i] || this.lost[i] || i === this.active) continue;
      if (heatAt(zn.x, zn.z) >= MISSIONS.casualtyHeat) {
        if (this.exposure[i] === 0 && danger < 0) danger = i; // rising edge → "fire's on the family" warning
        this.exposure[i] += dt;
        if (this.exposure[i] >= MISSIONS.casualtyGrace) {
          this.lost[i] = true;
          this._lostCount++;
          if (lost < 0) lost = i;
        }
      } else {
        this.exposure[i] = 0; // heat dropped → they hang on
      }
    }
    return { lost, danger };
  }

  /** 0..1 progress of the dwell on the zone being worked (drives a "loading…" readout). */
  get progress(): number {
    if (this.active < 0) return 0;
    return Math.min(1, this._dwell / this.needFor(this.active));
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
   * load zone), `disembarking` (stepping off at an unload zone), `deploying` (a crew rappels out during a
   * low-hover hold), or null when not actively working a zone. Drives the HUD "CREW BOARDING /
   * DISEMBARKING / DEPLOYING" progress bar (paired with `progress`).
   */
  get mode(): 'boarding' | 'disembarking' | 'deploying' | null {
    if (this.active < 0) return null;
    if (this.zones[this.active].lowHover) return 'deploying'; // low-hover hold: crew deploy on the line while you hold it
    return this._carrying ? 'disembarking' : 'boarding';
  }

  /** Zones with live flags for the markers + radar. */
  get views(): CrewZoneView[] {
    return this.zones.map((z, i) => ({
      ...z,
      done: this.done[i],
      active: this.isTargetable(i),
      home: !z.single, // the reusable base — always the "home" endpoint
      lost: this.lost[i], // the fire got there first — marker dies, crew gone
    }));
  }

  /** A short guidance line for the HUD hint (null when there's nothing to do right now). */
  hint(): string | null {
    if (this._delivered >= this._total) return null;
    if (this.active >= 0) {
      if (this.zones[this.active].lowHover) return 'Hold it low and steady — mind the treeline';
      if (this.zones[this.active].hover) return 'Hold the hover steady — crew on the line';
      return this._carrying ? 'Crew disembarking — hold it on the deck' : 'Crew boarding — hold it on the deck';
    }
    // nav hint toward next low-hover spot (no crew carry state)
    const nextLH = this.zones.find((z, i) => z.lowHover && z.single && !(this.done[i] || this.lost[i]));
    if (nextLH) return `Drop into ${nextLH.label} — settle low and hold it steady, off the trees`;
    if (this._carrying) {
      const tgt = this.zones.find((z, i) => z.role === 'unload' && !(z.single && (this.done[i] || this.lost[i])));
      if (!tgt) return null;
      return tgt.hover ? `Hover over ${tgt.label} to drop the crew` : `Land at ${tgt.label} to drop the crew`;
    }
    const src = this.zones.find((z, i) => z.role === 'load' && !(z.single && (this.done[i] || this.lost[i])));
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

    // Find the nearest zone we can act on given the carry state. A low-hover spot has a TIGHTER acceptance
    // radius than a landing LZ (the hole you drop into is small), so the capture radius is per-zone.
    let target = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.zones.length; i++) {
      if (!this.isTargetable(i)) continue;
      const cap = this.zones[i].lowHover ? MISSIONS.lowHoverRadius : MISSIONS.lzRadius;
      const d = Math.hypot(this.zones[i].x - x, this.zones[i].z - z);
      if (d <= cap && d < bestD) {
        bestD = d;
        target = i;
      }
    }

    // The "holding" gate depends on the zone: a HOVER zone wants a held stationary hover (airborne, under the
    // ceiling, near-still); a normal zone wants skids-down-and-stopped. Either way you must be ON the zone.
    if (target < 0 || !this.holding(target, agl, speed)) {
      // LOW-HOVER GRACE: a brief lapse (a wobble out of the band or a nudge off the spot) shouldn't zero a
      // long hold. While working a low-hover spot, a breach shorter than `lowHoverGraceSec` only PAUSES the
      // dwell — the timer freezes and resumes on recovery. Past the grace (or any non-drill zone) it resets.
      if (this.active >= 0 && this.zones[this.active].lowHover) {
        this._breach += dt;
        if (this._breach < MISSIONS.lowHoverGraceSec) return; // pause: keep `active` + `_dwell`, wait for recovery
      }
      this.active = -1;
      this._dwell = 0;
      this._breach = 0;
      return;
    }
    this._breach = 0; // holding again — clear any paused-breach grace

    if (target !== this.active) {
      this.active = target;
      this._dwell = 0;
    }
    this._dwell += dt;
    if (this._dwell >= this.needFor(target)) {
      if (this.zones[target].lowHover) {
        // pure drill — no crew, just mark the spot done and count it
        if (this.zones[target].single) this.done[target] = true;
        this._delivered++;
      } else if (this._carrying) {
        this._carrying = false;
        if (this.zones[target].single) this.done[target] = true;
        this._delivered++;
      } else {
        this._carrying = true;
        if (this.zones[target].single) this.done[target] = true;
      }
      this.active = -1;
      this._dwell = 0;
      this._breach = 0;
    }
  }

  /** Is the heli holding zone `i`? A LOW HOVER zone needs near-ground AGL; a HOVER zone needs an
   *  airborne mid-altitude hover; a normal zone needs skids down and stopped. */
  private holding(i: number, agl: number, speed: number): boolean {
    // LOW HOVER: be LOW (within the ground-relative ceiling) and STEADY. `agl` already rides the flight
    // floor, so this is measured from the GROUND — from the settled rest up to a forgiving low ceiling (no
    // strict airborne lower bound, which was unholdable). The hold is deliberately easy; the DIFFICULTY is
    // lateral — the tight tree ring (lowHoverClearRadius) means drifting off-centre strikes the canopy.
    if (this.zones[i].lowHover) return agl <= MISSIONS.lowHoverAglMax && speed <= MISSIONS.lowHoverSpeed;
    if (this.zones[i].hover) return agl > MISSIONS.landAgl && agl <= MISSIONS.hoverAglMax && speed <= MISSIONS.hoverSpeed;
    return agl <= MISSIONS.landAgl && speed <= MISSIONS.landSpeed;
  }

  /** Dwell seconds to satisfy zone `i`. */
  private needFor(i: number): number {
    if (this.zones[i].lowHover) return MISSIONS.lowHoverSec;
    if (this.zones[i].hover) return MISSIONS.hoverSec;
    return this._carrying ? MISSIONS.dropSec : MISSIONS.pickupSec;
  }

  /**
   * Is zone `i` THE next target given the current carry state? Single-use endpoints light ONE AT A
   * TIME, in array order (so a pickup leaves exactly one LZ lit — the guidance the player follows);
   * the reusable base is always available for its role (and is marked separately as "home").
   *
   * LOW HOVER zones are independent of carry state — they sequence as a pure drill, no crew needed.
   */
  private isTargetable(i: number): boolean {
    const zn = this.zones[i];
    if (zn.single && (this.done[i] || this.lost[i])) return false; // satisfied — or the fire took them
    // lowHover zones: no crew-carry dependency — the first undone lowHover is always the target
    if (zn.lowHover) return i === this.nextLowHoverIndex();
    const need: 'load' | 'unload' = this._carrying ? 'unload' : 'load';
    if (zn.role !== need) return false;
    if (!zn.single) return true; // the reusable base is always a valid endpoint for its role
    return i === this.nextSingleIndex(need); // single endpoints are sequential — only the next one
  }

  /** Index of the first not-done, not-lost lowHover zone (the next drill spot in sequence), or -1. */
  private nextLowHoverIndex(): number {
    for (let i = 0; i < this.zones.length; i++) {
      if (this.zones[i].lowHover && this.zones[i].single && !this.done[i] && !this.lost[i]) return i;
    }
    return -1;
  }

  /** Array index of the first not-done, not-lost single-use zone of `role` (the next in sequence), or -1. */
  private nextSingleIndex(role: 'load' | 'unload'): number {
    for (let i = 0; i < this.zones.length; i++) {
      if (this.zones[i].single && this.zones[i].role === role && !this.done[i] && !this.lost[i]) return i;
    }
    return -1;
  }
}
