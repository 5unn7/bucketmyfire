# Maps & anchored placement

How a real place (northern Saskatchewan, and future regions) becomes a playable
bounded world with its **bases, communities, and scoop lakes in the right spots** —
without breaking the procedural-first ethos or the locked `World` API.

> **Decision (2026-06-04):** one **Saskatchewan** map holds all the fire bases as
> anchored places; you pick which base is home per mission. "More maps later" = new
> regions (the stubbed `ember-flats` / `glacier-coast`, or other areas), each its own
> entry. Helicopters only for now — bases are heli pads + docks (no fixed-wing yet).

> **Shipped (2026-06-04):** the **map selector + "maps own missions"** layer is live ahead of
> anchored placement. The live region id was renamed `boreal-shield` → **`saskatchewan`** (label
> "Saskatchewan"); every campaign mission carries `map: 'saskatchewan'`; the menu has a ②&nbsp;Region
> step (`MissionSelect.mapStep`) that filters the mission grid to the picked map's missions
> (`fillMissions`). `ember-flats` / `glacier-coast` show as "Soon" (no missions yet). The anchored
> placement below (Phase 1–3) is the **next** build; `Region.anchors` + `MissionDef.homeBase` are
> already declared (additive, unused until World resolves them).

> **Shipped (2026-06-04, real-coordinate upgrade):** anchored placement is now driven by **real
> latitude/longitude**, not normalized 0..1 coords. `MapAnchor` carries `{ lat, lon }`; `Region.geo`
> declares the province bounding box + boundary `outline`. `World` projects every anchor with a cosine
> ("sinusoidal") projection (`project(lat, lon)`) sized so the geo box's N–S extent fills `MAPGEO.fill`
> of the world height — so the 7 fire bases sit at their **true relative positions** and Saskatchewan
> renders as its real **trapezoid** (wider south, narrower north), not a stretched square. Scoop-lake
> radii come from each lake's **real surface area** (`scoop.areaKm2`) compressed onto a playable band
> (`MAPGEO.lakeMinR..lakeMaxR`), so Reindeer Lake dwarfs Candle Lake while both stay scoopable. Towns
> sharing the big La Ronge / Churchill water nudge to distinct dry-shore points (no stacking). The radar
> (`world/minimap.ts`) shades the off-province exterior and strokes the provincial border, so the map
> reads as Saskatchewan. The whole province (49°–60°N) is framed; the **open southern third is reserved
> for v2** (Prince Albert / Hudson Bay are placed as markers but carry no campaign content yet).
> `Game`/`verify-campaign` were untouched — the reprojection lives entirely behind the `World` API
> (`verify:campaign` still 42/42). The normalized-`x`/`y` model in the sections below is **superseded**.

## The one capability we add

Today the world is procedural-from-seed and place **names are drawn randomly and pinned
as cosmetic labels** — there is no way to say "La Ronge sits *here*, on *this* lake."
A faithful replica needs **anchored placements**: named locations at authored relative
coords that World honors. Everything else (terrain, trees, fire, the rest of the lakes)
stays procedural and fills in around the anchors.

This is a minimal evolution of the existing **"future maps" seam**:
`world/regions.ts` (`Region` registry) + `MissionDef.map` + the `config.ts`
`TERRAIN`/`LAKE_SHAPE`/`STREAM`/`BIOMES` "different map = different profile" comment.

## Data model — `Region` grows into a `MapDef`

`Region` keeps its name pools and gains optional fields. **All additive → existing
regions and missions are unaffected when the new fields are absent** (they keep today's
fully-procedural behavior).

```ts
// world/regions.ts
export interface MapAnchor {
  id: string;                 // 'la-ronge', 'buffalo-narrows', … (stable; missions reference it)
  name: string;               // 'La Ronge' (pinned over the seeded NameSource)
  kind: 'base' | 'community' | 'both'; // 'base' = refuel/spawn; 'community' = protectable; most SK towns are 'both'
  x: number; y: number;       // normalized 0..1 in the map's bounding box (see "Coordinates")
  home?: boolean;             // default spawn/cold-start base (exactly one per region)
  scoop?: { lake: string; radius?: number }; // guarantee an adjacent scoop lake (name + size). Omit = river-fed/no guaranteed lake.
  blurb?: string;             // briefing flavour / picker card copy
}

export interface Region {
  id: string;
  label: string;              // real-world region this map evokes
  names: RegionNames;         // lakes / communities / highways pools (unchanged)
  // --- new, all optional ---
  seed?: number;              // default world seed for this map (missions still override)
  extent?: number;            // world units (default WORLD3D.size = 1500)
  terrain?: Partial<typeof TERRAIN>;  // per-map heightfield profile overrides (merged over the global default)
  biome?: Partial<typeof BIOMES>;     // per-map biome weight overrides
  timeOfDay?: TimeOfDay;      // default sky/sun/fog mood
  wind?: { angle?: number; strengthScale?: number };
  anchors?: MapAnchor[];      // the bases + communities at relative coords (the new placement layer)
}
```

`config.ts` `TERRAIN`/`LAKE_SHAPE`/`STREAM`/`BIOMES`/`COMMUNITIES` stay as the **global
defaults**; a region's `terrain`/`biome` partials merge over them at World construction.
No mass migration — per-map profiles are opt-in, added when a future map needs to feel
different.

## Coordinates

Anchor `(x, y)` are normalized **`0..1` in the map's bounding box**: `x` = west→east,
`y` = south→north. World maps them into an **inset playable rect** (≈10% margin) so a
boundary town (`x=0` / `y=1`) still has airspace around it instead of sitting on the
terrain edge. World convention is Y-up with flight in XZ, so:

