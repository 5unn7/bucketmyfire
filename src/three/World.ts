import { WORLD3D, FLIGHT, LAKES3D, LAKE_SHAPE, STREAM, COMMUNITIES, ROADS } from './config';
import { Noise2D, FbmParams } from './world/noise';
import { Biomes } from './world/biomes';
import { Placement } from './world/placement';
import { createNameSource, NameSource } from './world/names';
import { getRegion } from './world/regions';
import { getTerrainProfile, TerrainProfile } from './world/terrainProfile';

/**
 * The unified heightfield — the single source of ground/water truth for the whole
 * 3D world. This is the keystone abstraction (see docs/ROADMAP.md, Phase 1): terrain
 * displacement, lake water planes, the flight floor, and slope all flow from ONE
 * frame of reference here, so "descend to scoop" means the same thing at every lake
 * and a fixed altitude floor rides the hills without clipping.
 *
 * It owns NO Three.js objects — pure math over world-space (x, z). The terrain mesh,
 * lake discs, sims, and placement all READ from these functions; none of them know
 * whether a height came from a prebuilt mesh or (one day) a streamed tile. That keeps
 * the door open for a chunk streamer behind the same API without touching consumers.
 *
 * Locked API (never break these signatures):
 *   groundHeightAt(x,z): base terrain with lake basins carved in
 *   waterLevelAt(x,z):   flat per-lake water surface Y, or null on land
 *   isOverWater(x,z):    inside any lake's waterline
 *   lakeAt(x,z):         the lake whose disc covers (x,z), or null
 *   flightFloorAt(x,z):  minimum heli altitude here (canopy clearance on land,
 *                        scoop clearance over water) — the AGL band rides this
 *   slopeAt(x,z):        gradient magnitude of the ground (for fire/biomes later)
 */

/** Per-lake irregular-boundary parameters (an elongated ellipse + angular lobes). */
export interface LakeShape {
  elong: number; // long/short axis ratio (≥1)
  elongAngle: number; // world orientation of the long axis (rad)
  harmonics: { k: number; amp: number; phase: number }[]; // lobe terms summed onto the radius
}

export interface LakeRuntime {
  x: number;
  z: number;
  r: number; // nominal (base) radius — the boundary varies around it by angle
  /** Flat water-surface height — computed once from the base terrain at the center. */
  waterLevel: number;
  shape: LakeShape;
  name: string; // boreal lake name (Track A5) — display only
}

/** A named settlement (Track A5): the lakeside base, or a small forest hamlet. */
export interface CommunitySite {
  name: string; // northern-Saskatchewan community name
  x: number;
  z: number;
  kind: 'base' | 'town'; // 'base' = lakeside depot site; 'town' = forest hamlet
  radius: number; // cabins of a hamlet scatter within this of the center (units)
  buildings: number; // intended cabin count (towns); 0 for the base (depot only)
}

/** A highway (Track A5): a meandering polyline draped on the terrain between communities. */
export interface RoadRuntime {
  name: string; // highway designation (e.g. "Hwy 905")
  pts: { x: number; z: number }[]; // polyline (world XZ); the mesh drapes it on the ground
  width: number; // half-width of the asphalt ribbon
}

/** A stream / mini river: a meandering polyline whose surface descends along its run. */
export interface RiverRuntime {
  pts: { x: number; z: number }[]; // polyline (world)
  width: number; // half-width of the water ribbon
  surfStart: number; // water-surface Y at pts[0]
  surfEnd: number; // water-surface Y at the last point
  cum: number[]; // cumulative length at each point (for surface interpolation)
  total: number; // total polyline length
  minX: number; // bounding box (for cheap query rejection)
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Authored place names PINNED onto a world so a mission's briefing matches its radar (A5). */
export interface PlacePins {
  base?: string; // rename the home depot/base
  communities?: string[]; // communities[i] renames the i-th TOWN the mission references
}

/** Per-world generation options: which MAP/region to grow, and any authored name pins. */
export interface WorldOptions {
  regionId?: string; // region/map id (see world/regions.ts); omit → the default Saskatchewan map
  pins?: PlacePins; // mission-authored names laid over the seeded ones
}

export class World {
  readonly size = WORLD3D.size;
  readonly lakes: LakeRuntime[];
  /** Streams / mini rivers connecting lakes downhill + tiny tributaries (Track A4). */
  readonly rivers: RiverRuntime[];
  /** Named settlements (Track A5): one lakeside base + forest hamlets. */
  readonly communities: CommunitySite[];
  /** Highway network (Track A5): draped road ribbons linking the communities. */
  readonly roads: RoadRuntime[];
  /** Seeded PRNG (mulberry32). One stream for all deterministic world generation. */
  readonly rng: () => number;
  /** Deterministic boreal name source (lakes/communities/highways). */
  private readonly nameSource: NameSource;
  /** Biome classification (A2) — elevation × moisture × slope → color/density/tint. */
  readonly biomes: Biomes;
  /** Terrain-aware placement (A3) — fuel-biased fire siting. */
  readonly placement: Placement;
  /** Seeded noise field that shapes the base terrain (Track A1). */
  private readonly noise: Noise2D;
  /** Per-map terrain parameters (world/terrainProfile.ts) — boreal shield vs mountains, behind one generator. */
  private readonly profile: TerrainProfile;
  private readonly baseFbm: FbmParams;
  private readonly ridgeFbm: FbmParams;
  /** Optional high-relief massif layer; null on low-relief maps (so baseHeight skips it entirely). */
  private readonly mountainFbm: FbmParams | null;

