import { WORLD3D, FLIGHT, LAKES3D, LAKE_SHAPE, STREAM, COMMUNITIES, ROADS, MAPGEO, BRIDGE, HELIPAD } from './config';
import { Noise2D, FbmParams } from './world/noise';
import { Biomes } from './world/biomes';
import { Placement } from './world/placement';
import { createNameSource, NameSource } from './world/names';
import { getRegion, getTerrainProfile } from './maps/registry';
import type { Region, GeoFrame, TerrainProfile } from './maps/types';
import { AuthoredField } from './world/authored';
import type { BuildingKind } from './world/authored';
import { HeightPatch, decodeHeightmap } from './world/heightPatch';
import type { BridgeSite } from './meshes/bridges'; // TYPE-only (erased) — keeps World free of THREE / the bridge mesh

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
  /**
   * Authored freeform shore: a per-angle boundary-radius lookup table sampled once from a real `outline`
   * (ray-cast from the centre). When present, `lakeRadius()` reads THIS instead of the ellipse+harmonics,
   * so the carve, water mesh, isOverWater and every other consumer follow the exact drawn shape — no other
   * code path changes. Built by `World.applyOutline`; absent on the procedural/ellipse lakes (the default).
   */
  radial?: number[];
}

/** A named settlement (Track A5): the lakeside base, or a small forest hamlet. */
export interface CommunitySite {
  name: string; // northern-Saskatchewan community name
  x: number;
  z: number;
  kind: 'base' | 'town' | 'city'; // 'base' = lakeside depot site; 'town' = forest hamlet; 'city' = big road-node
  // population centre (Saskatoon/Regina) — excluded from the town index so mission `community: N` refs are stable
  radius: number; // cabins of a hamlet scatter within this of the center (units)
  buildings: number; // intended cabin count (towns); 0 for the base (depot only)
  anchorId?: string; // set when this site came from a region MapAnchor (links it back for getCommunity(id))
  // DECORATIVE population tier (drives the non-gameplay building scatter in Game): 'city' = dense skyline,
  // 'base' = medium cluster, 'community' = sparse hamlet. Derived from kind (+ a base's `urban` flag → 'city',
  // so Prince Albert reads as a city while staying a refuel base). Decoration only — never a Structure.
  tier?: 'city' | 'base' | 'community';
}

/** A region MapAnchor resolved to its placed world site (anchored maps). Exposed via World.anchor*(). */
export interface ResolvedAnchor {
  id: string;
  name: string;
  kind: 'base' | 'community' | 'both' | 'city';
  x: number;
  z: number;
  home: boolean;
  lake: LakeRuntime | null; // the adjacent scoop lake (guaranteed for bases), or null
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
  // Per-vertex water-surface Y aligned to `pts` (overrides the linear surfStart→surfEnd interpolation when
  // present). Authored rivers use this so a long run's surface FOLLOWS the terrain downhill in one continuous,
  // monotonically-descending profile — without it a multi-segment river clips through mid-segment rises and
  // breaks into disconnected puddles. Mini-rivers/tributaries leave it undefined (their straight A→B run is fine
  // with the linear model).
  surf?: number[];
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
  regionId?: string; // region/map id (see the maps/ registry); omit → the default Saskatchewan map
  pins?: PlacePins; // mission-authored names laid over the seeded ones
  homeBase?: string; // which MapAnchor base is the operational HOME (spawn/refuel) — placed first; omit → region home
  region?: Region; // a DRAFT region object to grow directly (map editor live preview), overriding regionId lookup
}

/** A river valley shaped under one bridge (set via setBridgeValleys) — local frame + derived dims. */
interface BridgeValley {
  cx: number; // valley centre (the bridge site) in world XZ
  cz: number;
  ax: number; // unit flow tangent (the along-river / fly-under axis)
  az: number;
  surfaceY: number; // river water level — the valley's vertical datum
  bankPeak: number; // |v| (across-span) at which the bank reaches full height — the abutment (= span/2)
  channelHalf: number; // inner |v| kept LOW as the channel corridor (no raise)
  bankRise: number; // height the banks/abutments are built up to, above surfaceY
  approach: number; // how far past the abutment the bank holds full height before tapering
  alongHalf: number; // half-length of the valley along the river before it fades out
  taper: number; // smooth taper distance at every outer edge
}

/**
 * A coarse cost field over the playfield that the road router (World.makeRoads) runs A* across. Built once
 * per world: `cost[iz*nx+ix]` is the per-cell traversal cost (`Infinity` = impassable lake / sub-water shelf;
 * higher = river crossing or steep ground), and `occupied` marks cells already carrying a laid road so a later
 * road can MERGE onto the shared corridor at a discount. Pure ints/floats, no THREE — determinism untouched.
 */
interface RoadGrid {
  cost: Float32Array;
  occupied: Uint8Array;
  nx: number;
  nz: number;
  cell: number; // world units per grid cell
  minX: number; // world X of the grid's lower-left corner (−sizeX/2)
  minZ: number;
}

export class World {
  /**
   * Playfield extents (world units), set once in the ctor from the region's geo frame (computeWorldFrame):
   *   - SQUARE maps (the default): sizeX === sizeZ === WORLD3D.size — the legacy square world.
   *   - 'bounds'-fit maps: the province's TRUE-SHAPE rectangle (its projected bounding box, longest axis =
   *     WORLD3D.size·MAPGEO.boundsFill), so the boundary sits at the map edge instead of floating in a square.
   * Consumers that need the real playfield (terrain mesh, scatter bounds, minimap, radar) read sizeX/sizeZ;
   * `size` is the bounding SQUARE (= max(sizeX,sizeZ) = WORLD3D.size) kept for the few that want one conservative
   * extent — notably the fire CELL grid + burn texture, which stay square and simply cover the rectangle.
   */
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly size: number;
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
  /** Per-map terrain parameters (maps/<region>/terrain.ts) — boreal shield vs mountains, behind one generator. */
  private readonly profile: TerrainProfile;
  private readonly baseFbm: FbmParams;
  private readonly ridgeFbm: FbmParams;
  /** Optional high-relief massif layer; null on low-relief maps (so baseHeight skips it entirely). */
  private readonly mountainFbm: FbmParams | null;
  /** Localized uplands projected to world XZ — baseHeight adds a smooth bump at each. */
  private readonly uplands: { x: number; z: number; r: number; height: number }[];
  /** Mesh-baked massifs (e.g. Cypress Hills) projected to world XZ — baseHeight adds each grid's relief. */
  private readonly heightPatches: HeightPatch[];
  /** Hand-painted terrain height offset (map editor) baked into a load-time field; null = none authored. */
  private readonly authoredTerrain: AuthoredField | null;
  /** Hand-painted tree-density bias (map editor); null = none authored. Sampled by Game's forest scatter. */
  private readonly authoredFoliage: AuthoredField | null;
  /** Hand-placed decorative buildings (map editor) projected to world XZ; Game instantiates the meshes. */
  readonly authoredBuildings: { x: number; z: number; kind: BuildingKind; rotationDeg: number }[];
  /** The active map's region (names + optional anchors); resolved once in the ctor. */
  private readonly region: Region;
  /** Which anchor base is the operational home this build (mission.homeBase); placed first. */
  private readonly homeBaseId?: string;
  /** Placed authored anchors (bases + towns) for anchored maps; empty on procedural maps. */
  private resolvedAnchors: ResolvedAnchor[] = [];
  /** Real-world projection frame for an anchored map (lat/lon → world XZ), or null on procedural maps. */
  private readonly geo: GeoFrame | null;
  private readonly latCenter: number; // centre of the geo box — the projection origin
  private readonly lonCenter: number;
  private readonly uPerKm: number; // world units per real kilometre (geo N–S extent → MAPGEO.fill of world)
  // 'bounds'-fit recentre (km): the projected-bounding-box centre, subtracted so the province sits centred at
  // the world origin even though the cosine projection makes it asymmetric in X. Zero on square maps (no shift).
  private readonly offsetXKm: number;
  private readonly offsetZKm: number;
  /** River valleys shaped under the bridges (set after construction via setBridgeValleys); empty = no shaping. */
  private bridgeValleys: BridgeValley[] = [];
  /** Resolved scenic bridge sites (truss spans where a road crosses a river) — built in the ctor AFTER the
   *  rivers so makeRoads can route a crossing onto each. Empty off-SK / when BRIDGE.enabled is false. */
  private bridgeSiteList: BridgeSite[] = [];
  /** The province outline projected to world XZ, cached once (the projection frame is fixed at construction).
   *  `groundHeightAt` (per terrain vertex) + placement guards point-in-polygon against this, so it must NOT
   *  re-project the lat/lon ring every call. Null = not yet built or no geo. */
  private cachedOutline: { x: number; z: number }[] | null = null;

