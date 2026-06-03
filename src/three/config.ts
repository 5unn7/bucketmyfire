// Central tuning for the 3D build. The world is a real Y-up scene now: the
// helicopter flies in the XZ plane with altitude along +Y. Values are in world
// units (the terrain spans ~600 units; the aircraft is ~8 units long), retuned
// down from the old 2D pixel scale but preserving the same momentum "feel".

export const WORLD3D = {
  size: 1500, // square terrain extent, centered at origin — big enough that crossing it
  // takes ~40s at cruise (the map should feel large); lakes/trees scale with this area.
  seed: 1337, // one seed threads through noise/hydrology/placement/fire (determinism invariant)
  // Carved lake basins: each lake's water sits in a smoothstepped bowl so "descend
  // to scoop" is identical everywhere (the Phase-1 keystone). All in world units,
  // measured relative to the lake's flat water surface.
  lakeBedDepth: 5, // deepest lakebed below the water surface (at the center)
  lakeShoreDrop: 0.4, // ground at the waterline sits this far below the surface (water meets land)
  lakeBankHeight: 1.6, // raised lip above the water just outside the shore
  lakeBankWidth: 10, // radial width of that raised bank ring
  lakeBlendWidth: 22, // radial width over which the bank blends back into base terrain
};

// Terrain heightfield profile (Track A1). Tuned to read like the northern-Saskatchewan
// Boreal/Taiga Shield: LOW glacially-scoured relief (modest amplitude — it's not
// mountains), domain-warped so ridges/valleys MEANDER like eskers + bedrock fractures,
// a ridged layer for granite outcrops poking through thin soil, and flattened lowlands
// for muskeg bog flats. This whole block is the seam for FUTURE MAPS: a different map is
// a different profile (+ seed + lake set), swapped behind the unchanged World API.
export const TERRAIN = {
  baseAmplitude: 9, // vertical scale of the rolling FBM (units) — kept low (shield relief)
  baseFrequency: 0.0045, // world→noise scale (lower = broader landforms)
  octaves: 5,
  lacunarity: 2.0, // frequency step per octave
  gain: 0.5, // amplitude falloff per octave
  warpStrength: 85, // domain-warp displacement (units) → winding, glacial ridgelines
  warpFrequency: 0.006,
  ridgeAmplitude: 6, // rocky bedrock outcrops standing above the rolling base
  ridgeFrequency: 0.011,
  ridgeOctaves: 3,
  ridgeThreshold: 0.5, // only ridge values above this rise (localizes outcrops)
  lowlandFlatten: 0.5, // 0..1 — compress below-water-line dips into flatter muskeg basins
} as const;

// Lake shape (irregular water bodies). Shield lakes follow bedrock fractures — they
// are ELONGATED and lobed, not round. Each lake gets a seeded boundary that varies by
// angle: an ellipse (elongation along a random axis) times a few low harmonics (lobes).
// The SAME boundary feeds the carved basin, the water-disc mesh, and isOverWater, so
// the irregular shoreline stays perfectly consistent everywhere.
export const LAKE_SHAPE = {
  elongMin: 1.25, // min long/short axis ratio
  elongMax: 1.95, // max — keep < ~2 so the radial boundary stays single-valued (star-convex)
  harmonics: 2, // number of angular lobes summed onto the ellipse
  harmonicAmp: 0.12, // max amplitude of each lobe (fraction of radius)
  meshRings: 14, // concentric rings in the water disc — enough for a smooth depth fade (no banding)
} as const;

// Streams / mini rivers (Track A4). Thin meandering channels that connect lakes
// downhill (mini rivers) plus short tributaries feeding into them (tiny streams).
// They carve a shallow channel into the terrain and their surface generalizes
// World.waterLevelAt, so you can SCOOP from a stream just like a lake. Kept narrow +
// shallow (Shield streams are small) so threading one is a real piloting test.
export const STREAM = {
  width: 3.4, // half-width of a mini-river water ribbon (units)
  tinyWidth: 2.0, // half-width of a tiny tributary
  depth: 1.8, // channel bed below the water surface (shallow — bucket still reaches)
  shoreDrop: 0.3, // bank-edge ground sits this far below the surface (water meets land)
  bankHeight: 0.7, // low raised lip just outside the channel
  bankWidth: 3.5, // width of that bank ring
  blendWidth: 9, // blend the bank back into base terrain
  meander: 3, // intermediate meander control points per stream
  meanderAmp: 20, // lateral meander amplitude (units)
  resample: 6, // ribbon cross-section spacing (units) — smaller = smoother stream edges
  tinyLength: 55, // how far a tributary reaches uphill from its lake (units)
  tinyRise: 2.5, // how much higher the tributary source sits above its lake (units)
  tinyTries: 6, // seeded directions to try per lake before giving up on a tributary
  // Hydrology DENSITY (so the map doesn't read as one fully-plumbed lake network — a
  // boreal landscape has plenty of isolated kettle lakes). A lake only spills to its
  // lower neighbour on a seeded coin-flip AND only if that neighbour is reasonably near;
  // tributaries are rarer still. Tuned down from "every lake connected" on this map.
  connectChance: 0.5, // probability a lake spills a stream to its nearest lower lake
  maxConnectDist: 360, // don't draw a river to a lower lake farther than this (units)
  tributaryChance: 0.3, // probability a lake gets a tiny uphill feeder at all
  mouthBlend: 9, // world units over which the channel carve fades out at a lake mouth (smooth join)
} as const;

// Biomes (Track A2). A `elevation × moisture × slope` classification → meadow /
// forest / rock / shore, driving terrain vertex colors and tree density + tint.
// Moisture is its own low-frequency noise channel (wetter in lowlands), so forest
// clusters in moist valleys, rock shows on steep outcrops, shore rings each lake.
export const BIOMES = {
  moistureFrequency: 0.004,
  moistureOctaves: 3,
  forestMoistLow: 0.42, // below → meadow; above forestMoistHigh → full forest
  forestMoistHigh: 0.62,
  rockSlope: 0.5, // gradient magnitude where bare granite starts showing
  rockHeight: 6.0, // elevation (units) where outcrops turn rocky regardless of slope
  shoreWidth: 6, // world-unit band outside each waterline that reads as sandy shore
  // Swamp / muskeg: very wet, FLAT, LOW ground — boggy peatland between the rises.
  swampMoist: 0.74, // moisture above this (with low elevation + low slope) turns to swamp
  swampMaxHeight: 1.5, // only low ground (≤ this elevation) can be swamp
  swampMaxSlope: 0.18, // only near-flat ground can be swamp (bogs are level)
  // Palette (hex)
  colorShore: 0x9c8d63, // gravel/sand
  colorMeadow: 0x6f8f3f, // light grassy green
  colorForest: 0x355e2c, // deep boreal green
  colorRock: 0x6f7176, // granite grey
  colorSwamp: 0x4f5836, // murky olive-brown peat bog
  // Tree placement (acceptance probability + foliage tint per biome)
  densForest: 1.0,
  densMeadow: 0.45, // denser meadow scatter — more trees overall
  densShore: 0.06,
  densRock: 0.03,
  densSwamp: 0.14, // sparse stunted stand in the bog
  tintForest: 0x2f5d34,
  tintMeadow: 0x4f7e40,
  tintSwamp: 0x3a4a30, // sickly dark green for swamp tamarack/black spruce
} as const;