  /**
   * @param seed world seed — threads through noise/hydrology/placement/fire RNG so the same
   * seed grows the same map (the determinism invariant). Defaults to `WORLD3D.seed` (the
   * sandbox map); the mission campaign passes a per-mission seed (the "future maps" seam).
   * @param opts which MAP/region to grow (drives the place-name pools) + any authored name pins.
   */
  constructor(seed: number = WORLD3D.seed, opts: WorldOptions = {}) {
    this.rng = mulberry32(seed);
    // Names draw from their own seeded streams (off the world seed) over the chosen region's pools
    // (world/regions.ts), independent of the main rng ordering — so picking a map and naming a
    // feature never shifts the rest of world generation.
    this.nameSource = createNameSource(seed ^ 0x27d4eb2f, getRegion(opts.regionId).names);
    // Offset the noise seed off the rng seed so terrain and placement RNG don't correlate.
    this.noise = new Noise2D(seed ^ 0x9e3779b9);
    // The per-map terrain profile (world/terrainProfile.ts): every heightfield parameter lives here so
    // ONE generator grows the SK boreal shield or the BC mountains. Default → Saskatchewan (the values
    // are config TERRAIN verbatim), so this seam is byte-identical for the live map.
    this.profile = getTerrainProfile(opts.regionId);
    this.baseFbm = {
      octaves: this.profile.octaves,
      frequency: this.profile.baseFrequency,
      lacunarity: this.profile.lacunarity,
      gain: this.profile.gain,
    };
    this.ridgeFbm = {
      octaves: this.profile.ridgeOctaves,
      frequency: this.profile.ridgeFrequency,
      lacunarity: this.profile.lacunarity,
      gain: this.profile.gain,
    };
    // Optional MOUNTAIN layer (BC and the like): a sharp ridged massif stacked on the base. null on
    // low-relief maps (SK) → the baseHeight branch never runs, adding zero noise samples there.
    this.mountainFbm = this.profile.mountainAmplitude
      ? {
          octaves: this.profile.mountainOctaves ?? 5,
          frequency: this.profile.mountainFrequency ?? 0.0017,
          lacunarity: this.profile.lacunarity,
          gain: this.profile.mountainGain ?? 0.5,
        }
      : null;

    // Lakes scattered across the world, count scaled to area so water density stays
    // constant as the map grows (the curated LAKES3D radii seed the size range). Each
    // lake's water surface is the base terrain height at its center, sampled ONCE (so
    // the plane stays flat); groundHeightAt then carves a bowl below it — water sits IN
    // a depression. Each also gets a seeded irregular boundary (elongated + lobed).
    this.lakes = this.scatterLakes();

    // Streams connect the lakes downhill (A4); built after lakes so the water
    // network exists before biomes (which read distance-to-water, now incl. rivers).
    this.rivers = this.makeRivers();

    // Settlements + highways (A5): named community sites, then a road network (MST) that
    // links them. Built after the hydrology so the base can sit on a real lake shore and
    // roads can drape over the finished ground/water surface.
    this.communities = this.makeCommunities();
    if (opts.pins) this.applyPins(opts.pins); // lay any mission-authored names over the seeded ones
    this.roads = this.makeRoads();

    // Biomes read elevation/slope/water-distance from this World plus their own
    // moisture noise channel (seeded off the world seed).
    this.biomes = new Biomes(
      seed ^ 0x85ebca6b,
      (x, z) => this.groundHeightAt(x, z),
      (x, z) => this.slopeAt(x, z),
      (x, z) => this.distanceToWater(x, z),
      // Alpine banding (treeline → scree → snow) only on maps that declare a treeline (BC). undefined
      // on SK, so biome samples stay byte-identical there.
      this.profile.treeline !== undefined
        ? {
            treeline: this.profile.treeline,
            snowline: this.profile.snowline ?? this.profile.treeline + 28,
            blend: this.profile.bandBlend ?? 6,
            scree: this.profile.colorScree ?? 0x8a8782,
            snow: this.profile.colorSnow ?? 0xf2f5fb,
          }
        : undefined,
    );
    this.placement = new Placement(this);
  }

  /**
   * Lay mission-authored names over the seeded ones (A5): rename the home base and/or the towns the
   * mission references, so a briefing that says "hold the line at La Ronge" labels that very town
   * "La Ronge" on the radar. Pins index the TOWNS in `getCommunity()` order; anything left unpinned
   * keeps its seeded region name. Display-only — names never feed generation, so this is pure mutation.
   */
  private applyPins(pins: PlacePins): void {
    if (pins.base) {
      const home = this.communities.find((c) => c.kind === 'base');
      if (home) home.name = pins.base;
    }
    if (pins.communities) {
      const towns = this.communities.filter((c) => c.kind === 'town');
      pins.communities.forEach((name, i) => {
        if (name && towns[i]) towns[i].name = name;
      });
    }
  }

