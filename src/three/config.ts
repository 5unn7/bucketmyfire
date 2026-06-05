// Central tuning for the 3D build. The world is a real Y-up scene now: the
// helicopter flies in the XZ plane with altitude along +Y. Values are in world
// units (the terrain spans ~600 units; the aircraft is ~8 units long), retuned
// down from the old 2D pixel scale but preserving the same momentum "feel".

export const WORLD3D = {
  size: 2100, // square terrain extent, centered at origin — ENLARGED 1500→2100 so the big lakes stop eating
  // the land (anchors spread ~1.4× further apart, lakes keep their absolute size → more dry ground, esp. La
  // Ronge). A side crossing is now ~70s at cruise (the map feels large). lakes/trees/fire-grid scale with this.
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

// Real-world map projection + lake sizing (anchored maps like Saskatchewan). Anchors carry REAL
// latitude/longitude; World projects them with a cosine ("sinusoidal") projection so true distances
// AND the province's converging-meridian trapezoid (wider south, narrower north) come out right — see
// world/regions.ts `geo` + `outline`. The province is scaled to fill `fill` of the square world's
// height; everything outside the border (E/W margins, the open south reserved for v2) is off-province
// wilderness, muted on the radar so the map reads as Saskatchewan rather than a filled square.
export const MAPGEO = {
  fill: 0.93, // province N–S extent fills this fraction of the square world height (leaves a rim margin)
  // Lake radius from REAL surface area (km²), compressed onto a playable band: radius = lerp(minR,maxR,t),
  // t = (√area − √areaMin)/(√areaMax − √areaMin) clamped 0..1. √area ∝ linear size, so a giant (Reindeer,
  // ~6650 km²) reads huge while a small lake stays scoopable — at true province scale a to-scale lake
  // would be an unscoopable dot, so the band trades literal scale for the right RELATIVE feel.
  lakeMinR: 30, // smallest scoop-lake radius (units) — still scoopable, but leaves more dry ground: the boreal
  // river-widening lakes that ring La Ronge floor here, so a lower floor opens up land between them
  lakeMaxR: 105, // largest (Athabasca-class) lake radius — TRIMMED 135→105 so the giants stop dominating the
  // (now larger) world; with the 2100u map the big lakes read big but no longer swallow the land around them
  lakeAreaMin: 30, // km² — areas at/below this map to lakeMinR
  lakeAreaMax: 7850, // km² — areas at/above this map to lakeMaxR (Lake Athabasca, the province's largest)
  lakeAreaDefault: 28, // km² assumed for anchor lakes with no published area (recreational river widenings) —
  // kept small so the unpublished Churchill-chain widenings near La Ronge stay tight and leave land between them
  // The map's ONE real-elevation↔world-unit vertical scale: terrain reliefs and region uplands are authored in
  // REAL metres and divided by this. Anchored so TERRAIN.baseAmplitude (9u) ≈ the shield's ~100 m of rolling
  // relief → ~11 m/unit; the SAME scale converts an upland's real prominence (Cypress Hills ≈ 590 m → ~54u).
  // Horizontal already has its scale (uPerKm, from the projection); this is its vertical companion, so an
  // upland is REAL data (km + m) through consistent scales — not hand-picked world units.
  metresPerUnit: 11,
} as const;

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

// Forest realism (photoreal pass). The boreal canopy is the dominant low-poly "tell" from the
// chase cam, so this block makes the conifers FULLER + DENSER and bakes a vertical light gradient
// into each crown (dark, self-shadowed base → sun-caught tips) for depth — all without leaving the
// instanced / chunked / distance-LOD / burnable machinery in meshes/trees.ts. DENSITY is the single
// biggest realism lever; it is tier-gated in Game.ts (low-end devices keep the original count) and
// the existing per-chunk frustum cull + distance LOD + the DPR watchdog hold 60fps. Revert to the
// old stylized look in one place: densityMul 1, canopyTiers 3, aoGradient 0, topLift 1.
export const FOREST = {
  baseCandidates: 3200, // tree candidates at the 600u reference size (Game scales by world AREA). TRIMMED from
  // the old hard-coded 5200 so the enlarged 2100u world doesn't 2× the tree load — fewer trees = some perf back
  // AND a more open landscape (lower canopy density over more land), which is part of the "more land" goal.
  densityMul: 2.0, // candidate-count multiplier on med/high (forest fullness) — low tier stays at 1
  canopyTiers: 6, // overlapping cone tiers per conifer (was 3) — a fuller, denser spruce silhouette
  radialSegments: 8, // near-LOD canopy roundness (was 7) — a rounder crown up close
  bottomRadius: 1.75, // widest (lowest) tier radius — a broader, more grounded base (old fixed: 1.5)
  topRadius: 0.42, // narrowest (apex) tier radius — a finer point
  aoGradient: 0.5, // how dark the crown BASE is vs the tips (0 = flat/old look, 1 = black base) — fakes self-shadow/AO
  topLift: 1.15, // brightness multiplier at the sun-caught apex (1 = no lift)
  gradientJitter: 0.08, // subtle per-vertex brightness noise so the needles don't read as a smooth ramp
} as const;

// Flight model — momentum integrator with helicopter-style steering: the pilot
// yaws the nose directly and applies variable throttle ALONG it; thrust adds to
// velocity, drag bleeds it, speed is capped, and the airframe banks into turns /
// pitches with the throttle. Altitude (collective) carries its own inertia so
// climbs/descents feel weighty.
export const FLIGHT = {
  enginePower: 105, // horizontal thrust (units/s^2) in the input direction (lowered with maxSpeed so
  // the build-up to cruise stays weighty instead of snapping straight to the lower cap)
  linearDrag: 1.1, // horizontal air resistance — the ONLY thing decelerating the craft once you let off
  // throttle (there's no brake), so this is the "coast on release" lever. LOWERED from 1.6: releasing
  // forward now carries momentum and glides out (~2s to bleed off) instead of stopping quick. Higher =
  // settles faster / less drift through turns; lower = floatier, skates more. Per-heli dragMul scales it
  // (the Black Hawk already coasts further).
  maxSpeed: 30, // horizontal AIRSPEED cap (units/s). LOWERED from 41 so the whole game flies SLOWER:
  // at this pace you maneuver more, so the per-heli handling spread (the docile, precise 205 vs the
  // fast, slippery Black Hawk) actually READS instead of blurring together at speed. A world-diagonal
  // crossing is now ~70s. The kt calibration (INSTRUMENTS.topSpeedKt) tracks this cap, lowered with it.
  // Wind blows the airframe over the ground: ground velocity = airspeed + wind, so a
  // headwind cuts your ground speed (you crawl into it) and a tailwind shoves you
  // along — a light heli gets pushed around. Scales the unit Wind vector to units/s.
  windSpeed: 6, // world units/s of drift at full wind strength (scaled down with maxSpeed so wind's
  // pull RELATIVE to airspeed is unchanged — it still nudges, doesn't shove)
  windHoldSpeed: 9, // airspeed (units/s) below which wind fades out → a hover holds station
  // (so releasing the stick doesn't let the wind carry you away)
  // Helicopter-style steering: the stick TURNS the nose (yawRate) and pushes
  // forward/back along it (variable throttle). The nose no longer chases velocity.
  yawRate: 1, // turn rate (rad/s, ~97°/s) at full left/right stick
  reversePower: 0.5, // backward thrust fraction — flying tail-first is slower
  // Raw turn/throttle/collective input is eased toward (this) per-60fps factor before
  // it drives yaw, thrust and climb, so a key tap or stick flick ramps in and rolls
  // out instead of snapping — the main lever for how SMOOTH the flight transitions
  // feel. Lower = smoother/floatier, higher = snappier/more direct (1 = no smoothing).
  // (The collective ALSO has its own velocity inertia below, collectiveResponse — the
  // two cascade into a soft S-curve climb/descent rather than a single-lag jerk.)
  controlResponse: 0.16,
  // --- Body attitude (acceleration-driven, like a real airframe) ---
  // The fuselage tilts toward its acceleration: dive to speed up, flare to brake,
  // bank into turns. These cap how far it leans and how persistently it cruises
  // nose-down. See the attitude block in HelicopterSim.update().
  maxBank: 1.0, // radians of roll at full lateral (turn) acceleration (RAISED 0.8→1.0 for aerobatic banks ~57°)
  maxPitch: 0.42, // radians of dive/flare at full fore/aft acceleration (LOWERED 0.62→0.42 ≈ 24°: full throttle
  // used to snap the nose 35° down and — via the pitchThrust feedback below — plunge + porpoise ("see-saw").
  // This caps ONLY the acceleration-driven tilt; the commanded dive-bomb (diveCommand) is bounded by maxPitchHard, untouched.
  cruisePitch: 0.14, // extra persistent nose-down at top speed (disc tilted to hold cruise)
  bodyEase: 0.13, // how fast bank/pitch ease toward their targets (RAISED 0.1→0.13 — snappier aerobatic roll-in; lower = softer/heavier)
  attitudeAccelSmoothing: 0.2, // EMA (per-60fps factor) on the acceleration that drives the nose-tilt/bank, BEFORE
  // it leans the airframe. The raw per-frame accel spikes on a throttle slam and at the speed cap, and since
  // nose-down feeds more thrust (pitchThrust), the unfiltered loop porpoises. Lower = smoother/laggier lean (kills
  // the see-saw); 1 = the old raw, twitchy behavior. The commanded dive-bomb/steer-bank bypass this entirely.
  // --- Direct pilot attitude authority (AEROBATICS) — leans the airframe on the STICK,
  // not just as a side effect of accelerating. This is what turns "it banks a little in a
  // turn" into "I can throw it into a hard banked turn and dive-bomb a fire on command."
  // Added on TOP of the acceleration-driven bank/pitch above, then clamped to the *Hard caps. ---
  steerBank: 0.55, // radians of roll commanded directly by full turn stick (a real banked turn even at modest speed)
  steerBankIdle: 0.35, // fraction of steerBank still present at a standstill (so a low-speed turn still drops a wing; full at cruise)
  diveCommand: 0.6, // radians of nose-down commanded by full DOWN collective AT TOP SPEED — the dive-bomb tuck. The pitch→motion
  // coupling (pitchThrust/pitchDive) then turns that nose-down into a real surging, sinking swoop; haul UP collective to flare out.
  // Scaled by forward speed, so easing straight down onto a lake to scoop barely noses over (only a fast forward descent dives).
  maxBankHard: 1.25, // hard clamp on TOTAL roll (~72°) so accel + stick combined can't tumble the airframe past a sane lean
  maxPitchHard: 0.95, // hard clamp on TOTAL pitch (~54°) — bounds the steepest dive/flare
  // --- Pitch → motion coupling (cyclic-forward): the nose-down disc drives REAL flight,
  // not just a cosmetic tilt. Tucking the nose tilts the thrust vector forward and down,
  // so a dive surges AND descends — and a committed dive can outrun level cruise. Pull UP
  // collective to flare out of it. Raise these for a more aggressive, weightier dive.
  pitchThrust: 92, // extra forward accel (units/s^2) per radian of nose-down disc — the speed surge (RAISED 66→92:
  // a committed dive bomb really gets away from you, scaled to stay proportional to the slower cruise)
  pitchDive: 50, // sink rate (units/s) per radian of nose-down BEYOND the cruise trim — the descent (RAISED 36→50 for a steeper plunge)
  diveSpeedBoost: 0.42, // top-speed cap raised by up to this fraction in a full committed dive (RAISED 0.28→0.42 — the dive outruns cruise)
  // Collective: the pilot raises/lowers altitude directly. To scoop you simply
  // descend over a lake until the slung bucket dips into the water (no scoop
  // button — the fill is physical). Vertical speed EASES in (rotor inertia) instead
  // of snapping, and the ease is now framerate-independent.
  climbSpeed: 16, // max climb rate (units/s) at full UP collective, empty bucket. LOWERED from 22 —
  // the old rate felt too quick/twitchy; a gentler ceiling makes holding altitude and easing
  // over a ridge feel deliberate. Full-ceiling climbs just take a little longer (you rarely go high).
  descendSpeed: 18, // max descent rate (units/s) at full DOWN collective (weight assists — no payload cut).
  // LOWERED from 24 to match the calmer climb — descents settle in instead of dropping out from under you.
  collectiveResponse: 0.06, // vertical inertia: lower = heavier/slower to spool up & down (per-60fps factor).
  // Nudged down from 0.07 so the climb/descent rate eases in a touch more gently (pairs with the new
  // collective input smoothing — see controlResponse above).
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
  maxClearance: 444, // ceiling above the floor at full climb → 2000 ft at ~4.5 ft/unit (LOWERED from
  // 555/2500 ft — keep INSTRUMENTS.ceilingFt in lockstep so the altimeter scale stays right). A tall
  // band you can climb into; normal flying stays low near the floor.
  startClearance: 111, // AGL the QA / autostart spawn drops you in at (≈ 500 ft) — comfortably airborne
  // in the working band, NOT pinned to the ceiling like before (which read as "starts at 2500 ft").
  canopyClearance: 8, // land floor = ground + this — keeps the rotor disc above the canopy
  scoopClearance: 2, // water floor = waterLevel + this — low enough that the slung bucket dips under
  // Landing pad (cold start): right around the base helipad the flight floor eases DOWN from the full
  // canopy clearance to this, so the heli rests ON the pad (skids down) and lifts off without snapping
  // up to canopy height. Blended over `padBlendRadius` units around the pad; beyond that the floor is
  // the usual canopy/scoop clearance — so this only affects the cleared base, not the bush.
  landClearance: 0.35, // floor clearance on the pad → the skids rest on the deck
  padBlendRadius: 26, // units over which the floor eases from the pad up to the normal flight floor

  // --- Weight coupling: a full bucket flies heavy and sluggish, recovers on drop ---
  // Each penalty is the fraction shaved off the parameter at a full (ratio = 1) bucket.
  payloadAccelPenalty: 0.35, // engine thrust loss when loaded
  payloadSpeedPenalty: 0.18, // top-speed loss when loaded → 80 kt empty drops to ~66 kt full
  payloadClimbPenalty: 0.4, // climb-rate loss when loaded — the main "heavy to fly" effect
  // A full bucket sags DOWN only slightly — it doesn't auto-descend, it just settles
  // a touch at neutral collective and takes longer to spool the climb (responsePenalty).
  // The heavy feel comes mostly from the climb/accel/speed penalties, not this. Fades
  // as water drains.
  payloadSink: 1.5, // gentle downward drift (units/s) at a full bucket (small on purpose)
  payloadResponsePenalty: 0.5, // fraction of vertical responsiveness lost when full (laggier collective)
};

// Cold engine start. Every mission begins shut down ON THE DECK at the base: the pilot HOLDS the
// START dial to spool the main rotor from rest to full RPM before the aircraft will fly. Flight and
// the mission clock stay frozen until the rotors are up (the authored 'start' radio beat fires the
// instant they are), and the rotor visuals + the audio drone both scale by the live RPM so the disc
// and the sound wind up together. Release the dial early and the RPM bleeds back down — you must
// hold continuously. Headless QA (?qa / ?autostart) skips the ritual and flies immediately.
export const STARTUP = {
  holdSeconds: 7, // continuous hold on START to bring the rotor from 0 → full RPM (matches the 7s engine-start clip, audio/HeliAudio.ts)
  spinDownSeconds: 3, // RPM bleeds back toward 0 over this long when START is released before full
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
// tuned there); the HUD converts to real-world numbers for a light helicopter
// (AS350-class): 80 kt empty / ~66 kt full airspeed, 2000 ft ceiling. The factors
// are derived from the FLIGHT caps so changing those keeps the gauges consistent.
export const INSTRUMENTS = {
  topSpeedKt: 80, // empty FLIGHT.maxSpeed maps to this on the airspeed tape (lowered WITH maxSpeed,
  // 41→30, keeping the world→kt scale constant so the slower aircraft reads honestly; the faster
  // Black Hawk still tapes well above this)
  ceilingFt: 2000, // top of the AGL band (FLIGHT.maxClearance) maps to this on the altimeter (LOWERED
  // from 2500 with maxClearance 555→444 — same ~4.5 ft/unit scale, just a lower cap)
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
  dropRadius: 30, // world units a drop douses around the bucket — WIDE + forgiving (was 20): a near-miss or
  // a swung bucket still lands meaningful water on the fire, so you don't have to hover dead-on. Per-cell
  // potency is unchanged (the douse dilute term scales with this), it just covers ~2× the area → a typical
  // fire clears in 1–2 passes. The predicted-impact ring mirrors this exactly, so what you aim is what hits.
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
  // --- Parked-on-the-ground pose (cold start / landed) ---
  // When the heli is sitting on the pad the slung bucket isn't dangling under the belly — a ground
  // crew lays it out on the deck just ahead of the nose, line slack. While the heli's AGL is below
  // `parkAgl`, Game parks the bucket `parkAhead` units in front of the nose (upright, no swing) and
  // hands back to the pendulum once it lifts off.
  parkAhead: 6.5, // units ahead of the nose the bucket rests while landed
  parkAgl: 1.6, // park the slung load while the heli is within this AGL of the pad (i.e. on the ground)
  groundDrag: 7, // horizontal velocity bled/sec while in contact (the scrape) — higher = grabbier
  grabDepth: 4, // penetration (units) at which contact drag DOUBLES — a tall canopy grabs hard
  spillDragMin: 4, // drag speed (units/s) below which a scrape is gentle enough not to slop water
  spillPerDrag: 0.5, // litres slopped per (unit/s) of drag speed, per second, while scraping with water
};

// --- Water-drop physical model (height → footprint, wind drift) ----------------------------------
// A drop's effect now depends on HOW HIGH and into WHAT WIND it was released. Read by the shared
// resolveDrop() helper in Game (which has World access for the bucket's AGL); the resolved center +
// radius + density feed FireSystem.douse, the spray sheet, the ripples, and the predicted-impact
// ring — ONE source of truth so what the player sees is what actually hits.
export const DROP_PHYSICS = {
  // Height band (bucket AGL, units). One-sided: full strength at/below bandHi (a deck dump is never
  // wrongly nerfed); only ABOVE the band does the load spread thin + weak.
  bandHi: 90, // top of the sweet spot (raised 70 → 90): at/below this bucket-AGL density=1, radius≈dropRadius —
  // a WIDE in-band window so you don't have to nail a precise low altitude; a normal-height run still bites full.
  ceilAGL: 200, // at/above here the load is mist: min density, max spread // ~900ft — you SEE it drift, it does ~nothing
  // Footprint growth with height (multipliers on BUCKET3D.dropRadius).
  tightRadiusMul: 0.9, // radius mult on the deck — a tight, dense splash (0.9·30≈27u)
  wideRadiusMul: 1.7, // radius mult at/above ceilAGL — a wider thin veil (1.7·30≈51u), but still realistic
  // Effectiveness (per-litre density) above the band.
  minDensityMul: 0.2, // density at ceilAGL — mist does ~20% per-litre work (eased 0.12 → 0.2 so a high drop is weak, not useless)
  areaFalloff: 1.0, // 0 = density-only high penalty, 1 = full 1/areaRatio per-cell dilution as the disc widens
  // Radial coverage within the disc (EDGE falloff): water peaks at center, tapers to the rim.
  edgeFloor: 0.45, // min coverage at the very rim (0..1) — a near-miss / edge clip still lands REAL water
  // (rim ≈ half the center, not 1/8th): you don't have to be pixel-perfect, but dead-on is still best
  coverWetFloor: 0.6, // FLOOR on the wet-firebreak coverage — keep the HOLDING LINE broad even on edge hits
  // (decouples "edge doesn't extinguish" — good — from "edge doesn't hold a line" — a separate, riskier nerf)
  // Intensity resistance (DEAD-ON-HOT): a hotter cell absorbs less knock per litre → multiple passes.
  hotResist: 0.2, // diminishing-returns strength (0=flat/old, 1=max). Eased 0.4 → 0.2 so a hot crown cell
  // no longer shrugs off water — a dead-on full pass drives even a max-heat cell to 0 (extinguish, don't grind).
  hotResistFloor: 0.3, // least a fully-hot cell is knocked vs flat — hot cells still take real damage, just resist
  // A cell whose heat a drop knocks to/below this is OUT for good: it drops to 0 and SCORCHES to mud (locked —
  // a doused-out cell can't re-light). This is what makes a fire reliably SHRINK as you bucket it and turns the
  // orange ground BLACK, instead of leaving a faint re-flaring ember. Above the lock (edge clip / thin high drop)
  // a cell keeps its heat and re-flares (slowly, per FIRE3D.cellRegrow). Set ≈ the lowest live heat that still reads.
  extinguishLock: 0.3,
  // Wind drift of the impact point (falling water is carried downwind; more the higher you drop).
  fallG: 42, // gravity (u/s²) for fall-TIME only. = SPRAY.gravity so the douse offset & the visible spray fall in lockstep
  v0Down: 16, // initial downward droplet speed (= SPRAY.speedDown) for the exact fall-time form
  windDriftGain: 4.0, // world u/s of horizontal drift per 1.0 wind.strength — eased so wind nudges the drop
  // off target without yanking it off the fire (you still lead into the wind, but a calm drop lands true)
  windDriftMax: 22.0, // hard clamp on total drift (≈0.85·dropRadius) so a centered drop can still partially connect
  minDriftAgl: 2.0, // below this AGL fall-time≈0 → no drift (avoids sqrt noise when the bucket scrapes the canopy)
} as const;

// --- Drop feedback (predicted-impact ring + post-drop readout) — VISUAL/UX only, never feeds the sim.
export const DROP_FX = {
  ringScale: 0.65, // the predicted-impact RING is drawn at this fraction of the douse footprint radius — a tighter,
  // less cluttered reticle that marks the DENSE CORE of the splash (where coverage peaks). Water still lands across
  // the full, wider footprint, tapering to the rim (DROP_PHYSICS.edgeFloor) — so the ring under-shows the splash
  // (the forgiving direction: you always soak at least the ring). VISUAL ONLY — never feeds the douse.
  markerShowAGL: 110, // show the predicted ring only below this bucket AGL (raised with the wider in-band window) // above = cruising, no clutter
  markerColorInBand: 0x49e0a0, // green-cyan: this drop will bite
  markerColorTooHigh: 0xffb24a, // amber: weak/dispersed (matches the existing crew-toast amber)
  markerColorWide: 0xff5a5a, // red: predicted center far from any live fire — you'll miss
  markerWideDist: 42, // units from the nearest live fire beyond which the ring reads as a MISS (red) — raised with
  // the wider dropRadius so the ring only warns "you'll miss" when the bigger splash genuinely won't reach the fire
  markerHideDist: 180, // no active fire within this of the predicted center → hide the ring (not on a run)
  markerMinOpacity: 0.18, // floor opacity (too-high fades toward this)
  markerMaxOpacity: 0.75, // in-band opacity — bright = confident
  markerLift: 0.4, // raise the decal above terrain to avoid z-fight
  resultDirectFrac: 0.45, // heatRemoved/heatPresent at/above which a drop is a "Direct hit"
  resultEdgeFrac: 0.12, // below direct, above this = "Edge only"
  resultTooHighEff: 0.5, // average density below which the readout calls it "Too high — dispersed"
  resultGaugeTintMs: 1100, // ms the water gauge flashes its result color
} as const;

// --- Fire HEAD marker ("where do I drop?") — a hot, pulsing chevron on each fire's advancing
// (downwind) edge so a player can read the HEAD — the part worth hitting — apart from the flanks and
// the burned-out heel. The chevron POINTS the way the fire is running, and the strongest head is the
// brightest, so the priority drop zone reads at a glance. Pooled GPU meshes (vfx/FireHeadMarkers). ---
export const FIREHEAD = {
  minHeat: 0.18, // a fire must be at least this hot (intensity×size) to mark a head (skip dying embers)
  color: 0xffd24a, // hot amber-white — distinct from the green drop ring; reads as "the live head"
  lead: 12, // how far downwind of the fire centre the chevron sits (units) at full size + full wind
  sizeBase: 6, // chevron size (units) at size class 0
  sizePerSize: 11, // + this × the fire's size class — a big blaze gets a bigger head marker
  lift: 0.5, // height above the ground (avoid z-fight on slopes)
  baseOpacity: 0.85, // peak opacity of the STRONGEST head
  minOpacityFrac: 0.35, // a weaker head dims to this fraction of baseOpacity, so the MAIN head pops
  pulseHz: 2.0, // pulse rate (Hz) — a live, attention-drawing throb
  pulseDepth: 0.35, // how deep the pulse modulates opacity (0 = steady, 1 = full blink)
} as const;

// --- Per-helicopter classes (the "feel" + payload + durability of each airframe) ----------
// All three playable helis used to SHARE the FLIGHT/BUCKET3D tuning — selecting one only swapped
// the mesh. A `HeliClass` gives each its own character: the base FLIGHT/BUCKET3D numbers are
// calibrated to the hero Bell 205A-1, so the 205 is all-1.0 BASELINE and the others scale RELATIVE
// to it (multipliers applied at point-of-use in HelicopterSim; payload penalties still stack on top).
// Absolute fields (capacity/fillRate/toughness) replace the shared BUCKET3D constants for that heli.
//   - Bell 205A-1 : the trainer — simplest/most forgiving, slowest, smallest bucket (the baseline).
//   - Bell 212    : medium across the board.
//   - UH-60       : supreme but a HANDFUL — fastest, biggest bucket (2× the 205), toughest airframe,
//                   but hard to control (twitchy yaw + LOW drag = lots of momentum → it overshoots).
export interface HeliClass {
  id: string;
  // --- Bucket payload (absolute) ---
  capacity: number; // litres the bucket holds (205 = half the Black Hawk)
  fillRate: number; // litres/sec while scooping (a bigger bucket fills a touch slower)
  // --- Flight feel (multipliers over FLIGHT.*) ---
  powerMul: number; // enginePower (horizontal accel)
  speedMul: number; // maxSpeed top-speed cap (205 is the slowest)
  climbMul: number; // climbSpeed
  yawMul: number; // yawRate — HIGH = the nose whips around (twitchy)
  dragMul: number; // linearDrag — LOW = carries momentum/overshoots → "hard to control/place"
  controlMul: number; // controlResponse input smoothing — LOW = floatier/laggier to place precisely
  collectiveMul: number; // collectiveResponse — LOW = heavier/laggier vertical
  // --- Airframe ---
  toughness: number; // divides incoming health damage (HIGH = a durable airframe)
}

export const HELI_CLASSES: Record<string, HeliClass> = {
  'bell-205a1': {
    id: 'bell-205a1', capacity: 100, fillRate: 45,
    powerMul: 1.0, speedMul: 1.0, climbMul: 1.0, yawMul: 1.0, dragMul: 1.0, controlMul: 1.0, collectiveMul: 1.0,
    toughness: 1.0,
  },
  'bell-212': {
    id: 'bell-212', capacity: 150, fillRate: 55,
    powerMul: 1.15, speedMul: 1.12, climbMul: 1.1, yawMul: 1.05, dragMul: 0.92, controlMul: 0.95, collectiveMul: 0.95,
    toughness: 1.15,
  },
  'uh-60': {
    id: 'uh-60', capacity: 200, fillRate: 70,
    powerMul: 1.4, speedMul: 1.34, climbMul: 1.25, yawMul: 1.25, dragMul: 0.78, controlMul: 0.82, collectiveMul: 0.82,
    toughness: 1.3,
  },
};

/** Resolve a heli's class; unknown/undefined → the 205A-1 baseline (mirrors swapInModel's fallback). */
export function resolveHeliClass(id?: string): HeliClass {
  return HELI_CLASSES[id ?? ''] ?? HELI_CLASSES['bell-205a1'];
}

// Airframe health / damage. Hull integrity is an IMPACT model only: the heli takes damage solely from
// slamming down (a hard landing past `hardLandingSink`); at zero health it CRASHES (instant mission
// fail), and it REPAIRS at any base (alongside refuel). Flying through fire / overspeed / scraping the
// bucket no longer cooks the airframe — FUEL is the resource that ticks down and sends you back to base
// (see MISSIONS + FuelSim). Per-heli `toughness` (HELI_CLASSES) divides the impact. Engine-agnostic
// state lives in sim/HealthSim.ts (numbers only, like FuelSim). Tuned FORGIVING: normal landings and
// every refuel touchdown cost nothing — only a genuine high-sink crash dents the hull.
export const HEALTH = {
  lowWarn: 0.3, // health gauge flashes below this
  hardLandingSink: 14, // sink rate (units/s) a floor contact must beat to be a SAFE settle (no damage)
  impactDmgPerUnit: 0.05, // health lost per (unit/s) of sink ABOVE hardLandingSink on a hard landing
  repairPerSec: 0.1, // health/sec restored at a base (slower than refuel — no free instant patch)
} as const;

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
  fireCells: 160, // grid resolution per side (160² over the 2100u map ≈ 13.1u cells — bumped 128→160 so the
  // bigger world keeps fire fronts about as crisp as before; the forest cut below funds the extra grid cost)
  blobCells: 24, // coarse grid the field is clustered into → up to maxActive rendered "fires"
  seedHeat: 0.2, // heat a freshly-ignited cell starts at (0..1) — a weak lick that must build
  seedRadius: 1, // radius (cells) of the disc lit when a fire is seeded/spotted — start as a SPOT
  cellRegrow: 0.03, // heat/sec a burning cell climbs toward its fuel ceiling — kept VERY LOW so a fire
  // barely re-heats: a cell you knock down but don't fully clear creeps back only slowly, so dousing makes
  // monotonic progress instead of racing a re-flare, and a fresh ignition builds gradually. (A wet cell's
  // regrow is near-frozen on top of this via wetRegrowSuppress below.) Established blazes still START hot —
  // missions seed them at an explicit per-size-class heat (scenario SIZE_CLASS), this only governs re-climb.
  cellBurnRate: 0, // fuel/sec a cell consumes at full heat. 0 = fires NEVER self-extinguish: a fire
  // burns until the PLAYER waters it out (you can't win by waiting). Kept as a lever — raise it to let
  // neglected fronts slowly starve again, but the design intent now is a persistent, player-fought blaze.
  cellSmolderFloor: 0.3, // min fraction of burn consumed when barely lit (only matters if cellBurnRate>0)
  charHeat: 0.5, // a cell must burn at least this hot to start charring its ground (the scar)
  charTime: 22, // seconds of hot burning before the ground blackens → `scorch` (visual scar; trails the front)
  // A doused-but-still-lit cell's regrow is suppressed while its ground is WET (set by a drop):
  // the knockdown HOLDS for ~the firebreak cooldown, then re-flares as it dries — so water is a
  // tactical holding action on a big blaze (knock the head, re-hit or cut a line), not a delete
  // button. A young/cool cell still dies outright in one good drop. (Track C — suppression depth.)
  wetRegrowSuppress: 0.85, // fraction of regrow removed in a fully-wet cell (0 = no effect, 1 = frozen)
  // Spread is SLOW and DIRECTIONAL: a creeping flank, a faster head running downwind. Base
  // time-to-ignite ≈ igniteThreshold / (spreadRate·heat·weight) − preheat decay, so these two
  // set the creep. These are the CALM BASELINE (eased hard — "spread was insane"): flat/no-wind
  // ≈ a cell every ~11s (~1 u/s); downwind head ≈ ~4s (~3 u/s). Each MISSION then dials the pace
  // up or down with `fire.spreadScale` (catalog.ts → FireSystem) — a near-static tutorial spot at
  // 0.25, a screaming firestorm at 1.3 — so spread is tuned PER MISSION instead of one hot rate.
  spreadRate: 0.2, // pre-heat deposited per (neighbour · heat · sec) — lower = slower creep (eased 0.34 → 0.2)
  igniteThreshold: 1.7, // pre-heat a cell must accumulate before it ignites — higher = slower (raised 1.25 → 1.7)
  preheatDecay: 0.34, // per-sec bleed of un-ignited pre-heat (raised: a stalled flank cools off faster, so creep dies)
  windSpread: 1.7, // extra pre-heat multiplier for a downwind neighbour (eased 2.6 → 1.7: the head still
  // RUNS with the wind, but no longer outpaces the player — reading the wind stays the core skill)
  slopeSpread: 1.3, // extra pre-heat multiplier for an uphill neighbour (eased 1.8 → 1.3 — fire still climbs)
  slopeRef: 6, // height diff (units) between cells that counts as a "full" slope for spread
  wetResist: 4, // a doused (wet) cell's ignition threshold is multiplied up to this — firebreaks hold
  minFuel: 0.06, // a cell below this fuel can't ignite or sustain (front stalls in thin fuel)
  spotChance: 0.0018, // per hot cell, per sec: throw an ember ahead — RARE, only in strong wind (eased 0.004 →
  // 0.0018, and scaled by the mission's spreadScale). Gated in code on wind + a very hot source — stops "fireworks".
  spotDist: 34, // how far downwind (units) a spotting ember lands — ~3 cells: stays VISUALLY
  // ATTACHED to the head (reads as the front advancing, not a new fire teleporting across the map)
  litresToClear: 35, // water litres that fully zero a cell's heat. A full 100L bambi dump (knockRef≈2.9) DECISIVELY
  // clears the cells it lands on — every cell in the ~27u disc is driven to 0, SCORCHES to mud, and locks out
  // (can't re-light). So actively bucketing a fire puts it OUT (was 135 > the 100L tank → impossible to clear a hot
  // cell; eased again 45 → 35 so it's reliably easy). A fire wider than one disc is walked pass by pass (≈1–2 passes
  // for a typical fire with the wider dropRadius); bigger buckets (212/UH-60) clear more. Pairs with DROP_PHYSICS.extinguishLock.
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
  // Per-cabin variety (deterministic from each structure's id) so a hamlet reads as
  // distinct dwellings, not stamped clones. Footprint/height jitter + a small palette of
  // boreal log/roof tints, and a chance each cabin gets a woodpile or a lean-to shed.
  sizeJitter: 0.18, // ± fraction applied to cabin body width/depth/height
  logTints: [0x6b4a2f, 0x7a5636, 0x5f4129, 0x715030, 0x4f3622], // weathered log walls
  roofTints: [0x4a2f1c, 0x3c3a33, 0x55402a, 0x32302b], // shingle / tin / tar-paper roofs
  woodpileChance: 0.5, // chance a cabin gets a stacked-log woodpile beside it
  shedChance: 0.4, // chance a cabin gets a small lean-to shed
} as const;

// Burning structures (the stakes, made VISIBLE). A structure within fire range used to only get a
// faint emissive tint; now a burning cabin/base grows REAL flames (the reused wildfire flame from
// meshes/fire.ts, scaled to the building), an HDR wall-glow that blooms into a night beacon, its own
// rooftop smoke column + sparks (fed into the shared pools), and it joins the HeroFireLights pool so
// it casts ground light. Mobile-safe: each structure's flame is built once and hidden (visible=false)
// until it catches — zero cost when not burning, no per-frame alloc, no shader recompiles. All in
// meshes/cabin.ts (flame + glow + collapse) + a thin Game.ts sync (smoke/embers/light/comms).
export const STRUCT_FIRE = {
  // Flame footprint passed to the flame's setSize (0..1). The flame rises ~15u×size, so these scale
  // the blaze to the building: a cabin burns modestly, the base goes up big.
  cabinFlameSize: 0.16,
  depotFlameSize: 0.4,
  // Flame brightness ramps in the instant a building catches (a flare-up) and roars as it chars:
  // intensity = clamp(flameBase + healthLost × flameGain).
  flameBase: 0.5, // intensity at the moment of ignition — an immediate, visible flare
  flameGain: 0.5, // extra intensity as it burns down toward destruction
  glowHDR: 2.6, // peak emissive multiplier on the timber at full burn (HDR → blooms at night)
  // Smoke + sparks thrown off a burning building into the shared pools (scaled by burn).
  smokePuffsCabin: 2, // smoke puffs/burst off a burning cabin
  smokePuffsDepot: 5, // the base belches a much heavier column
  smokeCrownCabin: 4, // height (units) above the base where a cabin's smoke column starts
  smokeCrownDepot: 6,
  emberRateCabin: 0.5, // share of the per-burst ember budget a cabin throws (0..1)
  emberRateDepot: 1.0, // the base showers sparks
  // Progressive collapse: char + sag begin at this fraction of health lost and complete at
  // destruction (was a single binary slump the instant before it was already gone).
  collapseStart: 0.45,
  // Relative heat a burning structure contributes to the HeroFireLights candidate pool, so a burning
  // town actually lights the night (the base reads hotter and reaches farther).
  lightHeatCabin: 0.5,
  lightHeatDepot: 0.85,
  igniteCooldown: 18, // seconds between pooled "cabins alight" callouts so a hamlet doesn't spam comms
} as const;

// Settlements (Track A5 — populated map). Beyond lone cabins, the world seeds a handful
// of named (fictional) boreal communities: one lakeside "base" (where the depot
// sits) plus several small forest hamlets (a tight cluster of cabins). They give the map
// a sense of place + stakes, and they're the nodes the highway network links. Generated
// deterministically in World (sites + names); Structures populates them with buildings.
export const COMMUNITIES = {
  baseCount: 4, // lakeside BASES seeded across the map — refuel/repair pads (the FIRST is "home", where
  // you cold-start; the other three are forward bases you can also set down on). Each sits on its own
  // lake (a scoop source on hand) and they're spread apart so "nearest base" means different ones as you
  // range across the map. Only the HOME base is a damageable depot Structure; the forward bases are pure
  // refuel infrastructure (helipad + dock + label), so they never pad a mission's `protect` survivor count.
  baseSpacing: 360, // min spacing between bases (units) — spreads the four across the 1500u map
  townCount: 5, // small forest hamlets seeded across the map (the bases are extra)
  minFromOrigin: 130, // keep towns off the player's spawn (units)
  spacing: 200, // minimum spacing between community centers (units) — towns feel distinct
  clusterRadius: 26, // cabins of a hamlet scatter within this of its center (units)
  cabinSpacing: 9, // min spacing between cabins WITHIN a hamlet (tight, village-like)
  cabinsMin: 3, // fewest cabins in a hamlet
  cabinsMax: 6, // most cabins in a hamlet
  remoteCabins: 3, // lone trapper cabins out in the bush (spread bait), beyond the towns
  baseShoreSearch: 48, // how far past a lake's edge to ray-march for the base's dry shore
  // Cleared yard around each settlement: trees thin out and the ground reads as a trampled
  // dirt clearing, so a hamlet looks lived-in (not boxes buried in forest). The same radius
  // suppresses the forest scatter and sizes the dirt decal under the buildings.
  yardRadius: 34, // radius of the cleared/dirt yard around a community centre (units)
  yardInner: 0.5, // fraction of yardRadius fully cleared of trees before the rim feathers in
  yardColor: 0x6e5e45, // trampled dirt / packed-earth yard tint
  yardSpeckle: 0.14, // per-vertex brightness wobble on the yard (worn ground, not a flat slab)
  dockLength: 16, // how far the base's jetty reaches out over the water (units)
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

// Scoring (Track C3, reworked). The score is a BREAKDOWN, computed once at the win/lose
// transition by the pure `missions/score.ts` and shown line-by-line (+ an S/A/B/C grade) on
// the end banner. It is built to reward the three things a good run actually demonstrates:
//   • HARDSHIP   — harder missions + the scary moments you actually faced are worth more.
//   • SKILL      — precise drops, a fast clean run, fuel left in the tank, no hull dents.
//   • COORDINATION — keeping every structure pristine, juggling multiple fronts, flawless runs.
// Outcome points + skill + coordination are summed, scaled by a hardship multiplier, then the
// active penalties (lost structures, hard landings, wasted water) are subtracted. The total is
// floored at 0 and CLAMPED at `maxScore`. A loss keeps only a small fraction of the outcome.
// The whole scale is small and bounded: a flawless run on the toughest mission lands near
// `maxScore` (1400), so scores read like a tidy rating, not a five-digit pile. The grade is a
// RATIO (total ÷ baseline) and therefore scale-invariant — shrinking these weights changes the
// number on the banner, never the letter.
export const SCORE = {
  maxScore: 1400, // the ceiling — every total is clamped here (reachable only on a hard, flawless run)

  // --- Outcome: the base reward for what the run achieved -----------------------------------
  perFireDoused: 9, // each fire you extinguish with a water drop (not burned out on its own)
  perStructureSaved: 35, // each structure still standing when the last fire dies
  perCrewMoved: 21, // each crew inserted / evacuee flown out (mission objective)
  winBonus: 70, // flat bonus for completing the mission

  // --- Hardship: harder missions + scarier runs pay more (MODERATE weighting) ---------------
  // Difficulty multiplier = 1 + (difficulty-1)·step → diff 1 ×1.0 … diff 5 ×1.5.
  difficultyStep: 0.125,
  // Dynamic hardship: a small uplift for how dangerous it actually got — the worst structure
  // threat you survived, and the most fires you faced at once. Caps at +35% on a brutal run.
  hardshipPeakThreat: 0.2, // +20% at a full (1.0) peak threat survived
  hardshipFireLoad: 0.15, // +15% when you faced `hardshipFireLoadRef` active fires at once
  hardshipFireLoadRef: 6, // active-fire count that reads as "maximum load"

  // --- Skill: how WELL you flew (win only) --------------------------------------------------
  precisionMax: 42, // ×hit-rate (effective drops ÷ total drops)
  precisionMinDrops: 3, // need ≥ this many drops before precision scores (a lucky 1/1 isn't 100%)
  speedMax: 52, // beat par → full; decays linearly to 0 at `parSlackMul`×par
  parBase: 40, // par seconds = parBase + parPerFire·firesInitial + parPerCrew·crewsTotal
  parPerFire: 14,
  parPerCrew: 22,
  parSlackMul: 2.4, // elapsed at which the speed bonus reaches 0
  rangeMax: 28, // ×fuel remaining at the end (fuel-pressure missions only)

  // --- Coordination: holding everything together (win only) ---------------------------------
  perPristineStructure: 14, // structure saved at near-full health — you kept the fire off it entirely
  pristineHealth: 0.92, // health ≥ this counts as pristine
  multiFrontBonus: 42, // ≥2 communities / fronts AND not a single structure lost
  flawlessBonus: 88, // win + every structure pristine + every crew + zero fires left to burn out

  // --- Penalties: active, subtracted after the multiplier; total floored at 0 ---------------
  perStructureLost: 28, // each structure destroyed
  hardLandingPenalty: 9, // each hull-denting hard landing (a crash is its own 0-score loss)
  wastedDropPenalty: 4, // each drop that missed or dispersed too high (sloppy water)

  // --- Loss handling + grade thresholds -----------------------------------------------------
  lossMultiplier: 0.35, // a failed mission keeps this fraction of its outcome points
  gradeS: 1.6, // grade = total ÷ baseline (baseline = a bonus-free competent win at this difficulty)
  gradeA: 1.35,
  gradeB: 1.15,
  gradeC: 0.9,

  // --- Stars (cosmetic, per-mission 1..3) ---------------------------------------------------
  // Stars reuse the SAME baseline ratio that drives the letter grade (scale-invariant, difficulty-
  // normalized) so they can never contradict it on the debrief: 1★ = mission cleared (any win),
  // 2★ = a clean competent win, 3★ = an excellent run. These TRACK gradeB / gradeS by design — keep
  // them equal unless you deliberately want stars to read differently from the letter.
  starTwo: 1.15, // ratio for the 2nd star (mirrors gradeB)
  starThree: 1.6, // ratio for the 3rd star (mirrors gradeS)
} as const;

// Mission MECHANICS tuning (the campaign layer). This is the single tuning source for the
// new gameplay mechanics the missions exercise — landing-zone size + crew sling pickup/drop,
// and the fuel/range model (Track C6). It holds VALUES only; the SCENARIO of each mission
// (seed, where the fires/crews/structures sit, win/lose) lives in `missions/catalog.ts` as a
// `MissionDef`, never here. Engine-agnostic sims (`sim/CrewTransport.ts`, `sim/FuelSim.ts`)
// read these exactly as `HelicopterSim`/`FireSystem` read FLIGHT/FIRE3D.
export const MISSIONS = {
  // --- Crew transport (land-and-board delivery + evacuation) ---
  // A crew move is a REAL ferry: SET DOWN on the zone's cleared pad (the flight floor eases to
  // skids height there, like the base helipad), bring the aircraft to a stop, and hold the
  // touchdown for the dwell while the crew board / disembark the cabin — then on to the next.
  // One crew at a time; no slung basket, no extra button — just fly it down and stop.
  lzRadius: 14, // horizontal distance (units) within which a touchdown counts as "on the zone" (narrow pad)
  lzClearRadius: 20, // forest cleared within this of an LZ so the skids reach the ground (inner core fully clear)
  landAgl: 1.2, // height above the eased pad floor (units) below which the heli counts as LANDED (skids down)
  landSpeed: 2.0, // airspeed (units/s) below which the heli counts as stopped (no boarding on the roll)
  pickupSec: 2.2, // landed dwell to BOARD a crew at a pickup/base zone
  dropSec: 2.2, // landed dwell to set a crew DOWN at a dropoff zone
  zoneSmoke: 0x39d0ff, // marker-smoke / ring tint for an ACTIVE (next) zone (cyan)
  zoneSmokeDone: 0x5a6b72, // tint once a zone is satisfied (greyed out)
  zoneHome: 0x5fe0a0, // persistent tint for the reusable HOME base zone — always lit, distinct green from the cyan LZs

  // --- Fuel / range (Track C6 — calibrated to the hero Bell 205A-1, 60× time compression:
  // full bucket + full power ≈ 2.5 min endurance, light loiter ≈ 4.2 min). Only missions
  // with `fuel:true` construct a FuelSim; everything else ignores this block. ---
  startFuel: 1.0, // tank fraction at spawn (0..1)
  idleBurn: 0.0029, // fuel/sec floor at a hover — EASED 0.004→0.0029 (≈1.4× endurance) so range keeps pace with
  // the 1.4× larger world (bases sit further apart now); ~5.7-min max-endurance loiter
  thrustBurn: 0.0014, // extra fuel/sec at full demand (½ throttle + ½ climb) — eased 0.002→0.0014 with idleBurn
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

// Quality tiers (B0). One auto-detected preset picks SCENE COMPLEXITY at load
// (shadows, tessellation, post-fx). Render RESOLUTION is a SEPARATE, recompile-free
// lever: a frame-time watchdog scales DPR within [dpr.floor .. dprCap] and — unlike
// the old one-way tier ratchet — steps it back UP when there's headroom, so a brief
// stall can't strand the device at a permanently blurry resolution. dprCap is 2 on
// med/high (a cheap scene at DPR 2 is sharp AND affordable) but 1 on low — a device
// that classifies "low" starts sharp-enough at DPR 1 instead of janking ~2.5s at 2×
// before the watchdog can step it down. Load-time-only fields (shadowMapSize,
// waterSegments, terrainSegments) are read once at construction — changing them
// would recompile, so the watchdog never touches them.
export const QUALITY = {
  presets: {
    // terrainSegments = grid resolution per side; higher = smoother carved SHORELINES
    // (the waterline reads jagged at low res). Water-disc edges (waterSegments) too.
    // bloom > 0 enables the post-fx composer (low skips it entirely → cheapest path).
    // msaa = composer multisample count (0 = none; the no-composer low path AAs via the
    // renderer's own antialias). dprCap = per-tier render-resolution ceiling.
    low: { name: 'low', dprCap: 1, shadows: false, shadowMapSize: 512, waterSegments: 96, terrainSegments: 140, bloom: 0, msaa: 0 }, // dprCap 1: low-end devices skip the ~2.5s startup jank of rendering at 2× before the watchdog steps down
    med: { name: 'med', dprCap: 2, shadows: true, shadowMapSize: 1024, waterSegments: 160, terrainSegments: 190, bloom: 1, msaa: 0 },
    high: { name: 'high', dprCap: 2, shadows: true, shadowMapSize: 2048, waterSegments: 224, terrainSegments: 248, bloom: 1, msaa: 4 },
  },
  // Adaptive render-resolution watchdog (the only runtime lever — recompile-free).
  dpr: {
    floor: 1.0, // never render below this DPR (the pixelation guard); also capped by the device DPR
    step: 0.25, // DPR nudge per adjustment — [1.0 .. 2.0] resolves in 4 steps
    upWindowSec: 4, // sustained headroom (EMA < upgradeMs) before stepping DPR back UP
  },
  downgradeMs: 22, // EMA frame-time (≈45fps) above which we're "over budget" → step DPR down
  upgradeMs: 15, // EMA frame-time (≈66fps) below which there's headroom → step DPR up
  downgradeWindowSec: 2.5, // sustained over-budget time before stepping DPR down
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
  bloomThreshold: 1.05, // raised again (0.95→1.05): only genuine HDR >1 pixels bloom — the fire
  // white-hot core + tight sun core still glow, but the broad amber sky/horizon halo (which crept
  // just over the old 0.95 when you faced the low sun) now stays crisp instead of blooming flat white
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
  exposure: 0.28, // overall shaft brightness added back onto the frame. Lowered from 0.45: the
  // shafts were stacking with the sky halo + bloom into a blinding into-sun white-out that hid the
  // whole scene; 0.28 keeps readable raking shafts without washing the frame when you face the sun.
  threshold: 0.62, // luma a sampled pixel must exceed to seed rays (dark geometry → no shaft).
  // Raised from 0.5 so only the genuine bright sky near the sun streams — the warm-but-mid amber
  // haze band no longer seeds full-frame shafts (a second contributor to the into-sun wash).
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

// Ambient drifting embers (atmosphere). A SUBTLE, persistent field of slow amber motes floating
// in the fire-season air around the camera — distinct from EMBERS (bright sparks thrown off a
// blaze that arc and die). They drift on the wind, breathe, and recycle forever, and THICKEN near
// active fires (more motes respawn downwind of a blaze the closer you are). Tune "subtle vs more"
// with `max` + `baseAlpha`; "how much it clumps at fires" with `fireBias`/`fireSenseRadius`.
// Pooled additive GPU points (vfx/AmbientEmbers.ts) — fixed `max`, O(max)/frame, no recompiles.
export const AMBIENT_EMBERS = {
  max: 130, // pooled mote cap — kept low so the air glints, never swarms (subtle, not a blizzard)
  radius: 95, // motes live within this horizontal radius of the camera (units)
  recycleScale: 1.25, // recycle a mote once it drifts past radius × this (then it respawns near cam)
  belowCam: 46, // motes spawn from this far BELOW the camera…
  aboveCam: 22, // …up to this far above it (the air column you actually see)
  rise: 0.45, // gentle buoyant drift up (units/s) — they float, they don't shoot
  drift: 0.5, // small random lateral launch speed (units/s)
  windInfluence: 3.0, // downwind drift the mote eases toward (units/s) — light; embers hang, not streak
  windCatch: 0.5, // how fast a mote is dragged to the wind drift (per second) — slow, lazy
  swayAmp: 0.45, // per-mote sine sway amplitude (units/s) — the lazy weave of a floating ember
  swayHz: 0.45, // sway frequency (Hz)
  life: 8.0, // seconds a mote lives before recycling (long → they linger in the air)
  fadeIn: 0.14, // fraction of life spent fading IN (no birth pop)
  fadeOut: 0.32, // fraction of life spent fading OUT (no death pop)
  size: 1.7, // base point size — tiny glowing motes
  baseAlpha: 0.42, // PEAK opacity — the subtlety dial (lower = more delicate)
  colorHot: 0xffb866, // warm amber (fresh / fire-fed motes)
  colorCool: 0xc4500f, // deep ember (ambient / aged motes)
  twinkleHz: 2.0, // slow breathe rate (Hz) — a glow, not a glint
  ambientBright: 0.55, // alpha scale for a far-from-fire mote (dimmer — just atmosphere)
  fireBright: 1.0, // alpha scale for a fire-fed mote (brighter — it's a real ember)
  // Fire coupling: a blaze within `fireSenseRadius` of the camera pulls up to `fireBias` of the
  // respawns to spawn downwind of it → the air visibly thickens with embers near the fire.
  fireBias: 0.65, // max fraction of respawns pulled to near a fire (at full proximity)
  fireSenseRadius: 240, // a fire within this of the camera contributes density + is a spawn source (units)
  fireDownwind: 16, // how far downwind of a fire a fire-fed mote spawns (units)
  fireScatter: 16, // lateral scatter around the downwind spawn point (units)
  fireLift: 5, // base height above the fire a fire-fed mote spawns (units)
  fireLiftRand: 16, // extra random height on top (units) → a rising column of embers
  fireRise: 1.8, // upward speed of a fire-fed mote (units/s) — rises faster than ambient
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

// Smoke plumes (Track B4) — per-fire wildfire smoke as a VOLUME. A single pooled GPU Points
// cloud (fixed ring buffer, one scene object) where each puff billboards a real soft smoke-puff
// SPRITE (a downloaded asset, see `tex`), rotated per puff. Puffs rise from a fire's crown,
// EXPAND and fade over their life, and BEND downwind (velocity dragged toward the live wind
// vector). The column is dense + near-opaque so the helicopter can't see through it — you fly
// AROUND it. Color is ZONED by how far a puff has risen above its crown: fire-lit ORANGE at the
// base, oily NEAR-BLACK billows low in the fresh body, GREY for most of the height, dispersing
// to PALE grey at the anvil.
export const SMOKE = {
  tex: 'textures/smoke-puff.png', // soft smoke-puff sprite billboarded per particle (real asset, see CREDITS.md)
  max: 2400, // pooled particle cap (ring buffer — recycles oldest, never grows). High so the dense,
  // near-opaque column sustains its full height without recycling the base out from under it.
  emitInterval: 0.07, // seconds between puff bursts (shorter → a denser, more continuous, occluding column)
  rise: 17, // initial upward speed (units/s) — the column SHOOTS up into a tall pillar
  riseDamp: 0.1, // per-second cooling that bleeds the rise (very low → it keeps climbing, towers)
  spread: 2.2, // initial random lateral speed (units/s)
  windInfluence: 9, // downwind drift the plume accelerates toward (units/s at full wind)
  windCatch: 0.55, // how fast a puff is dragged to wind speed (lower → a tall pillar that leans late)
  life: 18, // particle lifetime (seconds) — long so the pillar towers (pyrocumulus reach)
  startSize: 20, // point size when fresh (a fat, dense textured puff)
  endSize: 150, // point size when fully aged — huge billows up high (pyrocumulus anvil)
  opacity: 0.92, // peak alpha (per puff, before sprite + soft falloff) — thick, view-blocking column
  // Anti-FLICKER guards (a billboard you fly INTO must not slam the whole frame to black). The
  // on-screen point size is capped so no single puff can fill the view, and puffs within the
  // near band fade out as they approach the eye — so flying through a column dissolves the puffs
  // smoothly (the DOM smoke veil, FIRE3D.smokeBlind*, handles the actual in-column blinding)
  // instead of popping near-black sprites, especially when backlit by a low sun in heavy smoke.
  maxScreenSize: 680, // hard ceiling on a puff's on-screen pixel size (was an effectively full-screen 1800)
  nearFadeLo: 4, // closer than this (view-space units) a puff is fully faded (you've flown into it)
  nearFadeHi: 17, // by this distance it's back to full opacity — the soft-particle near fade band
  minIntensity: 0.1, // fires dimmer than this don't smoke
  // Heat reactivity (C3.1): heat = fire intensity × size. A big, hot fire throws a taller, bigger,
  // DENSER column that obscures the seat of the fire (read the wind, run in upwind). Scales per puff.
  maxPuffsPerBurst: 10, // a Class-A spot emits 1 puff/burst; a full blaze up to this many
  crownBase: 3, // smoke leaves the flame crown this low (units) at size 0 — boils right off the seat…
  crownPerSize: 15, // …plus this × size — a big fire's column starts high up the flame wall
  heatSize: 2.1, // extra puff size at full heat (×) — fat, billowing pyrocumulus over a big fire
  heatOpacity: 0.7, // extra alpha at full heat (×) — a big front's column reads thick/opaque
  // --- Volume color ZONING (orange base → black billows → grey body → pale anvil) ----------
  // Driven by `rise` = how far (world units) a puff has climbed above the crown it left.
  bodyColor: 0x5b574f, // the dark ASH-GREY that makes up most of the column (reads against bright sky)
  darkColor: 0x100e0c, // near-black OILY pockets low in the fresh, dense body
  paleColor: 0xb4afa6, // dispersing PALE grey at the anvil / oldest puffs
  warmColor: 0xff6a1e, // fire-lit ORANGE glow on the lowest puffs (the smoke base catches the flame light)
  warmRise: 22, // base orange glow fades out by this many units above the crown
  warmStrength: 1.5, // intensity of that base glow (×)
  darkLo: 2, // the black band starts this far above the crown…
  darkHi: 64, // …and fades back to grey by here (so the black sits in the lower-mid body)
  darkStrength: 0.95, // how black the oily pockets get (0..1 mix toward darkColor)
  paleRise: 120, // grey disperses toward pale above this rise (the dissipating top)
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
  // --- Cold-start fly-in: every mission opens with the camera tucked CLOSE to the parked heli (a low
  // hero shot of the rotor spooling up), then pulls OUT to the normal trail as the engine tops out, so
  // the view "settles into" flight by the time the start cycle completes. Driven by spool RPM (0..1),
  // back-loaded (intro*PullStart) so it holds the close-up through most of the start. ChaseCamera eases
  // it MONOTONICALLY — a released START dial that bleeds RPM never yanks the camera back in. ---
  introDistance: 12, // how far behind the heli at full close-up (vs `distance` 28)
  introHeight: 6, // how far above at full close-up (vs `height` 15) — a low, close, cinematic angle
  introLookAhead: 3, // aim point ahead of the nose at full close-up (vs `lookAhead` 10) — frames the airframe, not past it
  introPullStart: 0.55, // spool fraction (0..1) at which the pull-out BEGINS — the transition lands exactly at full RPM
  // Free-look ("eye" button): drag = orbit VELOCITY (not distance), so holding it
  // spins the camera continuously — a full 360° either way — and a tiny drag is
  // enough (the button can sit near the screen edge). Release eases back to default.
  lookYawRate: 2.4, // rad/sec orbit speed at full deflection (~360° in 2.6s), unbounded
  lookPitchRate: 1.6, // rad/sec vertical orbit speed at full deflection
  lookPitchMin: -0.45, // lowest the cam tilts (below the heli, looking up) — radians
  lookPitchMax: 1.15, // highest the cam tilts (overhead, looking down) — radians
  lookPadRadius: 46, // px of drag from the eye button that maps to full orbit speed
  lookReturnLerp: 0.1, // how fast the view eases back to default on release (per 60fps frame)
  // --- Mobile-portrait readability (concern 6). `fov` is VERTICAL; a tall narrow viewport CROPS the
  // horizontal world, so the ground under the bucket vanishes. Hor+ derives a wider vertical fov in
  // portrait so a portrait player sees the same horizontal span a landscape player does. ALL no-ops in
  // landscape (aspect ≥ portraitFovBlendStart) → desktop framing is byte-identical. ---
  portraitHorizFovRef: 88, // deg HORIZONTAL fov to preserve in portrait (≈ what a 1.78 landscape player sees)
  portraitVfovMax: 95, // deg clamp on the derived vertical fov so an extreme-narrow phone doesn't fisheye
  portraitFovBlendStart: 1.05, // aspect at/above which fov = CAMERA.fov exactly (landscape untouched)
  portraitFovBlendEnd: 0.72, // aspect at/below which full Hor+ applies; smoothstep across the band (no pop at aspect≈1)
  // --- Gentle "bombing-run" look-down assist: when low + slow + carrying water near a fire, lift the cam
  // and tilt it down so the impact zone shows. Additive on free-look, portrait-only, eases in/out. ---
  bombingRun: true, // master enable
  bombingPortraitOnly: true, // engage only in portrait (aspect<1); landscape chase framing never changes
  bombingExtraHeight: 10, // extra cam height at full engage (on top of `height`)
  bombingExtraPitch: 0.32, // extra look-down (rad ≈18°) ADDED to free-look curPitch, clamped to lookPitchMax
  bombingExtraLookAhead: 14, // extra lookAhead at full engage — frame the impact zone, not the nose
  bombingArmAgl: 130, // engage only when heliSim.agl < this (a low pass)
  bombingArmSpeed: 26, // engage only when heliSim.speed < this (lining up, not transiting)
  bombingArmWater: 1, // engage only when carrying ≥ this many litres
  bombingArmFireDist: 180, // engage only when the nearest active fire is within this (units)
  bombingEngageLerp: 0.05, // per-60fps ease of the 0..1 engage factor IN and OUT — glides, never snaps
};

// Title / attract screen — the home-screen 3D backdrop that renders BEHIND the menu (ui/title/
// TitleScreen + menu/AttractScene). A lightweight, non-interactive scene: a gradient sky dome, a
// gently rolling boreal floor, sun+hemi lighting, and a slow cinematic camera drift. Built once and
// torn down the instant the player hits PLAY (the menu→mission jump is a full reload anyway), so it
// never competes with the gameplay renderer. This block is the SINGLE source of its tuning — the
// moving layers added in later phases (helicopter flyby, fire + smoke, drifting clouds, swaying
// trees) extend it here rather than hard-coding values. Mobile-60: curated + low complexity, the
// shared QualityTier caps DPR and gates shadows/post-fx exactly as in-game.
export const TITLE = {
  timeOfDay: 'golden', // SKY_PRESETS mood for the backdrop — the game's cinematic golden-hour default
  // Camera — a composed, slightly elevated frame that looks out over the floor toward the low sun,
  // sliding through a very slow sway+bob so the scene breathes without ever distracting from the menu.
  camera: {
    fov: 55, // vertical FOV (deg) — a touch tighter than the 60° chase cam for a posterish, composed frame
    pos: { x: 12, y: 30, z: 108 }, // eye position (world units) — high enough to look down across a vista of rolling floor
    target: { x: 0, y: 7, z: -48 }, // aim point tilts the lens DOWN (~8°) so the horizon sits low and the boreal floor reads as a vista; logo gets clear sky above
    driftX: 9, // horizontal sway amplitude (units) of the idle orbit
    driftY: 2.5, // vertical bob amplitude (units)
    swayHz: 0.02, // sway frequency (cycles/sec) — ~50s per pass, hypnotically slow
    bobHz: 0.014, // bob frequency (cycles/sec) — offset from sway so the motion never feels like a loop
  },
  // Rolling boreal floor — a single procedural plane, vertex-coloured by height (deep green hollows →
  // lighter meadow rises, matching the BIOMES palette) and faded into the horizon by the preset fog.
  ground: {
    size: 2400, // floor extent (units) — runs well past the fog far-plane so no edge ever shows
    segments: 100, // plane tessellation for the gentle roll (built once at load)
    amplitude: 7, // vertical relief of the rolling hills (units) — low, shield-country relief
    frequency: 0.012, // world→sine scale for the roll (lower = broader landforms)
    colorLow: 0x2f5234, // deep boreal green in the hollows
    colorHigh: 0x6f8f3f, // lighter meadow green on the rises
  },
  wind: { x: 0.35, z: 0.12 }, // gentle ambient wind fed to the shared uniform bus (drives foliage/smoke in later phases)
} as const;
