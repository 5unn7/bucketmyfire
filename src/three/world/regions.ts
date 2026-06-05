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
  kind: 'base' | 'community' | 'both'; // 'base' = spawn/refuel; 'community' = protectable; SK towns are 'both'
  lat: number; // real latitude, decimal °N
  lon: number; // real longitude, decimal degrees — NEGATIVE for west (e.g. -105.284)
  home?: boolean; // the default cold-start base when a mission omits homeBase (exactly one per region)
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
  rivers?: readonly RegionRiver[]; // authored named rivers (real lat/lon polylines) laid as carved channels
  geo?: GeoFrame; // real-world projection frame (bounding box + outline) for anchored maps
}

// --- saskatchewan ANCHORS — the real fire bases + protected towns at their REAL lat/lon ------------
// Real coordinates (verified) so World projects the bases to their true relative positions and the
// province comes out as its real trapezoid. `scoop.areaKm2` is the lake's real surface area — World
// derives the radius from it (MAPGEO band), so Reindeer (6650 km²) dwarfs Candle (132 km²). The 7 fire
// bases you spawn/refuel from + the towns the campaign defends. `kind:'both'` = a base that's ALSO a
// protected community (La Ronge / Denare Beach / Buffalo Narrows). Exactly one `home`. See docs/MAPS.md.
// Authored in tools/map-editor.html (2026-06-05) — repositioned bases/towns with EXACT freeform lake outlines.
// Scoop lakes with an `outline` trace that shore exactly (World ray-casts it); `areaKm2` is the fallback.
const SASKATCHEWAN_ANCHORS: readonly MapAnchor[] = [
  { id: 'la-ronge', name: 'La Ronge', kind: 'both', lat: 55.3076, lon: -105.605, home: true, scoop: { lake: 'Lac La Ronge', areaKm2: 480, outline: [{ lat: 55.6624, lon: -105.0152 }, { lat: 55.6455, lon: -105.2351 }, { lat: 55.3357, lon: -105.1692 }, { lat: 55.2174, lon: -105.2399 }, { lat: 55.2343, lon: -105.4076 }, { lat: 55.2118, lon: -105.5657 }, { lat: 55.0823, lon: -105.6251 }, { lat: 54.9077, lon: -105.5764 }, { lat: 54.8063, lon: -105.391 }, { lat: 54.75, lon: -104.8546 }, { lat: 54.9189, lon: -104.6454 }, { lat: 55.178, lon: -104.609 }, { lat: 55.4089, lon: -104.583 }, { lat: 55.6286, lon: -104.5469 }] }, blurb: 'Primary air-attack base — island lake, easy water.' },
  { id: 'prince-albert', name: 'Prince Albert', kind: 'base', lat: 53.1266, lon: -105.7296, blurb: 'Southern gateway base; river country.' },
  { id: 'southend', name: 'Southend', kind: 'base', lat: 57.0703, lon: -103.4381, blurb: 'Remote far-north outpost on a vast cold lake.' },
  { id: 'cypress-hills', name: 'Cypress Hills', kind: 'base', lat: 49.7464, lon: -107.8708, scoop: { lake: 'Cypress Lake', areaKm2: 224, outline: [{ lat: 49.814, lon: -107.6207 }, { lat: 49.6563, lon: -107.3186 }, { lat: 49.5211, lon: -107.3141 }, { lat: 49.4817, lon: -107.7896 }, { lat: 49.493, lon: -108.3623 }, { lat: 49.707, lon: -107.8777 }] }, blurb: 'Eastern forward base — lake-poor, hard scoop.' },
  { id: 'denare-beach', name: 'Denare Beach', kind: 'both', lat: 55.476, lon: -102.0801, scoop: { lake: 'Amisk Lake', areaKm2: 453, outline: [{ lat: 55.538, lon: -102.2436 }, { lat: 55.3578, lon: -101.8927 }, { lat: 55.048, lon: -101.7549 }, { lat: 55.1325, lon: -101.9831 }, { lat: 54.9184, lon: -102.2673 }, { lat: 55.1156, lon: -102.2899 }, { lat: 55.1606, lon: -102.5424 }, { lat: 55.3409, lon: -102.6767 }, { lat: 55.5436, lon: -102.3626 }] }, blurb: 'SE lakeside village near the Manitoba line.' },
  { id: 'dorintosh', name: 'Dorintosh', kind: 'base', lat: 54.9551, lon: -109.1496, scoop: { lake: 'Greig Lake', outline: [{ lat: 54.9157, lon: -108.8621 }, { lat: 54.8481, lon: -108.9154 }, { lat: 54.803, lon: -109.0095 }, { lat: 54.7861, lon: -109.1351 }, { lat: 54.803, lon: -109.2636 }, { lat: 54.9945, lon: -109.4378 }, { lat: 55.1072, lon: -109.2908 }] }, blurb: 'SW park gateway — lakes everywhere, easy water.' },
  { id: 'buffalo-narrows', name: 'Buffalo Narrows', kind: 'both', lat: 56.9406, lon: -108.4697, scoop: { lake: 'Peter Pond Lake', areaKm2: 778, outline: [{ lat: 57.3574, lon: -108.5013 }, { lat: 57.318, lon: -108.3418 }, { lat: 57.1321, lon: -108.0067 }, { lat: 56.9012, lon: -108.5699 }, { lat: 56.9012, lon: -108.7452 }, { lat: 56.6703, lon: -108.6547 }, { lat: 56.5745, lon: -109.0357 }, { lat: 56.7435, lon: -109.3897 }, { lat: 56.9688, lon: -109.7428 }, { lat: 57.1603, lon: -109.5041 }, { lat: 57.0195, lon: -108.993 }, { lat: 57.0139, lon: -108.6821 }, { lat: 57.1997, lon: -108.7596 }, { lat: 57.318, lon: -108.6548 }] }, blurb: 'NW lakes-country base on the narrows.' },
  { id: 'weyakwin', name: 'Weyakwin', kind: 'community', lat: 54.4414, lon: -105.7082 },
  { id: 'missinipe', name: 'Missinipe', kind: 'community', lat: 56.3156, lon: -105.1285, scoop: { lake: 'Otter Lake' } },
  { id: 'stanley-mission', name: 'Stanley Mission', kind: 'community', lat: 55.8538, lon: -105.1051 }, // river/lake-fed off the nearby Churchill + La Ronge water — no separate Nistowiak disc (it read as an extra lake by La Ronge)
  { id: 'beauval', name: 'Beauval', kind: 'community', lat: 55.287, lon: -107.4685, scoop: { lake: 'Lac la Plonge', areaKm2: 257, outline: [{ lat: 55.5123, lon: -107.4787 }, { lat: 55.4898, lon: -107.3087 }, { lat: 55.4278, lon: -107.1672 }, { lat: 55.3377, lon: -107.0845 }, { lat: 55.2363, lon: -107.081 }, { lat: 55.1462, lon: -107.1566 }, { lat: 55.0842, lon: -107.2921 }, { lat: 55.0617, lon: -107.4584 }, { lat: 55.0842, lon: -107.6267 }, { lat: 55.1124, lon: -107.7364 }, { lat: 55.2983, lon: -107.281 }] } },
  { id: 'ile-a-la-crosse', name: 'Île-à-la-Crosse', kind: 'community', lat: 56.2819, lon: -107.5236, scoop: { lake: 'Lac Île-à-la-Crosse', areaKm2: 391, outline: [{ lat: 56.5241, lon: -107.5354 }, { lat: 56.9297, lon: -107.4626 }, { lat: 56.434, lon: -107.3476 }, { lat: 56.3383, lon: -107.0995 }, { lat: 56.2256, lon: -107.0954 }, { lat: 56.1355, lon: -107.2133 }, { lat: 56.0059, lon: -107.2989 }, { lat: 55.9609, lon: -107.6995 }, { lat: 56.0679, lon: -107.5739 }, { lat: 56.158, lon: -107.548 }, { lat: 56.2087, lon: -107.4289 }, { lat: 56.327, lon: -107.2312 }, { lat: 56.4171, lon: -107.6523 }, { lat: 56.5016, lon: -107.7282 }] } },
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
  { name: 'Lake Athabasca', lat: 59.4842, lon: -108.7652, areaKm2: 4500, outline: [{ lat: 59.6024, lon: -105.3587 }, { lat: 59.5743, lon: -107.1274 }, { lat: 59.2363, lon: -107.6636 }, { lat: 59.4053, lon: -108.3043 }, { lat: 59.3603, lon: -109.1518 }, { lat: 59.1913, lon: -110.0143 }, { lat: 59.3603, lon: -110.1796 }, { lat: 59.4842, lon: -110.3514 }, { lat: 59.6362, lon: -110.0494 }, { lat: 59.7095, lon: -109.7798 }, { lat: 59.9967, lon: -108.9255 }, { lat: 59.9066, lon: -108.1641 }, { lat: 59.6531, lon: -108.201 }, { lat: 59.6813, lon: -107.4221 }] },
  { name: 'Wollaston Lake', lat: 58.554, lon: -104.0177, areaKm2: 2384, outline: [{ lat: 58.3006, lon: -104.4798 }, { lat: 58.4188, lon: -104.3145 }, { lat: 58.5315, lon: -104.6014 }, { lat: 58.6892, lon: -104.6616 }, { lat: 58.8356, lon: -104.3307 }, { lat: 58.9426, lon: -103.999 }, { lat: 58.9708, lon: -103.6699 }, { lat: 58.9201, lon: -103.411 }, { lat: 58.768, lon: -103.3666 }, { lat: 58.6216, lon: -103.2789 }, { lat: 58.4977, lon: -103.4491 }, { lat: 58.4188, lon: -103.723 }, { lat: 58.1091, lon: -103.9212 }, { lat: 58.1147, lon: -104.3901 }] },
  { name: 'Cree Lake', lat: 58.2569, lon: -107.5641, areaKm2: 563, elong: 1.6, bearingDeg: 235 },
  { name: 'Black Lake', lat: 59.5094, lon: -104.4596, areaKm2: 30, outline: [{ lat: 59.5094, lon: -103.9268 }, { lat: 59.3348, lon: -104.1014 }, { lat: 59.4362, lon: -104.2407 }, { lat: 59.4024, lon: -104.5741 }, { lat: 59.5657, lon: -104.8912 }, { lat: 59.3122, lon: -105.0074 }, { lat: 59.2334, lon: -105.1741 }, { lat: 59.5094, lon: -104.9924 }, { lat: 59.5544, lon: -104.947 }, { lat: 59.5939, lon: -104.7904 }, { lat: 59.6558, lon: -104.5992 }, { lat: 59.6051, lon: -104.278 }, { lat: 59.5939, lon: -104.1227 }, { lat: 59.5206, lon: -104.0261 }] },
  { name: 'Lake Diefenbaker', lat: 51.2231, lon: -106.9647, areaKm2: 394, outline: [{ lat: 51.1217, lon: -106.8004 }, { lat: 51.1667, lon: -107.4033 }, { lat: 51.3245, lon: -107.6525 }, { lat: 51.3864, lon: -107.7003 }, { lat: 51.4146, lon: -107.3765 }, { lat: 51.3695, lon: -107.0681 }, { lat: 51.2963, lon: -106.7416 }, { lat: 51.1217, lon: -106.2799 }] },
  { name: 'Last Mountain Lake', lat: 51.0153, lon: -104.9707, areaKm2: 226, outline: [{ lat: 50.5197, lon: -104.7656 }, { lat: 50.7506, lon: -105.0192 }, { lat: 51.0266, lon: -105.0869 }, { lat: 51.2688, lon: -105.1558 }, { lat: 51.342, lon: -104.9566 }, { lat: 51.0604, lon: -104.9073 }, { lat: 50.9252, lon: -104.7933 }, { lat: 50.7393, lon: -104.6812 }, { lat: 50.5535, lon: -104.5255 }] },
  { name: 'Reindeer Lake', lat: 57.7841, lon: -102.2236, areaKm2: 7850, outline: [{ lat: 57.2265, lon: -103.3997 }, { lat: 57.0913, lon: -104.0819 }, { lat: 57.5813, lon: -103.2724 }, { lat: 57.8798, lon: -103.136 }, { lat: 58.1614, lon: -102.8062 }, { lat: 58.3361, lon: -101.9659 }, { lat: 59.2034, lon: -101.0469 }, { lat: 58.9218, lon: -100.932 }, { lat: 58.2459, lon: -101.2154 }, { lat: 57.9868, lon: -101.1628 }, { lat: 57.9643, lon: -101.6434 }, { lat: 57.5025, lon: -101.6422 }, { lat: 57.3785, lon: -101.9902 }, { lat: 57.2208, lon: -102.8591 }] },
  { name: 'Montreal Lake', lat: 54.1874, lon: -105.3991, areaKm2: 30, outline: [{ lat: 54.4859, lon: -105.397 }, { lat: 54.4521, lon: -105.281 }, { lat: 54.3958, lon: -105.2815 }, { lat: 54.2606, lon: -105.2539 }, { lat: 54.1142, lon: -105.2554 }, { lat: 53.979, lon: -105.2855 }, { lat: 53.8833, lon: -105.3342 }, { lat: 53.8495, lon: -105.4013 }, { lat: 53.8438, lon: -105.5255 }, { lat: 53.9114, lon: -105.5922 }, { lat: 54.1311, lon: -105.5725 }, { lat: 54.2437, lon: -105.5336 }, { lat: 54.3958, lon: -105.5137 }, { lat: 54.4859, lon: -105.5619 }] },
];