  /**
   * Resolve a mission placement reference to a community site. `'base'` → the lakeside base;
   * a number → that town (0-based among the forest hamlets), falling back to any community at
   * that index. Returns null if the seeded map didn't grow a matching site. Used by `Game` to
   * resolve `nearCommunity` fire/structure/zone specs against the generated world.
   */
  getCommunity(which: number | 'base'): CommunitySite | null {
    if (which === 'base') return this.communities.find((c) => c.kind === 'base') ?? null;
    const towns = this.communities.filter((c) => c.kind === 'town');
    // Town index only — never fall through to a BASE slot (the array's first `baseCount` entries are
    // bases now), so a mission's `community: N` can't accidentally resolve to a refuel base.
    return towns[which] ?? null;
  }

  /**
   * Every lakeside BASE (refuel/repair pad). The FIRST is "home" — the largest lake's shore, where
   * the player cold-starts — and `getCommunity('base')` resolves to it; the rest are forward bases.
   */
  bases(): CommunitySite[] {
    return this.communities.filter((c) => c.kind === 'base');
  }

  /**
   * Scatter lakes across the world, seeded + deterministic. Count scales with area
   * (keeping the same per-area water density the 600-unit map had), centers are biased
   * to lowlands (so lakes sit in valleys, not on peaks), kept apart so basins don't
   * overlap, and clear of the origin so you don't start mid-lake. Radii are drawn from
   * the curated LAKES3D set so the size distribution still feels hand-tuned.
   */
  private scatterLakes(): LakeRuntime[] {
    const lakes: LakeRuntime[] = [];
    const density = LAKES3D.length / (600 * 600); // curated lakes per unit² at the base size
    const count = Math.max(LAKES3D.length, Math.round(density * this.size * this.size * this.profile.lakeDensityScale));
    const bound = this.size / 2 - 60;
    const radii = LAKES3D.map((l) => l.r);
    let guard = 0;
    while (lakes.length < count && guard++ < count * 80) {
      const x = (this.rng() * 2 - 1) * bound;
      const z = (this.rng() * 2 - 1) * bound;
      const r = radii[Math.floor(this.rng() * radii.length)];
      if (Math.hypot(x, z) < 90) continue; // keep the start area clear
      if (this.baseHeight(x, z) > this.profile.lakeMaxHeight) continue; // bias to lowlands/valleys (no ponds on ridgetops)
      let ok = true;
      for (const o of lakes) {
        if (Math.hypot(o.x - x, o.z - z) < o.r + r + 80) {
          ok = false; // non-overlapping basins, with breathing room between
          break;
        }
      }
      if (!ok) continue;
      lakes.push({
        x,
        z,
        r,
        waterLevel: this.baseHeight(x, z),
        shape: this.makeLakeShape(),
        name: this.nameSource.lake(),
      });
    }
    return lakes;
  }

  /** Generate one lake's seeded irregular boundary (elongation + angular lobes). */
  private makeLakeShape(): LakeShape {
    const elong = LAKE_SHAPE.elongMin + this.rng() * (LAKE_SHAPE.elongMax - LAKE_SHAPE.elongMin);
    const elongAngle = this.rng() * Math.PI * 2;
    const harmonics = [];
    for (let i = 0; i < LAKE_SHAPE.harmonics; i++) {
      harmonics.push({
        k: 2 + Math.floor(this.rng() * 3), // 2..4 lobes
        amp: LAKE_SHAPE.harmonicAmp * (0.5 + this.rng() * 0.5),
        phase: this.rng() * Math.PI * 2,
      });
    }
    return { elong, elongAngle, harmonics };
  }

  /**
   * Boundary radius of a lake at world angle `phi` (from its center): an ellipse
   * (elongation along the lake's long axis) modulated by its lobe harmonics. The
   * carved basin, the water-disc mesh, and isOverWater all read this same function,
   * so the irregular shoreline is identical across geometry, physics, and queries.
   */
  lakeRadius(lake: LakeRuntime, phi: number): number {
    const s = lake.shape;
    const a = phi - s.elongAngle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const ellipse = 1 / Math.sqrt((ca / s.elong) * (ca / s.elong) + sa * sa);
    let w = 1;
    for (const h of s.harmonics) w += h.amp * Math.sin(h.k * phi + h.phase);
    return lake.r * ellipse * w;
  }

  // --- Rivers / streams (A4) ---------------------------------------------------