// Flight model — momentum integrator with helicopter-style steering: the pilot
// yaws the nose directly and applies variable throttle ALONG it; thrust adds to
// velocity, drag bleeds it, speed is capped, and the airframe banks into turns /
// pitches with the throttle. Altitude (collective) carries its own inertia so
// climbs/descents feel weighty.
export const FLIGHT = {
  enginePower: 140, // horizontal thrust (units/s^2) in the input direction
  linearDrag: 1.6, // horizontal air resistance: higher = settles faster
  maxSpeed: 41, // horizontal AIRSPEED cap (units/s) → 110 kt at the coherent ~4.5 ft/unit
  // scale (see INSTRUMENTS / maxClearance). At this scale a world-diagonal crossing is
  // ~50s and 110 kt reads as a real cruise; the kt calibration tracks this cap.
  // Wind blows the airframe over the ground: ground velocity = airspeed + wind, so a
  // headwind cuts your ground speed (you crawl into it) and a tailwind shoves you
  // along — a light heli gets pushed around. Scales the unit Wind vector to units/s.
  windSpeed: 8, // world units/s of drift at full wind strength (lowered: wind nudges, doesn't shove)
  windHoldSpeed: 12, // airspeed (units/s) below which wind fades out → a hover holds station
  // (so releasing the stick doesn't let the wind carry you away)
  // Helicopter-style steering: the stick TURNS the nose (yawRate) and pushes
  // forward/back along it (variable throttle). The nose no longer chases velocity.
  yawRate: 1, // turn rate (rad/s, ~97°/s) at full left/right stick
  reversePower: 0.5, // backward thrust fraction — flying tail-first is slower
  // Raw turn/throttle input is eased toward (this) per-60fps factor before it drives
  // yaw and thrust, so a key tap or stick flick ramps in and rolls out instead of
  // snapping — the main lever for how SMOOTH the flight transitions feel. Lower =
  // smoother/floatier, higher = snappier/more direct (1 = no smoothing).
  controlResponse: 0.16,
  // --- Body attitude (acceleration-driven, like a real airframe) ---
  // The fuselage tilts toward its acceleration: dive to speed up, flare to brake,
  // bank into turns. These cap how far it leans and how persistently it cruises
  // nose-down. See the attitude block in HelicopterSim.update().
  maxBank: 0.8, // radians of roll at full lateral (turn) acceleration
  maxPitch: 0.52, // radians of dive/flare at full fore/aft acceleration (deeper nose-over)
  cruisePitch: 0.14, // extra persistent nose-down at top speed (disc tilted to hold cruise)
  bodyEase: 0.1, // how fast bank/pitch ease toward their targets (lower = softer/heavier)
  // --- Pitch → motion coupling (cyclic-forward): the nose-down disc drives REAL flight,
  // not just a cosmetic tilt. Tucking the nose tilts the thrust vector forward and down,
  // so a dive surges AND descends — and a committed dive can outrun level cruise. Pull UP
  // collective to flare out of it. Raise these for a more aggressive, weightier dive.
  pitchThrust: 90, // extra forward accel (units/s^2) per radian of nose-down disc — the speed surge
  pitchDive: 36, // sink rate (units/s) per radian of nose-down BEYOND the cruise trim — the descent
  diveSpeedBoost: 0.28, // top-speed cap raised by up to this fraction in a full committed dive
  // Collective: the pilot raises/lowers altitude directly. To scoop you simply
  // descend over a lake until the slung bucket dips into the water (no scoop
  // button — the fill is physical). Vertical speed EASES in (rotor inertia) instead
  // of snapping, and the ease is now framerate-independent.
  climbSpeed: 22, // max climb rate (units/s) at full UP collective, empty bucket. Kept as-is
  // so a small "pop over a ridge" feels the same; the tall band just means full-ceiling
  // climbs now take real time (you rarely go that high).
  descendSpeed: 24, // max descent rate (units/s) at full DOWN collective (weight assists — no payload cut)
  collectiveResponse: 0.07, // vertical inertia: lower = heavier/slower to spool up & down (per-60fps factor)
  startAltitude: 60, // start comfortably airborne in the taller band (was 30)
  rotorSpin: 26, // main-rotor visual spin (rad/s)
  tailRotorSpin: 42, // tail-rotor visual spin (rad/s)

  // --- AGL flight band (replaces the old absolute min/maxAltitude) ---
  // The heli flies in a band that RIDES the flight floor from World.flightFloorAt,
  // so a fixed-clearance descent always lands the same height above whatever's
  // below — ground on land, the water surface over a lake. The floor itself bakes
  // in the surface-specific offset (canopy over land, scoop over water); these two
  // are an extra global band around it.
  minClearance: 0, // hover margin above the floor at full descent (0 = sit on the floor)
  maxClearance: 555, // ceiling above the floor at full climb → 2500 ft at ~4.5 ft/unit (a real,
  // tall band you can climb into; normal flying stays low near the floor)
  canopyClearance: 8, // land floor = ground + this — keeps the rotor disc above the canopy
  scoopClearance: 2, // water floor = waterLevel + this — low enough that the slung bucket dips under

  // --- Weight coupling: a full bucket flies heavy and sluggish, recovers on drop ---
  // Each penalty is the fraction shaved off the parameter at a full (ratio = 1) bucket.
  payloadAccelPenalty: 0.35, // engine thrust loss when loaded
  payloadSpeedPenalty: 0.18, // top-speed loss when loaded → 110 kt empty drops to ~90 kt full
  payloadClimbPenalty: 0.4, // climb-rate loss when loaded — the main "heavy to fly" effect
  // A full bucket sags DOWN only slightly — it doesn't auto-descend, it just settles
  // a touch at neutral collective and takes longer to spool the climb (responsePenalty).
  // The heavy feel comes mostly from the climb/accel/speed penalties, not this. Fades
  // as water drains.
  payloadSink: 1.5, // gentle downward drift (units/s) at a full bucket (small on purpose)
  payloadResponsePenalty: 0.5, // fraction of vertical responsiveness lost when full (laggier collective)
};

// Rotor downwash + ground effect (Track C4). The column of air a helicopter throws
// down only reaches the surface when the aircraft is LOW. `sim/RotorWash.ts` turns the
// flight sim's AGL into two plain-number SIGNALS (the sim-boundary invariant): a
// `surface` strength (drives water ripples, canopy bend, flame fanning) and a
// `groundEffect` cushion (a buoyant lift assist for low scooping passes). All reaches
// are in AGL/world units; nothing here touches a Three scene or the DOM.
export const WASH = {
  reach: 28, // AGL (units) below which the downwash reaches the surface (0 above) — the
  // wash is strongest on the deck and squared in the sim, so only genuinely low passes blow
  groundReach: 16, // AGL below which the in-ground-effect cushion builds (≈ a rotor span)
  groundLift: 6, // buoyant climb assist (units/s) at the surface, hover collective — gated
  // by collective so a full DOWN descent still bottoms out on the floor (scoop unaffected)
  // --- Water: the downwash dimples a lake into concentric rings under the heli ---
  rippleInterval: 0.13, // seconds between downwash ripple rings (reuses the B1 ripple pool)
  rippleStrength: 0.6, // ring punch at full wash (cf. WATER.dipStrength 0.45 / dropStrength 0.9)
  // --- Foliage: the canopy directly below flattens OUTWARD, away from the rotor ---
  foliageRadius: 24, // trees within this of the wash center bend (units)
  foliageBend: 1.8, // max outward crown displacement (units) at full wash
  // --- Fire: flames near the heli whip harder under the wash (cosmetic only) ---
  fanRadius: 20, // fires within this of the heli are agitated (units)
  fanStrength: 1.0, // agitation fed to the flame shader at full wash, point-blank
} as const;