```
worldX = (lerp(margin, 1-margin, anchor.x) - 0.5) * extent
worldZ = (0.5 - lerp(margin, 1-margin, anchor.y)) * extent   // +y north → −Z
```

## World integration (locked API preserved)

`World` already takes a region id (for names) and already places lakeside bases
(`COMMUNITIES.baseCount`, `baseShoreSearch`, the depot + dock) and hamlets. The change is
**where** they go:

1. **If `region.anchors` is present**, drive base/community placement from the anchors
   instead of the seeded scatter: resolve each anchor's world `(X, Z)`, and for any anchor
   with `scoop`, **guarantee a lake basin there** (use the procedural lake if one already
   landed near it, else carve a pinned one of `scoop.radius`), then place the base on its
   shore via the existing `baseShoreSearch`. Pin `anchor.name` over the seeded name.
2. Fill the **rest** of the lakes / streams / trees / hamlets procedurally as today, around
   the anchors.
3. Expose anchors via **new, additive** resolvers — the locked signatures
   (`groundHeightAt`, `waterLevelAt`, `isOverWater`, `lakeAt`, `flightFloorAt`, `slopeAt`)
   are untouched:

```ts
World.anchor(id: string): ResolvedAnchor | null   // { id, name, kind, x, z, lake? }
World.anchors(): ResolvedAnchor[]
World.homeAnchor(): ResolvedAnchor                 // the home base (spawn / cold-start / refuel)
```

The `world/placement.ts` `fireSite` / fuel logic is unchanged — fires still seed in dry
forest, now naturally *around* the anchored towns.

## Mission integration

- `MissionDef.map` already selects the region (exists).
- New `MissionDef.homeBase?: string` — which anchor you spawn at / refuel from. Defaults to
  the region's `home` anchor (La Ronge).
- `FirePlacement` / `ZonePlacement` `community` accepts an **anchor id (string)** in
  addition to the existing index `number` / `'base'`, so a brief reads
  `nearCommunity: 'denare-beach'`. Index form stays for backward compatibility.
- Scenario resolution (`missions/scenario.ts`) maps anchor ids → world positions via
  `World.anchor()`.

## Rollout

1. **Phase 1 — placement.** Add the anchor fields + the Saskatchewan anchors (below).
   World resolves anchor positions, guarantees scoop lakes, pins names, exposes
   `anchor()/anchors()/homeAnchor()`. Player cold-starts at the home anchor.
2. **Phase 2 — missions.** `homeBase` + anchor-id `community` references; scenario resolver
   bridge; place-name pinning from anchors.
3. **Phase 3 — per-map feel (later).** `terrain`/`biome`/`timeOfDay` overrides per region,
   so `ember-flats` (flat high-fuel bog) and `glacier-coast` (steep fjord) actually differ.

## Verification

- `npm run build` — type gate.
- `npm run verify:campaign` — every mission still completable; each home base must have a
  reachable scoop lake (the anchor guarantee makes this deterministic).
- Headless (`?m=<id>&qa`): assert `__game.debug.lakes` contains the anchored lake near
  `homeAnchor`, and `__game.heliSim.position` cold-starts at it. (See the `bmf-verify` skill.)

## The Saskatchewan anchors (Phase-1 data)

Normalized to the bounding box of these 7 places (x: Dorintosh 0 → Denare Beach 1;
y: Hudson Bay 0 → Southend 1). Real adjacent water named where it exists; Prince Albert &
Hudson Bay are river-fed in reality, so they get a smaller guaranteed lake = longer, harder
scoop runs (a built-in difficulty lever).

```ts
const SASKATCHEWAN_ANCHORS: MapAnchor[] = [
  { id: 'la-ronge',        name: 'La Ronge',        kind: 'both', x: 0.51, y: 0.64, home: true,
    scoop: { lake: 'Lac La Ronge', radius: 240 }, blurb: 'Primary tanker base — island lake, easy water.' },
  { id: 'prince-albert',   name: 'Prince Albert',   kind: 'both', x: 0.44, y: 0.10,
    scoop: { lake: 'Candle Lake', radius: 130 },   blurb: 'Southern gateway base; river country, longer water runs.' },
  { id: 'southend',        name: 'Southend',        kind: 'both', x: 0.82, y: 1.00,
    scoop: { lake: 'Reindeer Lake', radius: 260 }, blurb: 'Remote far-north outpost on a vast cold lake.' },
  { id: 'hudson-bay',      name: 'Hudson Bay',      kind: 'both', x: 0.95, y: 0.00,
    scoop: { lake: 'Fir Lake', radius: 90 },       blurb: 'Eastern forward base in the hills — lake-poor, hard scoop.' },
  { id: 'denare-beach',    name: 'Denare Beach',    kind: 'both', x: 1.00, y: 0.52,
    scoop: { lake: 'Amisk Lake', radius: 170 },    blurb: 'SE lakeside village near the Manitoba line.' },
  { id: 'dorintosh',       name: 'Dorintosh',       kind: 'both', x: 0.00, y: 0.45,
    scoop: { lake: 'Greig Lake', radius: 150 },    blurb: 'SW park gateway — lakes everywhere, easy water.' },
  { id: 'buffalo-narrows', name: 'Buffalo Narrows', kind: 'both', x: 0.02, y: 0.86,
    scoop: { lake: 'Peter Pond Lake', radius: 220 }, blurb: 'NW lakes-country base — sits on the narrows between two big lakes.' },
];
```

Difficulty gradient falls out of the geography: **Dorintosh** (water everywhere) →
**La Ronge** (island hub) → **Buffalo Narrows** / **Southend** (big remote lakes) →
**Prince Albert** → **Hudson Bay** (barely any water = long ferries).