  /**
   * Build the stream network: SOME lakes spill a mini river down to their nearest LOWER
   * lake (a seeded coin-flip, and only when that lake is reasonably near), plus the
   * occasional short tributary feeding a lake from uphill ground. Deliberately sparse —
   * a boreal landscape has plenty of isolated kettle lakes, not one plumbed network.
   * Seeded + deterministic.
   */
  private makeRivers(): RiverRuntime[] {
    const rivers: RiverRuntime[] = [];

    // Mini rivers: a fraction of lakes connect to their nearest strictly-lower lake.
    for (const src of this.lakes) {
      // Roll FIRST (per lake) so the seeded stream advances uniformly whether or not a
      // downhill neighbour exists — keeps the sparseness stable across the map.
      if (this.rng() > STREAM.connectChance) continue;
      let dst: LakeRuntime | null = null;
      let best = Infinity;
      for (const cand of this.lakes) {
        if (cand === src || cand.waterLevel >= src.waterLevel) continue;
        const dd = Math.hypot(cand.x - src.x, cand.z - src.z);
        if (dd < best) {
          best = dd;
          dst = cand;
        }
      }
      if (!dst || best > STREAM.maxConnectDist) continue; // no neighbour, or too far to plumb
      const ux = (dst.x - src.x) / best;
      const uz = (dst.z - src.z) / best;
      const aR = this.lakeRadius(src, Math.atan2(uz, ux));
      const bR = this.lakeRadius(dst, Math.atan2(-uz, -ux));
      rivers.push(
        this.buildRiver(
          src.x + ux * aR,
          src.z + uz * aR,
          dst.x - ux * bR,
          dst.z - uz * bR,
          src.waterLevel,
          dst.waterLevel,
          STREAM.width,
          STREAM.meanderAmp,
        ),
      );
    }

    // Tiny tributaries: an occasional short feeder from uphill ground into a lake. Most
    // lakes get none (seeded roll); the ones that do try a few seeded directions and take
    // the first that genuinely rises above the lake (so the channel stays sunken) and
    // doesn't run into other water.
    for (const lake of this.lakes) {
      if (this.rng() > STREAM.tributaryChance) continue; // most lakes have no feeder
      for (let attempt = 0; attempt < STREAM.tinyTries; attempt++) {
        const ang = this.rng() * Math.PI * 2;
        const ux = Math.cos(ang);
        const uz = Math.sin(ang);
        const aR = this.lakeRadius(lake, ang);
        const ex = lake.x + ux * (aR + STREAM.tinyLength);
        const ez = lake.z + uz * (aR + STREAM.tinyLength);
        if (this.baseHeight(ex, ez) < lake.waterLevel + STREAM.tinyRise) continue; // not uphill enough
        if (this.lakeAt(ex, ez)) continue; // don't start inside another lake
        rivers.push(
          this.buildRiver(
            ex,
            ez,
            lake.x + ux * aR,
            lake.z + uz * aR,
            lake.waterLevel + STREAM.tinyRise,
            lake.waterLevel,
            STREAM.tinyWidth,
            STREAM.meanderAmp * 0.6,
          ),
        );
        break; // one tributary per lake
      }
    }
    return rivers;
  }

  /** Resample a straight A→B run into a meandering polyline + cached lengths/bbox. */
  private buildRiver(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    surfStart: number,
    surfEnd: number,
    width: number,
    meanderAmp: number,
  ): RiverRuntime {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / L; // unit perpendicular (for lateral meander)
    const nz = (bx - ax) / L;
    // Resample densely so the ribbon curves smoothly (the meander envelope is a
    // continuous function of t, so more samples = a smooth, high-poly stream edge).
    const segs = Math.max(STREAM.meander + 1, Math.ceil(L / STREAM.resample));
    const pts: { x: number; z: number }[] = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const bxp = ax + (bx - ax) * t;
      const bzp = az + (bz - az) * t;
      // Lateral meander from noise, tapered to 0 at both ends so it joins cleanly.
      const off = this.noise.simplex(bxp * 0.02 + 13, bzp * 0.02 - 7) * meanderAmp * Math.sin(Math.PI * t);
      pts.push({ x: bxp + nx * off, z: bzp + nz * off });
    }

    const cum = [0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      minX = Math.min(minX, pts[i].x);
      maxX = Math.max(maxX, pts[i].x);
      minZ = Math.min(minZ, pts[i].z);
      maxZ = Math.max(maxZ, pts[i].z);
    }
    return { pts, width, surfStart, surfEnd, cum, total: cum[cum.length - 1] || 1, minX, maxX, minZ, maxZ };
  }

  /**
   * Nearest stream to (x, z): the closest river within its carve influence, with the
   * perpendicular distance `d` and the interpolated water surface `surf` at that point.
   * Null if no stream is near. Drives the channel carve and the water queries.
   */
  nearestRiver(x: number, z: number): { river: RiverRuntime; d: number; surf: number } | null {
    let best: { river: RiverRuntime; d: number; surf: number } | null = null;
    for (const r of this.rivers) {
      const inf = r.width + STREAM.bankWidth + STREAM.blendWidth;
      if (x < r.minX - inf || x > r.maxX + inf || z < r.minZ - inf || z > r.maxZ + inf) continue;
      const hit = pointToRiver(x, z, r);
      if (!best || hit.d < best.d) best = { river: r, d: hit.d, surf: hit.surf };
    }
    if (!best) return null;
    const inf = best.river.width + STREAM.bankWidth + STREAM.blendWidth;
    return best.d <= inf ? best : null;
  }

