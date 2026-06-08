import { BUCKET3D, DROP_PHYSICS, FIRE3D, WORLD3D } from '../config';

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

/**
 * What a single `douse()` actually accomplished — numbers only, so the Game/HUD can give honest
 * feedback ("Direct hit — 70% knocked down" vs "Edge only") without the sim touching the DOM. It's a
 * REUSED struct on the FireSystem instance (returned by reference) so a per-frame drop allocates nothing.
 */
export interface DouseResult {
  heatRemoved: number; // total heat (0..1 per cell, summed) this drop knocked down
  heatPresent: number; // total live heat that was in the disc when the water arrived
  cellsHit: number; // burning cells the disc covered
  cellsExtinguished: number; // cells this drop took to zero
  peakHeatHit: number; // hottest single cell the disc covered (0..1)
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
  /** Playfield extents (world units). Omit → the legacy square `WORLD3D.size` (byte-identical). */
  sizeX?: number;
  sizeZ?: number;
}

/** The canonical (finest) cell size — fixed by the square world so every map shares it. */
export const CELL_U = WORLD3D.size / FIRE3D.fireCells; // 2100 / 160 = 13.125u

/** A resolved rectangular fire grid: counts, the real cell size, and the half-extents it spans. */
export interface FireGrid {
  nx: number;
  nz: number;
  cellSize: number;
  halfX: number;
  halfZ: number;
}

/**
 * Resolve the fire grid for a playfield of `sizeX × sizeZ` world units. The cell size is the
 * CANONICAL `CELL_U` (so the fire game is scale-INVARIANT — a fire of N units is the same number
 * of cells on every map), UNLESS the area would exceed `FIRE3D.maxCells` — then the cell size
 * coarsens just enough to stay within the mobile budget (`cellSize = max(CELL_U, √(area/maxCells))`).
 * Square SK (2100²) → 160×160 at 13.125u (byte-identical); bounds SK (1060×2058) → 81×157 at 13.125u;
 * an oversized 3000² province → 160×160 at 18.75u (capped). Pure — shared by FireSystem, the fire
 * DataTexture, and the campaign verifier so they can never disagree on the grid.
 */
export function fireGridFor(sizeX: number, sizeZ: number): FireGrid {
  const cellSize = Math.max(CELL_U, Math.sqrt((sizeX * sizeZ) / FIRE3D.maxCells));
  const nx = Math.max(1, Math.round(sizeX / cellSize));
  const nz = Math.max(1, Math.round(sizeZ / cellSize));
  return { nx, nz, cellSize, halfX: sizeX / 2, halfZ: sizeZ / 2 };
}

/** Minimal wind contract — the unit wind vector the front runs along. */
export interface WindLike {
  vx: number;
  vz: number;
}

/**
 * Per-instance tuning the MISSION dials (vs the global `FIRE3D` baseline). `spreadScale` multiplies
 * the front's pre-heat creep AND ember-spotting rate, so one fire model serves a near-static tutorial
 * spot (~0.25) through a screaming firestorm (~1.3). 1 = the config baseline. (Game passes
 * `mission.fire.spreadScale`.) Kept numeric-only so the engine-agnostic sim boundary holds.
 */
export interface FireTuning {
  spreadScale?: number;
  /** Multiplies ember-SPOTTING rate on TOP of `spreadScale` (1 = no extra throttle). Lets a mission keep a
   *  lively front creep while cutting how fast it throws NEW spot fires — the solo "don't out-breed one
   *  bucket" lever. Defaults to 1 → existing missions are byte-identical. */
  spotScale?: number;
  /** Per-mission ceiling on simultaneously-counted fires, clamped to the load-time `FIRE3D.maxActive` pool
   *  capacity. Shrinks the ACTIVE subset only (the mesh pool stays sized at FIRE3D.maxActive → no realloc /
   *  shader recompile). Omit → the full pool. */
  maxActive?: number;
  /** CONTAINMENT — the "tide turns" completability guarantee for `extinguishAll` score races. Once the pilot
   *  has DOUSED this many fires (the `doused` counter), the blaze is contained: spotting stops entirely and
   *  the front's creep is throttled to `FIRE3D.containedSpreadScale`, so the remaining fire can only shrink
   *  (doused cells scorch → no new head out-breeds one bucket). Omit / 0 → no containment (byte-identical). */
  containAfter?: number;
}