// Instrument calibration — DISPLAY ONLY. Physics runs in world units (the feel is
// tuned there); the HUD converts to real-world numbers for a light water-bomber
// (AS350-class): 110 kt empty / ~90 kt full airspeed, 2500 ft ceiling. The factors
// are derived from the FLIGHT caps so changing those keeps the gauges consistent.
export const INSTRUMENTS = {
  topSpeedKt: 110, // empty FLIGHT.maxSpeed maps to this on the airspeed tape
  ceilingFt: 2500, // top of the AGL band (FLIGHT.maxClearance) maps to this on the altimeter
  maxVsiFpm: 1600, // full-collective climb (FLIGHT.climbSpeed) maps to this on the VSI
  lowAltFt: 250, // altimeter reads LOW (red) below this AGL
};


// Bambi bucket slung under the heli on a rope. Spring-damped so it lags in turns
// and overshoots on stops (payload physics); water leaves the bucket's world XZ,
// not the heli's, so smooth flying bombs true. Mirrors the old 2D BUCKET_PHYS.
export const BUCKET3D = {
  ropeLength: 7, // rest hang below the heli (units)
  // --- Longline flex (visual sag) ---
  // A real longline isn't a rigid stick: it bows into a catenary whose depth scales
  // with load. A LIGHT bucket lets the line go soft and droop; a FULL bucket's weight
  // pulls it taut and nearly straight. Game draws the rope as `ropeSegments` short
  // members dipped by a mid-span sag interpolated from fill (purely visual, O(1)).
  ropeSegments: 10, // line subdivisions for the drawn sag (visual only)
  ropeSagEmpty: 1.3, // mid-span droop (units) at an empty bucket — soft, flexible
  ropeSagFull: 0.25, // mid-span droop at a full bucket — taut, nearly straight
  stiffness: 90, // LATERAL (XZ) spring pulling the bucket under the heli
  damping: 9, // lateral sway bleed
  massEmpty: 1.0,
  massFull: 1.6, // a full bucket is heavier → more lateral lag/overshoot
  // How hard the heli's velocity drags the bucket's rest target back. Higher =
  // the bucket (and the rope with it) trail further behind the faster you fly.
  // At top speed this pushes the offset toward maxSwing so the rope rakes way back.
  swayFromVel: 0.09, // heli velocity blended into the rest target (turn/speed trail)
  fullSag: 1.5, // extra hang when full
  // Vertical follow is a per-frame lerp toward the hang target (NOT a spring — no
  // oscillation, just smooth lag), and it scales with load so the line FEELS as
  // flexible as it looks: a LIGHT bucket follows loosely (more vertical give), a
  // FULL bucket follows tightly (the taut, weighted line reads rigid). Per design
  // feedback: still no springy Y bounce, just softer give when light.
  verticalFollowEmpty: 0.32, // loose vertical follow when light — flexible
  verticalFollowFull: 0.55, // tight vertical follow when full — rigid
  // Pendulum swing of the BODY (visual): the bucket hangs ALONG the longline instead
  // of staying bolt-upright, so when it lags in a turn it visibly swings out like a
  // real slung load. 0 = always upright (old look), 1 = the body fully aligns with the
  // rope (a free bob). Partial so it leans into the swing rather than dragging sideways.
  swingTilt: 0.7,
  maxStep: 1 / 30, // clamp dt so the spring can't explode after a stall
  capacity: 100,
  refillRate: 45, // litres/sec while dipped — ~2.2s to fill the bucket
  // --- Drop behavior (two real bucket archetypes) ---
  // 'bambi' = a classic Bambi bucket: ONE tap fully dumps the load — the whole
  //           tank empties automatically (at dumpRate) and there's no way to drop
  //           "just a little". 'valve' = a valve-equipped variant: hold DROP to
  //           pour and RELEASE to pause, so you can split a load across passes.
  type: 'bambi' as 'bambi' | 'valve',
  dumpRate: 200, // litres/sec while a latched 'bambi' dump runs — full tank gone in ~0.5s
  dropRate: 120, // litres/sec while a 'valve' bucket is held open — a tank lasts ~0.8s
  dropRadius: 26, // world units a drop douses around the bucket
  dipThreshold: 1.2, // bucket counts as "in the water" within this of the surface
  // Physical scoop tip: while the bucket is submerged it eases a forward tilt and a
  // small downward dip offset, then levels out when it lifts clear. Vertical follow
  // (load-scaled) keeps the dip smooth so mainly the tilt + tiny dip read.
  scoopTip: 0.5, // forward tilt (rad) eased in while submerged
  scoopDip: 0.6, // extra downward offset (units) while submerged
  tipEase: 0.2, // per-frame lerp toward the tip/level target
  // Soft rope constraint: the bucket may swing, but never past this horizontal
  // distance from the heli (the rope goes taut). Mostly-vertical 7-unit rope.
  maxSwing: 6.5, // max horizontal bucket offset from the anchor (units) — room to rake back at speed
  // --- Terrain & tree collision (Track C) ---
  // The slung bucket can't pass through the ground or the treetops: it rests on
  // whatever's under it and DRAGS while in contact, so flying low scrapes it along
  // the dirt and snags it in the canopy (deeper contact = grabbier). Carrying water
  // while scraping slops some of it out.
  bottomOffset: 0.72, // bucket underside below its origin (scaled body half-height, 1.2 × 0.6) — the contact point
  groundDrag: 7, // horizontal velocity bled/sec while in contact (the scrape) — higher = grabbier
  grabDepth: 4, // penetration (units) at which contact drag DOUBLES — a tall canopy grabs hard
  spillDragMin: 4, // drag speed (units/s) below which a scrape is gentle enough not to slop water
  spillPerDrag: 0.5, // litres slopped per (unit/s) of drag speed, per second, while scraping with water
};

// Lake centers (XZ); water height is sampled from the terrain at runtime.
export const LAKES3D = [
  { x: -120, z: -70, r: 32 },
  { x: 150, z: 50, r: 28 },
  { x: 40, z: 175, r: 34 },
  { x: -175, z: 150, r: 26 },
];