  // --- Settlements + highways (A5) ---------------------------------------------

  /**
   * Seed the named communities: up to `COMMUNITIES.baseCount` lakeside BASES (refuel/repair pads —
   * the first is "home", on the largest lake's dry shore, where the player cold-starts), plus a
   * handful of forest HAMLETS on moderate dry ground, spaced apart and off the player's spawn.
   * Deterministic. Structures.ts fills the HOME base with a depot; the forward bases are refuel
   * infrastructure (helipad/dock/label), placed by Game, not damageable Structures.
   */
  private makeCommunities(): CommunitySite[] {
    const out: CommunitySite[] = [];

    for (const base of this.pickLakesideSites(COMMUNITIES.baseCount)) out.push(base);

    const bound = this.size / 2 - 80;
    let towns = 0;
    let guard = 0;
    while (towns < COMMUNITIES.townCount && guard++ < 800) {
      const x = (this.rng() * 2 - 1) * bound;
      const z = (this.rng() * 2 - 1) * bound;
      if (Math.hypot(x, z) < COMMUNITIES.minFromOrigin) continue; // off spawn
      if (this.lakeAt(x, z)) continue; // not in a lake
      if (this.nearestRiver(x, z)) continue; // not straddling a stream
      const h = this.baseHeight(x, z);
      if (h < 0.5 || h > 8) continue; // dry ground, but not perched on a ridge
      let ok = true;
      for (const c of out) {
        if (Math.hypot(c.x - x, c.z - z) < COMMUNITIES.spacing) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const buildings =
        COMMUNITIES.cabinsMin +
        Math.floor(this.rng() * (COMMUNITIES.cabinsMax - COMMUNITIES.cabinsMin + 1));
      out.push({
        name: this.nameSource.community(),
        x,
        z,
        kind: 'town',
        radius: COMMUNITIES.clusterRadius,
        buildings,
      });
      towns++;
    }
    return out;
  }

  /**
   * Pick up to `count` lakeside BASE sites, one per lake, biggest-lake-first so "home" lands on the
   * largest lake's shore. A lake whose shore sits within `COMMUNITIES.baseSpacing` of a base already
   * chosen is skipped, so the bases spread across the map rather than clumping on neighbouring lakes.
   * Returns fewer than `count` only on a cramped map (always ≥1 home when any lake exists). Deterministic.
   */
  private pickLakesideSites(count: number): CommunitySite[] {
    const lakesByR = [...this.lakes].sort((a, b) => b.r - a.r);
    const sites: CommunitySite[] = [];
    for (const lake of lakesByR) {
      if (sites.length >= count) break;
      const shore = this.lakeShorePoint(lake);
      if (!shore) continue;
      if (sites.some((s) => Math.hypot(s.x - shore.x, s.z - shore.z) < COMMUNITIES.baseSpacing)) continue;
      sites.push({
        name: this.nameSource.community(),
        x: shore.x,
        z: shore.z,
        kind: 'base',
        radius: COMMUNITIES.clusterRadius,
        buildings: 0,
      });
    }
    return sites;
  }

  /** Dry shore point just past a lake's edge (ray-march outward from the centre), or null if landlocked. */
  private lakeShorePoint(lake: LakeRuntime): { x: number; z: number } | null {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const rr = this.lakeRadius(lake, a);
      for (let m = rr + 6; m < rr + COMMUNITIES.baseShoreSearch; m += 3) {
        const x = lake.x + dx * m;
        const z = lake.z + dz * m;
        if (this.isOverWater(x, z)) continue;
        return { x, z };
      }
    }
    return null;
  }