/**
 * Read-only view of the live cellular field for RENDERERS (terrain char + ember glow, minimap
 * burn overlay). Numbers only — no Three — so the engine-agnostic sim boundary holds. The arrays
 * are the sim's OWN buffers (no copy): treat them as read-only and valid only for the current
 * frame; don't mutate them or stash references across a streaming swap.
 */
export interface FireFieldView {
  readonly nx: number; // cells along X
  readonly nz: number; // cells along Z (== nx on a square map)
  readonly cellSize: number; // world units per cell
  readonly halfX: number; // half the X extent — the grid spans [-halfX, halfX] in world X
  readonly halfZ: number; // half the Z extent — the grid spans [-halfZ, halfZ] in world Z
  readonly heat: Float32Array; // live fire 0..1 per cell (the actively-burning region), row-major cz*nx+cx
  readonly scorch: Uint8Array; // 1 once a cell has burned out (the lasting burn scar)
}

export class FireSystem {
  // --- The field (fixed-size grids over [-halfX,halfX] × [-halfZ,halfZ]) ------
  private readonly nx: number; // cells along X
  private readonly nz: number; // cells along Z
  private readonly cellSize: number; // world units per cell (CELL_U unless the map is coarsened)
  private readonly halfX: number; // half the X extent
  private readonly halfZ: number; // half the Z extent
  private readonly fuel: Float32Array; // remaining fuel per cell (0..1), sampled once
  private readonly heat: Float32Array; // live fire per cell (0..1)
  private readonly preheat: Float32Array; // accumulating ignition energy per cell
  private readonly wet: Float32Array; // doused firebreak suppression (0..1), decays
  private readonly charTime: Float32Array; // seconds a cell has burned hot (drives the char SCAR, not burn-out)
  private readonly scorch: Uint8Array; // 1 once a cell's ground has charred (visual scar; a doused charred cell stays out)
  private readonly cellY: Float32Array; // ground height per cell (for spread slope + mesh Y)

  // Scale-invariant cell counts derived from the authored AREAS (so a coarser grid uses fewer
  // cells for the same PHYSICAL footprint — see FIRE3D.fullSizeArea / fireArea).
  private readonly cellsForFullSize: number; // burning cells that read as cluster size 1
  private readonly cellsPerFire: number; // cells ≈ one "fire" for the scoring counters

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

  // Reused result for douse() — returned by reference so a per-frame drop never allocates.
  private readonly _douseResult: DouseResult = {
    heatRemoved: 0,
    heatPresent: 0,
    cellsHit: 0,
    cellsExtinguished: 0,
    peakHeatHit: 0,
  };

  // Stable field view object (built once) handed to renderers each frame — no per-frame alloc.
  private readonly fieldViewObj: FireFieldView;

  // Mission-dialled spread pace (1 = FIRE3D baseline) — multiplies pre-heat creep + spotting.
  private readonly spreadScale: number;
  // Mission-dialled ember-spotting throttle (1 = no extra cut), applied INDEPENDENTLY of spreadScale so the
  // front can creep lively while it stops throwing new spot fires faster than one bucket can clear.
  private readonly spotScale: number;
  // Per-mission ACTIVE-fire ceiling, clamped ≤ the load-time FIRE3D.maxActive pool capacity (mesh pool stays full).
  private readonly activeCap: number;
  // CONTAINMENT threshold: # of fires the pilot must douse before the front stops spotting + creeps slowly
  // (the "tide turns" completability rule). 0 = disabled (existing missions byte-identical).
  private readonly containAfter: number;