// Forest fire simulation (slowed + capped, per the 2D tuning lesson). Track C3
// extracts this into the engine-agnostic sim/FireSystem.ts and adds real dynamics:
// fires burn out as they consume FUEL, spread UPHILL + downwind through fuel, and
// doused ground becomes a wet FIREBREAK that resists reignition for a cooldown.
export const FIRE3D = {
  count: 3, // fires at the start — a few seeds that GROW, not a map full of blazes
  maxIntensity: 100,
  regrowth: 3.5, // intensity/sec when ignored (scaled by remaining fuel — a starved fire burns weaker)
  spreadIntervalMs: 4500, // creep cadence (quickened — fires feel alive, still winnable on mobile)
  spreadChance: 0.2, // per established active fire, per tick
  spreadDistance: 30, // world units a new fire spawns from its parent
  maxActive: 14, // hard cap — spread can't run away (also the FireMesh pool size)
  // Douse is by VOLUME of water delivered, not by time, so a fast one-shot dump
  // and a slow valve pour knock a fire down by the same amount per litre. With
  // capacity 100 and maxIntensity 100, ~1.2 means a full tank kills a full fire
  // (with margin) — and a half-load valve drop knocks it halfway. (Track C.)
  dousePerLitre: 1.2, // fire intensity removed per litre of water landing in radius

  // --- C3: fuel depletion (fires burn out) ---
  // Each fire carries a local fuel reserve that drains while it burns; at zero the
  // fire self-extinguishes and SCORCHES its patch (so it can't immediately reignite).
  // Intensity's ceiling tracks remaining fuel, so an ignored fire visibly dies down as
  // it starves. Depletion keeps a SMOLDER FLOOR (it never scales to zero with intensity)
  // so fuel reaches 0 in finite time — without it the fuel↔intensity coupling decays
  // exponentially and the fire asymptotes, never actually burning out.
  fuelStart: 1.0, // initial fuel reserve (0..1)
  burnRate: 0.03, // fuel/sec consumed at full intensity → a full fire burns out in ~55s if ignored
  smolderFloor: 0.35, // min fraction of burnRate a knocked-down fire still consumes (guarantees burn-out)
  scorchStrength: 0.85, // how much a burned-out cell's flammability is knocked down (0..1)

  // --- C3: wet firebreaks (doused ground resists reignition) ---
  firebreakStrength: 0.9, // flammability knockdown in cells hit by a drop (0..1)
  firebreakCooldownMs: 14000, // how long a wet cell takes to dry back to flammable
  gridCells: 48, // suppression-grid resolution per side (fixed-size Float32Arrays; ~12.5u cells)

  // --- C3: slope-driven spread (fire climbs) ---
  slopeBias: 0.6, // 0..1 — how hard spread direction is pulled toward the local uphill vector

  // --- C3.1: size classes + growth + re-flare (a fire is a GROWING footprint, not a dot) ---
  // Each fire carries a `size` 0..1 (an NWCG Class-A spot → big blaze). It IGNITES small,
  // GROWS while it burns, and its intensity ceiling — and thus flame length, glow, and smoke —
  // rises with size. A fire only throws spot fires once grown past `spreadSizeThreshold`.
  // Dousing knocks down BOTH intensity and size; a fire is only OUT once knocked down AND
  // shrunk under `killSize`, so a big blaze RE-FLARES from its remaining size/fuel and takes
  // several passes (its smoke obscures it, too → genuinely hard to fight).
  initialSize: 0.35, // size of the opening fires (already established — immediate action)
  sizeStart: 0.12, // size of a freshly-spotted fire (a small Class-A ignition that must grow)
  sizeGrowth: 0.034, // size/sec gained at full intensity+fuel → a spot takes ~70–90s to reach a blaze
  // (slowed from 0.05 — fires escalate more gradually so the player has time to read + attack a front)
  sizeIntensityFloor: 0.22, // intensity ceiling fraction at size 0 (a tiny fire still has short flames)
  spreadSizeThreshold: 0.4, // a fire must reach this size before it can spot new fires
  sizeBurnBase: 0.5, // fuel-burn rate fraction at size 0 (small fires barely consume; big ones race)
  reflareBoost: 1.2, // extra intensity regrowth per unit size → big fires re-flare fast after a knockdown
  sizeDousePerLitre: 0.0045, // size shrunk per litre (a full 100L tank ≈ −0.45 size → a big blaze needs ~2–3 passes)
  killSize: 0.15, // a fire is OUT only once intensity hits 0 AND size drops under this

  // --- C5: CELLULAR FIRE FIELD (the real propagation model) ---------------------------
  // Fire is now a FIELD, not a handful of objects: a fixed grid of cells, each with a
  // `fuel` reserve (sampled once from world.fuelAt → forest burns, rock/water/road don't)
  // and a live `heat`. A burning cell PRE-HEATS its neighbours, weighted by wind, slope,
  // and their fuel; once a neighbour's accumulated pre-heat crosses the ignition
  // threshold it lights — a genuine advancing front that spots downwind and stalls at
  // firebreaks. The ≤maxActive flame MESHES are just a view of the hottest cell clusters.
  fireCells: 128, // grid resolution per side (128² over a 1500u map ≈ 11.7u cells)
  blobCells: 24, // coarse grid the field is clustered into → up to maxActive rendered "fires"
  seedHeat: 0.2, // heat a freshly-ignited cell starts at (0..1) — a weak lick that must build
  seedRadius: 1, // radius (cells) of the disc lit when a fire is seeded/spotted — start as a SPOT
  cellRegrow: 0.16, // heat/sec a burning cell climbs toward its fuel ceiling (lowered again: a fire
  // builds more gradually + a knockdown buys longer relief before it climbs back; pairs with wetRegrowSuppress below)
  cellBurnRate: 0.016, // fuel/sec a cell consumes at full heat → a forest cell now burns out in
  // ~60–70s (was 0.05 ≈ 20s). The single biggest lever against "fires burn out 10× too fast": a
  // neglected front lives for MINUTES and grows into a real threat instead of fizzling.
  cellSmolderFloor: 0.3, // min fraction of burn it consumes when barely lit (guarantees burn-out)
  // A doused-but-still-lit cell's regrow is suppressed while its ground is WET (set by a drop):
  // the knockdown HOLDS for ~the firebreak cooldown, then re-flares as it dries — so water is a
  // tactical holding action on a big blaze (knock the head, re-hit or cut a line), not a delete
  // button. A young/cool cell still dies outright in one good drop. (Track C — suppression depth.)
  wetRegrowSuppress: 0.85, // fraction of regrow removed in a fully-wet cell (0 = no effect, 1 = frozen)
  // Spread is SLOW and DIRECTIONAL: a creeping flank, a faster head running downwind. Base
  // time-to-ignite ≈ igniteThreshold / (spreadRate·heat·weight) − preheat decay, so these two
  // set the creep. Flat/no-wind ≈ a cell every ~5s (~2.5 u/s); downwind head ≈ ~1s (~11 u/s).
  spreadRate: 0.34, // pre-heat deposited per (neighbour · heat · sec) — lower = slower creep (eased from 0.5)
  igniteThreshold: 1.25, // pre-heat a cell must accumulate before it ignites — higher = slower (raised from 1.0)
  preheatDecay: 0.25, // per-sec bleed of un-ignited pre-heat (a stalled flank cools instead of creeping forever)
  windSpread: 2.6, // extra pre-heat multiplier for a downwind neighbour (raised: the head RUNS with
  // the wind — reading the wind and attacking the head upwind becomes the core skill)
  slopeSpread: 1.8, // extra pre-heat multiplier for an uphill neighbour (fire climbs decisively)
  slopeRef: 6, // height diff (units) between cells that counts as a "full" slope for spread
  wetResist: 4, // a doused (wet) cell's ignition threshold is multiplied up to this — firebreaks hold
  minFuel: 0.06, // a cell below this fuel can't ignite or sustain (front stalls in thin fuel)
  spotChance: 0.004, // per hot cell, per sec: throw an ember ahead — RARE, and only in strong wind (rarer: slower spread)
  // (gated in code on wind strength + a very hot source). This is what stops "fireworks everywhere".
  spotDist: 34, // how far downwind (units) a spotting ember lands — ~3 cells: stays VISUALLY
  // ATTACHED to the head (reads as the front advancing, not a new fire teleporting across the map)
  litresToClear: 135, // water litres that fully zero a cell's heat (raised from 55). A full 100L
  // bambi dump now KNOCKS DOWN a full-heat cell (1.0 → ~0.26) instead of deleting it — a big blaze
  // re-flares and needs several passes, while a young/cool fire (heat ≲0.7) still dies in one drop.
  cellsForFullSize: 46, // burning cells in a cluster that read as footprint size 1 (raised so flame/
  // smoke scale tracks the now-larger sustained fronts)
  cellsPerFire: 8, // cells ≈ one "fire" for the burned-out / doused scoring counters
  repMinHeat: 0.15, // minimum clustered heat for a cluster to be a rendered fire (below → it's out)
  repCellMin: 0.06, // a cell must be at least this hot to count toward a render cluster

  // --- C5: consequences (trees / fauna / smoke read the field) ------------------------
  treeIgniteHeat: 0.25, // a tree whose cell heat exceeds this catches fire
  treeBurnTime: 4.5, // seconds for a lit tree to char + collapse its canopy into a black snag
  treeScanInterval: 0.3, // seconds between (throttled) tree-ignition scans of the field
  faunaFleeHeat: 0.12, // fire heat near a critter (in its sample radius) that triggers PANIC
  faunaFleeRadius: 60, // how far a critter "senses" fire (units) → flees before it's on top of it
  faunaPanicSpeed: 7, // panic run speed (units/s) — ~4× the calm wander
  smokeBlindRadius: 130, // how far upwind of the camera fire heat is gathered into a blinding veil
  smokeBlindMax: 0.82, // peak opacity of the smoke veil when the camera is deep in the column
};

