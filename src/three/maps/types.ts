/**
 * Map schema — per-map world identity + picker + bundle types (moved verbatim from
 * world/regions.ts and world/terrainProfile.ts during the maps-foundation refactor).
 * A `MapModule` is one playable map: its Region (world-gen data), optional TerrainProfile,
 * picker MapCard, and optional campaign. Imports only TYPES (no runtime), so the Node verify
 * bundle reaches it with no import.meta.env in the graph.
 */
export type { TerrainDab, FoliageDab, AuthoredBuilding } from '../world/authored';
import type { TerrainDab, FoliageDab, AuthoredBuilding } from '../world/authored';
import type { MissionDef } from '../missions/types';

/** The three place-name pools a region's `NameSource` draws from. */
export interface RegionNames {
  lakes: readonly string[];
  communities: readonly string[];
  highways: readonly string[];
}

/** A real-world point (decimal °N / °, west negative) — used for authored lake outlines pinned at true coords. */
export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * An ANCHORED place on a map (the "future maps" placement layer — see docs/MAPS.md). A named
 * location pinned at its REAL latitude/longitude that world generation honors, rather than a name
 * draped onto a random procedural feature. World projects (lat, lon) into world XZ with a cosine
 * ("sinusoidal") projection (`Region.geo`), so the bases sit at their true relative positions and
 * the province comes out as its real converging-meridian trapezoid — not a stretched square.
 */
export interface MapAnchor {
  id: string; // stable id missions reference via MissionDef.homeBase ('la-ronge', 'denare-beach', …)
  name: string; // display name, pinned over the seeded NameSource ('La Ronge')
  kind: 'base' | 'community' | 'both' | 'city'; // 'base' = spawn/refuel; 'community' = protectable; SK towns are 'both';
  // 'city' = a large southern population centre (Saskatoon/Regina) — a road node + DENSE decorative skyline, but
  // NOT a gameplay base or a mission town (excluded from the town index, so adding one never shifts mission refs).
  lat: number; // real latitude, decimal °N
  lon: number; // real longitude, decimal degrees — NEGATIVE for west (e.g. -105.284)
  home?: boolean; // the default cold-start base when a mission omits homeBase (exactly one per region)
  urban?: boolean; // a BASE that also sits in a city (Prince Albert) → keeps its depot/refuel role but gets the
  // dense 'city' decorative skyline instead of the medium base scatter. Ignored on non-base anchors.
  scoop?: { lake: string; areaKm2?: number; elong?: number; bearingDeg?: number; outline?: readonly LatLon[] }; // guarantee
  // an adjacent scoop lake; radius derived from real area (MAPGEO band). Omit areaKm2 for an unpublished/recreational
  // lake → MAPGEO.lakeAreaDefault. `elong`/`bearingDeg` give a SIGNATURE lake its real silhouette (long/short
  // axis ratio + compass bearing of the long axis, 0 = N–S, 90 = E–W) so a giant like Reindeer sprawls in
  // its true direction instead of as a round disc. `outline` (≥3 real lat/lon points, authored in tools/map-editor.html)
  // pins an EXACT freeform shore — World ray-casts it into the same radial boundary the ellipse uses, so it supersedes
  // elong/bearing while areaKm2 stays the fallback. Omit scoop entirely = river-fed (attaches to nearest water).
  blurb?: string; // briefing / picker flavour
}

/**
 * A named GEOGRAPHIC lake pinned at its real centroid (the "reads-like-the-province" layer, docs/MAPS.md).
 * Unlike a base/town's scoop lake, these belong to no settlement — they're the iconic water that makes the
 * map read as Saskatchewan: the far-north giants (Athabasca, Wollaston, Cree, Black) and the southern
 * reservoirs (Diefenbaker, Last Mountain). World places them at their projected centroid with a radius from
 * real area (MAPGEO band) and an optional real silhouette (`elong` + `bearingDeg`). Drawn + labelled like any
 * named lake; scoopable if you fly there, but they sit away from the central campaign band.
 */