  /**
   * @param seed world seed — threads through noise/hydrology/placement/fire RNG so the same
   * seed grows the same map (the determinism invariant). Defaults to `WORLD3D.seed` (the
   * sandbox map); the mission campaign passes a per-mission seed (the "future maps" seam).
   * @param opts which MAP/region to grow (drives the place-name pools) + any authored name pins.
   */
  constructor(seed: number = WORLD3D.seed, opts: WorldOptions = {}) {
    this.rng = mulberry32(seed);
    // Names draw from their own seeded streams (off the world seed) over the chosen region's pools
    // (the maps/ registry), independent of the main rng ordering — so picking a map and naming a
    // feature never shifts the rest of world generation.
    // A draft region (map-editor live preview) is grown verbatim; otherwise resolve the map by id.
    this.region = opts.region ?? getRegion(opts.regionId);
    this.homeBaseId = opts.homeBase;
    // Real-world projection frame (anchored maps): scale the geo box's N–S extent to MAPGEO.fill of the
    // square world height, then project anchors with a cosine ("sinusoidal") projection — true distances
    // AND the province's converging-meridian trapezoid. Synthesised from the anchor bounds if a region
    // declares anchors but no explicit geo; null on procedural maps (project() is never called there).
    this.geo = resolveGeo(this.region);
    // One helper resolves the whole world frame from the geo box: the square fit (default — N–S fills
    // MAPGEO.fill of a WORLD3D.size² playfield, no recentre) or the 'bounds' fit (the province's projected
    // bounding box becomes a true-shape rectangle, recentred at the origin). Square maps come out byte-identical.
    const frame = computeWorldFrame(this.geo);
    this.latCenter = frame.latCenter;
    this.lonCenter = frame.lonCenter;
    this.uPerKm = frame.uPerKm;
    this.offsetXKm = frame.offsetXKm;
    this.offsetZKm = frame.offsetZKm;
    this.sizeX = frame.sizeX;
    this.sizeZ = frame.sizeZ;
    this.size = Math.max(frame.sizeX, frame.sizeZ); // bounding square (= WORLD3D.size) for square-grid consumers
    this.nameSource = createNameSource(seed ^ 0x27d4eb2f, this.region.names);
    // Offset the noise seed off the rng seed so terrain and placement RNG don't correlate.
    this.noise = new Noise2D(seed ^ 0x9e3779b9);
    // The per-map terrain profile (maps/<region>/terrain.ts): every heightfield parameter lives here so
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

    // Localized uplands (Cypress Hills): project each region upland to world XZ once. Its REAL footprint (km)
    // converts through the SAME projection scale as every distance (uPerKm → scales with the world), and its
    // REAL prominence (m) through the vertical scale (MAPGEO.metresPerUnit) — so the size isn't hand-picked
    // world units. baseHeight adds a smooth radial bump at each: a single hill rising from the boreal flats,
    // distinct from the whole-map mountain layer above. Set BEFORE lakes (baseHeight feeds their water level).
    this.uplands = (this.region.uplands ?? []).map((u) => {
      const p = this.project(u.lat, u.lon);
      return { x: p.x, z: p.z, r: u.radiusKm * this.uPerKm, height: u.prominenceM / MAPGEO.metresPerUnit };
    });

    // Height patches (Cypress Hills): a massif baked from a real mountain mesh. Same projection + scaling as
    // an upland (km footprint → uPerKm, metre prominence → metresPerUnit), but the SHAPE comes from a baked
    // grid (world/heightPatch.ts) instead of a radial bump. Also set BEFORE lakes so the carved relief feeds
    // each lake's sampled water level. Empty on maps with no patches → baseHeight skips the loop entirely.
    this.heightPatches = (this.region.heightPatches ?? []).map((hp) => {
      const p = this.project(hp.lat, hp.lon);
      return new HeightPatch({
        centerX: p.x,
        centerZ: p.z,
        halfWidth: (hp.widthKm * this.uPerKm) / 2,
        halfLength: (hp.lengthKm * this.uPerKm) / 2,
        rotation: ((hp.rotationDeg ?? 0) * Math.PI) / 180,
        baseHeight: (hp.baseM ?? 0) / MAPGEO.metresPerUnit,
        peakHeight: hp.prominenceM / MAPGEO.metresPerUnit,
        grid: decodeHeightmap(hp.heightmap),
        n: hp.heightmap.n,
      });
    });

    // Authored map-editor layers (world/authored.ts) — hand-painted terrain/foliage/buildings pinned at real
    // lat/lon, projected here ONCE through the same frame as uplands. All rng-free, so a region with no
    // authored layers grows the byte-identical seeded world. Terrain is baked into baseHeight BEFORE lakes so
    // each lake's water level (sampled once from baseHeight) sits on the edited ground.
    this.authoredTerrain = this.buildAuthoredField(
      this.region.terrain,
      (d) => d.deltaM / MAPGEO.metresPerUnit, // real metres → world units (matches the upland vertical scale)
    );
    this.authoredFoliage = this.buildAuthoredField(this.region.foliage, (d) => d.density);
    this.authoredBuildings = (this.region.buildings ?? []).map((b) => {
      const p = this.project(b.lat, b.lon);
      return { x: p.x, z: p.z, kind: b.kind, rotationDeg: b.rotationDeg ?? 0 };
    });

    // Lakes scattered across the world, count scaled to area so water density stays
    // constant as the map grows (the curated LAKES3D radii seed the size range). Each
    // lake's water surface is the base terrain height at its center, sampled ONCE (so
    // the plane stays flat); groundHeightAt then carves a bowl below it — water sits IN
    // a depression. Each also gets a seeded irregular boundary (elongated + lobed).
    this.lakes = this.scatterLakes();

    // Streams connect the lakes downhill (A4); built after lakes so the water
    // network exists before biomes (which read distance-to-water, now incl. rivers).
    this.rivers = this.makeRivers();

    // Scenic bridges (truss spans where a road crosses a river). Resolved HERE — after the rivers, before
    // the roads — so makeRoads can route each river crossing ONTO its bridge (so a road actually runs over
    // the deck), and so each bridge's river VALLEY is shaped into the ground before the terrain mesh +
    // structures sample it. Pure math (no THREE) so World stays engine-free + the verify bundle stays light.
    // No rng → determinism is untouched. Empty off-SK / when BRIDGE.enabled is false.
    this.bridgeSiteList = this.resolveBridgeSites();
    this.setBridgeValleys(this.bridgeSiteList);

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
  getCommunity(which: number | 'base' | string): CommunitySite | null {
    if (which === 'base') return this.communities.find((c) => c.kind === 'base') ?? null;
    // A string anchor id ('la-ronge', 'weyakwin', …) → the placed anchored site (anchored maps).
    if (typeof which === 'string') return this.communities.find((c) => c.anchorId === which) ?? null;
    const towns = this.communities.filter((c) => c.kind === 'town');
    // Town index only — never fall through to a BASE slot (the array's first entries are bases),
    // so a mission's `community: N` can't accidentally resolve to a refuel base.
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
   * Project a real (lat, lon) onto world XZ with a cosine ("sinusoidal") projection about the geo box
   * centre: north → −Z (the radar's up), east (less-negative lon) → +X, and east–west scaled by the
   * point's own latitude cosine so meridians converge toward the pole — the province renders as its
   * real trapezoid (wider south, narrower north) rather than a stretched rectangle. uPerKm sizes the
   * whole thing so the N–S extent fills MAPGEO.fill of the world. No-op origin on a map without geo.
   */
  private project(lat: number, lon: number): { x: number; z: number } {
    const zKm = -(lat - this.latCenter) * KM_PER_DEG_LAT - this.offsetZKm;
    const xKm = (lon - this.lonCenter) * KM_PER_DEG_LAT * Math.cos(lat * DEG2RAD) - this.offsetXKm;
    return { x: xKm * this.uPerKm, z: zKm * this.uPerKm };
  }

  /** Does this map carry a real-world projection frame? False on procedural maps (the editor's lat/lon
   *  authoring needs a geo frame; without one project() is a degenerate identity at the origin). */
  get hasGeo(): boolean {
    return !!this.geo;
  }

  /** World units per real kilometre (the projection scale) — the map editor converts brush km ↔ units. */
  get unitsPerKm(): number {
    return this.uPerKm;
  }

  /** Public projection (lat/lon → world XZ) for the map editor — wraps the private `project`. */
  toWorld(lat: number, lon: number): { x: number; z: number } {
    return this.project(lat, lon);
  }

  /** Inverse projection (world XZ → real lat/lon) for the map editor: it paints in XZ and stores dabs as
   *  lat/lon. Exact inverse of `project` (latitude from z, then longitude using that latitude's cosine). */
  toLatLon(x: number, z: number): { lat: number; lon: number } {
    const zKm = z / this.uPerKm + this.offsetZKm;
    const xKm = x / this.uPerKm + this.offsetXKm;
    const lat = this.latCenter - zKm / KM_PER_DEG_LAT;
    const lon = this.lonCenter + xKm / (KM_PER_DEG_LAT * Math.cos(lat * DEG2RAD));
    return { lat, lon };
  }

  /**
   * Lake radius (units) from a real surface area (km²), compressed onto the MAPGEO playable band so a
   * giant reads huge while a small lake stays scoopable (a true-scale lake would be an unscoopable dot
   * at province scale). √area ∝ linear size; clamp to [areaMin, areaMax] then lerp [minR, maxR].
   * Undefined area → MAPGEO.lakeAreaDefault (unpublished recreational/river-widening lakes).
   */
  private lakeRadiusFromArea(areaKm2?: number): number {
    const a = Math.max(MAPGEO.lakeAreaMin, Math.min(MAPGEO.lakeAreaMax, areaKm2 ?? MAPGEO.lakeAreaDefault));
    const sMin = Math.sqrt(MAPGEO.lakeAreaMin);
    const t = (Math.sqrt(a) - sMin) / (Math.sqrt(MAPGEO.lakeAreaMax) - sMin);
    return MAPGEO.lakeMinR + t * (MAPGEO.lakeMaxR - MAPGEO.lakeMinR);
  }

  /** The active map's real boundary projected to world XZ — the province outline the radar draws and
   *  shades the exterior against. Null on procedural maps (no geo). */
  provinceOutline(): { x: number; z: number }[] | null {
    if (!this.geo) return null;
    if (!this.cachedOutline) this.cachedOutline = this.geo.outline.map((c) => this.project(c.lat, c.lon));
    return this.cachedOutline;
  }

  /**
   * Signed distance (world units) from (x,z) to the province outline: NEGATIVE inside, POSITIVE outside,
   * 0 on procedural maps (no geo, so the mask is a no-op there). Ray-cast point-in-polygon for the sign +
   * min point-to-segment distance for the magnitude — O(outline edges), and SK is 4 convex corners, so this
   * is cheap even called per terrain vertex. Reads the CACHED projected ring (never re-projects).
   */
  private insideProvince(x: number, z: number): number {
    const ring = this.provinceOutline();
    if (!ring || ring.length < 3) return 0;
    let inside = false;
    let minD2 = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      const d2 = pointToSegDist2(x, z, a.x, a.z, b.x, b.z);
      if (d2 < minD2) minD2 = d2;
    }
    const d = Math.sqrt(minD2);
    return inside ? -d : d;
  }

  /** Public boolean: is (x,z) at least `margin` units INSIDE the province polygon? True on procedural/square
   *  maps with no mask (geo present but not bounds-fit) so callers don't special-case. Used by placement
   *  guards to keep lakes/fires/structures off the lowered off-province band on a true-shape map. A positive
   *  `margin` requires extra clearance so a fire DISC seeded here (whose rendered centroid can drift toward
   *  the rim) still sits fully on real land — pass ≈ the fire's radius. */
  isInProvince(x: number, z: number, margin = 0): boolean {
    if (!this.geo || this.geo.fit !== 'bounds') return true;
    return this.insideProvince(x, z) < -margin;
  }

  /** Decorative place labels (far-north + southern reference points) projected to world XZ — pure radar labels,
   *  NOT gameplay anchors/structures, so the whole province reads as Saskatchewan. Empty if the map has none. */
  landmarks(): { name: string; x: number; z: number; kind: 'city' | 'town' }[] {
    return (this.region.landmarks ?? []).map((pl) => {
      const w = this.project(pl.lat, pl.lon);
      return { name: pl.name, x: w.x, z: w.z, kind: pl.kind };
    });
  }

  /** The LakeRuntime whose centre is nearest (x,z), or null if the map has no lakes. */
  private nearestLakeRuntime(x: number, z: number): LakeRuntime | null {
    let best: LakeRuntime | null = null;
    let bestD = Infinity;
    for (const l of this.lakes) {
      const d = (l.x - x) * (l.x - x) + (l.z - z) * (l.z - z);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best;
  }

  /** Resolve an authored anchor by id to its placed world site (anchored maps only), or null. */
  anchor(id: string): ResolvedAnchor | null {
    return this.resolvedAnchors.find((a) => a.id === id) ?? null;
  }

  /**
   * Is there scoopable open water within `range` units of (x,z)? True if any lake's (nominal) shoreline is
   * within range — so a pilot can refill the bucket nearby. The factory uses this to flag a town as
   * DEFENSIBLE (a fire near it can actually be fought) before authoring a defend-the-town mission there.
   */
  isScoopWaterWithin(x: number, z: number, range: number): boolean {
    for (const l of this.lakes) {
      if (Math.hypot(l.x - x, l.z - z) - l.r <= range) return true;
    }
    return false;
  }

  /**
   * The world-XZ polyline of an authored named river (`region.rivers`, e.g. 'Churchill River'),
   * or null if this map has no such river. A read-only geo query — like `landmarks()`/`anchor()`,
   * it just re-projects the authored lat/lon points through the same `project()` the world used to
   * lay the channel, so a feature (the Missinipe bridge) can be pinned onto real river geometry
   * without re-deriving the projection. Returns the raw centreline points (no meander), enough to
   * find the nearest point + flow tangent. Empty/missing river → null.
   */
  namedRiverPath(name: string): { x: number; z: number }[] | null {
    const def = (this.region.rivers ?? []).find((r) => r.name === name);
    if (!def || def.points.length < 2) return null;
    return def.points.map((p) => this.project(p.lat, p.lon));
  }

  /** Project a real (lat, lon) to world XZ via the active map's geo projection (anchored maps); a
   *  no-op origin on procedural maps. Public read-only wrapper for features pinned at real coords
   *  (e.g. the bridges) that need to resolve a lat/lon against the same projection the world used. */
  projectLatLon(lat: number, lon: number): { x: number; z: number } {
    return this.project(lat, lon);
  }

  /**
   * Shape a river VALLEY at each bridge so it spans the banks instead of standing tall on stilts:
   * `groundHeightAt` then RAISES the banks on either side up toward the deck, while the river channel
   * + the fly-under tunnel stay low. Call ONCE after construction with the resolved bridge sites
   * (empty to clear / on maps without any), BEFORE the terrain mesh + structures sample the ground.
   * Bank height + corridor width are DERIVED from the bridge config so they track any tuning. Uses no
   * rng and only raises ground, so determinism + the campaign verifier are untouched.
   */
  /** Graded flat helipad sites (set by Game from the resolved base pads BEFORE the terrain mesh builds). */
  private padLevels: { x: number; z: number; r: number; level: number }[] = [];

  /**
   * Register base helipad sites to GRADE FLAT: within `r` of each, `groundHeightAt` is leveled to `level` (the
   * pad's own centre height) and blends smoothly back to natural terrain at the rim — so the flat concrete slab
   * sits flush and a hillside can't poke through it (the "cutoff"). Pure, rng-free; levels TO the natural centre
   * height so it barely perturbs anything. Empty = ungraded. Set by Game before `createTerrain` samples the mesh.
   */
  setPadLevels(pads: readonly { x: number; z: number; r: number; level: number }[]): void {
    this.padLevels = pads.slice();
  }

  setBridgeValleys(sites: readonly { x: number; z: number; ax: number; az: number; surfaceY: number }[]): void {
    if (!BRIDGE.enabled || !BRIDGE.valley.enabled) {
      this.bridgeValleys = [];
      return;
    }
    const bankPeak = BRIDGE.span / 2;
    this.bridgeValleys = sites.map((site) => ({
      cx: site.x,
      cz: site.z,
      ax: site.ax,
      az: site.az,
      surfaceY: site.surfaceY,
      bankPeak,
      channelHalf: bankPeak * BRIDGE.valley.channelFrac,
      bankRise: (BRIDGE.deckClearance + BRIDGE.deckThickness) * BRIDGE.valley.bankToDeck,
      approach: BRIDGE.valley.approach,
      alongHalf: BRIDGE.valley.alongHalf,
      taper: BRIDGE.valley.taper,
    }));
  }

  /** The resolved scenic bridge sites (where a truss span crosses a river). Game reads these to build the
   *  bridge meshes/colliders; resolved once in the ctor. Empty off-SK / when BRIDGE.enabled is false. */
  bridgeSites(): BridgeSite[] {
    return this.bridgeSiteList.slice();
  }

  /**
   * Resolve every configured scenic bridge against this world: for each `BRIDGE.sites` entry, project its real
   * lat/lon and find the best CROSSING on its named river — not just the nearest point, but the one near there
   * where the span's two bank piers actually land on DRY ground (and the deck crosses water). Takes the segment
   * direction as the flow tangent and samples the water surface there. Mirrors `meshes/bridges.computeBridgeSites`
   * but runs DURING construction (pure math, no THREE) so `makeRoads` can route a crossing onto the result, and
   * the dry-bank search means a hand-typed coord no longer strands a pier in the water. Sites whose river isn't
   * on this map are skipped (empty off-SK / when disabled). No rng → determinism untouched.
   */
  private resolveBridgeSites(): BridgeSite[] {
    if (!BRIDGE.enabled) return [];
    const out: BridgeSite[] = [];
    const pierC = BRIDGE.span / 2 - BRIDGE.pierWidth / 2; // |offset| of each pier from the deck centre, across the span
    for (const spec of BRIDGE.sites) {
      const path = this.namedRiverPath(spec.river);
      if (!path) continue; // that river isn't on this map
      const near = this.project(spec.near.lat, spec.near.lon);
      const best = this.bestBridgeCrossing(path, near, pierC);
      if (!best) continue;
      const wl = this.waterLevelAt(best.x, best.z);
      const surfaceY = wl ?? this.groundHeightAt(best.x, best.z);
      out.push({ name: spec.name, x: best.x, z: best.z, surfaceY, ax: best.ax, az: best.az });
    }
    return out;
  }

  /**
   * Pick the bridge CROSSING on a river polyline near `near`: walk the spine at a fine step and score each
   * candidate so a span there lands its two bank piers (at ±`pierC` across the flow) on DRY ground while the
   * deck crosses water. Score = (deck-over-water) + (left pier dry) + (right pier dry), tie-broken toward the
   * point closest to `near`; only candidates within `BRIDGE.crossingSearch` of `near` are considered. Returns the
   * crossing point + unit flow tangent, or the plain nearest point if the river never offers a dry-bank span.
   */
  private bestBridgeCrossing(
    path: readonly { x: number; z: number }[],
    near: { x: number; z: number },
    pierC: number,
  ): { x: number; z: number; ax: number; az: number } | null {
    const search = BRIDGE.crossingSearch;
    const search2 = search * search;
    const step = BRIDGE.crossingStep;
    let best: { x: number; z: number; ax: number; az: number } | null = null;
    let bestScore = -Infinity;
    let bestNearD = Infinity;
    let fallback: { x: number; z: number; ax: number; az: number } | null = null;
    let fallbackD = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ax = (b.x - a.x) / segLen; // flow tangent
      const az = (b.z - a.z) / segLen;
      const px = -az; // perpendicular = the span axis (bank to bank)
      const pz = ax;
      const steps = Math.max(1, Math.ceil(segLen / step));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const cx = a.x + (b.x - a.x) * t;
        const cz = a.z + (b.z - a.z) * t;
        const nd = (cx - near.x) ** 2 + (cz - near.z) ** 2;
        // The plain nearest point — used only if no candidate in range offers a clean span.
        if (nd < fallbackD) {
          fallbackD = nd;
          fallback = { x: cx, z: cz, ax, az };
        }
        if (nd > search2) continue;
        const deckWet = this.isOverWater(cx, cz) ? 1 : 0;
        const leftDry = this.isOverWater(cx + px * pierC, cz + pz * pierC) ? 0 : 1;
        const rightDry = this.isOverWater(cx - px * pierC, cz - pz * pierC) ? 0 : 1;
        const score = deckWet + leftDry + rightDry;
        if (score > bestScore || (score === bestScore && nd < bestNearD)) {
          bestScore = score;
          bestNearD = nd;
          best = { x: cx, z: cz, ax, az };
        }
      }
    }
    // Require a genuine crossing (deck over water + at least one dry bank); otherwise fall back to nearest.
    return best && bestScore >= 2 ? best : fallback;
  }

  /**
   * Route a road over each bridge: find the road's nearest INTERIOR point that's actually a river CROSSING (on
   * the water) and within `BRIDGE.roadSnapDist`, and move it onto the bridge centre — so the carriageway crosses
   * the deck rather than causeway-ing the river off to one side (Game then rides the road up onto the deck there).
   * Only the single nearest crossing point is pulled, so a road that doesn't cross near a bridge is untouched (the
   * span just stands over the river as before). Endpoints stay pinned to their towns. Pure geometry, no rng.
   */
  private snapRoadsToBridges(roads: RoadRuntime[]): void {
    for (const b of this.bridgeSiteList) {
      let bestRoad: RoadRuntime | null = null;
      let bestI = -1;
      let bestD: number = BRIDGE.roadSnapDist;
      for (const road of roads) {
        for (let i = 1; i < road.pts.length - 1; i++) {
          const p = road.pts[i];
          const d = Math.hypot(p.x - b.x, p.z - b.z);
          if (d >= bestD) continue;
          // Only snap a genuine water crossing (a dry near-town point would yank the road sideways).
          if (!this.isOverWater(p.x, p.z) && !this.nearestRiver(p.x, p.z)) continue;
          bestD = d;
          bestRoad = road;
          bestI = i;
        }
      }
      if (bestRoad && bestI >= 0) bestRoad.pts[bestI] = { x: b.x, z: b.z };
    }
  }

  /** All placed anchors (bases + towns) for the active map; empty on procedural maps. */
  anchors(): ResolvedAnchor[] {
    return this.resolvedAnchors.slice();
  }

  /** The home base anchor (cold-start / default refuel), or null if the map has no anchors. */
  homeAnchor(): ResolvedAnchor | null {
    return this.resolvedAnchors.find((a) => a.home) ?? null;
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
    // Anchored maps: pin a GUARANTEED scoop lake at each scoop-bearing anchor BEFORE the random scatter,
    // at its real projected position with a radius derived from the lake's real surface area. Process
    // BASES first (a base must keep its own water), biggest lake first so the giants (Reindeer) claim
    // their space; a TOWN lake whose centre falls inside an already-placed lake is dropped — the town
    // then attaches to that neighbouring water (realistic for the connected Churchill chain). They count
    // toward `count` (below), displacing random water; the random loop keeps clear of them.
    const scoopAnchors = (this.region.anchors ?? []).filter((a) => a.scoop);
    scoopAnchors.sort((a, b) => {
      const abase = a.kind !== 'community';
      const bbase = b.kind !== 'community';
      if (abase !== bbase) return abase ? -1 : 1; // bases before towns
      return this.lakeRadiusFromArea(b.scoop!.areaKm2) - this.lakeRadiusFromArea(a.scoop!.areaKm2); // biggest first
    });
    for (const a of scoopAnchors) {
      const isBase = a.kind !== 'community';
      const sc = a.scoop!;
      const reqR = this.lakeRadiusFromArea(sc.areaKm2);
      // A SIGNATURE lake (elong + bearing) keeps its real silhouette: split the equal-area radius into a short
      // axis (the stored `r`) and a longer axis so the FOOTPRINT AREA is preserved while it sprawls in its true
      // compass direction (Reindeer long N–S, Lac La Ronge canted NE). A plain lake stays a near-round disc.
      const r = sc.elong ? reqR / Math.sqrt(sc.elong) : reqR;
      const shape = sc.elong ? this.makeLakeShape({ elong: sc.elong, elongAngle: bearingToElongAngle(sc.bearingDeg ?? 0) }) : this.makeLakeShape();
      const p = this.project(a.lat, a.lon);
      // Keep the lake on the map: clamp its centre so centre ± (short) radius stays inside the terrain. An
      // elongated long axis may overhang the rim — realistic, it just clips at the border like the real lake.
      const limX = this.sizeX / 2 - r - 30;
      const limZ = this.sizeZ / 2 - r - 30;
      p.x = Math.max(-limX, Math.min(limX, p.x));
      p.z = Math.max(-limZ, Math.min(limZ, p.z));
      // Drop a TOWN lake that would substantially overlap existing water (it attaches to that lake — the
      // connected Churchill chain near La Ronge becomes one big lake, not a pile of discs); bases keep theirs.
      if (!isBase && lakes.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + r * 0.4)) continue;
      const lake: LakeRuntime = { x: p.x, z: p.z, r, waterLevel: this.baseHeight(p.x, p.z), shape, name: sc.lake };
      this.applyOutline(lake, sc.outline); // authored freeform shore (if any) overrides the ellipse silhouette
      lakes.push(lake);
    }
    const density = LAKES3D.length / (600 * 600); // curated lakes per unit² at the base size
    const count = Math.max(LAKES3D.length, Math.round(density * this.sizeX * this.sizeZ * this.profile.lakeDensityScale));
    const boundX = this.sizeX / 2 - 60;
    const boundZ = this.sizeZ / 2 - 60;
    const radii = LAKES3D.map((l) => l.r);
    let guard = 0;
    while (lakes.length < count && guard++ < count * 80) {
      const x = (this.rng() * 2 - 1) * boundX;
      const z = (this.rng() * 2 - 1) * boundZ;
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
        // On an anchored map the ONLY named lakes are the real ones pinned at anchors — the random
        // background ponds stay nameless so the radar never labels a real SK lake at a fake spot
        // ("hallucinated" Wollaston/Knee/Hatchet Lakes scattered everywhere). Procedural maps keep names.
        name: this.region.anchors?.length ? '' : this.nameSource.lake(),
      });
    }

    // Iconic GEOGRAPHIC lakes (far-north giants + southern reservoirs) at their REAL centroids. Appended AFTER
    // the gameplay water so the central campaign layout — and the seeded RNG stream — stay byte-identical: their
    // shapes come from a LOCAL deterministic generator (namedLakeShape), never this.rng. They make the radar read
    // as Saskatchewan beyond the campaign band but belong to no mission. They may clip the province rim or kiss a
    // hydrologically-connected neighbour (Athabasca↔Black) — both faithful to the real map.
    const named = this.region.namedLakes ?? [];
    for (let i = 0; i < named.length; i++) {
      const nl = named[i];
      const reqR = this.lakeRadiusFromArea(nl.areaKm2);
      const elong = nl.elong && nl.elong > 1 ? nl.elong : 1;
      const r = elong > 1 ? reqR / Math.sqrt(elong) : reqR;
      const p = this.project(nl.lat, nl.lon);
      const limX = this.sizeX / 2 - r - 20;
      const limZ = this.sizeZ / 2 - r - 20;
      p.x = Math.max(-limX, Math.min(limX, p.x));
      p.z = Math.max(-limZ, Math.min(limZ, p.z));
      const lake: LakeRuntime = { x: p.x, z: p.z, r, waterLevel: this.baseHeight(p.x, p.z), shape: namedLakeShape(elong, bearingToElongAngle(nl.bearingDeg ?? 0), i), name: nl.name };
      this.applyOutline(lake, nl.outline); // authored freeform shore (if any) overrides the ellipse silhouette
      lakes.push(lake);
    }
    return this.applyNoLakeZones(lakes);
  }

  /**
   * Drop NAMELESS procedural ponds whose centre falls inside a region `noLakeZones` exclusion — to clear a stray
   * pond from a stretch that should read as open land/river. Named scoop + geographic lakes are ALWAYS kept.
   * Applied AFTER the seeded scatter, so the rng stream — and thus every other lake — stays byte-identical; only
   * the excluded ponds vanish. No-op when the region declares no zones (every other map is unchanged).
   */
  private applyNoLakeZones(lakes: LakeRuntime[]): LakeRuntime[] {
    const zones = this.region.noLakeZones;
    if (!zones?.length) return lakes;
    return lakes.filter((l) => {
      if (l.name) return true; // never remove a named scoop / geographic lake
      for (const z of zones) {
        const p = this.project(z.lat, z.lon);
        if (Math.hypot(l.x - p.x, l.z - p.z) <= z.radiusKm * this.unitsPerKm) return false;
      }
      return true;
    });
  }

  /**
   * Generate one lake's seeded irregular boundary (elongation + angular lobes). A signature lake passes an
   * `override` to stamp its REAL silhouette (axis ratio + orientation); the random draws are still CONSUMED
   * either way so the seeded world is identical regardless of which lakes carry an override.
   */
  private makeLakeShape(override?: { elong?: number; elongAngle?: number }): LakeShape {
    const rElong = LAKE_SHAPE.elongMin + this.rng() * (LAKE_SHAPE.elongMax - LAKE_SHAPE.elongMin);
    const rAngle = this.rng() * Math.PI * 2;
    const elong = override?.elong ?? rElong;
    const elongAngle = override?.elongAngle ?? rAngle;
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
    // Authored freeform shore: interpolate the pre-sampled boundary LUT (wrap-around) — O(1), and it makes
    // every downstream consumer trace the exact outline without knowing it isn't an ellipse.
    const lut = lake.radial;
    if (lut) {
      const n = lut.length;
      let a = phi / (Math.PI * 2);
      a -= Math.floor(a); // wrap phi into [0, 1)
      const f = a * n;
      const i = Math.floor(f) % n;
      const frac = f - Math.floor(f);
      return lut[i] * (1 - frac) + lut[(i + 1) % n] * frac;
    }
    const s = lake.shape;
    const a = phi - s.elongAngle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const ellipse = 1 / Math.sqrt((ca / s.elong) * (ca / s.elong) + sa * sa);
    let w = 1;
    for (const h of s.harmonics) w += h.amp * Math.sin(h.k * phi + h.phase);
    return lake.r * ellipse * w;
  }

  /**
   * Stamp an authored freeform outline onto a lake: project its real lat/lon ring to world XZ, re-centre the
   * lake on the ring centroid, and ray-cast a per-angle boundary LUT from there (`radial`). After this the lake
   * traces the EXACT drawn shore everywhere `lakeRadius` is read. Determinism is untouched — the lake's seeded
   * `shape` (and its rng draws) were already taken; this only overrides the boundary, centre, radius and water
   * level. No-op for a missing/degenerate ring, so the lake keeps its ellipse. (Assumes a star-convex outline —
   * the editor's default; a wild concavity past the centre is bridged radially, never a hole.)
   */
  private applyOutline(lake: LakeRuntime, outline: readonly { lat: number; lon: number }[] | undefined): void {
    if (!outline || outline.length < 3) return;
    const verts = outline.map((o) => this.project(o.lat, o.lon));
    let cx = 0;
    let cz = 0;
    for (const v of verts) {
      cx += v.x;
      cz += v.z;
    }
    cx /= verts.length;
    cz /= verts.length;
    const lut = buildLakeLUT(cx, cz, verts, LAKE_OUTLINE_SAMPLES);
    let maxR = 0;
    for (const t of lut) if (t > maxR) maxR = t;
    if (maxR <= 0) return; // degenerate (centre outside the ring) → leave the ellipse intact
    lake.x = cx;
    lake.z = cz;
    lake.r = maxR;
    lake.radial = lut;
    lake.waterLevel = this.baseHeight(cx, cz);
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

    // Authored named rivers FIRST (region.rivers): real lat/lon polylines laid as carved channels. Uses no rng,
    // so it can't perturb the seeded procedural streams that follow.
    this.addAuthoredRivers(rivers);

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

  /**
   * Lay each authored region river (a real lat/lon polyline) as a chain of short carved channels — one
   * RiverRuntime per consecutive pair of points. The water surface is sampled from the terrain at each
   * vertex (`baseHeight`), so the channel hugs the ground and stays scoopable everywhere `waterLevelAt`
   * reads it; `width` is the FULL ribbon width (halved here for the channel half-width `buildRiver` expects,
   * default = the mini-river width). Uses NO rng — determinism is untouched. Each segment is its own mesh in
   * Game, so frustum culling keeps the draw cost to the few segments near the camera.
   */
  private addAuthoredRivers(rivers: RiverRuntime[]): void {
    for (const def of this.region.rivers ?? []) {
      const verts = def.points.map((p) => this.project(p.lat, p.lon));
      if (verts.length < 2) continue;
      const half = (def.width ?? STREAM.width * 2) / 2;
      rivers.push(this.buildAuthoredRiver(verts, half, STREAM.meanderAmp * 0.5));
    }
  }

  /**
   * Build ONE continuous river from an authored lat/lon polyline: resample the whole run into a dense, gently
   * meandering point list, then give it a per-vertex water surface that FOLLOWS the terrain DOWNHILL — a
   * monotonic-descending lower envelope of the natural ground along the path (flowing from the higher end). That
   * keeps the surface at or below ground everywhere, so the carved channel stays submerged in one continuous
   * ribbon instead of breaking into puddles where the old per-segment straight-line surface poked above a
   * mid-segment rise. RNG-free (so it can't perturb the seeded world); `baseHeight` here is pre-carve terrain.
   */
  private buildAuthoredRiver(verts: { x: number; z: number }[], half: number, meanderAmp: number): RiverRuntime {
    // Resample the full polyline at ~STREAM.resample spacing into one continuous list; the meander envelope
    // tapers to 0 only at the two TRUE ends (not at every authored vertex) so the river curves smoothly through.
    const segLen: number[] = [];
    let totalIn = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      const l = Math.hypot(verts[i + 1].x - verts[i].x, verts[i + 1].z - verts[i].z);
      segLen.push(l);
      totalIn += l;
    }
    totalIn = totalIn || 1;
    const pts: { x: number; z: number }[] = [];
    let acc = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      const a = verts[i];
      const b = verts[i + 1];
      const L = segLen[i] || 1;
      const nx = -(b.z - a.z) / L; // unit perpendicular (lateral meander)
      const nz = (b.x - a.x) / L;
      const segs = Math.max(1, Math.ceil(L / STREAM.resample));
      for (let k = i === 0 ? 0 : 1; k <= segs; k++) {
        const tt = k / segs;
        const bx = a.x + (b.x - a.x) * tt;
        const bz = a.z + (b.z - a.z) * tt;
        const gt = (acc + L * tt) / totalIn; // global 0..1 along the whole river
        const off = this.noise.simplex(bx * 0.02 + 13, bz * 0.02 - 7) * meanderAmp * Math.sin(Math.PI * gt);
        pts.push({ x: bx + nx * off, z: bz + nz * off });
      }
      acc += L;
    }

    // Terrain-following monotonic surface: sample the natural ground, then take a running minimum from the
    // higher end so the surface never rises (water flows downhill) and never sits above ground (no puddles).
    const n = pts.length;
    const terr = pts.map((p) => this.baseHeight(p.x, p.z));
    const surf = new Array<number>(n);
    if (terr[0] >= terr[n - 1]) {
      surf[0] = terr[0];
      for (let i = 1; i < n; i++) surf[i] = Math.min(terr[i], surf[i - 1]);
    } else {
      surf[n - 1] = terr[n - 1];
      for (let i = n - 2; i >= 0; i--) surf[i] = Math.min(terr[i], surf[i + 1]);
    }

    const cum = [0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      minX = Math.min(minX, pts[i].x);
      maxX = Math.max(maxX, pts[i].x);
      minZ = Math.min(minZ, pts[i].z);
      maxZ = Math.max(maxZ, pts[i].z);
    }
    return { pts, width: half, surf, surfStart: surf[0], surfEnd: surf[n - 1], cum, total: cum[cum.length - 1] || 1, minX, maxX, minZ, maxZ };
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
    // Anchored maps (Saskatchewan): the real fire bases + protected towns ARE the populated map,
    // placed at authored coords. No random ambient towns → no duplicate names, no clutter.
    if (this.region.anchors?.length) {
      this.placeAnchoredSites(out);
      return out;
    }
    // Procedural maps (BC / Ontario / sandbox): lakeside bases biggest-lake-first, then forest hamlets.
    for (const base of this.pickLakesideSites(COMMUNITIES.baseCount)) out.push(base);
    this.scatterAmbientTowns(out);
    return out;
  }

  /**
   * Place the region's authored anchors (bases + towns) at their relative coords. The HOME anchor goes
   * FIRST so `bases()[0]` / `getCommunity('base')` resolve to it. Bases sit on the dry shore of their
   * guaranteed scoop lake; towns sit at their coord (nudged off water if one happens to cover it). Records
   * `resolvedAnchors` so `anchor()/homeAnchor()` and `getCommunity(id)` can look them up.
   */
  private placeAnchoredSites(out: CommunitySite[]): void {
    this.resolvedAnchors = [];
    const all = this.region.anchors ?? [];
    // Operational HOME base: the build's homeBase (a base/both anchor) if given, else the region's
    // `home` anchor, else the first base. Placed FIRST so bases()[0] / getCommunity('base') resolve to it.
    const chosen =
      (this.homeBaseId && all.find((a) => a.id === this.homeBaseId && (a.kind === 'base' || a.kind === 'both'))) ||
      all.find((a) => a.home) ||
      all.find((a) => a.kind === 'base' || a.kind === 'both') ||
      null;
    const anchors = chosen ? [chosen, ...all.filter((a) => a.id !== chosen.id)] : [...all];
    for (const a of anchors) {
      const p = this.project(a.lat, a.lon);
      const lake = this.lakeAt(p.x, p.z) ?? this.nearestLakeRuntime(p.x, p.z);
      const isBase = a.kind === 'base' || a.kind === 'both';
      const isCity = a.kind === 'city';
      let site: { x: number; z: number } = p;
      if (isBase && lake) {
        // A base is a lakeside depot: seat it on the shore of its own (pinned) lake nearest its position.
        const s = this.lakeShorePointNear(lake, p.x, p.z) ?? this.lakeShorePoint(lake);
        if (s) site = s;
      } else if (!isBase && this.isOverWater(p.x, p.z)) {
        // A town/city whose projected point lands on a (shared) lake nudges to the NEAREST dry land from its
        // own spot — so towns ringing one big lake spread along its shore instead of collapsing to a point.
        site = this.nudgeToDryLand(p.x, p.z);
      }
      out.push({
        name: a.name,
        x: site.x,
        z: site.z,
        kind: isCity ? 'city' : isBase ? 'base' : 'town',
        radius: COMMUNITIES.clusterRadius,
        buildings: isBase || isCity ? 0 : (COMMUNITIES.cabinsMin + COMMUNITIES.cabinsMax) >> 1,
        anchorId: a.id,
        // Decoration tier: a 'city' anchor → dense skyline; a base reads as a city when it's `urban` (Prince
        // Albert) else a medium base cluster; a community → a sparse hamlet.
        tier: isCity ? 'city' : isBase ? (a.urban ? 'city' : 'base') : 'community',
      });
      this.resolvedAnchors.push({ id: a.id, name: a.name, kind: a.kind, x: site.x, z: site.z, home: a.id === chosen?.id, lake });
    }
    this.separateTownSites(out);
  }

  /**
   * Push apart any TOWN sites that landed too close (tight real clusters like the Churchill-chain
   * villages around La Ronge, or two towns nudged onto the same shore arc) so each stays a distinct,
   * readable marker rather than an overlapping blob. A few relaxation passes; each move re-snaps to dry
   * land. Bases are left alone (they're far apart and pinned to their lake). `out` and `resolvedAnchors`
   * are index-parallel, so both are updated together.
   */
  private separateTownSites(out: CommunitySite[]): void {
    const MIN_SEP = 26; // ≈ a cluster radius — yards may kiss but centres read as separate
    const towns = out.map((c, i) => ({ c, i })).filter((o) => o.c.kind === 'town');
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let m = 0; m < towns.length; m++) {
        for (let n = m + 1; n < towns.length; n++) {
          const A = out[towns[m].i];
          const B = out[towns[n].i];
          const dx = B.x - A.x;
          const dz = B.z - A.z;
          const d = Math.hypot(dx, dz);
          if (d >= MIN_SEP) continue;
          // Deterministic fallback direction when two sites coincide exactly (index-derived, no RNG).
          const ux = d > 1e-3 ? dx / d : Math.cos(towns[m].i);
          const uz = d > 1e-3 ? dz / d : Math.sin(towns[m].i);
          const push = (MIN_SEP - d) / 2 + 0.5;
          const an = this.nudgeToDryLand(A.x - ux * push, A.z - uz * push);
          const bn = this.nudgeToDryLand(B.x + ux * push, B.z + uz * push);
          A.x = an.x;
          A.z = an.z;
          B.x = bn.x;
          B.z = bn.z;
          this.resolvedAnchors[towns[m].i].x = an.x;
          this.resolvedAnchors[towns[m].i].z = an.z;
          this.resolvedAnchors[towns[n].i].x = bn.x;
          this.resolvedAnchors[towns[n].i].z = bn.z;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Scatter `COMMUNITIES.townCount` random forest hamlets on dry ground, off spawn + off existing
   *  sites — the procedural-map populated layer (unused on anchored maps). */
  private scatterAmbientTowns(out: CommunitySite[]): void {
    const boundX = this.sizeX / 2 - 80;
    const boundZ = this.sizeZ / 2 - 80;
    let towns = 0;
    let guard = 0;
    while (towns < COMMUNITIES.townCount && guard++ < 800) {
      const x = (this.rng() * 2 - 1) * boundX;
      const z = (this.rng() * 2 - 1) * boundZ;
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
        tier: 'community',
      });
      towns++;
    }
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
        tier: 'base',
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

  /** Dry shore point of `lake` NEAREST world (px,pz): ray-march outward from the lake centre THROUGH
   *  that point to the first dry spot, so each anchor that shares a lake lands on its OWN side of the
   *  shore (near its real position) instead of every anchor collapsing onto one point. When (px,pz) is
   *  ~the lake centre (e.g. a base pinned at its lake) the angle defaults to +x. Null if landlocked. */
  private lakeShorePointNear(lake: LakeRuntime, px: number, pz: number): { x: number; z: number } | null {
    const a0 = Math.atan2(pz - lake.z, px - lake.x);
    const dx = Math.cos(a0);
    const dz = Math.sin(a0);
    const rr = this.lakeRadius(lake, a0);
    for (let m = rr + 6; m < rr + COMMUNITIES.baseShoreSearch; m += 3) {
      const x = lake.x + dx * m;
      const z = lake.z + dz * m;
      if (!this.isOverWater(x, z)) return { x, z };
    }
    return null;
  }

  /** Nearest dry land to (px,pz): expanding-ring search in all directions (independent of any one lake's
   *  centre), so a town sitting on shared water moves the SHORTEST way ashore near its real spot. Returns
   *  the input unchanged if surrounded by water out to the search cap (heavily-watered country). */
  private nudgeToDryLand(px: number, pz: number): { x: number; z: number } {
    if (!this.isOverWater(px, pz)) return { x: px, z: pz };
    for (let r = 8; r <= 180; r += 8) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = px + Math.cos(a) * r;
        const z = pz + Math.sin(a) * r;
        if (!this.isOverWater(x, z)) return { x, z };
      }
    }
    return { x: px, z: pz };
  }

  /**
   * Highway network. The TOPOLOGY (which towns connect) is a tree — any AUTHORED provincial-highway corridors
   * the region declares (real routes through real towns, e.g. Hwy 2: Prince Albert → Weyakwin → La Ronge), then
   * a minimum spanning tree (Prim's) over the community centers for whatever's still isolated. A tree means roads
   * MERGE at the towns they share and never lay a redundant second edge between the same pair (no overlap).
   *
   * Each edge's PATH is then routed by a water-aware grid A* (`routeRoad`), not a straight line nudged sideways:
   * the path goes AROUND lakes, crosses rivers short (then bridges them), prefers flatter ground, and coalesces
   * onto an already-laid road when it runs close — then it's line-of-sight simplified into long straight runs, so
   * there's no zig-zag. The cost grid is built once and shared by every edge. No rng → determinism untouched.
   */
  private makeRoads(): RoadRuntime[] {
    if (!ROADS.enabled) return []; // roads are off — roadless bush (no grid, no A*, no meshes, no authored roads)
    const nodes = this.communities;
    const roads: RoadRuntime[] = [];
    if (nodes.length < 2) {
      this.addAuthoredRoads(roads); // still lay hand-painted roads even on a community-sparse map
      return roads;
    }
    const grid = this.buildRoadGrid(); // shared water/slope cost field; `occupied` accumulates as edges are laid
    const built = new Set<string>();
    const edgeKey = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`);
    const nodeOf = (anchorId: string) => nodes.findIndex((n) => n.anchorId === anchorId);

    // Authored corridors: connect consecutive anchors of each real highway route, named for that highway.
    for (const route of this.region.highwayRoutes ?? []) {
      let prev = -1;
      for (const id of route.through) {
        const i = nodeOf(id);
        if (i < 0) continue;
        if (prev >= 0 && prev !== i && !built.has(edgeKey(prev, i))) {
          roads.push(this.routeRoad(grid, nodes[prev], nodes[i], route.name));
          built.add(edgeKey(prev, i));
        }
        prev = i;
      }
    }

    // Connectivity MST (Prim's) over ALL nodes — guarantees every settlement is linked even when the corridors
    // formed separate components. Edges already laid by a corridor are skipped (no duplicate road on top).
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
      if (!built.has(edgeKey(bi, bj))) {
        roads.push(this.routeRoad(grid, nodes[bi], nodes[bj]));
        built.add(edgeKey(bi, bj));
      }
    }
    this.addAuthoredRoads(roads); // hand-painted roads (map editor) laid alongside the generated network
    this.snapRoadsToBridges(roads); // pull each river crossing onto its bridge so a road runs over the deck
    return roads;
  }

  /**
   * Lay each authored region road (a real lat/lon polyline from the map editor) as a draped `RoadRuntime`.
   * The user painted the exact path, so the points are projected straight to world XZ (no meander, no MST) —
   * the road mesh still drapes them on the ground/water surface in Game. `width` is the half-width (default
   * `ROADS.width`); an unnamed road draws a designation from the region's highway pool. Uses NO rng.
   */
  private addAuthoredRoads(roads: RoadRuntime[]): void {
    for (const def of this.region.roads ?? []) {
      const pts = def.points.map((p) => this.project(p.lat, p.lon));
      if (pts.length < 2) continue;
      roads.push({ name: def.name ?? this.nameSource.highway(), pts, width: def.width ?? ROADS.width });
    }
  }

  /**
   * Build the shared road cost grid once: a coarse field over the playfield where lakes (and their sub-water
   * shore shelf) are IMPASSABLE, rivers cost extra (a short bridged crossing), and steep ground costs more, so
   * an A* over it naturally goes around water and prefers gentle slopes. `occupied` starts empty and fills in as
   * edges are laid, giving later roads a merge discount onto the shared corridor. Pure + deterministic (no rng).
   */
  private buildRoadGrid(): RoadGrid {
    const cell = ROADS.routeCell;
    const minX = -this.sizeX / 2;
    const minZ = -this.sizeZ / 2;
    const nx = Math.max(1, Math.ceil(this.sizeX / cell));
    const nz = Math.max(1, Math.ceil(this.sizeZ / cell));
    const cost = new Float32Array(nx * nz);
    const occupied = new Uint8Array(nx * nz);
    const bridges = this.bridgeSiteList; // resolved before makeRoads → roads can be funnelled onto each deck
    const attract2 = ROADS.bridgeAttract * ROADS.bridgeAttract;
    for (let iz = 0; iz < nz; iz++) {
      const cz = minZ + (iz + 0.5) * cell;
      for (let ix = 0; ix < nx; ix++) {
        const cx = minX + (ix + 0.5) * cell;
        const idx = iz * nx + ix;
        if (this.roadCellBlocked(cx, cz)) {
          cost[idx] = Infinity; // a lake or its sub-water shelf → the route must go around
          continue;
        }
        // Bridge pull: near a bridge, river crossing is cheap (cross ON the deck) and the dry approach is
        // discounted (funnel toward it), so a road that must cross the river does so at the bridge, not beside it.
        let nearBridge = false;
        for (const b of bridges) {
          const dx = cx - b.x;
          const dz = cz - b.z;
          if (dx * dx + dz * dz <= attract2) {
            nearBridge = true;
            break;
          }
        }
        let c = 1 + this.slopeAt(cx, cz) * ROADS.slopeCost; // prefer flatter ground
        if (this.isOverWater(cx, cz)) {
          c += nearBridge ? ROADS.bridgeCrossCost : ROADS.riverCrossCost; // a river (lakes excluded): cheap on a bridge, costly elsewhere
        } else if (nearBridge) {
          c *= ROADS.bridgeApproachDiscount; // funnel the dry approach toward the deck
        }
        cost[idx] = c;
      }
    }
    return { cost, occupied, nx, nz, cell, minX, minZ };
  }

  /** Is (x, z) impassable to a road — inside a lake disc, or on the sub-water shore shelf carved below a nearby
   *  lake's surface (a road there drapes at/under the waterline)? Rivers are NOT blocked (they get bridged). */
  private roadCellBlocked(x: number, z: number): boolean {
    if (this.lakeAt(x, z)) return true;
    const g = this.groundHeightAt(x, z);
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const reach = lake.r * 2.5 + WORLD3D.lakeBankWidth + WORLD3D.lakeBlendWidth;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (g < lake.waterLevel + ROADS.shoreClear) return true;
    }
    return false;
  }

  /**
   * Route one road A→B over the cost grid: A* for a coarse cell path that avoids water + prefers gentle ground,
   * mark its cells `occupied` so later roads merge onto it, then line-of-sight simplify the path into long
   * straight runs (kills the zig-zag, arcs around lakes), resample to the mesh's ribbon spacing, and lightly
   * smooth. Endpoints are pinned to the two towns. Falls back to a straight line only if A* finds no route.
   */
  private routeRoad(grid: RoadGrid, a: CommunitySite, b: CommunitySite, name?: string): RoadRuntime {
    const sIdx = this.nearestOpenCell(grid, a.x, a.z);
    const gIdx = this.nearestOpenCell(grid, b.x, b.z);
    let coarse: { x: number; z: number }[];
    const path = sIdx >= 0 && gIdx >= 0 ? this.aStarRoad(grid, sIdx, gIdx) : null;
    if (path && path.length >= 2) {
      for (const idx of path) grid.occupied[idx] = 1; // a later edge that runs close coalesces onto this corridor
      coarse = path.map((idx) => this.cellCenter(grid, idx));
      coarse[0] = { x: a.x, z: a.z }; // pin exact town endpoints (the grid cell centre is only an approximation)
      coarse[coarse.length - 1] = { x: b.x, z: b.z };
    } else {
      // No route (or both towns share one cell) → a direct link. Mark the start cell so neighbours still merge.
      if (sIdx >= 0) grid.occupied[sIdx] = 1;
      coarse = [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
    }
    const straight = this.simplifyRoadPath(coarse);
    const dense = this.resampleRoad(straight);
    this.smoothRoad(dense);
    return { name: name ?? this.nameSource.highway(), pts: dense, width: ROADS.width };
  }

  /** Grid A* (8-connected, binary-heap, lazy-deletion). Step cost = destination cell cost × step length, with a
   *  merge discount on cells already carrying a road. Returns the cell-index path start→goal, or null if blocked. */
  private aStarRoad(grid: RoadGrid, start: number, goal: number): number[] | null {
    const { cost, occupied, nx, nz, cell } = grid;
    const N = nx * nz;
    const g = new Float32Array(N);
    g.fill(Infinity);
    const f = new Float32Array(N);
    f.fill(Infinity);
    const came = new Int32Array(N);
    came.fill(-1);
    const closed = new Uint8Array(N);
    const gx = goal % nx;
    const gz = (goal / nx) | 0;
    const heur = (ix: number, iz: number) => Math.hypot((ix - gx) * cell, (iz - gz) * cell);
    const heap: number[] = []; // cell indices, ordered by f via the closures below
    const up = (c: number) => {
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (f[heap[p]] <= f[heap[c]]) break;
        const t = heap[p];
        heap[p] = heap[c];
        heap[c] = t;
        c = p;
      }
    };
    const push = (i: number) => {
      heap.push(i);
      up(heap.length - 1);
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1;
          const r = l + 1;
          let s = c;
          if (l < heap.length && f[heap[l]] < f[heap[s]]) s = l;
          if (r < heap.length && f[heap[r]] < f[heap[s]]) s = r;
          if (s === c) break;
          const t = heap[s];
          heap[s] = heap[c];
          heap[c] = t;
          c = s;
        }
      }
      return top;
    };
    g[start] = 0;
    f[start] = heur(start % nx, (start / nx) | 0);
    push(start);
    while (heap.length) {
      const cur = pop();
      if (closed[cur]) continue;
      if (cur === goal) break;
      closed[cur] = 1;
      const cix = cur % nx;
      const ciz = (cur / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nix = cix + dx;
          const niz = ciz + dz;
          if (nix < 0 || niz < 0 || nix >= nx || niz >= nz) continue;
          const nIdx = niz * nx + nix;
          if (closed[nIdx] || cost[nIdx] === Infinity) continue;
          const stepLen = dx !== 0 && dz !== 0 ? cell * Math.SQRT2 : cell;
          const cc = cost[nIdx] * (occupied[nIdx] ? ROADS.mergeDiscount : 1);
          const tentative = g[cur] + cc * stepLen;
          if (tentative < g[nIdx]) {
            came[nIdx] = cur;
            g[nIdx] = tentative;
            f[nIdx] = tentative + heur(nix, niz);
            push(nIdx);
          }
        }
      }
    }
    if (start !== goal && came[goal] < 0) return null;
    const out: number[] = [];
    let c = goal;
    while (c !== -1) {
      out.push(c);
      if (c === start) break;
      c = came[c];
    }
    out.reverse();
    return out;
  }

  /** Nearest grid cell to a world point that a road can actually sit on (the town's own cell, else a short ring
   *  search outward) — towns sit on lake shores, so their exact cell can be blocked. −1 if nothing open is near. */
  private nearestOpenCell(grid: RoadGrid, x: number, z: number): number {
    const { cost, nx, nz, cell, minX, minZ } = grid;
    const ix0 = Math.max(0, Math.min(nx - 1, Math.floor((x - minX) / cell)));
    const iz0 = Math.max(0, Math.min(nz - 1, Math.floor((z - minZ) / cell)));
    if (cost[iz0 * nx + ix0] !== Infinity) return iz0 * nx + ix0;
    for (let r = 1; r <= 12; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring shell only
          const ix = ix0 + dx;
          const iz = iz0 + dz;
          if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
          const idx = iz * nx + ix;
          if (cost[idx] === Infinity) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** World-space centre of a grid cell. */
  private cellCenter(grid: RoadGrid, idx: number): { x: number; z: number } {
    const ix = idx % grid.nx;
    const iz = (idx / grid.nx) | 0;
    return { x: grid.minX + (ix + 0.5) * grid.cell, z: grid.minZ + (iz + 0.5) * grid.cell };
  }

  /**
   * Line-of-sight simplify: collapse the A* cell staircase into the fewest control points whose straight
   * segments stay clear of lakes — long straight runs that arc around the water, no zig-zag. Crossing a river on
   * a straight is fine (it's bridged); only LAKE water blocks a shortcut. Endpoints are always kept.
   */
  private simplifyRoadPath(pts: { x: number; z: number }[]): { x: number; z: number }[] {
    if (pts.length <= 2) return pts.slice();
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (this.segClearOfLakes(pts[i], pts[j])) break;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  /** Does the straight segment p→q stay off lake water (sampled every `ROADS.simplifyTol` units)? */
  private segClearOfLakes(p: { x: number; z: number }, q: { x: number; z: number }): boolean {
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    const steps = Math.max(1, Math.ceil(L / ROADS.simplifyTol));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (this.roadCellBlocked(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t)) return false;
    }
    return true;
  }

  /** Resample a sparse control polyline to ~`ROADS.resample` spacing so the road MESH has smooth, evenly-spaced
   *  cross-sections that drape the terrain (the mesh uses each point as one cross-section). Endpoints preserved. */
  private resampleRoad(pts: { x: number; z: number }[]): { x: number; z: number }[] {
    if (pts.length < 2) return pts.slice();
    const out: { x: number; z: number }[] = [{ x: pts[0].x, z: pts[0].z }];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const segs = Math.max(1, Math.round(L / ROADS.resample));
      for (let k = 1; k <= segs; k++) {
        const t = k / segs;
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    return out;
  }

  /**
   * Laplacian smoothing of a road's INTERIOR points — relax each toward the average of its neighbours a couple
   * passes, for gentle, polished bends where the simplified path turns around a lake. A point is NEVER relaxed
   * onto water OR a sub-water lake shelf (that would re-drape the deck at the waterline), and the endpoints stay
   * pinned to their towns. Cheap, one-time at world build.
   */
  private smoothRoad(pts: { x: number; z: number }[]): void {
    for (let pass = 0; pass < ROADS.smoothPasses; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        const cx = (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3;
        const cz = (pts[i - 1].z + pts[i].z + pts[i + 1].z) / 3;
        // Only relax onto safe ground — never back onto water OR a sub-water lake shelf (which would re-drape the
        // deck at the waterline). A rejected point keeps its dodged position, so this can't undo the lake-avoid.
        if (this.roadPointOk(cx, cz)) pts[i] = { x: cx, z: cz };
      }
    }
  }

  /**
   * Is (x, z) safe to drape a road on? Off all water AND up on the bank — above any nearby lake's surface by
   * ROADS.shoreClear, never on the sub-water shore shelf (carved below the water plane), which would sit the
   * deck at/under the waterline. Used by the smoothing pass; the dodge does the equivalent against its own lake.
   */
  private roadPointOk(x: number, z: number): boolean {
    if (this.isOverWater(x, z)) return false;
    const g = this.groundHeightAt(x, z);
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const reach = lake.r * 2.5 + WORLD3D.lakeBankWidth + WORLD3D.lakeBlendWidth; // matches the carve's influence cull
      if (dx * dx + dz * dz > reach * reach) continue;
      if (g < lake.waterLevel + ROADS.shoreClear) return false; // would drape at/under this lake's surface
    }
    return true;
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

    // Localized uplands (Cypress Hills): a smooth radial massif rising out of the flats. Applied AFTER the
    // muskeg flatten (a hill is dry high ground, not a wet basin) and added on top, with a touch of ridged
    // texture so the dome reads as rocky relief rather than a bald bump. Loop is empty on maps with no uplands.
    for (const u of this.uplands) {
      const d = Math.hypot(x - u.x, z - u.z);
      if (d >= u.r) continue;
      const t = 1 - d / u.r; // 1 at centre → 0 at rim
      const s = t * t * (3 - 2 * t); // smoothstep falloff
      const ridge = this.noise.ridged(wx, wz, this.ridgeFbm); // reuse the outcrop field for crest texture
      h += u.height * s * (1 + ridge * 0.18);
    }

    // Height patches (Cypress Hills): relief baked from a real mountain mesh — the shape is a sampled grid
    // rather than a radial dome. A light ridge modulation (scaled by the patch's own contribution, so it
    // fades out at the rim) gives the mesh rocky crest texture at the terrain's sampling resolution. The
    // loop is empty on maps with no patches → the seeded world is unchanged.
    for (const hp of this.heightPatches) {
      const hh = hp.sample(x, z);
      if (hh === 0) continue;
      const ridge = this.noise.ridged(wx, wz, this.ridgeFbm);
      h += hh * (1 + ridge * 0.12);
    }

    // Hand-painted terrain (map editor): a baked offset field raises/lowers the ground. O(1) bilinear
    // sample; null (no authored terrain) skips it entirely → the seeded world is unchanged.
    if (this.authoredTerrain) h += this.authoredTerrain.sample(x, z);
    return h;
  }

  /**
   * Build a load-time AuthoredField from a region's painted brush dabs (terrain or foliage), projecting
   * each lat/lon to world XZ and its real km radius to units. Returns null when nothing is authored, so
   * the per-frame samplers can short-circuit. Pure + rng-free (the determinism invariant).
   */
  private buildAuthoredField<T extends { lat: number; lon: number; radiusKm: number }>(
    dabs: readonly T[] | undefined,
    amp: (d: T) => number,
  ): AuthoredField | null {
    if (!dabs || !dabs.length) return null;
    const proj = dabs.map((d) => {
      const p = this.project(d.lat, d.lon);
      return { x: p.x, z: p.z, r: d.radiusKm * this.uPerKm, amp: amp(d) };
    });
    return new AuthoredField(this.sizeX, this.sizeZ, proj);
  }

  /**
   * Tree-density multiplier from the hand-painted foliage layer (map editor): max(0, 1 + field), so a
   * painted dab of +1 doubles trees there and −1 clears them. 1 everywhere when nothing is authored.
   * Game's forest scatter multiplies the biome density by this (alongside the clearing factor).
   */
  authoredFoliageMul(x: number, z: number): number {
    if (!this.authoredFoliage) return 1;
    return Math.max(0, 1 + this.authoredFoliage.sample(x, z));
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
    // Bridge valleys: raise the banks toward each deck so the bridges span valleys, not stilts.
    h = this.applyBridgeValleys(x, z, h);
    // Helipad grade: level the ground flat under each base pad so the slab sits flush (no terrain cutoff).
    h = this.applyPadLevels(x, z, h);
    // Province-outline mask (bounds-fit maps only): trace the real province edge. No-op on square maps.
    return this.applyOutlineFalloff(x, z, h);
  }

  /**
   * Level the ground toward each registered base-pad height within its grade radius (see setPadLevels), so a
   * flat helipad slab sits flush on flat ground. Fully flat inside `gradeFlatInner·r`, then a smooth (smootherstep)
   * blend back to natural terrain at the rim. A no-op outside every pad's reach, or when no pads are registered.
   */
  private applyPadLevels(x: number, z: number, h: number): number {
    if (this.padLevels.length === 0) return h;
    for (const p of this.padLevels) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d >= p.r) continue;
      const inner = p.r * HELIPAD.gradeFlatInner;
      const t = d <= inner ? 0 : (d - inner) / (p.r - inner);
      const w = 1 - smootherstep(t); // 1 at the centre (full flatten) → 0 at the rim (natural)
      h = h + (p.level - h) * w;
    }
    return h;
  }

  /**
   * Raise the banks of every bridge valley at (x, z) toward its deck (see setBridgeValleys), returning
   * the possibly-raised ground. A no-op (returns `h`) where there's no valley, the point is outside a
   * valley's localized footprint, inside its protected channel corridor, or over water — so it never
   * buries a lake or the river, and the fly-under tunnels stay clear.
   *
   * RAISE-only and SMOOTH: every falloff is quintic `smootherstep` (zero 1st + 2nd derivative at the
   * ends → no visible kink), the rise is spread over a wide wall + a generous taper for a casual,
   * polished slope, and overlapping valleys are combined with a MAX of their targets (not summed), so
   * two nearby bridges merge into one gentle rise instead of stacking into a spike.
   */
  private applyBridgeValleys(x: number, z: number, h: number): number {
    if (this.bridgeValleys.length === 0) return h;
    let target = h; // highest bank target any valley wants here; starts at natural ground (raise-only)
    for (const bv of this.bridgeValleys) {
      const dx = x - bv.cx;
      const dz = z - bv.cz;
      const u = dx * bv.ax + dz * bv.az; // along the river (the fly-under axis)
      const along = 1 - smootherstep((Math.abs(u) - bv.alongHalf) / bv.taper); // localize up/downstream of the bridge
      if (along <= 0) continue;
      const av = Math.abs(dx * bv.az - dz * bv.ax); // |across-span| — distance from the channel centreline
      if (av <= bv.channelHalf) continue; // the channel corridor stays low (protects the fly-under tunnel)
      const wall = Math.max(1e-3, bv.bankPeak - bv.channelHalf);
      const rampIn = smootherstep((av - bv.channelHalf) / wall); // 0 at the channel edge → 1 at the abutment (the valley wall)
      const rampOut = 1 - smootherstep((av - (bv.bankPeak + bv.approach)) / bv.taper); // hold the approach, then fade out
      const factor = rampIn * rampOut * along; // 0 outside the footprint → 1 at a full-height bank
      if (factor <= 0) continue;
      if (this.isOverWater(x, z)) continue; // never raise over water — keep lakes + the river at their level
      const want = lerp(h, bv.surfaceY + bv.bankRise, factor); // this valley's desired ground here
      if (want > target) target = want; // smooth-max across valleys → nearby bridges merge, never spike
    }
    return target;
  }

  /**
   * PROVINCE-OUTLINE MASK (Slice 2 — bounds-fit maps only): lower the ground toward `offProvinceLevel`
   * across a blend band straddling the projected outline, so the visible land edge traces the real province
   * instead of filling the rectangle. LOWER-ONLY (Math.min) so it never fights the lake basin carve or a
   * bridge raise — whichever is lower wins, giving a smooth transition, never a notch. The smoothstep puts
   * the half-lowered point exactly ON the outline, fully lowered one band past it (beyond = off-province
   * lowland; the distance fog swallows it — no ocean, no cliff, no hard flight wall). `flightFloorAt` reads
   * `groundHeightAt`, so the altitude band follows automatically. GATED on `fit:'bounds'` → square/procedural
   * maps are a no-op (byte-identical). Called last in `groundHeightAt` (after lakes/river/bridges).
   */
  private applyOutlineFalloff(x: number, z: number, h: number): number {
    if (!this.geo || this.geo.fit !== 'bounds') return h;
    const band = MAPGEO.outlineBlendBand;
    const low = MAPGEO.offProvinceLevel;
    const sd = this.insideProvince(x, z); // − inside, + outside
    if (sd <= -band) return h; // well inside → untouched
    if (sd >= band) return Math.min(h, low); // well outside → lowland (min so an even-lower carve still wins)
    const t = (sd + band) / (2 * band); // 0 at the inner band edge → 0.5 on the outline → 1 at the outer edge
    return Math.min(h, lerp(h, low, smoothstep(t)));
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
   * Water-surface Y scoopable from (x, z) with a horizontal tolerance `reach`, else null. A direct hit
   * (over a lake/river) returns its surface exactly like `waterLevelAt`; otherwise a lake whose irregular
   * shoreline is within `reach` of (x, z) still counts (its flat `waterLevel`). The slung bucket reads this
   * so a swung / tipped-over bucket that drifts a little past the exact waterline still fills — "looks like
   * it's in the lake" == "it scoops". `reach <= 0` is identical to `waterLevelAt`. O(lakes), like `lakeAt`.
   */
  scoopWaterAt(x: number, z: number, reach: number): number | null {
    const direct = this.waterLevelAt(x, z);
    if (direct !== null) return direct;
    if (reach <= 0) return null;
    for (const lake of this.lakes) {
      const dx = x - lake.x;
      const dz = z - lake.z;
      const d = Math.hypot(dx, dz);
      if (d > lake.r * 2.5 + reach) continue; // cheap reject — past the boundary + the tolerance
      if (d - this.lakeRadius(lake, Math.atan2(dz, dx)) <= reach) return lake.waterLevel;
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
   * slung bucket under); on land it sits a small groundClearance above the ground, so
   * you can SET DOWN ANYWHERE on open ground and the craft is never auto-lifted to clear
   * terrain. The trees are an obstacle the rotor crashes into (CRASH), NOT a floor that
   * elevators you over them. HelicopterSim adds the [minClearance, maxClearance] band on top.
   */
  flightFloorAt(x: number, z: number): number {
    const wl = this.waterLevelAt(x, z);
    if (wl !== null) return wl + FLIGHT.scoopClearance;
    return this.groundHeightAt(x, z) + FLIGHT.groundClearance;
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

// --- Real-world projection (module-pure helpers) -------------------------------

const KM_PER_DEG_LAT = 111.32; // mean km per degree of latitude (also the lon scale before cos(lat))
const DEG2RAD = Math.PI / 180;

// --- Authored freeform-lake boundary (module-pure) -----------------------------

const LAKE_OUTLINE_SAMPLES = 128; // angular resolution of an authored lake's boundary LUT (smooth + cheap to read)

/**
 * Distance along a ray (origin O, UNIT direction D) to its first crossing of segment A→B, or -1 if it misses.
 * Solves O + tD = A + u(B−A) for t ≥ 0, u ∈ [0,1]; |D|=1 so t is the world-unit distance. Used to ray-cast a
 * polygon outline into the per-angle boundary radius the radial lake model reads.
 */
function rayHitSeg(ox: number, oz: number, dx: number, dz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const det = ex * dz - ez * dx;
  if (Math.abs(det) < 1e-9) return -1; // ray ∥ edge
  const wx = ax - ox;
  const wz = az - oz;
  const t = (ex * wz - ez * wx) / det; // distance along the ray
  const u = (dx * wz - dz * wx) / det; // position along the edge
  if (u < -1e-6 || u > 1 + 1e-6 || t < 0) return -1;
  return t;
}

/**
 * Sample an outline polygon into a per-angle boundary-radius LUT, ray-cast from centre (cx, cz). Each entry is
 * the nearest shoreline crossing along that angle — exact for a star-convex ring (one crossing), and the same
 * convention `lakeRadius` reads back: angle a → direction (cos a, sin a), matching `atan2(dz, dx)`. A degenerate
 * angle with no forward hit borrows its neighbour so the boundary never collapses to 0.
 */
function buildLakeLUT(cx: number, cz: number, verts: { x: number; z: number }[], samples: number): number[] {
  const lut = new Array<number>(samples).fill(0);
  for (let s = 0; s < samples; s++) {
    const a = (s / samples) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let best = Infinity;
    for (let i = 0; i < verts.length; i++) {
      const A = verts[i];
      const B = verts[(i + 1) % verts.length];
      const t = rayHitSeg(cx, cz, dx, dz, A.x, A.z, B.x, B.z);
      if (t >= 0 && t < best) best = t;
    }
    lut[s] = Number.isFinite(best) ? best : 0;
  }
  // Patch any holes (a ray that found nothing — centre on/outside an edge) with the nearest non-zero neighbour.
  for (let s = 0; s < samples; s++) {
    if (lut[s] > 0) continue;
    for (let step = 1; step < samples; step++) {
      const a = lut[(s - step + samples) % samples];
      const b = lut[(s + step) % samples];
      if (a > 0 || b > 0) {
        lut[s] = Math.max(a, b);
        break;
      }
    }
  }
  // Relax the sharp radial notches a long/lobed (non-star-convex) shore casts so the waterline reads as a
  // smooth, uniform shape rather than a shimmering sliver-triangle edge. Wrap-around 3-tap binomial, applied
  // N times — the same LUT feeds the mesh, the carved basin and isOverWater, so the silhouette stays in lock-step.
  smoothLakeLUT(lut, LAKE_SHAPE.outlineSmoothPasses);
  return lut;
}

/**
 * Smooth a closed boundary-radius LUT in place: `passes` of a wrap-around [1,2,1]/4 binomial blur. Each pass
 * widens the effective Gaussian, so a few passes turn a notched cast into a gently varying ring without
 * collapsing the overall silhouette. No-op for `passes <= 0`.
 */
function smoothLakeLUT(lut: number[], passes: number): void {
  const n = lut.length;
  if (passes <= 0 || n < 3) return;
  for (let p = 0; p < passes; p++) {
    const src = lut.slice();
    for (let s = 0; s < n; s++) {
      const a = src[(s - 1 + n) % n];
      const b = src[s];
      const c = src[(s + 1) % n];
      lut[s] = (a + 2 * b + c) * 0.25;
    }
  }
}

/**
 * Compass bearing of a lake's long axis (degrees, 0 = N–S, 90 = E–W) → the `elongAngle` (the `phi` where the
 * boundary ellipse reaches farthest) in World's XZ convention: `phi = atan2(dz, dx)`, north = −Z, east = +X.
 * A bearing β points (sin β, −cos β) in world XZ, so its phi is `atan2(−cos β, sin β)` (sign is irrelevant —
 * the ellipse is symmetric about its axis).
 */
function bearingToElongAngle(bearingDeg: number): number {
  const b = bearingDeg * DEG2RAD;
  return Math.atan2(-Math.cos(b), Math.sin(b));
}

/**
 * An irregular lake boundary for a PINNED geographic lake, generated WITHOUT World's seeded RNG — so appending
 * these far-north/southern lakes never perturbs the campaign world (same ellipse + lobe-harmonic form as
 * `makeLakeShape`, but the lobes are a deterministic function of the lake's index).
 */
function namedLakeShape(elong: number, elongAngle: number, idx: number): LakeShape {
  const harmonics: { k: number; amp: number; phase: number }[] = [];
  for (let i = 0; i < LAKE_SHAPE.harmonics; i++) {
    const t = idx * 1.37 + i * 2.11 + 0.5;
    harmonics.push({
      k: 2 + ((idx + i) % 3), // 2..4 lobes
      amp: LAKE_SHAPE.harmonicAmp * (0.55 + 0.45 * Math.abs(Math.sin(t * 1.7))),
      phase: (t * 2.399) % (Math.PI * 2),
    });
  }
  return { elong: Math.max(1, elong), elongAngle, harmonics };
}

/**
 * The real-world projection frame for a region: its explicit `geo` if declared, else synthesised from
 * the anchor lat/lon bounds (padded 10%) so any anchored map still projects without an authored frame.
 * Null when the region has neither geo nor anchors (procedural maps — `project()` is never called there).
 */
function resolveGeo(region: Region): GeoFrame | null {
  if (region.geo) return region.geo;
  const anchors = region.anchors;
  if (!anchors?.length) return null;
  let latMin = Infinity;
  let latMax = -Infinity;
  let lonMin = Infinity;
  let lonMax = -Infinity;
  for (const a of anchors) {
    latMin = Math.min(latMin, a.lat);
    latMax = Math.max(latMax, a.lat);
    lonMin = Math.min(lonMin, a.lon);
    lonMax = Math.max(lonMax, a.lon);
  }
  const padLat = (latMax - latMin) * 0.1 || 0.1;
  const padLon = (lonMax - lonMin) * 0.1 || 0.1;
  latMin -= padLat;
  latMax += padLat;
  lonMin -= padLon;
  lonMax += padLon;
  return {
    latMin,
    latMax,
    lonMin,
    lonMax,
    outline: [
      { lat: latMin, lon: lonMin },
      { lat: latMin, lon: lonMax },
      { lat: latMax, lon: lonMax },
      { lat: latMax, lon: lonMin },
    ],
  };
}

/** The resolved world frame: projection scale + recentre + playfield extents (see computeWorldFrame). */
interface WorldFrame {
  latCenter: number;
  lonCenter: number;
  uPerKm: number;
  sizeX: number;
  sizeZ: number;
  offsetXKm: number;
  offsetZKm: number;
}

/**
 * Resolve the WORLD FRAME from a region's geo box — the rectangular-playfield seam. Two fits:
 *
 *   - default / 'square' (every existing map): the legacy SQUARE world. uPerKm scales the geo's N–S extent
 *     to MAPGEO.fill of a WORLD3D.size² playfield; no recentre. sizeX === sizeZ === WORLD3D.size. This branch
 *     is the EXACT old formula, so square maps stay byte-identical (and the campaign verifier is untouched).
 *
 *   - 'bounds' (true-shape maps): the world's extent BECOMES the province's projected bounding box. Project
 *     the outline corners in km about the geo centre, take their bbox, scale so the LONGEST side fills
 *     MAPGEO.boundsFill of the budget, and recentre on the bbox centroid so the (cosine-asymmetric) province
 *     sits centred at the origin. sizeX/sizeZ are the rectangle's true extents → the boundary is at the edge.
 *
 * Null geo (procedural maps) → an identity frame at WORLD3D.size² (project() is never called there).
 */
function computeWorldFrame(geo: GeoFrame | null): WorldFrame {
  if (!geo) {
    return { latCenter: 0, lonCenter: 0, uPerKm: 1, sizeX: WORLD3D.size, sizeZ: WORLD3D.size, offsetXKm: 0, offsetZKm: 0 };
  }
  const latCenter = (geo.latMin + geo.latMax) / 2;
  const lonCenter = (geo.lonMin + geo.lonMax) / 2;
  if (geo.fit !== 'bounds') {
    const uPerKm = (WORLD3D.size * MAPGEO.fill) / ((geo.latMax - geo.latMin) * KM_PER_DEG_LAT);
    return { latCenter, lonCenter, uPerKm, sizeX: WORLD3D.size, sizeZ: WORLD3D.size, offsetXKm: 0, offsetZKm: 0 };
  }
  // 'bounds': project the outline in km (uPerKm = 1, no recentre) and take the bounding box.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of geo.outline) {
    const zKm = -(c.lat - latCenter) * KM_PER_DEG_LAT;
    const xKm = (c.lon - lonCenter) * KM_PER_DEG_LAT * Math.cos(c.lat * DEG2RAD);
    if (xKm < minX) minX = xKm;
    if (xKm > maxX) maxX = xKm;
    if (zKm < minZ) minZ = zKm;
    if (zKm > maxZ) maxZ = zKm;
  }
  const widthKm = Math.max(1e-3, maxX - minX);
  const heightKm = Math.max(1e-3, maxZ - minZ);
  // ENGINE-DECIDED SIZE (D2): a CONSTANT real scale (MAPGEO.unitsPerKm), so the world's extent IS the
  // province's real bounding box at a fixed u/km. Then clamp the longest axis into
  // [worldSizeMin, worldSizeMax] — scaling u/km (aspect preserved) so a tiny province isn't a dot and a
  // giant one can't blow the fire-cell budget. SK's ~1224 km long axis × 1.63 ≈ 2000u (inside the band).
  let uPerKm = MAPGEO.unitsPerKm;
  const longest = Math.max(widthKm, heightKm) * uPerKm;
  if (longest > MAPGEO.worldSizeMax) uPerKm *= MAPGEO.worldSizeMax / longest;
  else if (longest < MAPGEO.worldSizeMin) uPerKm *= MAPGEO.worldSizeMin / longest;
  return {
    latCenter,
    lonCenter,
    uPerKm,
    sizeX: widthKm * uPerKm,
    sizeZ: heightKm * uPerKm,
    offsetXKm: (minX + maxX) / 2,
    offsetZKm: (minZ + maxZ) / 2,
  };
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
  let bestI = 0; // segment index of the nearest approach
  let bestU = 0; // fractional position along that segment
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
      bestI = i;
      bestU = u;
    }
  }
  // Per-vertex surface (authored rivers): interpolate along the nearest segment so the carve/water query read
  // the terrain-following profile. Else fall back to the linear surfStart→surfEnd model (mini-rivers).
  if (r.surf) return { d: bestD, surf: r.surf[bestI] + (r.surf[bestI + 1] - r.surf[bestI]) * bestU };
  const t = bestLen / r.total;
  return { d: bestD, surf: r.surfStart + (r.surfEnd - r.surfStart) * t };
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Squared distance from point (px,pz) to segment (ax,az)–(bx,bz). Squared to avoid a sqrt in the
 *  per-vertex point-in-polygon loop (insideProvince takes one sqrt over the min). */
function pointToSegDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + t * vx);
  const dz = pz - (az + t * vz);
  return dx * dx + dz * dz;
}

/** Quintic smootherstep (Perlin) — like smoothstep but with zero 1st AND 2nd derivative at both ends,
 *  so blends have no visible kink/crease. Used to keep the bridge valleys polished. */
function smootherstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * c * (c * (c * 6 - 15) + 10);
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
