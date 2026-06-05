/**
 * Region registry — the per-MAP world identity (Track A5, "future maps" seam).
 *
 * A `Region` is everything that makes one map FEEL like a real place rather than generic
 * boreal: today that's its place-name pools (lakes / communities / highways), tomorrow it's
 * the slot where a map's terrain profile, biome weights, and default time-of-day live too.
 * `World` is built against a region id (the player's chosen map, or the mission's `map`), and
 * its name source draws from THAT region's pools — so adding a new map is adding an entry here,
 * never another hardcoded name list sprinkled through the engine.
 *
 * Region ids mirror the picker cards in `ui/profile.ts` (`MAPS`) so the menu, the world, and the
 * leaderboard all agree on one id per map. The picker holds the cosmetic card metadata (art,
 * blurb, unlock gate); the region holds the world-generation data. Same id, two concerns.
 *
 * Pure data + tiny resolvers — no Three.js, no World import (World imports US). Add names freely;
 * the seeded `NameDrawer` in `world/names.ts` shuffles each pool per seed and never repeats until
 * it's exhausted, so a bigger pool just means more variety before the numbered fallback kicks in.
 */

/** The three place-name pools a region's `NameSource` draws from. */
export interface RegionNames {
  lakes: readonly string[];
  communities: readonly string[];
  highways: readonly string[];
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
  kind: 'base' | 'community' | 'both'; // 'base' = spawn/refuel; 'community' = protectable; SK towns are 'both'
  lat: number; // real latitude, decimal °N
  lon: number; // real longitude, decimal degrees — NEGATIVE for west (e.g. -105.284)
  home?: boolean; // the default cold-start base when a mission omits homeBase (exactly one per region)
  scoop?: { lake: string; areaKm2?: number; elong?: number; bearingDeg?: number }; // guarantee an adjacent
  // scoop lake; radius derived from real area (MAPGEO band). Omit areaKm2 for an unpublished/recreational
  // lake → MAPGEO.lakeAreaDefault. `elong`/`bearingDeg` give a SIGNATURE lake its real silhouette (long/short
  // axis ratio + compass bearing of the long axis, 0 = N–S, 90 = E–W) so a giant like Reindeer sprawls in
  // its true direction instead of as a round disc. Omit scoop entirely = river-fed (attaches to nearest water).
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
}

/** One map's world identity. Extensible: terrain/biome/time-of-day slot in behind the same id. */
export interface Region {
  id: string; // matches a picker card id in ui/profile.ts MAPS
  label: string; // the real-world region this map evokes (flavour / debug)
  names: RegionNames;
  anchors?: readonly MapAnchor[]; // bases + communities at REAL lat/lon (placement layer, docs/MAPS.md)
  namedLakes?: readonly RegionLake[]; // iconic geographic lakes at REAL coords (far-north + south reference water)
  landmarks?: readonly RegionPlace[]; // decorative place labels at REAL coords (far-north + southern reference points)
  highwayRoutes?: readonly HighwayRoute[]; // real highway corridors through real towns (laid before the MST)
  uplands?: readonly RegionUpland[]; // localized massifs (e.g. Cypress Hills) added to baseHeight as relief
  geo?: GeoFrame; // real-world projection frame (bounding box + outline) for anchored maps
}