  /**
   * Highway network: a minimum spanning tree over the community centers (Prim's), so
   * every settlement is reachable with no redundant loops. Each MST edge becomes one
   * draped, gently-meandering road, named after a northern-Sask provincial highway.
   */
  private makeRoads(): RoadRuntime[] {
    const nodes = this.communities;
    if (nodes.length < 2) return [];
    const roads: RoadRuntime[] = [];
    const inTree = new Array(nodes.length).fill(false);
    inTree[0] = true;
    for (let added = 1; added < nodes.length; added++) {
      let bi = -1;
      let bj = -1;
      let bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        if (!inTree[i]) continue;
        for (let j = 0; j < nodes.length; j++) {
          if (inTree[j]) continue;
          const dd = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
          if (dd < bd) {
            bd = dd;
            bi = i;
            bj = j;
          }
        }
      }
      if (bj < 0) break;
      inTree[bj] = true;
      roads.push(this.buildRoad(nodes[bi], nodes[bj]));
    }
    return roads;
  }

  /** Resample a straight A→B run into a gently-meandering road polyline (drapes at draw). */
  private buildRoad(a: CommunitySite, b: CommunitySite): RoadRuntime {
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / L; // unit perpendicular (lateral meander)
    const nz = (b.x - a.x) / L;
    const segs = Math.max(4, Math.ceil(L / ROADS.resample));
    const pts: { x: number; z: number }[] = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      // Lateral wander from noise, tapered to 0 at both ends so the road meets each town.
      const off = this.noise.simplex(px * 0.015 - 5, pz * 0.015 + 9) * ROADS.meanderAmp * Math.sin(Math.PI * t);
      const p = { x: px + nx * off, z: pz + nz * off };
      // Route around lakes: if this point fell in water, slide it along the road's
      // perpendicular until it hits land (endpoints stay put — towns sit on shore).
      pts.push(k === 0 || k === segs ? p : this.dodgeWater(p, nx, nz));
    }
    return { name: this.nameSource.highway(), pts, width: ROADS.width };
  }

  /**
   * Nudge a road point off water along the carriageway's perpendicular (nx, nz). Searches
   * both sides in growing steps and returns the first dry spot found (clearing the road's
   * full half-width so the deck doesn't clip the shore). Falls back to the original point if
   * no land is found within the cap — a long causeway is better than a kinked dead end.
   */
  private dodgeWater(p: { x: number; z: number }, nx: number, nz: number): { x: number; z: number } {
    if (!this.isOverWater(p.x, p.z)) return p;
    const step = ROADS.width;
    const maxSteps = Math.ceil(ROADS.dodgeMax / step);
    for (let s = 1; s <= maxSteps; s++) {
      const d = s * step;
      for (const sign of [1, -1]) {
        const cx = p.x + nx * d * sign;
        const cz = p.z + nz * d * sign;
        // Clear the full carriageway, not just the centreline, so shoulders stay dry.
        if (
          !this.isOverWater(cx, cz) &&
          !this.isOverWater(cx + nx * ROADS.width, cz + nz * ROADS.width) &&
          !this.isOverWater(cx - nx * ROADS.width, cz - nz * ROADS.width)
        ) {
          return { x: cx, z: cz };
        }
      }
    }
    return p;
  }

  // --- Base terrain ------------------------------------------------------------

  /**
   * Pure base terrain height (no lakes) at world (x, z) — Track A1's seeded noise.
   * Boreal-Shield recipe: domain-warp the coords (winding ridgelines), sample a
   * low-relief FBM for the rolling base, add a ridged layer above a threshold for
   * granite outcrops, then compress sub-waterline dips into flatter muskeg basins.
   * Pure + deterministic, so the mesh and every height query stay in lockstep.
   */
  private baseHeight(x: number, z: number): number {
    const p = this.profile;
    const [wx, wz] = this.noise.warp(x, z, p.warpStrength, p.warpFrequency);

    // Rolling base (low relief). fbm is ~[-1,1].
    let h = this.noise.fbm(wx, wz, this.baseFbm) * p.baseAmplitude;

    // Rocky outcrops: ridged crests above a threshold poke up through the soil.
    const ridge = this.noise.ridged(wx, wz, this.ridgeFbm); // ~[0,1]
    if (ridge > p.ridgeThreshold) {
      const t = (ridge - p.ridgeThreshold) / (1 - p.ridgeThreshold);
      h += t * t * p.ridgeAmplitude;
    }

    // Mountain layer (gated): profiles with a mountainAmplitude (BC) grow a sharp ridged massif on
    // top, sharing the same warped coords so ranges follow the winding valleys. null on SK → this
    // branch never runs, so SK draws the exact same noise in the same order (determinism invariant).
    if (this.mountainFbm) {
      const r = this.noise.ridged(wx, wz, this.mountainFbm); // ~[0,1] sharp crests
      h += Math.pow(r, p.mountainExponent ?? 2.0) * (p.mountainAmplitude as number);
    }

    // Muskeg: pull lowlands flatter so wet basins read level rather than as deep bowls.
    if (h < 0) h *= 1 - p.lowlandFlatten;
    return h;
  }

  // --- Ground (base + carved lake basins) -------------------------------------

  /**
   * Ground surface Y at world (x, z): the base terrain with each nearby lake's bowl
   * carved in. The bowl is a smoothstep profile — lakebed → shore shelf → raised
   * bank → blend back to terrain — so the water plane always sits inside a visible
   * depression. Lakes are far apart (non-overlapping basins); the lerp accumulation
   * is a no-op outside a lake's influence radius.
   */
  groundHeightAt(x: number, z: number): number {
    let h = this.baseHeight(x, z);
    let nearLakeSigned = Infinity; // signed distance to the nearest lake shoreline (− inside)
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const d = Math.hypot(dx, dz);
      // Cheap reject: far lakes contribute nothing to the carve. Their max boundary is
      // ~r·2.42 (elong + lobes); skip past the bank+blend ring. Keeps cost ~O(nearby)
      // even with many lakes in a big world.
      if (d > lake.r * 2.5 + WORLD3D.lakeBankWidth + WORLD3D.lakeBlendWidth) continue;
      const rAt = this.lakeRadius(lake, Math.atan2(dz, dx)); // irregular boundary at this angle
      const sd = d - rAt;
      if (sd < nearLakeSigned) nearLakeSigned = sd; // cache for the river-mouth blend below
      const w = basinWeight(d, rAt);
      if (w <= 0) continue;
      h = lerp(h, basinProfile(d, lake, rAt), w);
    }
    // Carve the nearest stream's shallow channel (A4) on top of the lakes.
    const rv = this.nearestRiver(x, z);
    if (rv) {
      let w = channelWeight(rv.d, rv.river.width);
      // River MOUTH polish: fade the channel carve out as it enters a lake so the stream
      // merges smoothly into the lake basin instead of notching a hard seam across the
      // shoreline + bank. Full carve a short way out (≥ mouthBlend), zero just inside the
      // waterline; the basin then owns the ground under the mouth.
      if (w > 0 && nearLakeSigned < STREAM.mouthBlend) {
        w *= smoothstep((nearLakeSigned + 2) / (STREAM.mouthBlend + 2));
      }
      if (w > 0) h = lerp(h, channelProfile(rv.d, rv.river.width, rv.surf), w);
    }
    return h;
  }

  // --- Water -------------------------------------------------------------------

  /**
   * Water-surface Y if (x, z) lies on water, else null — a lake's flat plane, or a
   * stream's locally-interpolated surface. Generalized for A4 so scoop/flight-floor
   * work over rivers exactly as over lakes (the keystone signature is unchanged).
   */
  waterLevelAt(x: number, z: number): number | null {
    const lake = this.lakeAt(x, z);
    if (lake) return lake.waterLevel;
    const rv = this.nearestRiver(x, z);
    return rv && rv.d <= rv.river.width ? rv.surf : null;
  }

  isOverWater(x: number, z: number): boolean {
    return this.waterLevelAt(x, z) !== null;
  }

  /** The lake whose (irregular) water disc covers (x, z), or null. */
  lakeAt(x: number, z: number): LakeRuntime | null {
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const d = Math.hypot(dx, dz);
      if (d > lake.r * 2.5) continue; // cheap reject — past any possible boundary
      if (d <= this.lakeRadius(lake, Math.atan2(dz, dx))) return lake;
    }
    return null;
  }

  /**
   * Signed distance (world units) to the nearest lake's shoreline: negative inside
   * the water, positive on land. Approximated along the radial to each center, which
   * is exact for the star-convex lake boundaries. Used by biomes for the shore band.
   */
  distanceToWater(x: number, z: number): number {
    let min = Infinity;
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const d = Math.hypot(dx, dz);
      // Only lakes whose shoreline could be the nearest matter; skip clearly-distant
      // ones (a far lake is never the closest water). Keeps this O(nearby) in a big world.
      if (d > lake.r * 2.5 + 60) continue;
      min = Math.min(min, d - this.lakeRadius(lake, Math.atan2(dz, dx)));
    }
    const rv = this.nearestRiver(x, z);
    if (rv) min = Math.min(min, rv.d - rv.river.width);
    return min;
  }

  // --- Flight floor ------------------------------------------------------------

  /**
   * Minimum heli altitude at (x, z) — the surface the AGL band rides. Over water it
   * sits a small scoopClearance above the flat surface (so a full descent dips the
   * slung bucket under); on land it sits a larger canopyClearance above the ground
   * (so the rotor disc clears the trees). HelicopterSim adds the [minClearance,
   * maxClearance] band on top.
   */
  flightFloorAt(x: number, z: number): number {
    const wl = this.waterLevelAt(x, z);
    if (wl !== null) return wl + FLIGHT.scoopClearance;
    return this.groundHeightAt(x, z) + FLIGHT.canopyClearance;
  }

  // --- Slope -------------------------------------------------------------------

  /** Gradient magnitude of the ground at (x, z) — central differences. */
  slopeAt(x: number, z: number): number {
    const e = 1;
    const dx = (this.groundHeightAt(x + e, z) - this.groundHeightAt(x - e, z)) / (2 * e);
    const dz = (this.groundHeightAt(x, z + e) - this.groundHeightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  /**
   * Distance from world (x, z) to the nearest road CENTRELINE (units), or Infinity when there are
   * no roads. Pure point-to-segment geometry over the road polylines — lets placement code keep
   * pads/LZs off the carriageway (a road's painted half-width is `RoadRuntime.width`). Cheap: the
   * MST has only a handful of short, coarsely-resampled roads.
   */
  distanceToRoad(x: number, z: number): number {
    let best = Infinity;
    for (const road of this.roads) {
      const pts = road.pts;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1].x;
        const az = pts[i - 1].z;
        const dx = pts[i].x - ax;
        const dz = pts[i].z - az;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t; // clamp to the segment
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d < best) best = d;
      }
    }
    return best;
  }

  /**
   * Register the centres that get a cleared yard (where buildings actually stand). Set by
   * `Game` from the resolved structure plan, so empty named-but-unbuilt community sites don't
   * grow phantom clearings in the forest. Falls back to all communities until set.
   */
  setClearings(centers: readonly { x: number; z: number; radius?: number }[]): void {
    this.clearingCenters = centers.slice();
  }
  private clearingCenters: readonly { x: number; z: number; radius?: number }[] | null = null;

  /**
   * Forest-clearing weight in 0..1: 1 out in the open bush, falling to 0 inside a registered
   * cleared patch so trees thin out where people live (a hamlet shouldn't be boxes buried in
   * forest) AND where the heli must touch down (a crew LZ — a NARROW patch via a per-centre
   * `radius`). Each centre clears fully within `radius * yardInner`, then feathers up to 1 at
   * its rim for a natural edge; a centre with no `radius` falls back to the hamlet `yardRadius`.
   * Returns the MIN over all centres (any patch clears). The yard decal in `meshes/clearing.ts`
   * uses the same radii so the dirt and the cleared trees line up.
   */
  clearingFactor(x: number, z: number): number {
    let k = 1;
    const centers = this.clearingCenters ?? this.communities;
    for (const c of centers) {
      const r = c.radius ?? COMMUNITIES.yardRadius; // per-centre radius — small for a crew LZ
      const inner = r * COMMUNITIES.yardInner;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d >= r) continue;
      const t = d <= inner ? 0 : (d - inner) / (r - inner);
      const w = t * t * (3 - 2 * t); // smoothstep rim
      if (w < k) k = w;
    }
    return k;
  }
}