// Decorative PLACE LABELS at their real coords — geographic reference points (not bases/missions) so the whole
// province reads right: the far-north settlements strung along Lake Athabasca and the Fond du Lac River, the NW
// villages, and the big southern cities the map otherwise omits. World projects these; the HUD radar labels them.
const SASKATCHEWAN_LANDMARKS: readonly RegionPlace[] = [
  { name: 'Uranium City', lat: 59.805, lon: -107.7258, kind: 'town' },
  { name: 'Fond-du-Lac', lat: 59.5481, lon: -106.4733, kind: 'town' },
  { name: 'Stony Rapids', lat: 59.5851, lon: -105.7633, kind: 'town' },
  { name: 'La Loche', lat: 57.6796, lon: -109.6317, kind: 'town' },
  { name: 'Patuanak', lat: 56.7681, lon: -107.3918, kind: 'town' },
  { name: 'Meadow Lake', lat: 54.3105, lon: -108.9296, kind: 'town' },
  { name: 'Nipawin', lat: 53.367, lon: -104.009, kind: 'town' },
  { name: 'North Battleford', lat: 52.8446, lon: -108.2075, kind: 'city' },
  { name: 'Saskatoon', lat: 52.133, lon: -106.67, kind: 'city' },
  { name: 'Regina', lat: 50.445, lon: -104.619, kind: 'city' },
];

