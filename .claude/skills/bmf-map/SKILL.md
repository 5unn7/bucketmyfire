---
name: bmf-map
description: >-
  Author, polish, or align a bucketmyfire MAP / region — the per-region world identity under
  `src/three/maps/<region>/`. Use whenever the task is to add a new playable map (a province /
  state / region), flesh out a stub map into something playable, fix how a map reads or sits in
  the world, or wire a map into the rest of the engine. A map is DATA: a `MapModule` (id,
  country, `card`, `region`, optional `terrain` profile + `missions`) resolved through
  `maps/registry.ts`. The `Region` is real-world data — a `geo` frame (lat/lon bbox + outline +
  `fit:'square'|'bounds'`), `anchors` (fire bases + protected towns at REAL lat/lon), named lakes,
  rivers, highway corridors, uplands/height-patches, and place-name pools — which `World` projects
  (cosine projection → real trapezoid) and masks to the province outline. This skill covers the
  three jobs: GENERATE a new map from real geography, POLISH an existing one (off-province
  placements, lake outlines, terrain feel, stray ponds, density), and ALIGN it with the other
  systems (registry + picker wiring, the locked `World` API, fire-grid scale-invariance, mission
  anchor refs) — plus the two mandatory gates (`npm run verify:world`, `npm run verify:campaign`).
  Reach for it on "add a map", "new region/province", "make BC/Alberta/Ontario playable", "build a
  Yukon map", "my fires spawn off-province", "the lake's the wrong shape", "the map doesn't read
  like the real place", "wire up a map", or any change under `src/three/maps/`. NOT for missions
  on an existing map (that's `bmf-mission`), tuning numbers in `config.ts` (`bmf-tune`), or meshes
  (`bmf-asset`).
---

# Authoring a bucketmyfire map

A **map** is authored data, not code. The engine grows a whole playable world from one
`MapModule` — terrain, water, towns, roads, fires, the radar — all keyed off a region id string.
`bmf-mission` writes scenarios that LIVE on a map; this skill writes the **map itself**.

The full type contract is [src/three/maps/types.ts](../../../src/three/maps/types.ts) — it is
densely commented; read it first. Everything below is the map you build from those types.

## The one seam that keeps the layers clean

Three layers, three owners — never blur them:

- **`maps/<region>/` (this skill) = WORLD IDENTITY**: the real geography. Where the province is on
  the globe, its outline, its fire bases and towns, its iconic lakes and rivers, its name pools,
  its terrain character. Pure data + types — no Three.js, no `import.meta.env` (the Node verify
  bundle reaches this graph).
- **`config.ts` (the `bmf-tune` skill) = MECHANIC + VISUAL VALUES**: fire spread, water look,
  world-size clamps (`MAPGEO.worldSizeMin/Max`, `unitsPerKm`), projection knobs. Shared by every
  map. If you're tempted to hard-code a world-size or a blend-band in a region, it belongs here.
- **`missions/` (the `bmf-mission` skill) = SCENARIOS**: a `MissionDef` selects a map by id
  (`map: 'saskatchewan'`) and references its **anchors** (`homeBase: 'la-ronge'`, `community`
  refs). A map PROVIDES the places; missions CONSUME them.

If you change a place a mission references (rename/move/remove an anchor), you've broken that
mission — see ALIGN below.

## The MapModule shape (one map = up to 5 small files)

A region is a folder under [src/three/maps/](../../../src/three/maps/). Look at
[maps/saskatchewan/](../../../src/three/maps/saskatchewan/) for the full, live example and
[maps/alberta/](../../../src/three/maps/alberta/) for a minimal names-only stub.

```
maps/<region>/
├── region.ts    REQUIRED — the Region: geo frame, anchors, lakes, rivers, highways, name pools
├── card.ts      the picker MapCard (name, tagline, blurb, accent, glyph, available, stats)
├── terrain.ts   optional TerrainProfile (omit → falls back to Saskatchewan boreal)
├── missions.ts  optional campaign (a MissionDef[] — author with bmf-mission)
└── index.ts     assembles the MapModule { id, country, card, region, terrain?, missions? }
```

`index.ts` just wires the pieces:

```ts
import type { MapModule } from '../types';
import { YUKON } from './region';
import { YUKON as YUKON_TERRAIN } from './terrain'; // omit if no profile
import { card } from './card';

export const yukon: MapModule = {
  id: 'yukon',          // THE contract string: == card.id == region.id == mission.map
  country: 'canada',    // groups the picker only when >1 distinct country exists
  card,
  region: YUKON,
  terrain: YUKON_TERRAIN,
};
```

The `id` is load-bearing and must match in four places: `index.id`, `card.id`, `region.id`, and
any `mission.map`. A mismatch silently falls back to Saskatchewan (`registry.ts` `fallback()`).

---

## GENERATE — author a new map from real geography

Work outside-in: frame the world, then fill it with real places, then give it a look and a card,
then wire it up. The whole point is that the map **reads like the real place** — invented lake
names and fake towns are the failure mode (see the `creative-director` reality-check lens).

### 1. The geo frame — where on Earth, and how it's fitted

The `geo: GeoFrame` is the projection contract. Get real coordinates (Wikipedia province/state
bounds, real lat/lon for each town — west longitude is **negative**):

```ts
const YUKON_GEO: GeoFrame = {
  fit: 'bounds',          // see the fit decision below
  latMin: 60, latMax: 69, // south/north edges (°N)
  lonMin: -141, lonMax: -124, // west/east edges (° — negative = west)
  outline: [              // real boundary corners, projected for the radar + the in-province mask
    { lat: 60, lon: -141 }, { lat: 60, lon: -124 },
    { lat: 69, lon: -134 }, { lat: 69, lon: -141 },
  ],
};
```

**The `fit` decision — the single most important call:**

- **`fit: 'bounds'`** (true-shape, like Saskatchewan): the world's extent BECOMES the province's
  projected bounding box (longest axis = `MAPGEO.boundsFill` of the size budget, clamped to
  `[worldSizeMin, worldSizeMax]`). `World` masks `groundHeightAt`/`flightFloorAt` to the outline —
  beyond the boundary falls off to `MAPGEO.offProvinceLevel` over `MAPGEO.outlineBlendBand`, so the
  visible land edge traces the real trapezoid (off-province = lowland + fog, no ocean, no wall).
  Choose this when you want the map to read as the real province shape. It regenerates the world,
  so it forces a `verify:world` re-baseline and a campaign re-check.
- **`fit: 'square'`** (or omit `geo` entirely): the legacy square world — the province floats in
  the middle of a `WORLD3D.size²` playfield, off-province margin muted on the radar. Simpler, no
  outline mask. Fine for an abstract/procedural map or a quick first pass.

The fire grid is **scale-invariant** either way (`fireGridFor` uses a constant cell size), so a
bigger or true-shape world doesn't change the fire game — don't try to "fix" cell counts.

### 2. Anchors — the fire bases and protected towns (the gameplay skeleton)

`anchors: MapAnchor[]` are the real places pinned at real lat/lon. These are what missions key
off, so they're the backbone:

```ts
const YUKON_ANCHORS: readonly MapAnchor[] = [
  { id: 'whitehorse', name: 'Whitehorse', kind: 'both', lat: 60.72, lon: -135.06, home: true,
    scoop: { lake: 'Schwatka Lake', areaKm2: 4 }, blurb: 'Primary air-attack base on the Yukon River.' },
  { id: 'dawson-city', name: 'Dawson City', kind: 'base', lat: 64.06, lon: -139.43,
    scoop: { lake: 'Klondike confluence' }, blurb: 'Northern goldfields outpost.' },
  { id: 'mayo', name: 'Mayo', kind: 'community', lat: 63.59, lon: -135.90 },
  // ...
];
```

Rules that matter:
- **`kind`**: `'base'` = spawn/refuel; `'community'` = protectable town; `'both'` = a base that's
  also a defended town; `'city'` = a large population centre (a road node + dense skyline, but NOT
  a base or a mission town — excluded from the town index, so adding one never shifts mission
  `community: N` refs).
- **Exactly one `home: true`** — the cold-start base when a mission omits `homeBase`.
- **`scoop`** guarantees an adjacent fillable lake. `areaKm2` (real surface area) drives the radius
  (`MAPGEO` band) — so a giant dwarfs a pond. Omit `areaKm2` → a default recreational size. Add
  `elong` + `bearingDeg` to give a signature lake its real silhouette; add `outline` (≥3 real
  lat/lon points, traced in the map editor) to pin the EXACT shore. Omit `scoop` → river-fed
  (attaches to nearest water).

### 3. The "reads-like-the-province" layer (makes the radar believable)

These are decoration — they never affect the campaign, but without them the map looks empty and
fake. Add the real iconic features:

- **`namedLakes: RegionLake[]`** — iconic geographic lakes at their real centroids (the far-north
  giants, the southern reservoirs). Real `areaKm2` → radius; `elong`/`bearingDeg`/`outline` →
  silhouette.
- **`rivers: RegionRiver[]`** — named rivers as real lat/lon polylines; laid as carved scoopable
  channels (no rng, so they never perturb the seeded world).
- **`highwayRoutes: HighwayRoute[]`** — real trunk corridors routed `through` a sequence of anchor
  ids; laid before the procedural MST so roads follow real routes. Keep these names OUT of the
  `names.highways` pool so a stray nearest-neighbour link can't steal a trunk name.
- **`landmarks: RegionPlace[]`** — decorative place labels (far-north settlements, southern
  cities) that aren't bases or missions — just radar reference points.
- **`uplands` / `heightPatches`** — a localized massif (smooth radial bump, or baked from a real
  mountain mesh like Cypress Hills). For a WHOLE-map mountainous look, use a terrain profile
  instead (step 4).
- **`noLakeZones`** — clear a stray procedural pond in country that should read as open land.

### 4. The name pools — `names` (REQUIRED)

`names: { lakes, communities, highways }` are the pools the procedural `NameSource` draws from for
ambient (un-anchored) water, towns, and roads. Use **real names from the region** — this is the
cheapest, highest-leverage authenticity win. ~20–26 of each is the norm (see any existing region).
On an anchored map, background lakes stay UNNAMED on the radar (kills hallucinated names); these
pools name the procedural scatter.

### 5. The terrain profile — the look + the flying (`terrain.ts`, optional)

A `TerrainProfile` shapes the heightfield. **Omit it** → the region falls back to Saskatchewan's
boreal-shield default (low relief). Author one when the region should feel different:

- **Boreal / low-relief** (start from [saskatchewan/terrain.ts](../../../src/three/maps/saskatchewan/terrain.ts)):
  spread `...TERRAIN` and nudge `lakeMaxHeight` / `lakeDensityScale`. No mountain layer.
- **Mountainous** (see [british-columbia/terrain.ts](../../../src/three/maps/british-columbia/terrain.ts)):
  raise `baseAmplitude`, add the `mountainAmplitude/Frequency/Octaves/Gain/Exponent` block (a
  ridged massif layer stacked on the base — peaks you fly UP), and add the alpine band
  (`treeline`/`snowline`/`bandBlend`/`colorScree`/`colorSnow`) for treeline → scree → snow. The
  AGL flight floor rises with the ground automatically, so passes cost nothing extra to author.

Every profile field is one of the `config.ts` `TERRAIN` levers, documented inline in the type. To
DIAL a profile's feel, that's the `bmf-tune` skill's territory — but the per-map VALUES live here.

### 6. The card (`card.ts`) and wiring (ALIGN, below)

```ts
export const card: MapCard = {
  id: 'yukon', name: 'Yukon', tagline: 'Subarctic taiga · soon',
  blurb: 'One tight, real sentence about the place and the flying.',
  available: false,          // false → dimmed "SOON" in the picker; flip true when playable
  accent: '#6b8fa8', glyph: '🏔️',
  imageUrl: 'maps/Yukon.webp', // BASE_URL-relative; ui/profile.ts prefixes. Optional — card works without art
  stats: { area: '482,443 km²', lakes: 'taiga lakes' },
};
```

---

## POLISH — fix an existing map

The common asks and where they live:

- **"Fires/towns spawn off-province"** (the classic `fit:'bounds'` bug): a placement's resolved
  centroid drifts past the outline rim. Fixes: pull the anchor/lake coords inward, or for mission
  fires add a `provinceMargin` (see `bmf-mission` + `missions/scenario.ts`). Verify with
  `verify:campaign` — it asserts in-province fires across seeds.
- **"The lake is the wrong shape / too round"**: give its `scoop` or `RegionLake` an `elong` +
  `bearingDeg`, or trace an exact `outline` in [tools/map-editor.html](../../../tools/map-editor.html)
  (it mirrors the game projection and exports paste-ready lat/lon arrays). `outline` supersedes
  the ellipse; `areaKm2` stays the fallback.
- **"It doesn't read like the real place"**: this is the name pools + the reads-like layer
  (step 3) — add the real iconic lakes/rivers/cities. Run it past the `creative-director`
  reality-check to catch invented or real-but-wrong names.
- **"The flying feels wrong for the region"**: tune `terrain.ts` (step 5) — relief amplitude, lake
  density, mountain/alpine bands.
- **"A stray pond sits in open country"**: add a `noLakeZones` entry on its midpoint.
- **"Make a stub map playable"** (Alberta/Ontario are names-only stubs): add `geo` + `anchors`
  (with one `home` + scoop lakes) + the reads-like layer + a `terrain` profile, flip
  `card.available` to `true`, and (usually) add a `missions.ts` campaign with `bmf-mission`.

---

## ALIGN — wire it into the engine and hold the contracts

A map isn't done when `region.ts` is written — it has to slot into the systems around it.

### Wiring (two edits, both small)

1. **`maps/registry.ts`** — import the module and add it to the `MAPS` array. **Order is
   load-bearing**: Saskatchewan stays FIRST (`MAPS[0]` / `firstAvailable` / the default resolve to
   it; the campaign concatenation `allMissions()` is in registry order). Append new maps.
2. **`ui/profile.ts`** needs nothing — its `MAPS` picker auto-derives from `mapCards()`. The map
   appears in the picker the moment it's in the registry; `card.available` controls selectable vs
   dimmed. (Optional: drop `public/maps/<Name>.webp` for cover art matching `card.imageUrl`.)

Missions flow automatically too: `allMissions()` / `missionById()` walk the registry, so a map's
`missions.ts` is live as soon as the module is registered.

### Contracts you must not break

- **The locked `World` API** — `groundHeightAt`/`waterLevelAt`/`isOverWater`/`lakeAt`/
  `flightFloorAt`/`slopeAt` (+ the additive `isInProvince`/`isScoopWaterWithin`/`provinceOutline`).
  Your map data flows THROUGH these; never change their signatures (a future chunk-streamer swaps in
  behind them). See [src/three/World.ts](../../../src/three/World.ts).
- **Determinism from the seed** — region data must be pure (no `Math.random()`, no `Date.now()`).
  World generation is a pure function of `WORLD3D.seed`; `verify:world` is the guard.
- **Fire-grid scale-invariance** — leave it alone. `fireGridFor` keeps a constant cell size, so a
  bigger/true-shape world is automatically handled.
- **Mission anchor refs** — if you rename/move/remove an anchor a mission references (`homeBase`,
  `community`), update the mission too (it's authored data — adapt the mission to the map, per the
  "authored map is source of truth" rule). `verify:campaign` will catch a dangling `homeBase`.
- **No `import.meta.env` in the maps graph** — the Node verify bundle imports it; keep it
  types-and-data only (BASE_URL prefixing lives in `ui/profile.ts`).

---

## VERIFY — the mandatory gates (this repo has no unit-test runner)

Run the cheapest gate that covers your change, then the build. For map work, all three:

```bash
npm run build           # tsc --noEmit gate — a bad id/type/unused import fails here
npm run verify:world    # world-gen determinism digest (samples the locked World API)
npm run verify:campaign # every mission completable + (on bounds maps) fires land in-province
```

- **`verify:world`** samples `World` over a fixed lattice and compares to
  [scripts/world-baseline.json](../../../scripts/world-baseline.json). It only tests the
  `saskatchewan` region, so **adding a new map won't trip it** — but **editing Saskatchewan's
  region/terrain WILL**. If the change was intentional, re-baseline:
  `npm run verify:world -- --update` (and commit the new baseline — see the memory note about
  re-baselining against the FINAL committed tree).
- **`verify:campaign`** runs the "perfect player" oracle through every mission. A new map with a
  campaign must pass here; a new map without one doesn't add cases. It builds `World` with the
  mission's `{ regionId, homeBase, places }` — the same world the game ships.
- For a deeper live check (shaders, the radar render), see the `bmf-verify` skill — but map data
  changes are almost always fully covered by the three gates above.

## Common pitfalls

1. **`id` mismatch** across index/card/region → silent fallback to Saskatchewan. Grep your id.
2. **Forgetting to register** the module in `registry.ts` → the map simply doesn't exist.
3. **Two `home: true` anchors, or zero** → ambiguous/blank cold-start base.
4. **Trunk highway names left in the `names.highways` pool** → a stray MST link steals "Hwy 2".
5. **West longitude entered positive** → the whole map mirrors east. West is negative.
6. **Choosing `fit:'bounds'` then not re-baselining** after it changes the SK world (only if you
   edited SK) → red `verify:world`.
7. **Off-province placements on a bounds map** → centroid drift past the rim; pull coords in or add
   a margin, and trust `verify:campaign`.
8. **Inventing lake/town names** instead of using real ones → fails the brand reality-check; use
   the real region's names in the pools.

## Related skills

- `bmf-mission` — author the campaign that lives on the map (the `missions.ts` file).
- `bmf-tune` — dial the shared `config.ts` levers a terrain profile pulls from (`TERRAIN`,
  `MAPGEO`, world-size clamps).
- `bmf-verify` — the full verification ladder when a change needs a live headless check.
- `creative-director` — reality-check the place names + blurb so the map reads true, not invented.