export interface RegionLake {
  name: string;
  lat: number;
  lon: number;
  areaKm2?: number; // real surface area → radius (MAPGEO band); omit → MAPGEO.lakeAreaDefault
  elong?: number; // long/short axis ratio (≥1); omit → near-round
  bearingDeg?: number; // compass bearing of the long axis (0 = N–S, 90 = E–W); omit → 0
  outline?: readonly LatLon[]; // EXACT freeform shore (≥3 real lat/lon pts, from tools/map-editor.html). World ray-casts
  // it into the radial boundary, so it supersedes elong/bearing; areaKm2 stays the fallback when omitted.
}

/**
 * A decorative PLACE LABEL pinned at its real lat/lon (the "reads-like-the-province" layer, docs/MAPS.md).
 * A geographic reference point drawn on the radar — a far-north settlement (Uranium City, Stony Rapids) or a
 * southern population centre (Saskatoon, Regina) — NOT a gameplay base or a damageable structure (those are
 * `anchors`). It lets the WHOLE province read as Saskatchewan without inventing missions in the empty north/south.
 */
export interface RegionPlace {
  name: string;
  lat: number;
  lon: number;
  kind: 'city' | 'town'; // 'city' = larger label (southern population centres); 'town' = smaller far settlement
}

/**
 * A real provincial-highway CORRIDOR routed through a sequence of anchor ids (the true road spine, e.g.
 * Hwy 2: Prince Albert → Weyakwin → La Ronge). World lays these named roads BEFORE its connectivity MST, so
 * the map's highways follow their real routes through the towns they actually serve instead of a nearest-
 * neighbour guess. Ids must be `anchors` on the same region; unknown ids are skipped.
 */
export interface HighwayRoute {
  name: string; // the highway designation drawn on the radar (e.g. 'Hwy 2')
  through: readonly string[]; // anchor ids in route order; consecutive pairs become road segments
}

/**
 * A LOCALIZED upland / massif pinned at its real lat/lon — a single elevated landform that rises out of the
 * otherwise-low boreal shield (Saskatchewan's Cypress Hills: the highest ground between the Rockies and
 * Labrador, real "mini-mountain" relief). World adds a smooth radial height bump at the projected centre in
 * `baseHeight`, so the terrain mesh + flight floor + biomes all see it. Unlike a profile's mountain layer
 * (which makes the WHOLE map mountainous, e.g. BC), an upland is a single hill in one corner — flight scenery.
 */
export interface RegionUpland {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number; // REAL footprint radius (km) → world units via the projection scale (uPerKm), so it scales
  // with the world like every other distance; the bump smoothsteps to 0 at that rim
  prominenceM: number; // REAL elevation above the surrounding plain (metres) → units via MAPGEO.metresPerUnit
}

/**
 * A localized massif baked from a real mountain MESH (vs. RegionUpland's smooth radial bump). A downloaded
 * mountain OBJ is rasterised once at build time into a normalized height grid (scripts/bake-heightmap.mjs →
 * a `{ n, data }` module), pinned here at its real lat/lon with a real km footprint + metre prominence.
 * World adds it into `baseHeight` like an upland, so it's collidable GROUND (flight floor / fire / lakes all
 * see its shape) — the engine loads no mesh. The grid is square; the footprint aspect lives in the km below.
 */
export interface RegionHeightPatch {
  name: string;
  lat: number; // footprint CENTRE (real coords)
  lon: number;
  widthKm: number; // REAL footprint extent (km) along the grid's local X (before rotation) → units via uPerKm
  lengthKm: number; // REAL footprint extent (km) along the grid's local Z — set widthKm:lengthKm to the bake's aspect
  prominenceM: number; // REAL peak elevation above the plain (metres → units via MAPGEO.metresPerUnit) at grid 1.0
  baseM?: number; // height (metres) the grid's 0.0 maps to (default 0 — the mesh skirt sits on the flats)
  rotationDeg?: number; // yaw about +Y in degrees (0 = grid X→world X); orient the peak vs. nearby water
  heightmap: { readonly n: number; readonly data: string }; // the baked, base64-packed normalized grid
}