// Real provincial-highway corridors through the campaign towns — the spines that thread the map together.
// Real northern-SK trunk corridors, routed through their anchored towns and laid before the MST: Hwy 2 is the
// north–south spine (Missinipe → Stanley Mission → La Ronge → Weyakwin → Prince Albert); Hwy 55 is the southern
// lakes corridor (Buffalo Narrows → Île-à-la-Crosse → Beauval → Prince Albert); Hwy 102 climbs the Churchill
// (Southend → Missinipe); Hwy 7 / Hwy 106 reach Cypress Hills and Denare Beach. Their names are kept OUT of the
// `names.highways` MST-naming pool below so a stray nearest-neighbour link can't steal a trunk name.
const SASKATCHEWAN_HIGHWAYS: readonly HighwayRoute[] = [
  { name: 'Hwy 55', through: ['buffalo-narrows', 'ile-a-la-crosse', 'beauval', 'prince-albert'] },
  { name: 'Hwy 2', through: ['missinipe', 'stanley-mission', 'la-ronge', 'weyakwin', 'prince-albert'] },
  { name: 'Hwy 102', through: ['southend', 'missinipe'] },
  { name: 'Hwy 7', through: ['prince-albert', 'cypress-hills'] },
  { name: 'Hwy 106', through: ['denare-beach', 'prince-albert'] },
];