// Structures to defend (Track C3 — stakes). Cabins scattered through the forest plus a
// lakeside depot; a fire within `threatRadius` damages whatever it reaches, and you LOSE
// when every structure is destroyed. This is what makes the fire dynamics matter — an
// ignored, spreading fire eventually burns your buildings down. Engine-agnostic state
// lives in sim/Structures.ts; meshes/cabin.ts draws them (procedural, zero assets).
export const STRUCTURES = {
  cabinCount: 5, // wooden cabins seeded in flammable forest (where the fire goes)
  depot: true, // one larger lakeside base/depot
  threatRadius: 34, // a fire within this (world units) of a structure damages it
  damagePerSec: 0.06, // health/sec lost to a point-blank, full-intensity fire → ~17s to destroy
  minFromOrigin: 90, // keep structures off the player's spawn
  cabinSpacing: 55, // minimum spacing between structures (world units)
  // Buildings must read as SHORTER than the boreal canopy (trees are ~6–8 units tall):
  // cabin roof-peak ≈ cabinSize × 2, depot ≈ depotSize × 1.1, so keep these well under ~3.
  cabinSize: 1.8, // cabin half-extent (units) → ~3.6u to the ridge, below the treetops
  depotSize: 3.6, // depot half-extent (units) → a wide, low lakeside base (~4u tall)
} as const;

// Settlements (Track A5 — populated map). Beyond lone cabins, the world seeds a handful
// of named (fictional) boreal communities: one lakeside "base" (where the depot
// sits) plus several small forest hamlets (a tight cluster of cabins). They give the map
// a sense of place + stakes, and they're the nodes the highway network links. Generated
// deterministically in World (sites + names); Structures populates them with buildings.
export const COMMUNITIES = {
  townCount: 5, // small forest hamlets seeded across the map (the base is extra)
  minFromOrigin: 130, // keep towns off the player's spawn (units)
  spacing: 200, // minimum spacing between community centers (units) — towns feel distinct
  clusterRadius: 26, // cabins of a hamlet scatter within this of its center (units)
  cabinSpacing: 9, // min spacing between cabins WITHIN a hamlet (tight, village-like)
  cabinsMin: 3, // fewest cabins in a hamlet
  cabinsMax: 6, // most cabins in a hamlet
  remoteCabins: 3, // lone trapper cabins out in the bush (spread bait), beyond the towns
  baseShoreSearch: 48, // how far past a lake's edge to ray-march for the base's dry shore
} as const;

// Highways (Track A5). A road network linking the communities — drawn as draped 3D
// asphalt ribbons that CONFORM to the terrain (a low causeway where they cross water) plus
// lines on the minimap. The network is a minimum spanning tree over the community centers
// (so every settlement is reachable, no redundant loops). Named after fictional bush
// routes. Built in World; meshes/road.ts draws them (procedural, zero assets).
export const ROADS = {
  // Northern bush roads are GRAVEL, not painted asphalt — matte tan-brown, no centre line,
  // with speckled, slightly ragged shoulders so they read as worn dirt, not a cartoon strip.
  // A realistic narrow ~3u carriageway: about a third of the heli's length. Half-width here.
  width: 1.2, // half-width of the gravel ribbon (units) → ~3u carriageway
  lift: 0.2, // sit the road this far above the ground it hugs (clears z-fighting only)
  bridgeLift: 0.7, // extra height where a road crosses water (a low causeway over the surface)
  meanderAmp: 18, // gentle lateral wander (units) — roads bend with terrain, less than rivers
  dodgeMax: 140, // max lateral search (units) to route a road point around a lake before giving up
  resample: 4.5, // ribbon cross-section spacing (units) — smaller = smoother road edges + better drape
  edgeConform: 0.7, // 0..1: how much each edge follows its OWN ground height (1) vs the centre's (0)
  edgeRagged: 0.16, // shoulder wobble as a fraction of width — gravel roads aren't perfect strips
  gravelColor: 0x6a5d49, // packed tan-brown gravel (matte, no markings)
  speckleLo: 0.8, // per-vertex brightness floor → worn, speckled surface (kills the flat-slab look)
  speckleHi: 1.08, // per-vertex brightness ceiling
} as const;

// Scoring (Track C3). Shown on the end banner (win or loss). Rewards fires you put out
// with water, structures still standing at the win, and a flat win bonus.
export const SCORE = {
  perFireDoused: 250, // each fire you extinguish with a water drop (not burned out on its own)
  perStructureSaved: 1000, // each structure still standing when the last fire dies
  winBonus: 2000, // flat bonus for clearing every fire
  perCrewDelivered: 600, // each crew inserted / evacuee flown out (mission objective)
} as const;

