// Saskatchewan region data — moved VERBATIM from world/regions.ts (the real fire bases, named lakes,
// landmarks, highway corridors, uplands, rivers, geo frame + name pools). Pure data; types only.
import type { Region, MapAnchor, GeoFrame, RegionLake, RegionPlace, HighwayRoute, RegionHeightPatch, RegionRiver } from '../types';
import { CYPRESS_HEIGHTMAP } from './cypressHeightmap';

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
  { id: 'prince-albert', name: 'Prince Albert', kind: 'base', urban: true, lat: 53.1266, lon: -105.7296, blurb: 'Southern gateway base; river country.' },
  { id: 'southend', name: 'Southend', kind: 'base', lat: 57.0703, lon: -103.4381, blurb: 'Remote far-north outpost on a vast cold lake.' },
  { id: 'cypress-hills', name: 'Cypress Hills', kind: 'base', lat: 49.7464, lon: -107.8708, scoop: { lake: 'Cypress Lake', areaKm2: 224, outline: [{ lat: 49.814, lon: -107.6207 }, { lat: 49.6563, lon: -107.3186 }, { lat: 49.5211, lon: -107.3141 }, { lat: 49.4817, lon: -107.7896 }, { lat: 49.493, lon: -108.3623 }, { lat: 49.707, lon: -107.8777 }] }, blurb: 'Southwest forward base — lake-poor, hard scoop.' },
  { id: 'denare-beach', name: 'Denare Beach', kind: 'both', lat: 55.476, lon: -102.0801, scoop: { lake: 'Amisk Lake', areaKm2: 453, outline: [{ lat: 55.538, lon: -102.2436 }, { lat: 55.3578, lon: -101.8927 }, { lat: 55.048, lon: -101.7549 }, { lat: 55.1325, lon: -101.9831 }, { lat: 54.9184, lon: -102.2673 }, { lat: 55.1156, lon: -102.2899 }, { lat: 55.1606, lon: -102.5424 }, { lat: 55.3409, lon: -102.6767 }, { lat: 55.5436, lon: -102.3626 }] }, blurb: 'NE lakeside village near the Manitoba line.' },
  { id: 'dorintosh', name: 'Dorintosh', kind: 'base', lat: 54.9551, lon: -109.1496, scoop: { lake: 'Greig Lake', outline: [{ lat: 54.9157, lon: -108.8621 }, { lat: 54.8481, lon: -108.9154 }, { lat: 54.803, lon: -109.0095 }, { lat: 54.7861, lon: -109.1351 }, { lat: 54.803, lon: -109.2636 }, { lat: 54.9945, lon: -109.4378 }, { lat: 55.1072, lon: -109.2908 }] }, blurb: 'SW park gateway — lakes everywhere, easy water.' },
  { id: 'buffalo-narrows', name: 'Buffalo Narrows', kind: 'both', lat: 56.9406, lon: -108.4697, scoop: { lake: 'Peter Pond Lake', areaKm2: 778, outline: [{ lat: 57.0195, lon: -108.993 }, { lat: 56.9688, lon: -109.7428 }, { lat: 56.7435, lon: -109.3897 }, { lat: 56.5745, lon: -109.0357 }, { lat: 56.6703, lon: -108.6547 }, { lat: 56.9012, lon: -108.7452 }, { lat: 56.9012, lon: -108.5699 }, { lat: 57.0139, lon: -108.6821 }, { lat: 57.1321, lon: -108.0067 }, { lat: 57.318, lon: -108.3418 }, { lat: 57.3574, lon: -108.5013 }, { lat: 57.318, lon: -108.6548 }, { lat: 57.1997, lon: -108.7596 }, { lat: 57.1603, lon: -109.5041 }] }, blurb: 'NW lakes-country base on the narrows.' },
  { id: 'weyakwin', name: 'Weyakwin', kind: 'community', lat: 54.4414, lon: -105.7082 },
  { id: 'missinipe', name: 'Missinipe', kind: 'community', lat: 56.3156, lon: -105.1285, scoop: { lake: 'Otter Lake' } },
  { id: 'stanley-mission', name: 'Stanley Mission', kind: 'community', lat: 55.8538, lon: -105.1051 }, // river/lake-fed off the nearby Churchill + La Ronge water — no separate Nistowiak disc (it read as an extra lake by La Ronge)
  { id: 'beauval', name: 'Beauval', kind: 'community', lat: 55.287, lon: -107.4685, scoop: { lake: 'Lac la Plonge', areaKm2: 257, outline: [{ lat: 55.1124, lon: -107.7364 }, { lat: 55.0842, lon: -107.6267 }, { lat: 55.0617, lon: -107.4584 }, { lat: 55.0842, lon: -107.2921 }, { lat: 55.1462, lon: -107.1566 }, { lat: 55.2363, lon: -107.081 }, { lat: 55.3377, lon: -107.0845 }, { lat: 55.2983, lon: -107.281 }, { lat: 55.4278, lon: -107.1672 }, { lat: 55.4898, lon: -107.3087 }, { lat: 55.5123, lon: -107.4787 }] } },
  { id: 'ile-a-la-crosse', name: 'Île-à-la-Crosse', kind: 'community', lat: 56.2819, lon: -107.5236, scoop: { lake: 'Lac Île-à-la-Crosse', areaKm2: 391, outline: [{ lat: 56.158, lon: -107.548 }, { lat: 55.9609, lon: -107.6995 }, { lat: 56.0679, lon: -107.5739 }, { lat: 56.2087, lon: -107.4289 }, { lat: 56.0059, lon: -107.2989 }, { lat: 56.1355, lon: -107.2133 }, { lat: 56.2256, lon: -107.0954 }, { lat: 56.3383, lon: -107.0995 }, { lat: 56.327, lon: -107.2312 }, { lat: 56.434, lon: -107.3476 }, { lat: 56.5241, lon: -107.5354 }, { lat: 56.5016, lon: -107.7282 }, { lat: 56.4171, lon: -107.6523 }] } },
  // Southern CITIES (kind:'city') — large population centres the campaign omits, now road nodes with a dense
  // decorative skyline so the whole province reads as Saskatchewan. No scoop/home/missions; excluded from the
  // town index (so mission `community: N` refs are unaffected). They replace the same-named decorative landmarks.
  { id: 'saskatoon', name: 'Saskatoon', kind: 'city', lat: 52.133, lon: -106.67, blurb: 'The bridge city on the South Saskatchewan.' },
  { id: 'regina', name: 'Regina', kind: 'city', lat: 50.445, lon: -104.619, blurb: 'Provincial capital, deep in the southern plains.' },
  { id: 'north-battleford', name: 'North Battleford', kind: 'city', lat: 52.8446, lon: -108.2075, blurb: 'West-central river city on the Yellowhead.' },
];