// Cypress Hills — Saskatchewan's far-SW highland (the highest land between the Rockies and Labrador). Authored
// as a RANGE of peaks RINGING Cypress Lake, so the lake sits in the central valley: each peak's footprint clears
// the lake centre, so they raise the rim, not the water (lakes sample their level from baseHeight, which already
// includes uplands). Real Cypress Hills block/feature names; in-game an upland is nameless relief (World reads only
// x/z/r/height). The `cypress-hills` base + its Sector-Ferry crew drop sit in this valley — no longer pure scenery.
const SASKATCHEWAN_UPLANDS: readonly RegionUpland[] = [
  { name: 'Centre Block', lat: 49.95, lon: -107.75, radiusKm: 26, prominenceM: 300 },
  { name: 'Conglomerate Cliffs', lat: 49.8, lon: -107.15, radiusKm: 22, prominenceM: 240 },
  { name: 'Bald Butte', lat: 49.55, lon: -107.05, radiusKm: 24, prominenceM: 270 },
  { name: 'Head of the Mountain', lat: 49.38, lon: -107.7, radiusKm: 28, prominenceM: 320 },
  { name: 'Lookout Point', lat: 49.45, lon: -108.3, radiusKm: 24, prominenceM: 250 },
  { name: 'West Block', lat: 49.8, lon: -108.45, radiusKm: 26, prominenceM: 280 },
];