/**
 * A named RIVER pinned as a real lat/lon polyline (authored in tools/map-editor.html). World projects each point
 * and lays the river as a chain of short channel segments hugging the terrain (like the procedural streams, but
 * following the authored path) — carved into the ground and scoopable like any water. Drawn BEFORE the procedural
 * stream network; uses no rng, so adding a river never perturbs the seeded world.
 */
export interface RegionRiver {
  name: string; // display label (e.g. 'Churchill River')
  width?: number; // FULL ribbon width in world units (World halves it for the channel half-width); omit → stream default
  points: readonly LatLon[]; // ≥2 real lat/lon points along the river's course, in flow order
}

/**
 * A hand-painted ROAD pinned as a real lat/lon polyline (authored in the in-3D map editor). Unlike the
 * auto-generated highway network (which World derives from anchors via an MST), an authored road follows the
 * EXACT path the user painted. World projects each point and lays it as one more draped `RoadRuntime` — so it
 * rides the terrain, causeways/ bridges water, and renders with the same road mesh as the generated roads.
 * Uses no rng, so adding one never perturbs the seeded world. The auto-road network is unaffected.
 */
export interface RegionRoad {
  name?: string; // optional designation drawn on the radar; omit → drawn from the region's highway name pool
  width?: number; // HALF-width of the asphalt ribbon in world units; omit → ROADS.width default
  points: readonly LatLon[]; // ≥2 real lat/lon points along the road's course, in order
}

/**
 * A map's real-world geographic frame: the lat/lon bounding box the playfield represents, plus the
 * province/region outline drawn on the radar. World scales the box's N–S extent to `MAPGEO.fill` of
 * the square world height and projects everything inside it; the outline (real corners, projected the
 * same way) bounds the in-province area so the map reads as the real place.
 */
export interface GeoFrame {
  latMin: number; // south edge (°N)
  latMax: number; // north edge (°N)
  lonMin: number; // west edge (° — negative for west)
  lonMax: number; // east edge (° — negative for west)
  outline: readonly { lat: number; lon: number }[]; // boundary polygon (real coords), projected for the radar
  /**
   * How the world is fitted to this frame (the rectangular-playfield seam — see World.computeWorldFrame):
   *   - undefined / 'square' (DEFAULT): the legacy SQUARE world — the province's N–S extent fills MAPGEO.fill
   *     of a WORLD3D.size² playfield and floats in the middle (the off-province E/W margin is muted on the radar).
   *   - 'bounds': a TRUE-SHAPE rectangular playfield — the world's extent BECOMES the province's projected
   *     bounding box (longest axis = MAPGEO.boundsFill of the budget), so the boundary sits at the map edge.
   * Default-square keeps every existing map byte-identical; a new map opts in with `fit: 'bounds'`.
   */
  fit?: 'square' | 'bounds';
}

