import { FIRE3D, WORLD3D } from '../config';

/**
 * Engine-agnostic forest-fire simulation as a CELLULAR FIELD (Track C5). Fire is modelled
 * as a fixed grid of cells — NOT a handful of fire objects — so propagation is a real
 * advancing front instead of parent fires spawning child dots:
 *
 *  - **Fuel grid** — every cell samples `world.fuelAt` ONCE (high in dense forest, ~0 on
 *    rock/water/road). A cell can only burn while it has fuel; when its fuel hits 0 it
 *    burns out and SCORCHES (can't reignite). Fuel continuity is what stalls a front at a
 *    lake, a road, or already-burned ground — exactly like a real fire.
 *  - **Heat + pre-heat** — a burning cell climbs toward a heat ceiling set by its fuel,
 *    consumes that fuel, and PRE-HEATS its 8 neighbours, weighted by **wind alignment**
 *    (the front runs downwind), **slope** (fire climbs), and the neighbour's fuel. When a
 *    neighbour's accumulated pre-heat crosses the ignition threshold it lights → a genuine
 *    moving front. Hot cells also **spot**: throw an ember far downwind to start a new head.
 *  - **Suppression** — a water drop zeroes heat in radius and stamps a WET firebreak that
 *    raises those cells' ignition threshold until it dries (cut a line ahead of the front).
 *
 * The renderer's fixed pool of ≤`maxActive` flame meshes is just a VIEW of the field: each
 * frame the hottest cells are clustered into a coarse blob grid and the top clusters become
 * the `FireState` "fires" the meshes/lights/smoke/embers decorate. So the public surface
 * (`spawnInitial`, `update`, `douse`, `active`, `activeCount`, …) is unchanged — `Game`,
 * `Structures`, smoke and embers consume it exactly as before.
 *
 * The world is reached only through injected callbacks (`groundHeightAt`, `isOverWater`,
 * `fuelAt`, `pickSite`) so this module never imports `World` — a future chunk streamer
 * swaps in behind those exactly like everywhere else. All grids are fixed-size typed arrays
 * (no per-frame allocation), honoring the mobile-60fps invariant.
 */

/** A single rendered fire — a CLUSTER of burning cells, exposed as the old object shape. */
export interface FireState {
  readonly id: number;
  x: number;
  z: number;
  y: number; // ground surface height (mesh sits here)
  intensity: number; // 0..FIRE3D.maxIntensity — cluster burn strength
  size: number; // 0..1 — footprint / NWCG size-class analog (how many cells are alight)
  fuel: number; // 0..1 — average remaining fuel in the cluster
  alive: boolean;
}

/** World fields the fire sim needs, injected so it stays decoupled from `World`. */
export interface FireDeps {
  rng: () => number;
  groundHeightAt(x: number, z: number): number;
  isOverWater(x: number, z: number): boolean;
  /** Base flammability 0..1 at (x,z) — high in dense forest, ~0 on rock/water/road. */
  fuelAt(x: number, z: number): number;
  /** Seeded fire-start picker (world.placement.fireSite with `bound` captured). */
  pickSite(minFromOrigin: number): { x: number; z: number } | null;
}

/** Minimal wind contract — the unit wind vector the front runs along. */
export interface WindLike {
  vx: number;
  vz: number;
}

export class FireSystem {
  // --- The field (fixed-size grids over [-size/2, size/2]²) -------------------
  private readonly n = FIRE3D.fireCells; // cells per side
  private readonly fuel: Float32Array; // remaining fuel per cell (0..1), sampled once
  private readonly heat: Float32Array; // live fire per cell (0..1)
  private readonly preheat: Float32Array; // accumulating ignition energy per cell
  private readonly wet: Float32Array; // doused firebreak suppression (0..1), decays
  private readonly scorch: Uint8Array; // 1 once a cell has burned out (fuel gone, can't reburn)
  private readonly cellY: Float32Array; // ground height per cell (for spread slope + mesh Y)

  private readonly half = WORLD3D.size / 2;
  private readonly cellSize = WORLD3D.size / FIRE3D.fireCells;