// --- Basin shaping (module-pure helpers) ---------------------------------------

/**
 * Carve weight in [0, 1] at radial distance `d` from a lake of waterline radius `r`:
 * full (1) out through the raised bank, then smoothstepping down to 0 across the
 * blend ring. Zero beyond, so groundHeightAt's lerp leaves distant terrain untouched.
 */
function basinWeight(d: number, r: number): number {
  const bankEnd = r + WORLD3D.lakeBankWidth;
  const outer = bankEnd + WORLD3D.lakeBlendWidth;
  if (d <= bankEnd) return 1;
  if (d >= outer) return 0;
  return 1 - smoothstep((d - bankEnd) / WORLD3D.lakeBlendWidth);
}

/**
 * Target ground height inside a lake's basin at radial distance `d`:
 *   - d ≤ r: lakebed (deep at the center) rising to the shore shelf at the waterline
 *   - r < d ≤ r+bankWidth: shore rising to a raised bank lip above the water
 *   - beyond: the bank top (blended back toward terrain by basinWeight)
 * All heights are absolute, anchored on the lake's flat waterLevel.
 */
function basinProfile(d: number, lake: LakeRuntime, r: number): number {
  const wl = lake.waterLevel;
  const bed = wl - WORLD3D.lakeBedDepth;
  const shore = wl - WORLD3D.lakeShoreDrop;
  const bankTop = wl + WORLD3D.lakeBankHeight;

  if (d <= r) {
    return lerp(bed, shore, smoothstep(d / r));
  }
  const bankEnd = r + WORLD3D.lakeBankWidth;
  if (d <= bankEnd) {
    return lerp(shore, bankTop, smoothstep((d - r) / WORLD3D.lakeBankWidth));
  }
  return bankTop;
}