// --- saskatchewan ANCHORS — the real fire bases + protected towns at their REAL lat/lon ------------
// Real coordinates (verified) so World projects the bases to their true relative positions and the
// province comes out as its real trapezoid. `scoop.areaKm2` is the lake's real surface area — World
// derives the radius from it (MAPGEO band), so Reindeer (6650 km²) dwarfs Candle (132 km²). The 7 fire
// bases you spawn/refuel from + the towns the campaign defends. `kind:'both'` = a base that's ALSO a
// protected community (La Ronge / Denare Beach / Buffalo Narrows). Exactly one `home`. See docs/MAPS.md.
const SASKATCHEWAN_ANCHORS: readonly MapAnchor[] = [
  // 7 fire bases (real coords)
  { id: 'la-ronge', name: 'La Ronge', kind: 'both', lat: 55.1, lon: -105.284, home: true, scoop: { lake: 'Lac La Ronge', areaKm2: 480, elong: 1.3, bearingDeg: 40 }, blurb: 'Primary air-attack base — island lake, easy water.' },
  // ^ Lac La Ronge is famously island-filled (1,000+ islands), so its OPEN water is well under its 1,413 km²
  //   gross area — rendered compact (850 km², lightly elongated) so the home base sits on a shore, not in a swamp.
  { id: 'prince-albert', name: 'Prince Albert', kind: 'base', lat: 53.2, lon: -105.768, scoop: { lake: 'Candle Lake', areaKm2: 132 }, blurb: 'Southern gateway base; river country.' },
  { id: 'southend', name: 'Southend', kind: 'base', lat: 56.317, lon: -103.234, scoop: { lake: 'Reindeer Lake', areaKm2: 6650, elong: 2.6, bearingDeg: 10 }, blurb: 'Remote far-north outpost on a vast cold lake.' },
  { id: 'hudson-bay', name: 'Hudson Bay', kind: 'base', lat: 52.85, lon: -112.384, scoop: { lake: 'Ruby Lake', areaKm2: 2.2 }, blurb: 'Eastern forward base — lake-poor, hard scoop.' },
  { id: 'denare-beach', name: 'Denare Beach', kind: 'both', lat: 54.667, lon: -104, scoop: { lake: 'Amisk Lake', areaKm2: 453 }, blurb: 'SE lakeside village near the Manitoba line.' },
  { id: 'dorintosh', name: 'Dorintosh', kind: 'base', lat: 54.354, lon: -108.627, scoop: { lake: 'Greig Lake' }, blurb: 'SW park gateway — lakes everywhere, easy water.' },
  { id: 'buffalo-narrows', name: 'Buffalo Narrows', kind: 'both', lat: 55.863, lon: -108.479, scoop: { lake: 'Peter Pond Lake', areaKm2: 778, elong: 2.2, bearingDeg: 0 }, blurb: 'NW lakes-country base on the narrows.' },
  // protected towns the missions defend (river-system widenings near La Ronge have no published area → default)
  { id: 'weyakwin', name: 'Weyakwin', kind: 'community', lat: 54.423, lon: -105.787, scoop: { lake: 'Weyakwin Lake' } },
  { id: 'missinipe', name: 'Missinipe', kind: 'community', lat: 55.603, lon: -104.773, scoop: { lake: 'Otter Lake' } },
  { id: 'stanley-mission', name: 'Stanley Mission', kind: 'community', lat: 55.418, lon: -104.556, scoop: { lake: 'Nistowiak Lake' } },
  { id: 'sucker-river', name: 'Sucker River', kind: 'community', lat: 55.299, lon: -105.165 }, // on Lac La Ronge — attaches to La Ronge's water
  { id: 'beauval', name: 'Beauval', kind: 'community', lat: 55.146, lon: -107.611, scoop: { lake: 'Lac la Plonge', areaKm2: 257 } },
  { id: 'ile-a-la-crosse', name: 'Île-à-la-Crosse', kind: 'community', lat: 55.433, lon: -107.897, scoop: { lake: 'Lac Île-à-la-Crosse', areaKm2: 391 } },
  // secondaries for the missions' unpinned references (m2 LZ South, m4 Family 3)
  { id: 'missinipe-south', name: 'Missinipe South', kind: 'community', lat: 55.56, lon: -104.79 },
  { id: 'grandmothers-bay', name: 'Grandmother’s Bay', kind: 'community', lat: 55.607, lon: -104.591 }, // river-fed on the connected Churchill chain (no separate disc) — keeps the La Ronge cluster from over-watering
];

// Saskatchewan's real geographic frame: the full province (49°–60°N, 110°W to the Manitoba line) so
// the radar shows the whole provincial outline. The 4-corner boundary is the real edges; the cosine
// projection makes the meridians converge, so it renders as SK's iconic trapezoid (wider south, narrower
// north). Bases cluster in the central-north (their true positions); the open south is reserved for v2.
const SASKATCHEWAN_GEO: GeoFrame = {
  latMin: 49,
  latMax: 60,
  lonMin: -110, // west: the 110°W meridian (Alberta line)
  lonMax: -101.36, // east: the Manitoba line
  outline: [
    { lat: 49, lon: -110 }, // SW
    { lat: 49, lon: -101.36 }, // SE
    { lat: 60, lon: -102.0 }, // NE (east boundary drifts slightly west toward the north)
    { lat: 60, lon: -110 }, // NW
  ],
};