// Authored named rivers (real lat/lon polylines from tools/map-editor.html). World projects each point and lays the
// river as a chain of short carved channel segments that hug the terrain — scoopable like any water, drawn before the
// procedural streams and using NO rng, so adding one never perturbs the seeded world (see World.addAuthoredRivers).
const SASKATCHEWAN_RIVERS: readonly RegionRiver[] = [
  { name: 'Churchill River', width: 18, points: [{ lat: 56.0769, lon: -101.7648 }, { lat: 56.0126, lon: -102.2473 }, { lat: 55.9714, lon: -102.9888 }, { lat: 56.2053, lon: -103.2529 }, { lat: 56.3292, lon: -103.6587 }, { lat: 56.2833, lon: -104.281 }, { lat: 56.32, lon: -104.8174 }, { lat: 56.5173, lon: -104.9709 }, { lat: 56.5332, lon: -105.1237 }, { lat: 56.5734, lon: -105.5281 }, { lat: 56.5807, lon: -105.8335 }, { lat: 56.7563, lon: -106.388 }, { lat: 56.6319, lon: -106.9309 }, { lat: 56.9593, lon: -107.2616 }, { lat: 56.951, lon: -107.3255 }, { lat: 56.8204, lon: -107.469 }, { lat: 56.7518, lon: -107.6205 }, { lat: 56.7714, lon: -108.1281 }, { lat: 57.0163, lon: -108.4141 }] },
  { name: 'Saskatchewan River', width: 13, points: [{ lat: 54.5636, lon: -101.6085 }, { lat: 54.5331, lon: -102.1884 }, { lat: 54.4114, lon: -102.9655 }, { lat: 54.1579, lon: -103.7616 }, { lat: 53.7319, lon: -104.1411 }, { lat: 53.5392, lon: -104.5236 }, { lat: 53.3263, lon: -105.2935 }, { lat: 53.2451, lon: -105.8366 }, { lat: 53.2046, lon: -106.5307 }, { lat: 53.1843, lon: -107.0888 }, { lat: 52.8192, lon: -107.1608 }, { lat: 52.6569, lon: -107.9579 }, { lat: 52.8902, lon: -108.8946 }, { lat: 53.164, lon: -109.4902 }, { lat: 53.2248, lon: -109.9869 }, { lat: 52.9716, lon: -110.4964 }] },
  { name: 'Clearwater River', width: 10, points: [{ lat: 57.1317, lon: -108.6039 }, { lat: 57.5313, lon: -109.1641 }, { lat: 57.931, lon: -109.3971 }, { lat: 58.2983, lon: -109.1412 }] },
  { name: 'S Saskatchewan river', width: 15, points: [{ lat: 50.8843, lon: -109.997 }, { lat: 51.1486, lon: -109.3641 }, { lat: 51.2517, lon: -108.6413 }, { lat: 51.2001, lon: -107.8253 }, { lat: 51.9155, lon: -107.0757 }, { lat: 52.2185, lon: -106.8222 }, { lat: 52.1798, lon: -105.9697 }, { lat: 52.7406, lon: -105.1324 }, { lat: 53.3335, lon: -104.8658 }, { lat: 53.5011, lon: -104.6784 }] },
];
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
    // Real northern-SK highways for the procedural (MST) links. The authored trunk routes (Hwy 2 / 7 / 55 / 102 /
    // 106 in SASKATCHEWAN_HIGHWAYS) are NOT in this pool — it names only the remaining nearest-neighbour roads, so a
    // stray link can't steal a trunk name (Hwy 106 was removed from here when it became an authored corridor).
    highways: ['Hwy 120', 'Hwy 123', 'Hwy 135', 'Hwy 165', 'Hwy 167', 'Hwy 905', 'Hwy 914', 'Hwy 918', 'Hwy 922', 'Hwy 955'],
  },
  anchors: SASKATCHEWAN_ANCHORS,
  namedLakes: SASKATCHEWAN_LAKES,
  landmarks: SASKATCHEWAN_LANDMARKS,
  highwayRoutes: SASKATCHEWAN_HIGHWAYS,
  uplands: SASKATCHEWAN_UPLANDS,
  rivers: SASKATCHEWAN_RIVERS,
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