// --- Stream channel shaping (module-pure helpers) ------------------------------

/** Carve weight in [0,1] at perpendicular distance `d` from a stream of half-width `w`. */
function channelWeight(d: number, w: number): number {
  const bankEnd = w + STREAM.bankWidth;
  const outer = bankEnd + STREAM.blendWidth;
  if (d <= bankEnd) return 1;
  if (d >= outer) return 0;
  return 1 - smoothstep((d - bankEnd) / STREAM.blendWidth);
}

/**
 * Target ground height in a stream channel at perpendicular distance `d` from the
 * centerline, anchored on the local water surface `surf`: streambed (deepest at the
 * center) → shore at the water's edge → low bank → blend back. Mirrors the lake basin.
 */
function channelProfile(d: number, w: number, surf: number): number {
  const bed = surf - STREAM.depth;
  const shore = surf - STREAM.shoreDrop;
  const bankTop = surf + STREAM.bankHeight;
  if (d <= w) return lerp(bed, shore, smoothstep(d / w));
  const bankEnd = w + STREAM.bankWidth;
  if (d <= bankEnd) return lerp(shore, bankTop, smoothstep((d - w) / STREAM.bankWidth));
  return bankTop;
}

/**
 * Closest approach of (x, z) to a river polyline: the perpendicular distance and the
 * water surface interpolated by arc-length at the nearest point. Exact per-segment.
 */
function pointToRiver(x: number, z: number, r: RiverRuntime): { d: number; surf: number } {
  let bestD = Infinity;
  let bestLen = 0;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const p0 = r.pts[i];
    const p1 = r.pts[i + 1];
    const vx = p1.x - p0.x;
    const vz = p1.z - p0.z;
    const len2 = vx * vx + vz * vz || 1;
    let u = ((x - p0.x) * vx + (z - p0.z) * vz) / len2;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    const cx = p0.x + u * vx;
    const cz = p0.z + u * vz;
    const dd = Math.hypot(x - cx, z - cz);
    if (dd < bestD) {
      bestD = dd;
      bestLen = r.cum[i] + u * Math.sqrt(len2);
    }
  }
  const t = bestLen / r.total;
  return { d: bestD, surf: r.surfStart + (r.surfEnd - r.surfStart) * t };
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** mulberry32 — tiny seeded PRNG, no dependency. Same seed → same stream. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