  // --- Render clusters (the coarse blob grid → ≤maxActive FireStates) ---------
  private readonly bn = FIRE3D.blobCells;
  private readonly bHeat: Float32Array;
  private readonly bX: Float32Array;
  private readonly bZ: Float32Array;
  private readonly bFuel: Float32Array;
  private readonly bCnt: Int32Array;
  private readonly reps: FireState[]; // reused pool (no per-frame object alloc)
  private repCount = 0;

  private burnedOutCells = 0;
  private extinguishedCells = 0;

  constructor(private readonly deps: FireDeps) {
    const N = this.n * this.n;
    this.fuel = new Float32Array(N);
    this.heat = new Float32Array(N);
    this.preheat = new Float32Array(N);
    this.wet = new Float32Array(N);
    this.scorch = new Uint8Array(N);
    this.cellY = new Float32Array(N);

    // Sample fuel + ground height per cell ONCE (the field's static terrain frame).
    for (let cz = 0; cz < this.n; cz++) {
      for (let cx = 0; cx < this.n; cx++) {
        const i = cz * this.n + cx;
        const wx = -this.half + (cx + 0.5) * this.cellSize;
        const wz = -this.half + (cz + 0.5) * this.cellSize;
        this.cellY[i] = this.deps.groundHeightAt(wx, wz);
        this.fuel[i] = this.deps.isOverWater(wx, wz) ? 0 : Math.max(0, Math.min(1, this.deps.fuelAt(wx, wz)));
      }
    }

    const B = this.bn * this.bn;
    this.bHeat = new Float32Array(B);
    this.bX = new Float32Array(B);
    this.bZ = new Float32Array(B);
    this.bFuel = new Float32Array(B);
    this.bCnt = new Int32Array(B);
    this.reps = [];
    for (let i = 0; i < FIRE3D.maxActive; i++) {
      this.reps.push({ id: i, x: 0, z: 0, y: 0, intensity: 0, size: 0, fuel: 0, alive: true });
    }
  }