// Iconic GEOGRAPHIC lakes at their REAL centroids — the water that makes the radar read as Saskatchewan
// beyond the central campaign band. The far-north giants (Athabasca, Wollaston, Cree, Black) fill the top of
// the province above Southend; the southern reservoirs (Diefenbaker, Last Mountain) fill the bottom. Real
// areas drive the radius (MAPGEO band → giants read huge but stay playable); `elong`/`bearingDeg` give each
// its true silhouette (Athabasca long E–W, Last Mountain a long N–S thread). They belong to no base/town, so
// they never affect the campaign — World appends them after the gameplay water (see World.scatterLakes).
const SASKATCHEWAN_LAKES: readonly RegionLake[] = [
  { name: 'Lake Athabasca', lat: 59.1, lon: -108.7, areaKm2: 4500, elong: 2.8, bearingDeg: 90 }, // far NW giant, clipped at the AB line
  { name: 'Wollaston Lake', lat: 58.25, lon: -103.3, areaKm2: 2681, elong: 1.5, bearingDeg: 90 }, // NE bifurcation lake
  { name: 'Cree Lake', lat: 57.5, lon: -106.6, areaKm2: 1435, elong: 1.6, bearingDeg: 95 }, // central-north
  { name: 'Black Lake', lat: 59.18, lon: -105.35, areaKm2: 464, elong: 2.6, bearingDeg: 90 }, // far north, off the Fond du Lac River
  { name: 'Lake Diefenbaker', lat: 50.9, lon: -107.0, areaKm2: 394, elong: 4.0, bearingDeg: 110 }, // southern reservoir on the S. Saskatchewan
  { name: 'Last Mountain Lake', lat: 51.05, lon: -105.25, areaKm2: 226, elong: 5.5, bearingDeg: 168 }, // long NNW–SSE thread NW of Regina
];

// Decorative PLACE LABELS at their real coords — geographic reference points (not bases/missions) so the whole
// province reads right: the far-north settlements strung along Lake Athabasca and the Fond du Lac River, the NW
// villages, and the big southern cities the map otherwise omits. World projects these; the HUD radar labels them.
const SASKATCHEWAN_LANDMARKS: readonly RegionPlace[] = [
  // far north (Athabasca basin / Fond du Lac River)
  { name: 'Uranium City', lat: 59.567, lon: -108.615, kind: 'town' },
  { name: 'Fond-du-Lac', lat: 59.331, lon: -107.176, kind: 'town' },
  { name: 'Stony Rapids', lat: 59.253, lon: -105.836, kind: 'town' },
  // (the Wollaston Lake village sits on the lake's SW shore — the lake's own label already marks that spot)
  // northwest
  { name: 'La Loche', lat: 56.483, lon: -109.433, kind: 'town' },
  { name: 'Patuanak', lat: 55.903, lon: -107.714, kind: 'town' },
  // south + central-south (the populated grainbelt the campaign flies over but never to)
  { name: 'Meadow Lake', lat: 54.13, lon: -108.435, kind: 'town' },
  { name: 'Nipawin', lat: 53.367, lon: -104.009, kind: 'town' },
  { name: 'North Battleford', lat: 52.758, lon: -108.286, kind: 'city' },
  { name: 'Saskatoon', lat: 52.133, lon: -106.67, kind: 'city' },
  { name: 'Regina', lat: 50.445, lon: -104.619, kind: 'city' },
];

// Real provincial-highway corridors through the campaign towns — the spines that thread the map together.
// Hwy 2 is the north–south trunk (Prince Albert → Weyakwin → La Ronge); Hwy 102 runs north up the Churchill
// from La Ronge; Hwy 155 is the northwest lakes corridor. World lays these named roads before its MST.
const SASKATCHEWAN_HIGHWAYS: readonly HighwayRoute[] = [
  { name: 'Hwy 2', through: ['prince-albert', 'weyakwin', 'la-ronge'] },
  { name: 'Hwy 102', through: ['la-ronge', 'missinipe', 'stanley-mission'] },
  { name: 'Hwy 155', through: ['beauval', 'ile-a-la-crosse', 'buffalo-narrows'] },
];

// Cypress Hills — the lone "mini-mountain" in Saskatchewan's far SW corner (real ~49.6°N, 109.8°W, the highest
// land between the Rockies and Labrador, rising ~600 m above the surrounding plains). A localized massif for
// some real elevation flying, well south-west of the campaign band so it's pure scenery (no lakes/missions there).
const SASKATCHEWAN_UPLANDS: readonly RegionUpland[] = [{ name: 'Cypress Hills', lat: 49.6, lon: -109.8, radiusKm: 50, prominenceM: 590 }];

