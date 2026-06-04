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
 * location pinned at authored RELATIVE coords that world generation honors, rather than a name
 * draped onto a random procedural feature. Today only the home-base NAME is wired from anchors
 * (Game pins it via MissionDef.homeBase); Phase 1 positions the base + guarantees its scoop lake.
 */
export interface MapAnchor {
  id: string; // stable id missions reference via MissionDef.homeBase ('la-ronge', 'denare-beach', …)
  name: string; // display name, pinned over the seeded NameSource ('La Ronge')
  kind: 'base' | 'community' | 'both'; // 'base' = spawn/refuel; 'community' = protectable; SK towns are 'both'
  x: number; // normalized 0..1 in the map bounding box: west→east
  y: number; // normalized 0..1: south→north (World maps into an inset rect; +y north → −Z)
  home?: boolean; // the default cold-start base when a mission omits homeBase (exactly one per region)
  scoop?: { lake: string; radius?: number }; // guarantee an adjacent scoop lake here; omit = river-fed
  blurb?: string; // briefing / picker flavour
}

/** One map's world identity. Extensible: terrain/biome/time-of-day slot in behind the same id. */
export interface Region {
  id: string; // matches a picker card id in ui/profile.ts MAPS
  label: string; // the real-world region this map evokes (flavour / debug)
  names: RegionNames;
  anchors?: readonly MapAnchor[]; // bases + communities at relative coords (placement layer, docs/MAPS.md)
}

// --- saskatchewan ANCHORS — the real fire bases + protected towns at authored RELATIVE coords -----
// `x` west→east 0..1, `y` south→north 0..1 (World maps these into an inset rect; +y north → −Z).
// The 7 fire bases you spawn/refuel from + the towns the campaign defends, so the map reads as a
// faithful mini-Saskatchewan rather than random hamlets. `kind:'both'` = a base that's ALSO a
// protected community (La Ronge / Denare Beach / Buffalo Narrows). Exactly one `home`. See docs/MAPS.md.
const SASKATCHEWAN_ANCHORS: readonly MapAnchor[] = [
  // 7 fire bases
  { id: 'la-ronge', name: 'La Ronge', kind: 'both', x: 0.51, y: 0.64, home: true, scoop: { lake: 'Lac La Ronge', radius: 240 }, blurb: 'Primary tanker base — island lake, easy water.' },
  { id: 'prince-albert', name: 'Prince Albert', kind: 'base', x: 0.44, y: 0.1, scoop: { lake: 'Candle Lake', radius: 130 }, blurb: 'Southern gateway base; river country.' },
  { id: 'southend', name: 'Southend', kind: 'base', x: 0.82, y: 1.0, scoop: { lake: 'Reindeer Lake', radius: 260 }, blurb: 'Remote far-north outpost on a vast cold lake.' },
  { id: 'hudson-bay', name: 'Hudson Bay', kind: 'base', x: 0.95, y: 0.0, scoop: { lake: 'Fir Lake', radius: 90 }, blurb: 'Eastern forward base — lake-poor, hard scoop.' },
  { id: 'denare-beach', name: 'Denare Beach', kind: 'both', x: 1.0, y: 0.52, scoop: { lake: 'Amisk Lake', radius: 170 }, blurb: 'SE lakeside village near the Manitoba line.' },
  { id: 'dorintosh', name: 'Dorintosh', kind: 'base', x: 0.0, y: 0.45, scoop: { lake: 'Greig Lake', radius: 150 }, blurb: 'SW park gateway — lakes everywhere, easy water.' },
  { id: 'buffalo-narrows', name: 'Buffalo Narrows', kind: 'both', x: 0.02, y: 0.86, scoop: { lake: 'Peter Pond Lake', radius: 220 }, blurb: 'NW lakes-country base on the narrows.' },
  // protected towns the missions defend
  { id: 'weyakwin', name: 'Weyakwin', kind: 'community', x: 0.46, y: 0.55, scoop: { lake: 'Weyakwin Lake', radius: 110 } },
  { id: 'missinipe', name: 'Missinipe', kind: 'community', x: 0.55, y: 0.73, scoop: { lake: 'Otter Lake', radius: 120 } },
  { id: 'stanley-mission', name: 'Stanley Mission', kind: 'community', x: 0.63, y: 0.78, scoop: { lake: 'Nistowiak Lake', radius: 120 } },
  { id: 'sucker-river', name: 'Sucker River', kind: 'community', x: 0.57, y: 0.71 }, // river-fed; shares Stanley Mission's water sector
  { id: 'beauval', name: 'Beauval', kind: 'community', x: 0.16, y: 0.74, scoop: { lake: 'Lac la Plonge', radius: 120 } },
  { id: 'ile-a-la-crosse', name: 'Île-à-la-Crosse', kind: 'community', x: 0.1, y: 0.8, scoop: { lake: 'Lac Île-à-la-Crosse', radius: 150 } },
  // secondaries for the missions' unpinned references (m2 LZ South, m4 Family 3)
  { id: 'missinipe-south', name: 'Missinipe South', kind: 'community', x: 0.55, y: 0.71 },
  { id: 'grandmothers-bay', name: 'Grandmother’s Bay', kind: 'community', x: 0.6, y: 0.8, scoop: { lake: 'Iskwatikan Lake', radius: 110 } },
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
    // Real northern-SK highways — the long gravel routes that link the outposts.
    highways: [
      'Hwy 2',
      'Hwy 102',
      'Hwy 106',
      'Hwy 120',
      'Hwy 123',
      'Hwy 135',
      'Hwy 155',
      'Hwy 165',
      'Hwy 167',
      'Hwy 905',
      'Hwy 914',
      'Hwy 918',
      'Hwy 922',
      'Hwy 955',
    ],
  },
  anchors: SASKATCHEWAN_ANCHORS,
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