// Saskatchewan's real geographic frame: the full province (49°–60°N, 110°W to the Manitoba line) so
// the radar shows the whole provincial outline. The 4-corner boundary is the real edges; the cosine
// projection makes the meridians converge, so it renders as SK's iconic trapezoid (wider south, narrower
// north). Bases cluster in the central-north (their true positions); the open south is reserved for v2.
const SASKATCHEWAN_GEO: GeoFrame = {
  // Slice 2: TRUE-SHAPE bounds fit — the world's extent IS the province's projected bounding box (≈1029×1996u
  // at MAPGEO.unitsPerKm), and World's outline mask traces the trapezoid so the visible land edge is real SK,
  // not a square. (Was the legacy square fit; flipping this regenerated the SK world + required the campaign
  // re-tune to km-authored placements.)
  fit: 'bounds',
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
  { name: 'Black Lake', lat: 59.5094, lon: -104.4596, areaKm2: 195, outline: [{ lat: 59.3122, lon: -105.0074 }, { lat: 59.2334, lon: -105.1741 }, { lat: 59.4024, lon: -104.5741 }, { lat: 59.3348, lon: -104.1014 }, { lat: 59.4362, lon: -104.2407 }, { lat: 59.5094, lon: -103.9268 }, { lat: 59.5206, lon: -104.0261 }, { lat: 59.5939, lon: -104.1227 }, { lat: 59.6051, lon: -104.278 }, { lat: 59.6558, lon: -104.5992 }, { lat: 59.5939, lon: -104.7904 }, { lat: 59.5657, lon: -104.8912 }, { lat: 59.5544, lon: -104.947 }, { lat: 59.5094, lon: -104.9924 }] },
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
  // Saskatoon / Regina / North Battleford were here as decorative city labels; they're now `city` ANCHORS
  // (road nodes + a dense skyline + their own radar label), so they're removed here to avoid a double label.
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
  // Southern spine: Hwy 11 (the Louis Riel Trail) strings the three big cities up to the campaign's gateway
  // base; Hwy 16 (the Yellowhead) brings North Battleford in. These connect the cities into the road network
  // so the whole province is reachable by road, north to south. Their names stay out of the MST naming pool.
  { name: 'Hwy 11', through: ['regina', 'saskatoon', 'prince-albert'] },
  { name: 'Hwy 16', through: ['north-battleford', 'saskatoon'] },
];