// Mission MECHANICS tuning (the campaign layer). This is the single tuning source for the
// new gameplay mechanics the missions exercise — landing-zone size + crew sling pickup/drop,
// and the fuel/range model (Track C6). It holds VALUES only; the SCENARIO of each mission
// (seed, where the fires/crews/structures sit, win/lose) lives in `missions/catalog.ts` as a
// `MissionDef`, never here. Engine-agnostic sims (`sim/CrewTransport.ts`, `sim/FuelSim.ts`)
// read these exactly as `HelicopterSim`/`FireSystem` read FLIGHT/FIRE3D.
export const MISSIONS = {
  // --- Crew / cargo sling transport (landing-zone delivery + evacuation) ---
  // A crew is "loaded"/"delivered" by holding a LOW + SLOW hover within a zone's radius
  // for the dwell time — the same low-and-slow skill scoop uses, no extra button.
  lzRadius: 24, // horizontal distance (units) within which a hover counts as "on the zone"
  hoverAgl: 16, // radar altitude (units) below which the heli is "low" enough to work a zone
  hoverSpeed: 7, // airspeed (units/s) below which the heli is "slow" enough to work a zone
  pickupSec: 2.2, // low+slow dwell to LOAD a crew at a pickup/base zone
  dropSec: 2.2, // low+slow dwell to DELIVER a crew at a dropoff zone
  zoneSmoke: 0x39d0ff, // marker-smoke / ring tint for an ACTIVE (next) zone (cyan)
  zoneSmokeDone: 0x5a6b72, // tint once a zone is satisfied (greyed out)

  // --- Fuel / range (Track C6 — calibrated to the hero Bell 205A-1, 60× time compression:
  // full bucket + full power ≈ 2.5 min endurance, light loiter ≈ 4.2 min). Only missions
  // with `fuel:true` construct a FuelSim; everything else ignores this block. ---
  startFuel: 1.0, // tank fraction at spawn (0..1)
  idleBurn: 0.004, // fuel/sec floor at a hover (→ ~4.2-min max-endurance loiter)
  thrustBurn: 0.002, // extra fuel/sec at full demand (½ throttle + ½ climb)
  payloadBurn: 0.35, // a full bucket adds this fraction to the thrust term (heavy-lift premium)
  lowWarn: 0.2, // fuel gauge flashes below this (≈ the real "30-min reserve")
  refuelRadius: 26, // grounded/slow within this of the depot refuels
  refuelPerSec: 0.25, // tank fraction restored per second at the depot (full ≈ 4 s)
  refuelAgl: 16, // radar altitude (units) below which refuel can start
  refuelSpeed: 6, // airspeed (units/s) below which refuel can start
  starveSinkLift: -0.45, // forced collective when starved — engine cut, the heli can only sink
} as const;

// Wildlife (boreal fauna) — procedural low-poly animals that bring the map to life:
// moose/deer grazing the meadows + loons floating on the lakes. Counts scale with map
// AREA so density holds as the world grows; placed seeded + deterministically. Each is an
// individual (not instanced) mesh — there are only a handful — distance-culled like trees.
// Procedural now (zero-asset); the factory is the swap point for a CC0 glTF later.
export const FAUNA = {
  ungulatePer1000: 14, // moose+deer per (1000 units)² of land → sparse, like real encounters
  mooseFraction: 0.4, // share of ungulates that are moose (rest deer)
  loonsPerLake: 3, // waterfowl floating on each lake
  wanderSpeed: 1.6, // ground-animal stroll speed (units/s)
  turnRate: 0.5, // how fast a wandering animal changes heading (rad/s)
  grazeChance: 0.5, // fraction of the time a ground animal is grazing (head down, stationary)
  bob: 0.06, // idle vertical bob amplitude (units)
  loonDrift: 0.5, // loon paddle speed on the water (units/s)
  cullDist: 420, // hide animals beyond this from the camera (just inside the fog)
  minFromOrigin: 80, // keep wildlife off the player's spawn
} as const;

// --- Track B (visuals) ------------------------------------------------------

// Quality tiers (B0). One auto-detected preset scales every later visual phase;
// an adaptive frame-time watchdog can step DOWN a tier (cheap: DPR + shadows) if
// the device can't hold frame rate. Load-time-only fields (shadowMapSize,
// waterSegments) are read once at construction — changing them would recompile.
export const QUALITY = {
  presets: {
    // terrainSegments = grid resolution per side; higher = smoother carved SHORELINES
    // (the waterline reads jagged at low res). Water-disc edges (waterSegments) too.
    // bloom = post-process glow render scale: 0 off, 0.5 half-res (cheaper), 1 full-res.
    low: { name: 'low', dprCap: 1, shadows: false, shadowMapSize: 512, waterSegments: 96, terrainSegments: 140, bloom: 0 },
    med: { name: 'med', dprCap: 1.5, shadows: true, shadowMapSize: 1024, waterSegments: 160, terrainSegments: 190, bloom: 0.5 },
    high: { name: 'high', dprCap: 2, shadows: true, shadowMapSize: 2048, waterSegments: 224, terrainSegments: 248, bloom: 1 },
  },
  downgradeMs: 22, // EMA frame-time (≈45fps) above which we're "over budget"
  downgradeWindowSec: 2.5, // sustained over-budget time before stepping a tier down
  emaAlpha: 0.08, // smoothing on the frame-time average
} as const;

// Fire glow (Track B3). Bloom post-process makes the emissive flames + sun halo
// glow, and a fixed pool of hero point-lights throws warm light on the ground around
// the nearest fires (never added/removed → no shader recompiles, mobile-60fps safe).
export const POSTFX = {
  bloomStrength: 0.9, // overall glow intensity — tightened so the fire HALOES its white-hot seat
  // instead of blooming the whole orange flame into a soft glowing cloud (the "orange smoke" look)
  bloomRadius: 0.55, // glow spread
  // Only HDR pixels bloom: the emissive flames (emissiveIntensity up to 2.6) and the sun
  // core clear this, but the LDR sky/fog (luminance ~0.8) stays crisp — so the fires glow
  // without the horizon washing out. (EffectComposer keeps HDR in a half-float target.)
  bloomThreshold: 0.95, // raised: only the genuine white-hot core (HDR >1) blooms — the deep-orange
  // flame body and warm sky stay crisp, so the fire reads as defined flame, not a glowing haze
} as const;

// Volumetric god-rays / crepuscular shafts (Track B — golden-hour). A screen-space radial
// blur of the rendered scene TOWARD the low sun's projected position: bright sky near the sun
// streams into shafts that the smoke column + ridgelines OCCLUDE — the defining "light raking
// through haze" look of the reference image. Occlusion-free (no extra scene render): the dark
// geometry in the lit frame carves the shafts. Runs inside the post chain at the composer's
// (already tier-reduced) pixel ratio, so it's only active on med/high (low skips the composer
// entirely). `samples` is baked into the shader at load — no runtime recompiles. The one piece
// to frame-test on a real phone; if it ever costs too much, drop `samples` or gate to high only.
export const GODRAYS = {
  enabled: true,
  samples: 48, // ray-march steps from each pixel toward the sun (compile-time constant)
  density: 0.9, // how far along the screen-vector to the sun each march reaches (0..1)
  decay: 0.95, // per-step brightness falloff → shafts fade out with distance from the sun
  weight: 0.5, // per-sample contribution to the accumulated shaft
  exposure: 0.45, // overall shaft brightness added back onto the frame
  threshold: 0.5, // luma a sampled pixel must exceed to seed rays (dark geometry → no shaft)
  belowHorizonFade: 0.06, // sun-dir Y below which the rays fade out (sun set / behind a hill)
} as const;

// Cinematic color grade + lens (final ShaderPass after bloom/tonemap). The "lens" is where
// half of the Hollywood look lives: a teal-orange grade (cool shadows, warm highlights), a
// gentle vignette to frame the eye, and fine animated film grain to fuse the layers into one
// image. All tasteful/subtle — pushed too far it reads as a filter, not film.
export const GRADE = {
  warmHighlights: 0.06, // how far highlights push warm (orange)
  coolShadows: 0.05, // how far shadows push cool (teal)
  saturation: 1.08, // slight saturation lift (>1 richer, 1 = neutral)
  contrast: 1.05, // gentle S-curve contrast around mid grey
  vignette: 0.32, // edge darkening strength (0 = none)
  grain: 0.035, // film grain amount (animated per frame)
} as const;
export const FIRELIGHT = {
  count: 5, // pooled hero lights (repositioned to the nearest hot fires). Raised from 3 so a long
  // sustained fire LINE lays a continuous warm glow on the forest (the pool resizes once at load).
  color: 0xff7a26, // warm ember orange
  intensity: 140, // peak light intensity at a full-strength fire — stronger golden-hour ground glow
  distance: 80, // falloff radius (units)
  decay: 1.6, // physical-ish falloff
  heightOffset: 3, // sit the light a touch above the flame base
  flicker: 0.18, // ± intensity flicker fraction
} as const;