  /** Seed the opening fires in dry forest, off the player's spawn. */
  spawnInitial(count: number, minFromOrigin: number): void {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 500) {
      const site = this.deps.pickSite(minFromOrigin);
      if (!site) continue;
      if (this.igniteDisc(site.x, site.z, FIRE3D.seedRadius)) placed++;
    }
    this.rebuildReps();
  }

  /**
   * Light a fire at an EXACT world point with a chosen disc radius (cells) and starting heat —
   * the mission campaign's targeted entry point (a small Class-A spot vs a large established
   * blaze) versus `spawnInitial`'s random fuel-biased seeding. A bigger radius + higher heat
   * reads immediately as a higher size-class fire (more lit cells → larger cluster footprint).
   */
  igniteAt(x: number, z: number, radiusCells: number, heat: number = FIRE3D.seedHeat): boolean {
    const caught = this.igniteDisc(x, z, radiusCells, heat);
    this.rebuildReps();
    return caught;
  }

  /**
   * Light a row of seed discs along a line through (x,z) — an established fire FRONT rather than a
   * single spot. `(dirX,dirZ)` is the line axis (need not be normalized; e.g. wind-perpendicular so
   * the front faces downwind), `lengthU` its full world-unit extent. Discs are spaced ~one disc
   * apart so they merge into one continuous line of fire. Used by a mission's opening blaze so the
   * scene reads like a real ridge-line front (and feeds one cohesive smoke column). Returns true if
   * any cell caught.
   */
  igniteLine(
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    lengthU: number,
    radiusCells: number,
    heat: number = FIRE3D.seedHeat,
  ): boolean {
    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len;
    const uz = dirZ / len;
    const step = Math.max(this.cellSize, radiusCells * this.cellSize * 1.6); // ~one disc apart
    const half = lengthU / 2;
    let caught = false;
    for (let d = -half; d <= half + 1e-3; d += step) {
      if (this.igniteDisc(x + ux * d, z + uz * d, radiusCells, heat)) caught = true;
    }
    this.rebuildReps();
    return caught;
  }

  /** Advance the field one step: burn + fuel depletion + neighbour spread + spotting + drying. */
  update(dtMs: number, wind: WindLike): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = Math.min(dtMs / 1000, 0.1); // clamp big stalls so the front can't jump

    const n = this.n;
    const N = n * n;
    const wlen = Math.hypot(wind.vx, wind.vz);
    const wnx = wlen > 1e-4 ? wind.vx / wlen : 0;
    const wnz = wlen > 1e-4 ? wind.vz / wlen : 0;

    // --- Pass A: burn each lit cell, consume its fuel, deposit pre-heat on neighbours ---
    for (let i = 0; i < N; i++) {
      const h = this.heat[i];
      if (h <= 0) continue;

      // Consume fuel (a smolder floor guarantees it reaches 0 in finite time → burn-out).
      const burn = FIRE3D.cellBurnRate * (FIRE3D.cellSmolderFloor + (1 - FIRE3D.cellSmolderFloor) * h) * dt;
      let f = this.fuel[i] - burn;
      if (f <= 0) {
        f = 0;
        if (this.scorch[i] === 0) {
          this.scorch[i] = 1;
          this.burnedOutCells++;
        }
      }
      this.fuel[i] = f;

      // Heat climbs toward a ceiling = remaining fuel; as fuel drains the flame dies with it.
      // A WET cell (just doused) regrows far more slowly, so a knockdown HOLDS while the firebreak
      // is fresh and only re-flares as it dries — water becomes a tactical holding action, not a
      // delete button (the smolder/re-flare loop). cellSmolderFloor keeps a tiny climb so a barely-
      // wet cell still creeps back; a fully-wet cell is nearly frozen.
      const regrow = FIRE3D.cellRegrow * (1 - FIRE3D.wetRegrowSuppress * this.wet[i]);
      let nh = h < f ? Math.min(f, h + regrow * dt) : f;
      if (nh < 0) nh = 0;
      this.heat[i] = nh;
      if (nh <= 0.04) continue; // too weak to spread

      // Pre-heat the 8 neighbours, weighted by wind alignment + slope + their fuel.
      const cx = i % n;
      const cz = (i / n) | 0;
      const yi = this.cellY[i];
      for (let oz = -1; oz <= 1; oz++) {
        const nz = cz + oz;
        if (nz < 0 || nz >= n) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oz === 0) continue;
          const nx = cx + ox;
          if (nx < 0 || nx >= n) continue;
          const j = nz * n + nx;
          if (this.scorch[j] === 1) continue;
          const fj = this.fuel[j];
          if (fj < FIRE3D.minFuel) continue;
          if (this.heat[j] >= fj) continue; // already as lit as its fuel allows

          // Direction to the neighbour (normalized; diagonals are longer).
          const inv = ox !== 0 && oz !== 0 ? 0.70710678 : 1;
          const dirx = ox * inv;
          const dirz = oz * inv;
          // Wind: a downwind neighbour gets far more pre-heat.
          const align = Math.max(0, dirx * wnx + dirz * wnz);
          let w = 1 + FIRE3D.windSpread * align;
          // Slope: an uphill neighbour gets more; downhill a little less (fire climbs).
          const dUp = (this.cellY[j] - yi) / FIRE3D.slopeRef;
          if (dUp > 0) w *= 1 + FIRE3D.slopeSpread * Math.min(1, dUp);
          else w *= Math.max(0.5, 1 + 0.3 * Math.max(-1, dUp));
          // Thin fuel carries the front more slowly.
          w *= 0.4 + 0.6 * fj;

          this.preheat[j] += FIRE3D.spreadRate * h * w * inv * dt;
        }
      }

      // Spotting: ONLY a very hot head in STRONG wind, and rarely — this is the lever that
      // keeps the map from lighting up everywhere at once (a real fire mostly creeps; embers
      // jump ahead only occasionally in a strong wind).
      if (wlen > 0.5 && h > 0.75 && this.deps.rng() < FIRE3D.spotChance * dt) {
        const dist = FIRE3D.spotDist * (0.5 + this.deps.rng());
        const ang = Math.atan2(wnz, wnx) + (this.deps.rng() - 0.5) * 0.7;
        const sx = -this.half + (cx + 0.5) * this.cellSize + Math.cos(ang) * dist;
        const sz = -this.half + (cz + 0.5) * this.cellSize + Math.sin(ang) * dist;
        const sj = this.cellIndex(sx, sz);
        if (sj >= 0 && this.scorch[sj] === 0 && this.fuel[sj] >= FIRE3D.minFuel) {
          this.preheat[sj] += FIRE3D.igniteThreshold * 1.3; // very likely to catch next pass
        }
      }
    }

    // --- Pass B: ignite cells whose pre-heat crossed threshold; bleed pre-heat + dry wet ---
    const dryStep = dt / (FIRE3D.firebreakCooldownMs / 1000);
    const preKeep = Math.max(0, 1 - FIRE3D.preheatDecay * dt);
    for (let i = 0; i < N; i++) {
      if (this.wet[i] > 0) this.wet[i] = Math.max(0, this.wet[i] - dryStep);

      const pre = this.preheat[i];
      if (pre <= 0) continue;
      if (this.heat[i] <= 0 && this.scorch[i] === 0 && this.fuel[i] >= FIRE3D.minFuel) {
        const thr = FIRE3D.igniteThreshold * (1 + FIRE3D.wetResist * this.wet[i]);
        if (pre >= thr) {
          this.heat[i] = Math.min(this.fuel[i], FIRE3D.seedHeat);
          this.preheat[i] = 0;
          continue;
        }
      }
      this.preheat[i] = pre * preKeep;
    }

    this.rebuildReps();
  }

  /**
   * Apply a water drop centered at (x,z): zero heat within `radius` by volume (fast dump and
   * slow valve pour knock down the same per litre), kill pending ignition, and stamp a WET
   * firebreak that resists reignition until it dries — so you can cut a line ahead of a front.
   */
  douse(x: number, z: number, radius: number, litres: number): void {
    const knock = litres / FIRE3D.litresToClear; // heat (0..1) removed per cell
    const r2 = radius * radius;
    const n = this.n;
    const minCx = clampInt(Math.floor((x - radius + this.half) / this.cellSize), 0, n - 1);
    const maxCx = clampInt(Math.floor((x + radius + this.half) / this.cellSize), 0, n - 1);
    const minCz = clampInt(Math.floor((z - radius + this.half) / this.cellSize), 0, n - 1);
    const maxCz = clampInt(Math.floor((z + radius + this.half) / this.cellSize), 0, n - 1);
    for (let cz = minCz; cz <= maxCz; cz++) {
      const wz = -this.half + (cz + 0.5) * this.cellSize;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const wx = -this.half + (cx + 0.5) * this.cellSize;
        if ((wx - x) * (wx - x) + (wz - z) * (wz - z) > r2) continue;
        const i = cz * n + cx;
        if (this.heat[i] > 0) {
          const after = Math.max(0, this.heat[i] - knock);
          if (after <= 0) this.extinguishedCells++;
          this.heat[i] = after;
        }
        this.preheat[i] = 0; // water kills pending ignition
        if (this.wet[i] < FIRE3D.firebreakStrength) this.wet[i] = FIRE3D.firebreakStrength;
      }
    }
    this.rebuildReps();
  }

  // --- Accessors (read by Game.ts each frame) --------------------------------

  active(): readonly FireState[] {
    return this.reps.slice(0, this.repCount);
  }

  get activeCount(): number {
    return this.repCount;
  }

  /** Cells that consumed their fuel and self-extinguished, scaled to "fire" units. */
  get burnedOut(): number {
    return Math.floor(this.burnedOutCells / FIRE3D.cellsPerFire);
  }

  /** Fires the player extinguished with water (not those that burned out) — for scoring. */
  get doused(): number {
    return Math.floor(this.extinguishedCells / FIRE3D.cellsPerFire);
  }

  get totalIntensity(): number {
    let s = 0;
    for (let i = 0; i < this.repCount; i++) s += this.reps[i].intensity;
    return s;
  }

  /**
   * Live fire heat (0..1) at a world point — the bridge that lets OTHER systems read the
   * field directly: trees ask "is my cell burning?" (→ ignite/collapse), fauna ask "is
   * there fire near me?" (→ flee), smoke asks "how much is alight upwind?" (→ blinding).
   * O(1) cell lookup; returns 0 outside the grid.
   */
  heatAt(x: number, z: number): number {
    const i = this.cellIndex(x, z);
    return i < 0 ? 0 : this.heat[i];
  }

  /** True once a cell has burned out (fuel consumed) — a tree there should be a charred snag. */
  scorchedAt(x: number, z: number): boolean {
    const i = this.cellIndex(x, z);
    return i < 0 ? false : this.scorch[i] === 1;
  }

  // --- Internals -------------------------------------------------------------

  /** Light a disc of cells (radius in cells) around a world point. Returns true if any caught. */
  private igniteDisc(x: number, z: number, radiusCells: number, heat: number = FIRE3D.seedHeat): boolean {
    const n = this.n;
    const c0 = this.cellIndex(x, z);
    if (c0 < 0) return false;
    const cx0 = c0 % n;
    const cz0 = (c0 / n) | 0;
    let caught = false;
    for (let oz = -radiusCells; oz <= radiusCells; oz++) {
      const cz = cz0 + oz;
      if (cz < 0 || cz >= n) continue;
      for (let ox = -radiusCells; ox <= radiusCells; ox++) {
        const cx = cx0 + ox;
        if (cx < 0 || cx >= n) continue;
        if (ox * ox + oz * oz > radiusCells * radiusCells) continue;
        const i = cz * n + cx;
        if (this.scorch[i] === 1 || this.fuel[i] < FIRE3D.minFuel) continue;
        this.heat[i] = Math.max(this.heat[i], Math.min(this.fuel[i], heat));
        caught = true;
      }
    }
    return caught;
  }

  /** World (x,z) → cell index, or -1 if outside the grid. */
  private cellIndex(x: number, z: number): number {
    const n = this.n;
    const cx = Math.floor((x + this.half) / this.cellSize);
    const cz = Math.floor((z + this.half) / this.cellSize);
    if (cx < 0 || cx >= n || cz < 0 || cz >= n) return -1;
    return cz * n + cx;
  }

  /**
   * Cluster the hot cells into the coarse blob grid and emit the top ≤maxActive clusters as
   * `FireState`s (centroid, aggregate intensity, footprint size, mean fuel). Stable slot order
   * (sorted by blob index) so a rendered fire doesn't jump meshes frame-to-frame.
   */
  private rebuildReps(): void {
    const n = this.n;
    const bn = this.bn;
    const B = bn * bn;
    this.bHeat.fill(0);
    this.bX.fill(0);
    this.bZ.fill(0);
    this.bFuel.fill(0);
    this.bCnt.fill(0);
    const bcell = WORLD3D.size / bn;

    for (let i = 0; i < n * n; i++) {
      const h = this.heat[i];
      if (h < FIRE3D.repCellMin) continue;
      const cx = i % n;
      const cz = (i / n) | 0;
      const wx = -this.half + (cx + 0.5) * this.cellSize;
      const wz = -this.half + (cz + 0.5) * this.cellSize;
      const bx = clampInt(Math.floor((wx + this.half) / bcell), 0, bn - 1);
      const bz = clampInt(Math.floor((wz + this.half) / bcell), 0, bn - 1);
      const b = bz * bn + bx;
      this.bHeat[b] += h;
      this.bX[b] += wx * h;
      this.bZ[b] += wz * h;
      this.bFuel[b] += this.fuel[i];
      this.bCnt[b]++;
    }

    // Collect qualifying blobs, keep the strongest maxActive, then sort by index for stable slots.
    const picked: number[] = [];
    for (let b = 0; b < B; b++) {
      if (this.bHeat[b] >= FIRE3D.repMinHeat) picked.push(b);
    }
    picked.sort((a, c) => this.bHeat[c] - this.bHeat[a]);
    if (picked.length > FIRE3D.maxActive) picked.length = FIRE3D.maxActive;
    picked.sort((a, c) => a - c);

    for (let k = 0; k < picked.length; k++) {
      const b = picked[k];
      const sumH = this.bHeat[b];
      const cnt = this.bCnt[b];
      const x = this.bX[b] / sumH;
      const z = this.bZ[b] / sumH;
      const avgH = sumH / cnt; // 0..1 mean heat across the cluster's lit cells
      const rep = this.reps[k];
      rep.x = x;
      rep.z = z;
      rep.y = this.deps.groundHeightAt(x, z);
      rep.intensity = FIRE3D.maxIntensity * Math.min(1, avgH);
      rep.size = Math.min(1, cnt / FIRE3D.cellsForFullSize);
      rep.fuel = this.bFuel[b] / cnt;
      rep.alive = true;
    }
    this.repCount = picked.length;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