// Cypress Hills — Saskatchewan's far-SW highland. The relief is BAKED FROM A REAL MOUNTAIN MESH (a downloaded
// Blender OBJ → a normalized height grid via scripts/bake-heightmap.mjs), reused as the repeating unit of a
// LOW E–W CHAIN of hills (not one tall peak) strung across the SW corner — each instance is the same mesh at
// a different scale / rotation / height, so the range reads varied. Authored as a chain with GAPS between the
// summits: low enough to stay in the flight band and weave THROUGH the valleys, and each hill added into
// baseHeight like an upland so it's collidable ground (flight floor / fire / lakes all see it; engine loads no
// mesh). All summits sit NORTH of Cypress Lake so the lake + the `cypress-hills` base stay on the low south
// flank (lakes sample their level from baseHeight → the chain must read LOW over the water). widthKm:lengthKm
// tracks the bake's source aspect (≈6.47:8.39). Heights/spread tuned via scripts/probe-cypress.ts.
const CYPRESS_HILL = (lat: number, lon: number, widthKm: number, lengthKm: number, prominenceM: number, rotationDeg: number): RegionHeightPatch => ({
  name: 'Cypress Hills',
  lat,
  lon,
  widthKm,
  lengthKm,
  prominenceM,
  baseM: 0,
  rotationDeg,
  heightmap: CYPRESS_HEIGHTMAP,
});
const SASKATCHEWAN_HEIGHTPATCHES: readonly RegionHeightPatch[] = [
  //          lat     lon      widthKm lengthKm promM rotDeg
  CYPRESS_HILL(49.85, -106.65, 30, 39, 160, 25),
  CYPRESS_HILL(49.93, -107.15, 33, 43, 178, 80),
  CYPRESS_HILL(49.89, -107.7, 31, 40, 150, 130),
  CYPRESS_HILL(49.96, -108.25, 34, 44, 172, 200),
  CYPRESS_HILL(49.9, -108.8, 31, 40, 162, 295),
  CYPRESS_HILL(49.84, -109.35, 28, 36, 142, 45),
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
// --- saskatchewan — the live campaign map (holds all 8 missions) -------------------------------
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
  // Clear the stray procedural pond in the open country BETWEEN Prince Albert (53.13, -105.73) and Saskatoon
  // (52.13, -106.67) — centred on their midpoint; 50 km reaches the central gap but not either city's own water.
  noLakeZones: [{ lat: 52.63, lon: -106.2, radiusKm: 50 }],
  landmarks: SASKATCHEWAN_LANDMARKS,
  highwayRoutes: SASKATCHEWAN_HIGHWAYS,
  heightPatches: SASKATCHEWAN_HEIGHTPATCHES,
  rivers: SASKATCHEWAN_RIVERS,
  geo: SASKATCHEWAN_GEO,
};

export { SASKATCHEWAN };
