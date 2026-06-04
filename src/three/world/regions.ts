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

// --- saskatchewan — the live campaign map (holds all 6 missions) -------------------------------
// Real northern-SK places: the Churchill River chain, the Lac La Ronge country, the Athabasca
// basin. Communities are the real northern villages, hamlets, and First Nations the campaign
// flies to protect; lakes and highways are the real water and gravel that thread them together.
// Anchored real placements (La Ronge, Prince Albert, Southend, …) are the planned next layer — docs/MAPS.md.
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
};

// --- ember-flats — MUSKEG PEATLAND (future map: flat bogs, high fire load, few lakes) ----------
const EMBER_FLATS: Region = {
  id: 'ember-flats',
  label: 'Muskeg peatland',
  names: {
    lakes: ['Tannin Lake', 'Bog Mirror', 'Sedge Lake', 'Cranberry Lake', 'Peat Pond', 'Smoke Lake', 'Cinderwater', 'Marsh Lake', 'Reedwater', 'Ember Pond'],
    communities: ['Bog End', 'Tamarack Crossing', 'Sphagnum Flats', 'Cranberry Portage', 'Peatford', 'Smoulder Creek', 'Mire Landing', 'Ashpoint', 'Duff Hollow', 'Reedmarsh'],
    highways: ['Hwy 63', 'Hwy 686', 'Hwy 754', 'Hwy 813', 'Hwy 881', 'Hwy 902'],
  },
};

// --- glacier-coast — FJORD COAST (future map: steep valleys, deep inlets, funnelled wind) ------
const GLACIER_COAST: Region = {
  id: 'glacier-coast',
  label: 'Fjord coast',
  names: {
    lakes: ['Blue Glacier Inlet', 'Deepfjord', 'Meltwater Sound', 'Iceberg Bay', 'Crevasse Lake', 'Moraine Lake', 'Calving Sound', 'Frostfjord'],
    communities: ['Fjordgate', 'Glacier Reach', 'Cold Inlet', 'Saltspray', 'Kittiwake Cove', 'Meltwater', 'Bergen Sound', 'Cairn Point', 'Tidehaven', 'Stormridge'],
    highways: ['Route 1', 'Route 4', 'Coast Road', 'Pass Road', 'Hwy 99'],
  },
};

export const DEFAULT_REGION_ID = 'saskatchewan';

const REGIONS: Record<string, Region> = {
  [SASKATCHEWAN.id]: SASKATCHEWAN,
  [EMBER_FLATS.id]: EMBER_FLATS,
  [GLACIER_COAST.id]: GLACIER_COAST,
};

/** Resolve a region by id, falling back to the default Saskatchewan map for an unknown/missing id. */
export function getRegion(id?: string): Region {
  return (id && REGIONS[id]) || REGIONS[DEFAULT_REGION_ID];
}