// --- saskatchewan — the live campaign map (holds all 6 missions) -------------------------------
// Real northern-SK places: the Churchill River chain, the Lac La Ronge country, the Athabasca
// basin. Communities are the real northern villages, hamlets, and First Nations the campaign
// flies to protect; lakes and highways are the real water and gravel that thread them together.
// `anchors` pins the real fire bases + towns at relative coords (above) — World resolves them.
const SASKATCHEWAN: Region = {
  id: 'saskatchewan',
  label: 'Saskatchewan',
  names: {
    lakes: [
      'Lac La Ronge',
      'Reindeer Lake',
      'Wollaston Lake',
      'Cree Lake',
      'Peter Pond Lake',
      'Churchill Lake',
      'Dore Lake',
      'Montreal Lake',
      'Besnard Lake',
      'Pinehouse Lake',
      'Nemeiben Lake',
      'Otter Lake',
      'Nistowiak Lake',
      'Iskwatikan Lake',
      'Black Lake',
      'Lake Athabasca',
      'Hatchet Lake',
      'Candle Lake',
      'Deschambault Lake',
      'Amisk Lake',
      'Jan Lake',
      'Smoothstone Lake',
      'Sandfly Lake',
      'Knee Lake',
      'Wapawekka Lake',
      'Trout Lake',
    ],
    communities: [
      'La Ronge',
      'Air Ronge',
      'Stanley Mission',
      'Pinehouse',
      'Beauval',
      'Île-à-la-Crosse',
      'Buffalo Narrows',
      'La Loche',
      'Cumberland House',
      'Sandy Bay',
      'Pelican Narrows',
      'Denare Beach',
      'Creighton',
      'Weyakwin',
      'Timber Bay',
      'Sucker River',
      'Grandmother’s Bay',
      'Patuanak',
      'Southend',
      'Missinipe',
      'Jans Bay',
      'Cole Bay',
      'Michel Village',
      'Dillon',
      'Turnor Lake',
      'Garson Lake',
    ],
    // Real northern-SK highways for the procedural (MST) links. Hwy 2 / 102 / 155 are NOT here — they're
    // authored corridors (SASKATCHEWAN_HIGHWAYS) routed through their real towns, so the pool that names the
    // remaining nearest-neighbour roads must exclude them or a stray link would steal a trunk-highway name.
    highways: ['Hwy 106', 'Hwy 120', 'Hwy 123', 'Hwy 135', 'Hwy 165', 'Hwy 167', 'Hwy 905', 'Hwy 914', 'Hwy 918', 'Hwy 922', 'Hwy 955'],
  },
  anchors: SASKATCHEWAN_ANCHORS,
  namedLakes: SASKATCHEWAN_LAKES,
  landmarks: SASKATCHEWAN_LANDMARKS,
  highwayRoutes: SASKATCHEWAN_HIGHWAYS,
  uplands: SASKATCHEWAN_UPLANDS,
  geo: SASKATCHEWAN_GEO,
};

// --- british-columbia — INTERIOR BC (future map: steep valleys, deep lakes, wind through the passes) ---
// Real Interior-BC fire country: the Cariboo, Thompson, and Okanagan. Mountainous relief lands when the
// terrain profile is tuned (docs/MAPS.md Phase 3); for now it's a future region with real place names.
const BRITISH_COLUMBIA: Region = {
  id: 'british-columbia',
  label: 'British Columbia',
  names: {
    lakes: [
      'Okanagan Lake',
      'Shuswap Lake',
      'Kootenay Lake',
      'Quesnel Lake',
      'Babine Lake',
      'Stuart Lake',
      'François Lake',
      'Adams Lake',
      'Nicola Lake',
      'Bowron Lake',
      'Arrow Lakes',
      'Chilko Lake',
      'Williston Lake',
      'Cariboo Lake',
    ],
    communities: [
      'Kamloops',
      'Kelowna',
      'Williams Lake',
      'Prince George',
      'Vernon',
      'Penticton',
      'Merritt',
      'Lytton',
      'Lillooet',
      'Quesnel',
      '100 Mile House',
      'Cache Creek',
      'Ashcroft',
      'Clearwater',
      'Vanderhoof',
      'Burns Lake',
      'Fort St. James',
      'Salmon Arm',
      'Revelstoke',
      'Princeton',
      'Logan Lake',
      'Barriere',
      'Chetwynd',
      'Mackenzie',
    ],
    highways: ['Hwy 1', 'Hwy 5', 'Hwy 97', 'Hwy 3', 'Hwy 16', 'Hwy 99', 'Hwy 24', 'Hwy 6', 'Hwy 33', 'Hwy 95', 'Hwy 20'],
  },
};