  constructor(private readonly deps: FireDeps, tuning: FireTuning = {}) {
    this.spreadScale = Math.max(0, tuning.spreadScale ?? 1);
    this.spotScale = Math.max(0, tuning.spotScale ?? 1);
    this.containAfter = Math.max(0, tuning.containAfter ?? 0);
    // Clamp the per-mission ceiling into [1, FIRE3D.maxActive] — never above the fixed mesh pool.
    this.activeCap = Math.max(1, Math.min(FIRE3D.maxActive, tuning.maxActive ?? FIRE3D.maxActive));
    // Resolve the rectangular grid from the playfield extents (default = the legacy square world).
    const grid = fireGridFor(deps.sizeX ?? WORLD3D.size, deps.sizeZ ?? WORLD3D.size);
    this.nx = grid.nx;
    this.nz = grid.nz;
    this.cellSize = grid.cellSize;
    this.halfX = grid.halfX;
    this.halfZ = grid.halfZ;
    // Authored AREAS → this map's cell counts (round-trips to 46 / 8 at the canonical CELL_U).
    const cellArea = this.cellSize * this.cellSize;
    this.cellsForFullSize = Math.max(1, Math.round(FIRE3D.fullSizeArea / cellArea));
    this.cellsPerFire = Math.max(1, Math.round(FIRE3D.fireArea / cellArea));
    const N = this.nx * this.nz;
    this.fuel = new Float32Array(N);
    this.heat = new Float32Array(N);
    this.preheat = new Float32Array(N);
    this.wet = new Float32Array(N);
    this.charTime = new Float32Array(N);
    this.scorch = new Uint8Array(N);
    this.cellY = new Float32Array(N);

    // Sample fuel + ground height per cell ONCE (the field's static terrain frame).
    for (let cz = 0; cz < this.nz; cz++) {
      for (let cx = 0; cx < this.nx; cx++) {
        const i = cz * this.nx + cx;
        const wx = -this.halfX + (cx + 0.5) * this.cellSize;
        const wz = -this.halfZ + (cz + 0.5) * this.cellSize;
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

    this.fieldViewObj = {
      nx: this.nx,
      nz: this.nz,
      cellSize: this.cellSize,
      halfX: this.halfX,
      halfZ: this.halfZ,
      heat: this.heat,
      scorch: this.scorch,
    };
  }

  /** World-unit length → cell count on THIS map's grid (≥1). Scenario size-classes / seed radii are
   *  authored in units; this converts them so the same physical disc is lit at any cell size. */
  cellsFromU(u: number): number {
    return Math.max(1, Math.round(u / this.cellSize));
  }

  /** The resolved cell size (world units) — exposed for renderers/tests that map cells ↔ world. */
  get cell(): number {
    return this.cellSize;
  }

  /**
   * The live cellular field for renderers (terrain char + ember glow, minimap burn). Returns a
   * STABLE object (no per-frame allocation) whose `heat`/`scorch` arrays are the sim's own live
   * buffers — read-only, valid for the current frame. This is the continuous burn the user sees:
   * `heat` is the advancing fire region, `scorch` the trailing burn scar.
   */
  fieldView(): FireFieldView {
    return this.fieldViewObj;
  }

  /** Seed the opening fires in dry forest, off the player's spawn. */
  spawnInitial(count: number, minFromOrigin: number): void {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 500) {
      const site = this.deps.pickSite(minFromOrigin);
      if (!site) continue;
      if (this.igniteDisc(site.x, site.z, this.cellsFromU(FIRE3D.seedRadiusU))) placed++;
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

    const gnx = this.nx;
    const gnz = this.nz;
    const N = gnx * gnz;
    // CONTAINMENT (the "tide turns" rule): once the pilot has doused `containAfter` fires, the front is
    // contained — stop throwing NEW spot fires (spotChance → 0) and throttle the creep to a slow residual
    // (containedSpreadScale). Doused cells already scorch permanently, so with no new heads the remaining
    // fire can only shrink → an `extinguishAll` score race (Daily Burn) is always finishable, never a treadmill.
    const contained = this.containAfter > 0 && this.doused >= this.containAfter;
    // Mission-scaled spread levers (the calm FIRE3D baseline × this mission's spreadScale).
    const spreadRate = FIRE3D.spreadRate * this.spreadScale * (contained ? FIRE3D.containedSpreadScale : 1);
    const spotChance = contained ? 0 : FIRE3D.spotChance * this.spreadScale * this.spotScale;
    const wlen = Math.hypot(wind.vx, wind.vz);
    const wnx = wlen > 1e-4 ? wind.vx / wlen : 0;
    const wnz = wlen > 1e-4 ? wind.vz / wlen : 0;

    // --- Pass A: burn each lit cell, consume its fuel, deposit pre-heat on neighbours ---
    for (let i = 0; i < N; i++) {
      const h = this.heat[i];
      if (h <= 0) continue;

      // NO SELF-EXTINGUISHING (design): fuel does NOT deplete by default, so a fire never burns
      // itself out — it persists until the PLAYER waters it out. The win can only come from water,
      // not from waiting. `cellBurnRate` is kept as a tuning lever (0 = never burns out); if it's
      // ever raised, a depleted cell simply caps its heat ceiling lower (it still won't auto-scorch).
      if (FIRE3D.cellBurnRate > 0) {
        const burn = FIRE3D.cellBurnRate * (FIRE3D.cellSmolderFloor + (1 - FIRE3D.cellSmolderFloor) * h) * dt;
        const nf = this.fuel[i] - burn;
        this.fuel[i] = nf > 0 ? nf : 0;
      }
      const f = this.fuel[i];

      // Heat climbs toward a ceiling = remaining fuel. A WET cell (just doused) regrows far more
      // slowly, so a knockdown HOLDS while the firebreak is fresh and only re-flares as it dries —
      // water is a tactical holding action, not a delete button (the smolder/re-flare loop).
      const regrow = FIRE3D.cellRegrow * (1 - FIRE3D.wetRegrowSuppress * this.wet[i]);
      let nh = h < f ? Math.min(f, h + regrow * dt) : f;
      if (nh < 0) nh = 0;
      this.heat[i] = nh;

      // CHAR SCAR (visual only — NEVER lowers heat/fuel). Ground under a sustained hot burn blackens:
      // after `charTime` seconds above `charHeat`, mark `scorch` so the terrain chars + the radar scar
      // fills. `scorch` here also means "once you water this charred cell OUT, it stays out" (a doused
      // charred cell can't be re-lit by a neighbour) — but on its own it keeps burning until you douse it.
      if (this.scorch[i] === 0 && nh >= FIRE3D.charHeat) {
        const ct = this.charTime[i] + dt;
        this.charTime[i] = ct;
        if (ct >= FIRE3D.charTime) {
          this.scorch[i] = 1;
          this.burnedOutCells++; // counts charred ground (the lasting scar), not a self-extinguish
        }
      }
      if (nh <= 0.04) continue; // too weak to spread

      // Pre-heat the 8 neighbours, weighted by wind alignment + slope + their fuel.
      const cx = i % gnx;
      const cz = (i / gnx) | 0;
      const yi = this.cellY[i];
      for (let oz = -1; oz <= 1; oz++) {
        const nz = cz + oz;
        if (nz < 0 || nz >= gnz) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oz === 0) continue;
          const nx = cx + ox;
          if (nx < 0 || nx >= gnx) continue;
          const j = nz * gnx + nx;
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

          this.preheat[j] += spreadRate * h * w * inv * dt;
        }
      }

      // Spotting: ONLY a very hot head in STRONG wind, and rarely — this is the lever that
      // keeps the map from lighting up everywhere at once (a real fire mostly creeps; embers
      // jump ahead only occasionally in a strong wind).
      if (wlen > 0.5 && h > 0.75 && this.deps.rng() < spotChance * dt) {
        const dist = FIRE3D.spotDist * (0.5 + this.deps.rng());
        const ang = Math.atan2(wnz, wnx) + (this.deps.rng() - 0.5) * 0.7;
        const sx = -this.halfX + (cx + 0.5) * this.cellSize + Math.cos(ang) * dist;
        const sz = -this.halfZ + (cz + 0.5) * this.cellSize + Math.sin(ang) * dist;
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
   * Apply a water drop centered at (x,z). No longer a flat disc: water density PEAKS at the impact
   * center and tapers to the rim (smoothstep falloff), so an edge clip only partially knocks a cell
   * down; a HOTTER cell resists the knock (diminishing returns), so a single dead-on pass on a crown
   * fire leaves a re-flare residual and needs several passes; and a drop spread over a wider disc
   * (a high release — Game widens `radius`) is DILUTED per cell. `effMul` (1 in-band, →0.12 mist) is
   * the height density Game passes in. The wet FIREBREAK is kept broad (floored) so an edge hit still
   * lays a holding line — "edge doesn't extinguish" is decoupled from "edge doesn't hold a line".
   *
   * Returns a REUSED `DouseResult` (no allocation) so the caller can give honest hit feedback. Stays
   * numbers-only — the engine-agnostic sim boundary holds.
   *
   * `countDoused` (default true) gates whether extinguished cells accrue to the cumulative `doused`
   * counter that drives scoring/containment. Open Skies REPLAYS a peer's broadcast douse with it false:
   * the fire still goes out on our field, but the kill credits THEM, not us.
   */
  douse(x: number, z: number, radius: number, litres: number, effMul = 1, countDoused = true): DouseResult {
    const res = this._douseResult;
    res.heatRemoved = 0;
    res.heatPresent = 0;
    res.cellsHit = 0;
    res.cellsExtinguished = 0;
    res.peakHeatHit = 0;
    if (radius <= 0) return res; // degenerate footprint — nothing lands

    const knockRef = litres / FIRE3D.litresToClear; // reference heat (0..1) a flat drop would remove
    const r2 = radius * radius;
    // A wider disc (high release) spreads the SAME litres over more cells → each gets less.
    const refArea = BUCKET3D.dropRadius * BUCKET3D.dropRadius;
    const dilute = 1 + DROP_PHYSICS.areaFalloff * (r2 / refArea - 1); // >1 wide, <1 tight
    const minCx = clampInt(Math.floor((x - radius + this.halfX) / this.cellSize), 0, this.nx - 1);
    const maxCx = clampInt(Math.floor((x + radius + this.halfX) / this.cellSize), 0, this.nx - 1);
    const minCz = clampInt(Math.floor((z - radius + this.halfZ) / this.cellSize), 0, this.nz - 1);
    const maxCz = clampInt(Math.floor((z + radius + this.halfZ) / this.cellSize), 0, this.nz - 1);
    for (let cz = minCz; cz <= maxCz; cz++) {
      const wz = -this.halfZ + (cz + 0.5) * this.cellSize;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const wx = -this.halfX + (cx + 0.5) * this.cellSize;
        const d2 = (wx - x) * (wx - x) + (wz - z) * (wz - z);
        if (d2 > r2) continue;
        // RADIAL COVERAGE: smoothstep falloff, 1 at center → edgeFloor at the rim. (s*s avoids pow.)
        const t = Math.sqrt(d2) / radius; // 0 center .. 1 rim
        const s = 1 - t * t * (3 - 2 * t); // smoothstep reversed: 1@center, 0@rim
        const cover = DROP_PHYSICS.edgeFloor + (1 - DROP_PHYSICS.edgeFloor) * s * s;
        const i = cz * this.nx + cx;
        const h = this.heat[i];
        if (h > 0) {
          // INTENSITY RESISTANCE: a hotter cell absorbs less per litre → needs more passes.
          const resist = 1 - DROP_PHYSICS.hotResist * (1 - DROP_PHYSICS.hotResistFloor) * h;
          let knock = (knockRef * cover * resist * effMul) / dilute;
          if (knock > knockRef) knock = knockRef; // a tight drop can never beat the flat reference
          let after = Math.max(0, h - knock);
          // EXTINGUISH: water that knocks a cell to/below `extinguishLock` puts it OUT for good — it drops
          // to 0 heat and SCORCHES to mud (locked: a doused-out cell can't re-ignite — scorch blocks Pass-B).
          // Since fires don't self-extinguish, this is what makes a fire monotonically SHRINKABLE: every cell
          // a drop clears stays out and the orange ground turns black. A cell only PARTLY knocked down (still
          // above the lock — an edge clip or a thin/high drop) keeps its heat and re-flares (slowly now).
          if (after <= DROP_PHYSICS.extinguishLock) {
            after = 0;
            if (countDoused) this.extinguishedCells++; // a replayed peer douse puts the cell out but credits THEM
            res.cellsExtinguished++;
            this.scorch[i] = 1;
          }
          res.heatPresent += h;
          res.heatRemoved += h - after;
          res.cellsHit++;
          if (h > res.peakHeatHit) res.peakHeatHit = h;
          this.heat[i] = after;
        }
        this.preheat[i] = 0; // water kills pending ignition across the whole disc (hard zero)
        // WET firebreak stays BROAD: floored so even a rim cell lays a usable holding line.
        const wetTarget = FIRE3D.firebreakStrength * Math.max(DROP_PHYSICS.coverWetFloor, cover);
        if (this.wet[i] < wetTarget) this.wet[i] = wetTarget;
      }
    }
    this.rebuildReps();
    return res;
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
    return Math.floor(this.burnedOutCells / this.cellsPerFire);
  }

  /** Fires the player extinguished with water (not those that burned out) — for scoring. */
  get doused(): number {
    return Math.floor(this.extinguishedCells / this.cellsPerFire);
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

  /**
   * World XZ of the single HOTTEST burning cell — where a competent pilot aims (you fight the worst
   * flames, not a cluster's geometric centre, which may be a doused-out hole). Returns null if nothing
   * burns. O(cells); used by the campaign verifier's perfect-player and available to assists.
   */
  hottestPoint(): { x: number; z: number } | null {
    let best = 0;
    let bi = -1;
    const N = this.nx * this.nz;
    for (let i = 0; i < N; i++) {
      if (this.heat[i] > best) {
        best = this.heat[i];
        bi = i;
      }
    }
    if (bi < 0) return null;
    const cx = bi % this.nx;
    const cz = (bi / this.nx) | 0;
    return { x: -this.halfX + (cx + 0.5) * this.cellSize, z: -this.halfZ + (cz + 0.5) * this.cellSize };
  }

  /** True once a cell has burned out (fuel consumed) — a tree there should be a charred snag. */
  scorchedAt(x: number, z: number): boolean {
    const i = this.cellIndex(x, z);
    return i < 0 ? false : this.scorch[i] === 1;
  }

  // --- Internals -------------------------------------------------------------

  /** Light a disc of cells (radius in cells) around a world point. Returns true if any caught. */
  private igniteDisc(x: number, z: number, radiusCells: number, heat: number = FIRE3D.seedHeat): boolean {
    const c0 = this.cellIndex(x, z);
    if (c0 < 0) return false;
    const cx0 = c0 % this.nx;
    const cz0 = (c0 / this.nx) | 0;
    let caught = false;
    for (let oz = -radiusCells; oz <= radiusCells; oz++) {
      const cz = cz0 + oz;
      if (cz < 0 || cz >= this.nz) continue;
      for (let ox = -radiusCells; ox <= radiusCells; ox++) {
        const cx = cx0 + ox;
        if (cx < 0 || cx >= this.nx) continue;
        if (ox * ox + oz * oz > radiusCells * radiusCells) continue;
        const i = cz * this.nx + cx;
        if (this.scorch[i] === 1 || this.fuel[i] < FIRE3D.minFuel) continue;
        this.heat[i] = Math.max(this.heat[i], Math.min(this.fuel[i], heat));
        caught = true;
      }
    }
    return caught;
  }

  /** World (x,z) → cell index, or -1 if outside the grid. */
  private cellIndex(x: number, z: number): number {
    const cx = Math.floor((x + this.halfX) / this.cellSize);
    const cz = Math.floor((z + this.halfZ) / this.cellSize);
    if (cx < 0 || cx >= this.nx || cz < 0 || cz >= this.nz) return -1;
    return cz * this.nx + cx;
  }

  /**
   * Cluster the hot cells into the coarse blob grid and emit the top ≤maxActive clusters as
   * `FireState`s (centroid, aggregate intensity, footprint size, mean fuel). Stable slot order
   * (sorted by blob index) so a rendered fire doesn't jump meshes frame-to-frame.
   */
  private rebuildReps(): void {
    const gnx = this.nx;
    const bn = this.bn;
    const B = bn * bn;
    this.bHeat.fill(0);
    this.bX.fill(0);
    this.bZ.fill(0);
    this.bFuel.fill(0);
    this.bCnt.fill(0);
    // Per-axis blob cell size so the coarse cluster grid spans a rectangular world (square → WORLD3D.size/bn).
    const bcellX = (this.halfX * 2) / bn;
    const bcellZ = (this.halfZ * 2) / bn;

    const N = gnx * this.nz;
    for (let i = 0; i < N; i++) {
      const h = this.heat[i];
      if (h < FIRE3D.repCellMin) continue;
      const cx = i % gnx;
      const cz = (i / gnx) | 0;
      const wx = -this.halfX + (cx + 0.5) * this.cellSize;
      const wz = -this.halfZ + (cz + 0.5) * this.cellSize;
      const bx = clampInt(Math.floor((wx + this.halfX) / bcellX), 0, bn - 1);
      const bz = clampInt(Math.floor((wz + this.halfZ) / bcellZ), 0, bn - 1);
      const b = bz * bn + bx;
      this.bHeat[b] += h;
      this.bX[b] += wx * h;
      this.bZ[b] += wz * h;
      this.bFuel[b] += this.fuel[i];
      this.bCnt[b]++;
    }

    // Collect qualifying blobs, keep the strongest `activeCap`, then sort by index for stable slots.
    // (The cap only limits how many qualifying blobs get a FireState — the zero-fires WIN condition is
    // unaffected: when no blob clears `repMinHeat`, repCount is 0 regardless of the cap.)
    const picked: number[] = [];
    for (let b = 0; b < B; b++) {
      if (this.bHeat[b] >= FIRE3D.repMinHeat) picked.push(b);
    }
    picked.sort((a, c) => this.bHeat[c] - this.bHeat[a]);
    if (picked.length > this.activeCap) picked.length = this.activeCap;
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
      rep.size = Math.min(1, cnt / this.cellsForFullSize);
      rep.fuel = this.bFuel[b] / cnt;
      rep.alive = true;
    }
    this.repCount = picked.length;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