// Fire embers / sparks (cinematic layer) — pooled additive GPU Points streaming up off
// each blaze, tumbling in the wind, twinkling, and dying. HDR/additive so they feed the
// bloom. Fixed ring buffer (never grows → no recompiles). See vfx/Embers.ts.
// Fire embers / firebrands. Sparse glowing motes lofted off the blaze and CARRIED DOWNWIND
// (a wildfire lofts burning debris, it doesn't spray a roman-candle fountain). Tuned down from
// a bright twinkly geyser: fewer, dimmer, ember-red, and quickly raked downwind so they read as
// dangerous firebrands streaming off the flame front, not sparks shot into the air.
export const EMBERS = {
  max: 500, // pooled spark cap (ring buffer — recycles oldest)
  emitInterval: 0.08, // seconds between ember bursts (sparser)
  maxPerBurst: 3, // a small spot throws 1/burst; a full blaze up to this many
  rise: 6.5, // initial upward (buoyant) speed (units/s) — a low loft, not a fountain
  riseDamp: 1.0, // per-second cooling that bleeds the rise fast → the brand arcs over quickly
  gravity: 6, // downward accel (units/s^2) — once cooled, embers fall
  spread: 2.6, // lateral launch + drift spread (units/s) — tighter
  windInfluence: 15, // downwind drift the brand accelerates toward — STRONG: firebrands streak with the wind
  windCatch: 1.2, // how fast a brand is dragged to wind speed (per second) — caught quickly
  life: 2.2, // ember lifetime (seconds)
  size: 2.3, // base point size — small glowing motes, not bright blobs
  colorHot: 0xffae5a, // fresh = hot ember orange (not white — that read as sparks)
  colorCool: 0xd83208, // aged = deep ember red
  twinkleHz: 7, // per-ember flicker rate (slower, less "glinting spark")
  minHeat: 0.3, // only genuinely hot fires throw firebrands
} as const;

// Water shader (B1). A single shared ShaderMaterial (onBeforeCompile over Standard)
// across all lakes: animated normals, real depth-fade color (from a per-vertex water
// depth baked off World.groundHeightAt), fresnel sky tint, shoreline foam, and an
// 8-slot ripple ring fed by bucket dips + drop impacts. No planar reflection.
export const RIPPLE_SLOTS = 8; // FIXED uniform-array size — never changes (no recompiles)
export const WATER = {
  shallowColor: 0x52aec9, // near-shore tint
  deepColor: 0x1c5878, // deep-center tint (lightened so the middle isn't near-black)
  skyTint: 0x9fc6e0, // matches the sky color — fresnel fakes a reflection toward it
  foamColor: 0xcfe0e6, // soft pale blue-grey (was stark near-white, which read as grey streaks)
  foamStrength: 0.45, // MAX foam blend at the waterline (0..1) — shore stays watery, not a white rim
  depthRange: 7.0, // water depth (units) over which shallow→deep blends (gradual fade)
  foamWidth: 0.7, // shore band (units of depth) that foams — thin so it hugs the very edge
  waveAmp: 0.08, // vertical surface ripple amplitude (units) — tiny, keeps it reading flat
  waveScale: 0.12, // spatial frequency of the surface swell
  waveSpeed: 1.3, // swell scroll speed
  normalStrength: 0.34, // how hard the animated normals perturb lighting (0..1) — softened so
  // the wave gradients don't smear the sky-tint into white-grey streaks across the lake
  fresnelPower: 5.0, // tighter to grazing angles (less sky-tint creeping over open water)
  fresnelTint: 0.4, // how much sky color the fresnel paints in (was 0.6 — dialed back vs streaks)
  opacity: 0.9,
  // Sun glitter — a sharp specular sparkle path toward the sun, broken into points by the
  // wave normals so the lake twinkles under the sun (the highlights feed the bloom).
  sunGlitterColor: 0xfff1d6, // warm sun-white highlight
  glitterStrength: 0.7, // additive highlight gain at the glints
  glitterPower: 180, // specular sharpness — high = tight, sparkly points (not a broad sheen)
  // Ripple rings (bucket dip + drop splash)
  rippleSpeed: 14, // ring expansion (units/sec)
  rippleLife: 1.6, // seconds a ring lives
  rippleWidth: 1.6, // ring thickness (units)
  dipStrength: 0.45, // ring punch from a scooping bucket dip
  dropStrength: 0.9, // ring punch from a water drop impact
} as const;

// Drifting cloud shadows (atmosphere). Soft, broad shadow blobs scroll across the land AND
// water in the shared wind — the same animated noise sampled in both the terrain and water
// shaders (world XZ, drifting with FrameContext wind×time) so a shadow crosses seamlessly
// from a hillside onto a lake. Pure shader multiply — O(1)/frame, no recompiles, load-once.
export const CLOUDS = {
  scale: 0.0017, // world→noise frequency (smaller = broader cloud blobs)
  speed: 0.45, // how fast the shadows drift relative to the wind vector
  coverageLo: 0.46, // noise value where a shadow starts to form
  coverageHi: 0.74, // noise value of full shadow (between = soft penumbra)
  darken: 0.66, // a full cloud shadow multiplies the ground/water color to this (0..1)
} as const;

// Water-drop spray (the visible payload release). A pooled, fixed-size GPU Points
// cloud: while the DROP is held, droplets pour from the bucket mouth, fall under
// gravity (inheriting some heli velocity so the column smears forward), and die when
// they hit the surface below — over a lake that impact also spawns a ripple ring.
// Procedural soft disc in the fragment shader → zero textures, zero binary assets.
export const SPRAY = {
  max: 1000, // pooled particle cap (ring buffer — never grows, never recompiles). Big so the
  // dump reads as a dense WHITE CURTAIN/SHEET of water, not a scatter of droplets.
  perEmit: 28, // droplets spawned per emission while dropping — a thick, continuous column
  emitInterval: 0.016, // seconds between emissions while the drop is held (near every frame)
  speedDown: 16, // initial downward speed (units/s)
  spread: 4.0, // random lateral velocity spread (units/s) — tighter so it stays a column/sheet
  inherit: 0.55, // fraction of heli horizontal velocity carried into the spray
  gravity: 42, // downward accel (units/s^2) — water falls hard and fast
  life: 1.1, // particle lifetime (seconds) — also the impact fallback
  size: 5.0, // base point size — the fragment shapes each into a vertical streak
  color: 0xeaf7ff, // bright water-white
} as const;