// --- ontario — NORTHERN ONTARIO (future map: Canadian Shield boreal, big cold lakes) -----------
// Real northwestern/northeastern Ontario fire country: the Shield from Thunder Bay and Kenora up to the
// James Bay lowlands. Boreal like Saskatchewan, so it shares the low-relief default until tuned.
const ONTARIO: Region = {
  id: 'ontario',
  label: 'Ontario',
  names: {
    lakes: [
      'Lake Nipigon',
      'Lake of the Woods',
      'Lac Seul',
      'Rainy Lake',
      'Wabigoon Lake',
      'Eagle Lake',
      'Lake Abitibi',
      'Lake Temagami',
      'Lake Nipissing',
      'Lake St. Joseph',
      'Trout Lake',
      'Lake Superior',
      'Lake Timiskaming',
      'Wabakimi Lake',
    ],
    communities: [
      'Thunder Bay',
      'Kenora',
      'Dryden',
      'Sioux Lookout',
      'Red Lake',
      'Atikokan',
      'Marathon',
      'Wawa',
      'Hearst',
      'Kapuskasing',
      'Cochrane',
      'Timmins',
      'Chapleau',
      'Nipigon',
      'Geraldton',
      'Ear Falls',
      'Nakina',
      'Fort Frances',
      'Ignace',
      'Manitouwadge',
      'Longlac',
      'Moosonee',
      'Terrace Bay',
      'Greenstone',
    ],
    highways: ['Hwy 11', 'Hwy 17', 'Hwy 71', 'Hwy 72', 'Hwy 105', 'Hwy 599', 'Hwy 101', 'Hwy 144', 'Hwy 129', 'Hwy 61'],
  },
};

// --- alberta — NORTHERN ALBERTA (future map: boreal + foothills, big-season crown fire) --------
// Real Alberta fire country: the Fort McMurray / Slave Lake / Peace boreal and the foothills. Black
// spruce that crowns and runs; shares the low-relief default until the foothills profile is tuned.
const ALBERTA: Region = {
  id: 'alberta',
  label: 'Alberta',
  names: {
    lakes: [
      'Lesser Slave Lake',
      'Lake Athabasca',
      'Cold Lake',
      'Lac La Biche',
      'Calling Lake',
      'Utikuma Lake',
      'Wabasca Lake',
      'Peerless Lake',
      'Winefred Lake',
      'Christina Lake',
      'Touchwood Lake',
      'Gull Lake',
      'Sturgeon Lake',
      'Pigeon Lake',
    ],
    communities: [
      'Fort McMurray',
      'Slave Lake',
      'High Level',
      'Grande Prairie',
      'Peace River',
      'Fox Creek',
      'Whitecourt',
      'Hinton',
      'Edson',
      'Lac La Biche',
      'Athabasca',
      'Fort Chipewyan',
      'High Prairie',
      'Manning',
      'Valleyview',
      'Swan Hills',
      'Wabasca',
      'Conklin',
      'Rainbow Lake',
      'Zama City',
      'Red Earth Creek',
      'Cold Lake',
      'Fort Vermilion',
      'Janvier',
    ],
    highways: ['Hwy 63', 'Hwy 88', 'Hwy 35', 'Hwy 43', 'Hwy 40', 'Hwy 881', 'Hwy 686', 'Hwy 2', 'Hwy 58', 'Hwy 813'],
  },
};

export const DEFAULT_REGION_ID = 'saskatchewan';

const REGIONS: Record<string, Region> = {
  [SASKATCHEWAN.id]: SASKATCHEWAN,
  [BRITISH_COLUMBIA.id]: BRITISH_COLUMBIA,
  [ALBERTA.id]: ALBERTA,
  [ONTARIO.id]: ONTARIO,
};

/** Resolve a region by id, falling back to the default Saskatchewan map for an unknown/missing id. */
export function getRegion(id?: string): Region {
  return (id && REGIONS[id]) || REGIONS[DEFAULT_REGION_ID];
}