/** One map's world identity. Extensible: terrain/biome/time-of-day slot in behind the same id. */
export interface Region {
  id: string; // matches a picker card id in ui/profile.ts MAPS
  label: string; // the real-world region this map evokes (flavour / debug)
  names: RegionNames;
  anchors?: readonly MapAnchor[]; // bases + communities at REAL lat/lon (placement layer, docs/MAPS.md)
  namedLakes?: readonly RegionLake[]; // iconic geographic lakes at REAL coords (far-north + south reference water)
  noLakeZones?: readonly { lat: number; lon: number; radiusKm: number }[]; // clear NAMELESS procedural ponds whose
  // centre falls inside (named scoop/geographic lakes are never touched) — removes a stray pond in a stretch that
  // should read as open land/river. Applied AFTER the seeded scatter, so every other lake stays byte-identical.
  landmarks?: readonly RegionPlace[]; // decorative place labels at REAL coords (far-north + southern reference points)
  highwayRoutes?: readonly HighwayRoute[]; // real highway corridors through real towns (laid before the MST)
  uplands?: readonly RegionUpland[]; // localized massifs (smooth radial bumps) added to baseHeight as relief
  heightPatches?: readonly RegionHeightPatch[]; // localized massifs baked from real mountain meshes (Cypress Hills)
  rivers?: readonly RegionRiver[]; // authored named rivers (real lat/lon polylines) laid as carved channels
  roads?: readonly RegionRoad[]; // hand-painted roads (real lat/lon polylines) laid as draped ribbons (map editor)
  terrain?: readonly TerrainDab[]; // hand-painted raise/lower brush dabs (map editor → World.baseHeight offset)
  foliage?: readonly FoliageDab[]; // hand-painted tree-density brush dabs (map editor → forest scatter bias)
  buildings?: readonly AuthoredBuilding[]; // hand-placed decorative structures (map editor → Game meshes)
  geo?: GeoFrame; // real-world projection frame (bounding box + outline) for anchored maps
}

export interface TerrainProfile {
  // --- base heightfield (the 12 config TERRAIN fields) ---
  baseAmplitude: number; // vertical scale of the rolling FBM (units)
  baseFrequency: number; // world→noise scale (lower = broader landforms)
  octaves: number;
  lacunarity: number; // frequency step per octave
  gain: number; // amplitude falloff per octave
  warpStrength: number; // domain-warp displacement (units) → winding ridgelines/valleys
  warpFrequency: number;
  ridgeAmplitude: number; // rocky crests poking above the rolling base
  ridgeFrequency: number;
  ridgeOctaves: number;
  ridgeThreshold: number; // only ridge values above this rise (localizes outcrops/ranges)
  lowlandFlatten: number; // 0..1 — compress sub-waterline dips into flatter basins

  // --- lake siting (replaces the old hardcoded `>3`) ---
  lakeMaxHeight: number; // reject a lake center whose baseHeight exceeds this (valley/lowland bias)
  lakeDensityScale: number; // multiplies the area-derived lake count (1 = baseline; <1 = fewer)

  // --- MOUNTAIN layer (optional; ABSENT = off → zero cost for low-relief maps) ---
  mountainAmplitude?: number; // ridged massif relief stacked on top of the base (units)
  mountainFrequency?: number; // peak spacing (lower = broader massifs)
  mountainOctaves?: number;
  mountainGain?: number;
  mountainExponent?: number; // sharpening power on the ridged value (>1 = flatter highs, sharper summits)

  // --- ALPINE banding (optional; drives the treeline → scree → snow look + tree cutoff) ---
  treeline?: number; // elevation above which trees vanish and ground turns to bare scree
  snowline?: number; // elevation above which ground turns to snow (defaults to treeline + 28)
  bandBlend?: number; // smoothstep half-width (units) for the band transitions
  colorScree?: number; // bare alpine rock/scree (hex)
  colorSnow?: number; // snow (hex)
}

/** A map's picker-card metadata. imageUrl is BASE_URL-relative (the UI prefixes it — keeps map data bundler-agnostic). */
export interface MapCard {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  available: boolean;
  accent: string;
  glyph: string;
  imageUrl?: string;
  /** Headline province facts shown on the picker card (pre-formatted display strings, e.g.
   *  '661,900 km²' / '100,000+ lakes'). Optional — a map without them just shows name + CTA. */
  stats?: { area: string; lakes: string };
}

/** One playable map = world identity + terrain + picker card + (optional) campaign. `country` groups
 *  maps in the picker only when more than one distinct value exists (flat tree, no country folders). */
export interface MapModule {
  id: string; // region id — the contract string (== card.id == mission.map)
  country: string; // owning country id (e.g. 'canada')
  card: MapCard;
  region: Region;
  terrain?: TerrainProfile; // omit → default (Saskatchewan boreal) via registry fallback
  missions?: readonly MissionDef[]; // omit → no campaign
}