// Smoke plumes (Track B4) — per-fire wildfire smoke. A single pooled GPU Points
// cloud (fixed ring buffer, one scene object, soft procedural puffs → zero textures):
// each active fire puffs particles from its crown that RISE, EXPAND, fade, and BEND
// downwind (accelerated toward the live wind vector), scaling with fire intensity.
// Restores the 2D smoke and reads great against the bloom + atmosphere.
export const SMOKE = {
  max: 1800, // pooled particle cap (ring buffer — recycles oldest, never grows). Raised so the
  // denser emission below sustains a TALLER, fuller column without recycling the base out from under it.
  emitInterval: 0.09, // seconds between puff bursts (shorter → a denser, more continuous column)
  rise: 16, // initial upward speed (units/s) — the column SHOOTS up
  riseDamp: 0.1, // per-second cooling that bleeds the rise (very low → it keeps climbing, towers ~200u)
  spread: 2.2, // initial random lateral speed (units/s)
  windInfluence: 9, // downwind drift the plume accelerates toward (units/s at full wind)
  windCatch: 0.55, // how fast a puff is dragged to wind speed (lower → a tall pillar that leans late, not a low smear)
  life: 18, // particle lifetime (seconds) — raised so the pillar towers higher (pyrocumulus reach)
  startSize: 9, // point size when fresh (a fat, dense base, not a thread)
  endSize: 90, // point size when fully aged — huge billows up high (pyrocumulus anvil)
  color: 0x26221e, // near-black charcoal — a DANGEROUS wildfire throws thick, oily black smoke
  // (the brown-grey before read as harmless campfire smoke). It greys/lightens only way up high.
  warmColor: 0xff5a14, // ember underglow: ONLY the freshest puffs at the seat are lit warm
  opacity: 0.72, // peak alpha (per puff, before soft-edge falloff) — thick, fully obscuring column
  minIntensity: 0.1, // fires dimmer than this don't smoke
  // Heat reactivity (C3.1): heat = fire intensity × size. A big, hot fire throws a taller,
  // bigger, DENSER, DARKER column that obscures the seat of the fire (so it's hard to
  // bomb accurately — read the wind, run in upwind). All scale per-puff off the puff's heat.
  maxPuffsPerBurst: 8, // a Class-A spot emits 1 puff/burst; a full blaze up to this many (denser — raised from 6)
  crownBase: 3, // smoke leaves the flame crown this low (units) at size 0 — boils right off the seat…
  crownPerSize: 15, // …plus this × size — a big fire's column starts high up the flame wall
  heatSize: 2.1, // extra puff size at full heat (×) — fat, billowing pyrocumulus over a big fire
  heatOpacity: 0.95, // extra alpha at full heat (×) — a big front's column reads thick/opaque
  heatDarken: 0.82, // darkens the puff toward black at full heat (0..1) — an oily, light-eating pillar
} as const;

// Heat haze / refraction (Track B4). The classic "this is HOT" shimmer: a subtle screen-space
// refraction over the rising hot air above each fire. A LATE post pass (after tonemap) warps the
// image UVs by panning value-noise, masked to a soft, UPWARD-biased lobe over the hottest on-screen
// fires (hot air rises, so the shimmer lives above the seat and tapers up the column). A FIXED-size
// uniform array (HAZE_SLOTS) → no shader recompiles; it lives inside the composer, so it auto-gates
// OFF on the low tier (which skips post entirely). Kept EXTREMELY subtle per real-time-VFX practice —
// pushed hard it reads as a water bubble, not heat. See postfx/HeatHaze.ts.
export const HAZE_SLOTS = 8; // FIXED uniform-array size (the hottest on-screen fires) — never changes
export const HAZE = {
  enabled: true,
  strength: 0.006, // MAX UV warp (screen fraction) at a fire's seat — subtle on purpose
  radiusWorld: 26, // world-space reach of the shimmer column, projected to a screen radius by distance
  riseHeight: 9, // how far above the fire crown the haze center sits (hot air rises) (units)
  noiseScale: 7.0, // spatial frequency of the refraction noise (screen space × aspect)
  noiseSpeed: 1.4, // how fast the shimmer churns upward
  minHeat: 0.25, // fires cooler than this (intensity × size) don't shimmer
  maxRadius: 0.3, // clamp the screen radius so a very close fire doesn't warp the whole frame
} as const;

// Audio (procedural, zero assets — built live with the Web Audio API; see
// audio/HeliAudio.ts). The rotor is a CONSTANT drone with the two-blade Huey
// "wop-wop" blade slap — NOT a car engine. The blade-pass pulse RATE never tracks
// the throttle; only the slap DEPTH (chop intensity) swells as the aircraft works
// harder (climbing / turning / fast). Frequencies here are fixed on purpose.
export const AUDIO = {
  masterVolume: 0.55, // overall ceiling
  fadeInSec: 0.9, // master fade when audio first unlocks (first user gesture)
  paramEaseSec: 0.14, // smoothing time for dynamic param changes (kills zipper noise)

  // Rotor wash — the constant bed of moving air (lowpassed noise).
  washHz: 540, // lowpass cutoff of the wash bed
  washVolume: 0.16,
  washBrighten: 160, // extra cutoff (Hz) added at full speed (more air rush)

  // Blade slap — the iconic "whomp-whomp." Periodic amplitude pulse of a low
  // noise band at the 2-blade blade-pass rate. The RATE is constant.
  bladePassHz: 10.6, // pulse rate — STAYS CONSTANT (the anti-"car-engine" rule)
  slapBandHz: 185, // bandpass center of the thump body
  slapBandQ: 1.3,
  slapSharpness: 2.6, // >1 peaks the pulse into a "whomp" instead of a smooth tremolo
  slapFloor: 0.06, // always-present chop floor under the pulse
  slapDepthIdle: 0.16, // pulse depth at rest
  slapDepthLoad: 0.36, // pulse depth working hard (climb/turn/speed)
  slapVolume: 0.5,

  // Turbine whine — a steady high tone sitting under everything.
  turbineHz: 615,
  turbineVolume: 0.05,

  // Tail rotor — a subtle fast flutter buzz, high and quiet.
  tailHz: 1500, // bandpass center
  tailFlutterHz: 47, // flutter (tremolo) rate
  tailFloor: 0.25,
  tailVolume: 0.05,

  // One-shots
  scoopVolume: 0.45,
  dropVolume: 0.5,
  winVolume: 0.4,
} as const;

// Chase camera: trails behind the heading, lifted up, looking slightly ahead —
// the Forza/GTA follow-cam. Lerped so it eases rather than snapping.
export const CAMERA = {
  fov: 60,
  distance: 28, // how far behind the heli
  height: 15, // how far above
  lookAhead: 10, // aim point ahead of the nose
  posLerp: 0.08, // position smoothing (per 60fps frame)
  lookLerp: 0.12, // aim smoothing
  minGroundClearance: 8, // never let the cam dip below the ground at its XZ + this
  // Free-look ("eye" button): drag = orbit VELOCITY (not distance), so holding it
  // spins the camera continuously — a full 360° either way — and a tiny drag is
  // enough (the button can sit near the screen edge). Release eases back to default.
  lookYawRate: 2.4, // rad/sec orbit speed at full deflection (~360° in 2.6s), unbounded
  lookPitchRate: 1.6, // rad/sec vertical orbit speed at full deflection
  lookPitchMin: -0.45, // lowest the cam tilts (below the heli, looking up) — radians
  lookPitchMax: 1.15, // highest the cam tilts (overhead, looking down) — radians
  lookPadRadius: 46, // px of drag from the eye button that maps to full orbit speed
  lookReturnLerp: 0.1, // how fast the view eases back to default on release (per 60fps frame)
};
