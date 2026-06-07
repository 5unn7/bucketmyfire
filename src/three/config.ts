// Central tuning for the 3D build. The world is a real Y-up scene now: the
// helicopter flies in the XZ plane with altitude along +Y. Values are in world
// units (the terrain spans ~600 units; the aircraft is ~8 units long), retuned
// down from the old 2D pixel scale but preserving the same momentum "feel".

import { applyConfigOverrides } from './dev/configOverrides';

export const WORLD3D = {
  size: 2100, // square terrain extent, centered at origin — ENLARGED 1500→2100 so the big lakes stop eating
  // the land (anchors spread ~1.4× further apart, lakes keep their absolute size → more dry ground, esp. La
  // Ronge). A side crossing is now ~70s at cruise (the map feels large). lakes/trees/fire-grid scale with this.
  seed: 1337, // one seed threads through noise/hydrology/placement/fire (determinism invariant)
  // Carved lake basins: each lake's water sits in a smoothstepped bowl so "descend
  // to scoop" is identical everywhere (the Phase-1 keystone). All in world units,
  // measured relative to the lake's flat water surface.
  lakeBedDepth: 5, // deepest lakebed below the water surface (at the center)
  lakeShoreDrop: 0.9, // ground at the waterline sits this far below the surface (water meets land). Deeper = the
  // shoreline is unambiguously SUBMERGED, so no land sliver pokes through the disc edge where terrain undulates.
  // (Scoop reads the water SURFACE, not the bed, so a deeper edge never affects filling.)
  lakeBankHeight: 1.6, // raised lip above the water just outside the shore
  lakeBankWidth: 10, // radial width of that raised bank ring
  lakeBlendWidth: 22, // radial width over which the bank blends back into base terrain
};

// Real-world map projection + lake sizing (anchored maps like Saskatchewan). Anchors carry REAL
// latitude/longitude; World projects them with a cosine ("sinusoidal") projection so true distances
// AND the province's converging-meridian trapezoid (wider south, narrower north) come out right — see
// maps/<region>/region.ts `geo` + `outline`. The province is scaled to fill `fill` of the square world's
// height; everything outside the border (E/W margins, the open south reserved for v2) is off-province
// wilderness, muted on the radar so the map reads as Saskatchewan rather than a filled square.
export const MAPGEO = {
  fill: 0.93, // province N–S extent fills this fraction of the square world height (leaves a rim margin)
  // ENGINE-DECIDED WORLD SIZE (D2): a true-shape ('bounds'-fit) map's size is its REAL extent at a
  // CONSTANT real scale, not a fraction of a fixed budget — so every province shares one u/km and a
  // km-authored mission transfers unchanged. `unitsPerKm` is that scale (≈ the square-fit scale, so
  // Saskatchewan's ~1224 km long axis ≈ 2000u); the longest axis is then clamped into
  // [worldSizeMin, worldSizeMax] (aspect preserved) so a tiny province isn't a postage stamp and a
  // giant one can't blow the fire-cell / draw budget.
  unitsPerKm: 1.63, // world units per real km for bounds-fit maps (SK long axis ≈ 2000u)
  worldSizeMin: 1000, // smallest allowed longest-axis extent (units) — scale UP below this
  worldSizeMax: 3000, // largest allowed longest-axis extent (units) — scale DOWN above this (caps the budget)
  boundsFill: 0.98, // SUPERSEDED by unitsPerKm + the clamp above (kept for the radar/border comments); no longer
  // sizes the world. Was: the province's LONGEST projected axis fills this fraction of a fixed budget.
  // PROVINCE-OUTLINE MASK (Slice 2 — bounds-fit maps only): the visible land edge traces the real province
  // outline instead of filling the rectangle. The ground falls off to `offProvinceLevel` across a blend band
  // straddling the border (no cliff, no hard flight wall — beyond reads as off-province lowland + distance fog,
  // NOT ocean). Only active when a region's geo opts in via `fit:'bounds'`; square maps are untouched.
  outlineBlendBand: 90, // half-width (units) the ground transitions over, centred on the outline (±90u → ~180u total)
  offProvinceLevel: -12, // lowland Y the ground falls to beyond the border (below SK land ~[−5,9] but NOT a deep ocean)
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
  // SMOOTHING PASS (2026-06-05): the map read as "lots of uneven terrain" — the culprit was the granite
  // ridge layer (tall, frequent spikes) + a violent domain warp. Eased to a calmer, rolling boreal shield:
  // ridge spikes are lower + rarer, the warp is gentler, lowlands flatter. Landform SCALE (the frequencies)
  // is unchanged so the map keeps its character — it's the same place, just less jagged. Dial back toward
  // the old jaggedness by raising ridgeAmplitude (was 6) / lowering ridgeThreshold (was 0.5) / warpStrength (was 85).
  baseAmplitude: 8, // vertical scale of the rolling FBM (units) — eased 9→8 for calmer hills (still shield relief)
  baseFrequency: 0.0045, // world→noise scale (lower = broader landforms)
  octaves: 5,
  lacunarity: 2.0, // frequency step per octave
  gain: 0.5, // amplitude falloff per octave
  warpStrength: 58, // domain-warp displacement (units) → winding ridgelines — eased 85→58 so valleys wind gently, not violently
  warpFrequency: 0.006,
  ridgeAmplitude: 3.4, // rocky bedrock outcrops above the rolling base — eased 6→3.4 (the main "uneven/jagged" fix)
  ridgeFrequency: 0.011,
  ridgeOctaves: 3,
  ridgeThreshold: 0.62, // only ridge values above this rise — raised 0.5→0.62 so outcrops are rare landmarks, not a bumpy field
  lowlandFlatten: 0.62, // 0..1 — compress below-water-line dips into flatter muskeg basins (eased 0.5→0.62, smoother flats)
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
  // Authored-outline cleanup: a long/lobed real lake (Lac La Ronge) ray-cast from its centroid yields a
  // single-valued boundary LUT with SHARP notches where the nearest shore crossing jumps between angles —
  // those notches render as sliver triangles that shimmer ("low-graphic / glitch"). A wrap-around low-pass
  // pass over the LUT relaxes the notches into a smooth, uniform waterline. Shared by mesh + basin + isOverWater.
  outlineSmoothPasses: 4, // 0 = off (verbatim outline); each pass is a 3-tap binomial blur over the 128-sample ring
} as const;

// Streams / mini rivers (Track A4). Thin meandering channels that connect lakes
// downhill (mini rivers) plus short tributaries feeding into them (tiny streams).
// They carve a shallow channel into the terrain and their surface generalizes
// World.waterLevelAt, so you can SCOOP from a stream just like a lake. Kept narrow +
// shallow (Shield streams are small) so threading one is a real piloting test.
export const STREAM = {
  width: 3.4, // half-width of a mini-river water ribbon (units)
  tinyWidth: 2.0, // half-width of a tiny tributary
  depth: 2.6, // channel bed below the water surface (the bucket scoops off the SURFACE, so a deeper bed is free)
  shoreDrop: 0.8, // bank-edge ground sits this far below the surface (water meets land). Raised so the channel
  // EDGE is clearly submerged under the ribbon — kills the land slivers that showed through a too-shallow channel.
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
  // Palette (hex) — colour pass: greens pushed richer/more saturated and the shore warmed, so the
  // boreal floor reads vivid instead of a flat olive wash (paired with GRADE.saturation 1.18).
  colorShore: 0xb6a06a, // warm gravel/sand — a warm note against the greens + blue water
  colorMeadow: 0x7ba83a, // brighter spring-grass green (was a muted 0x6f8f3f)
  colorForest: 0x2f6e2c, // deep boreal green, a touch more saturated/greener (was 0x355e2c)
  colorRock: 0x71747a, // granite grey, faintly cooler
  colorSwamp: 0x53632f, // mossier olive-green peat bog (less brown, more life)
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
  baseCandidates: 2800, // tree candidates at the 600u reference size (Game scales by world AREA). Bumped back UP
  // (2000→2800) now that the forest is DEFERRED (streamed a few ms/frame post-first-frame, see Game.deferredBuild) —
  // the candidate cost no longer freezes the boot, so we can afford a fuller forest again.
  densityMul: 2.0, // candidate-count multiplier on med/high (forest fullness) — low tier stays at 1. Back to 2.0 (deferred).
  canopyTiers: 5, // overlapping cone tiers per conifer (4→5 — fuller crown; the deferred stream absorbs the build cost)
  radialSegments: 7, // near-LOD canopy roundness (8→7) — still round up close, one ring of verts off per cone
  nearRadius: 420, // a synchronous conifer patch of this radius around the spawn is built AT FIRST FRAME (so cone trees
  // are already around you on the pad) while the full forest streams in past it — see Game's near-patch.
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
  yawRate: 0.72, // turn rate (rad/s) at full left/right stick — LOWERED 1.0→0.72 to reduce jumpy over-steer
  reversePower: 0.5, // backward thrust fraction — flying tail-first is slower
  // Raw turn/throttle/collective input is eased toward (this) per-60fps factor before
  // it drives yaw, thrust and climb, so a key tap or stick flick ramps in and rolls
  // out instead of snapping — the main lever for how SMOOTH the flight transitions
  // feel. Lower = smoother/floatier, higher = snappier/more direct (1 = no smoothing).
  // (The collective ALSO has its own velocity inertia below, collectiveResponse — the
  // two cascade into a soft S-curve climb/descent rather than a single-lag jerk.)
  controlResponse: 0.10, // LOWERED 0.16→0.10: one tap ramps in slower — less "a tiny flick does everything"
  // --- Body attitude (acceleration-driven, like a real airframe) ---
  // The fuselage tilts toward its acceleration: dive to speed up, flare to brake,
  // bank into turns. These cap how far it leans and how persistently it cruises
  // nose-down. See the attitude block in HelicopterSim.update().
  maxBank: 1.0, // radians of roll at full lateral (turn) acceleration (RAISED 0.8→1.0 for aerobatic banks ~57°)
  maxPitch: 0.60, // radians of physics-driven pitch at full fore/aft acceleration (RAISED 0.42→0.60 — was too
  // low for flare: at cruise the nose could only tip ~16° nose-up under hard braking, not enough to feel it.
  // Still well under maxPitchHard; the commanded dive-bomb (diveCommand) is bounded by that, untouched.
  cruisePitch: 0.14, // extra persistent nose-down at top speed (disc tilted to hold cruise)
  bodyEase: 0.08, // how fast bank/pitch ease toward their targets — LOWERED 0.13→0.08 so the airframe leans in softly, not with a jerk
  attitudeAccelSmoothing: 0.12, // EMA (per-60fps factor) on the acceleration that drives the nose-tilt/bank, BEFORE — LOWERED 0.2→0.12 for calmer lean
  // it leans the airframe. The raw per-frame accel spikes on a throttle slam and at the speed cap, and since
  // nose-down feeds more thrust (pitchThrust), the unfiltered loop porpoises. Lower = smoother/laggier lean (kills
  // the see-saw); 1 = the old raw, twitchy behavior. The commanded dive-bomb/steer-bank bypass this entirely.
  // --- Direct pilot attitude authority (AEROBATICS) — leans the airframe on the STICK,
  // not just as a side effect of accelerating. This is what turns "it banks a little in a
  // turn" into "I can throw it into a hard banked turn and dive-bomb a fire on command."
  // Added on TOP of the acceleration-driven bank/pitch above, then clamped to the *Hard caps. ---
  steerBank: 0.42, // radians of roll commanded directly by full turn stick — LOWERED 0.55→0.42 to reduce sharp-jerk banking on stick flicks
  steerBankIdle: 0.35, // fraction of steerBank still present at a standstill (so a low-speed turn still drops a wing; full at cruise)
  diveCommand: 0.48, // radians of nose-down commanded by full DOWN collective AT TOP SPEED — the dive-bomb tuck. The pitch→motion
  // coupling (pitchThrust/pitchDive) then turns that nose-down into a real surging, sinking swoop; haul UP collective to flare out.
  // Scaled by forward speed, so easing straight down onto a lake to scoop barely noses over (only a fast forward descent dives).
  // EASED 0.6→0.48: still a real dive when you push the nose over at speed — diving + climbing stays fun — just a less violent tuck.
  flareCommand: 0.38, // radians of nose-UP commanded by full UP collective AT TOP SPEED — the flare brake. Mirror of diveCommand:
  // pulling UP collective at speed pitches the nose back visibly and (via flareBrake below) actually bleeds airspeed.
  // Fades with forward speed so a slow hover-climb doesn't wobble the nose. Tune together with diveCommand.
  flareBrake: 45, // braking force (units/s²) per radian of nose-up — the flared disc tilts thrust backward and decelerates you.
  // Mirror of pitchThrust (80): ~half strength so a flare scrubs speed without stopping dead. Raise for a harder brake.
  maxBankHard: 1.25, // hard clamp on TOTAL roll (~72°) so accel + stick combined can't tumble the airframe past a sane lean
  maxPitchHard: 0.95, // hard clamp on TOTAL pitch (~54°) — bounds the steepest dive/flare
  // --- Pitch → motion coupling (cyclic-forward): the nose-down disc drives REAL flight,
  // not just a cosmetic tilt. Tucking the nose tilts the thrust vector forward and down,
  // so a dive surges AND descends — and a committed dive can outrun level cruise. Pull UP
  // collective to flare out of it. Raise these for a more aggressive, weightier dive.
  pitchThrust: 80, // extra forward accel (units/s^2) per radian of nose-down disc — the speed surge (EASED 92→80: a dive
  // still gets away from you, just not violently — diving stays a fun, controllable trade of height for speed)
  pitchDive: 44, // sink rate (units/s) per radian of nose-down BEYOND the cruise trim — the descent (EASED 50→44: a real plunge, calmer)
  diveSpeedBoost: 0.32, // top-speed cap raised by up to this fraction in a full committed dive (EASED 0.42→0.32 — the dive still outruns cruise, less wild)
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
  groundClearance: 0.5, // land floor = ground + this — a SMALL skid clearance so you can SET DOWN ANYWHERE on open
  // ground (not just pads), and the craft is never auto-lifted to clear terrain/canopy. It is NOT a canopy buffer:
  // the trees are an OBSTACLE the rotor crashes into (the tree-strike in CRASH/Game), not a floor that elevators you
  // over them. So you fly ABOVE the canopy to cross forest, or drop into a clearing to land — your blades just can't
  // touch the trees. (Was `canopyClearance: 8`, which held you 8u over the canopy and auto-climbed rising terrain.)
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
  ropeLength: 7, // rest hang below the cargo hook (units)
  bellyOffset: 1.8, // how far the cargo hook sits above the skid line — rope attaches here, not the heli center
  // --- Longline flex (visual sag) ---
  // A real longline isn't a rigid stick: it bows into a catenary whose depth scales
  // with load. A LIGHT bucket lets the line go soft and droop; a FULL bucket's weight
  // pulls it taut and nearly straight. Game draws the rope as `ropeSegments` short
  // members dipped by a mid-span sag interpolated from fill (purely visual, O(1)).
  ropeSegments: 10, // line subdivisions for the drawn sag (visual only)
  ropeSagEmpty: 1.3, // mid-span droop (units) at an empty bucket — soft, flexible
  ropeSagFull: 0.25, // mid-span droop at a full bucket — taut, nearly straight
  stiffness: 8, // LATERAL (XZ) spring — low so the pendulum has a ~2s natural period and actually swings
  damping: 3, // lateral sway bleed (ratio ~0.53: underdamped, oscillates a few times then settles)
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
  dipThreshold: 1.2, // bucket fills while its UNDERSIDE is at/below the surface (deeper always counts), or
  // within this much ABOVE it — so a sunk or tipped-over bucket reliably scoops, not just a perfect surface kiss.
  dipReach: 4, // horizontal tolerance (units) on the water test — a swung/tilted bucket whose origin drifts
  // this far past a lake's shoreline still scoops, so "looks like it's in the lake" == "it fills".
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

// Airframe health / damage. Airframe integrity is an IMPACT model: the heli takes damage from slamming
// down (a hard landing past `hardLandingSink`). A landing whose SEVERITY clears `explodeSeverity`
// (i.e. a sink rate past the midpoint of hardLandingSink → fatalSink) is unsurvivable — the airframe
// EXPLODES on touchdown (instant mission fail). A softer-but-still-hard landing only dents the airframe,
// and grinding it to zero across several bad landings also crashes it. It REPAIRS at any base
// (alongside refuel). Flying through fire / overspeed / scraping the bucket no longer cooks the
// airframe — FUEL is the resource that ticks down and sends you back to base (see MISSIONS + FuelSim).
// Per-heli `toughness` (HELI_CLASSES) divides the dent (NOT the explosion — a slam is a slam). The
// separate `CRASH` block below covers flying INTO a tree (a mid-air rotor strike → crumble + fall).
// Engine-agnostic state lives in sim/HealthSim.ts (numbers only, like FuelSim). Tuned FORGIVING:
// normal landings and every refuel touchdown cost nothing — only a genuinely hard arrival hurts.
export const HEALTH = {
  lowWarn: 0.3, // health gauge flashes below this
  hardLandingSink: 14, // sink rate (units/s) a floor contact must beat to be a SAFE settle (no damage)
  impactDmgPerUnit: 0.05, // health lost per (unit/s) of sink ABOVE hardLandingSink on a SURVIVABLE hard landing
  // Catastrophic-impact gate ("over 50% → you explode"). A landing's SEVERITY ramps 0→1 across
  // [hardLandingSink … fatalSink]; once it crosses `explodeSeverity` the touchdown is fatal — the
  // airframe is destroyed outright and blows up where it sits (no slow bleed). 0.5 puts the
  // explosion threshold at the midpoint sink rate ((14 + 34) / 2 = 24 units/s) — a normal full-down
  // descent (~18 u/s) only dents; a committed dive-bomb into the deck blows up.
  fatalSink: 34, // sink rate (units/s) that reads as 100% severity (a vertical slam)
  explodeSeverity: 0.5, // severity fraction (0..1) at/above which the impact is unsurvivable → explode
  repairPerSec: 0.1, // health/sec restored at a base (slower than refuel — no free instant patch)
} as const;

// Crash from a TREE STRIKE + the descent warnings that precede a slam. Flying the airframe INTO the
// forest canopy (the rotor disc / fuselage catching a treetop) is fatal: the heli CRUMBLES and FALLS —
// engine cut, it tumbles ballistically to the ground and detonates on contact (sim/HelicopterSim
// beginCrash/updateCrash drive the fall; Game.detonate ends the run). The flight floor keeps you a
// canopy-clearance above flat forest, so strikes happen when you fly LOW into rising/forested terrain
// or descend among tall trees — fairly warned by the GPWS-style "SINK RATE" / "TERRAIN — PULL UP"
// callouts below. All values are world units / units-per-second; tune these to make crashing easier
// (bigger heliRadius, smaller strikeBite) or more forgiving. Engine-agnostic; consumed by Obstacles +
// HelicopterSim + Game.
export const CRASH = {
  // --- Tree strike (the airframe flies into the canopy) ---
  heliRadius: 5, // horizontal collision reach of the airframe + rotor disc (units), added to a tree's core
  canopyCore: 0.62, // fraction of a tree's canopy radius that's a SOLID strike core (the outer fringe is just needles, no hit)
  strikeBite: 3, // a treetop must rise this far ABOVE the heli's belly (within reach) to be a fatal strike — raise to soften
  warnBite: 1.5, // ...and this far above the belly to raise the "TERRAIN — PULL UP" caution (an early read on a rising canopy)
  // --- The fall after a strike (crumble + drop to the ground) ---
  gravity: 30, // downward accel (units/s²) once the engine is dead and the airframe is falling
  maxFall: 60, // terminal sink (units/s) of the dead airframe
  fallDrag: 0.5, // per-sec horizontal velocity bleed while tumbling (carries some momentum INTO the trees, then bleeds)
  initialDrop: 6, // immediate downward kick (units/s) at the strike instant so a climbing heli still falls, not floats
  tumbleYaw: 3.4, // spin (rad/s) of the dead airframe as it crumbles
  tumbleRoll: 2.8, // roll tumble (rad/s)
  tumblePitch: 1.9, // pitch tumble (rad/s)
  rotorCutSeconds: 1.1, // rotor RPM bleeds 1 → 0 over this once the engine is dead (the disc winds down as it falls)
  // --- Detonation burst (cosmetic — reuses the ember + smoke pools, no new scene objects) ---
  explodeEmbers: 30, // sparks thrown when the wreck blows up
  explodeSmoke: 9, // dense smoke puffs off the impact point
  deathHold: 2, // seconds to LINGER on the explosion/wreck (sim frozen, VFX still playing) before the
  // MISSION FAILED modal slides in — so the player actually SEES the crash instead of it being hidden
  // instantly behind the card. The mayday radio call + flash + boom fire at the impact; the modal waits.
  // --- GPWS-style descent warnings (the "proper warning" before you break the airframe) ---
  // Surfaced as a flashing centre caption (HUD.setAlert) so a player gets honest notice before a slam:
  // a SINK RATE caution while descending fast and low, escalating to PULL UP when the arrival would be
  // fatal. cautionAlt/pullUpAlt gate them by AGL so they never nag during normal high cruise.
  sinkCautionRate: 15, // descending faster than this (units/s) while low → "SINK RATE" caution (≈ HEALTH.hardLandingSink:
  // a touchdown at this sink would START denting the airframe, so the caution tracks a real consequence — not a nag)
  sinkWarningRate: 20, // ...this fast while VERY low → escalate to "PULL UP" (nearing the HEALTH explode threshold — you'll wreck it)
  cautionAlt: 90, // only warn when within this AGL of the floor (≈400 ft) — silent while cruising high
  pullUpAlt: 40, // "PULL UP" / "TERRAIN" only fire this close to the ground (≈180 ft)
} as const;

// Procedural truss bridges where a ROAD/TOWN crosses a river — a SCENIC feature + skill gate. Each
// `sites` entry spans the authored river named there at the point nearest its real lat/lon, so every
// bridge sits over real water (see meshes/bridges.ts + World.namedRiverPath/projectLatLon). The dare:
// descend below the deck and thread the helicopter UNDER it, low over the river — clip the deck, the
// truss, or a bank pier and you STRIKE (reuses the crash pipeline → crumble + fall + detonate, cause
// 'bridge'). A clean pass-through earns a quiet radio nod naming that bridge (recognition only — no
// score change), gated by `rewardCooldown`. World shapes a river VALLEY at each so the bridge spans
// the banks instead of standing on stilts. Bridges whose river isn't on the active map skip silently
// (so non-SK maps get none). Dimensions are SHARED across all bridges. All values are WORLD UNITS
// unless noted. Set enabled:false to remove them all; trim `sites` to remove individual bridges.
export const BRIDGE = {
  enabled: true,
  // Where to build a bridge: span `river` (an authored RegionRiver name) at the point nearest `near`
  // (real lat/lon). `name` labels the clean-pass radio call. These are the road-crosses-river towns.
  sites: [
    { name: 'Missinipe', river: 'Churchill River', near: { lat: 56.3159, lon: -104.7577 } }, // a narrow Churchill reach E of Otter Lake — the old Missinipe coord snapped the span onto Otter Lake's RIM (piers in water, steep shore walls beside the deck). This reach gives dry banks within the span + a clean fly-under (see scripts probe).
    { name: 'Prince Albert', river: 'Saskatchewan River', near: { lat: 53.1266, lon: -105.7296 } },
    { name: 'Saskatoon', river: 'S Saskatchewan river', near: { lat: 52.133, lon: -106.67 } },
  ],
  // --- Road integration: the carriageway runs OVER the deck (not a causeway under it) ---
  roadSnapDist: 90, // pull a road's river crossing onto a bridge centre when it passes within this (units); 0 = off. Widened to cover ROADS.bridgeAttract so a crossing the router funnelled toward the bridge is pinned exactly onto the deck
  deckRideMargin: 3, // extend the on-deck footprint by this (units) when draping the road so it fully rides the deck
  // --- Structure dimensions (shared by every bridge) ---
  span: 50, // deck LENGTH bank-to-bank (across the channel) — wide enough to land its piers on dry banks
  roadway: 14, // deck WIDTH along the flow = the front-to-back depth of the tunnel you thread
  deckClearance: 9, // height of the deck UNDERSIDE above the river surface = the headroom you fly under. Lowered (was 14) so the deck sits NEAR the terrain — the banks barely rise to meet it, killing the lumpy raised-mound look where two bridges sit close. Raise back toward 14 for taller fly-under arches at the cost of more terrain raise.
  deckThickness: 2.4, // deck slab thickness
  trussHeight: 11, // top-chord HAUNCH height above the deck (the truss height at the panel points nearest the banks)
  trussPeakRise: 6, // EXTRA top-chord rise at midspan above `trussHeight` -> a polygonal camelback (Parker-truss) silhouette peaking over the channel. 0 = a flat-top Warren truss
  trussBays: 6, // panels per truss plane; interior panel points carry the verticals and the diagonals lean toward midspan = a Pratt web (the riveted-railway look)
  trussBeam: 1.1, // truss member (chord/diagonal/post/end-post) cross-section thickness
  // Weathered-steel look (the rusted railway-truss read). All procedural: one MeshStandardMaterial + a baked vertex tint, no texture, no recompile.
  steelColor: 0x6f4a35, // base rust-brown of the steel members
  steelMetalness: 0.32, // low: oxidised iron reads matte, not chromed
  steelRoughness: 0.86,
  weathering: true, // bake a vertical rust gradient into the steel (darker/warmer near the deck, cleaner at the crown). false = flat colour
  pierWidth: 12, // each bank pier's footprint across the span — sits at the span ENDS, leaving the centre clear
  // --- Collision (the airframe-vs-bridge strike test; engine-agnostic, in meshes/bridges.ts) ---
  heliReach: 4.5, // horizontal collision radius of the airframe + rotor disc added to every solid part
  heliTopRise: 5, // how far the rotor disc sits ABOVE the belly — the vertical span tested against the deck
  // --- Clean-pass reward (recognition only) ---
  rewardCooldown: 5, // seconds before another clean pass-under can be acknowledged again (no hover-farming)
  // --- Terrain blend: shape a gentle river VALLEY at each bridge so it spans the banks instead of
  // standing tall on stilts. World.applyBridgeValleys RAISES the banks on either side toward the deck
  // (the river channel + the fly-under tunnel stay low + untouched), with a SMOOTH (quintic) profile
  // and a wide taper so the rise is a casual, polished slope — not a spike — and nearby bridges merge
  // (smooth-max) instead of stacking. Bank height + corridor width DERIVE from the bridge dims, so
  // they track any tuning. RAISE-only (never buries water — lakes + the channel are protected), no
  // rng, computed once at load → determinism + the verifier are unaffected. enabled:false = flat.
  // NOTE: gentleness is bounded by `span` — a tall deck over a SMALL span forces a steeper bank
  // (the rise must reach the deck within half the span). Widen `span` for genuinely casual walls. ---
  valley: {
    enabled: true,
    bankToDeck: 0.55, // banks rise to this fraction of the deck-top height; <1 leaves the deck slightly proud (its piers cover the gap) and keeps the wall gentler — avoids a steep "meet the deck exactly" spike. Eased from 0.78 so the banks raise LESS (with the lowered deck, only a small lift is needed) — the terrain stays near its natural height and just dips into a shallow valley at the channel
    channelFrac: 0.3, // inner fraction of the half-span kept LOW as the channel corridor; the rest is the valley wall up to the abutment. Lower = the rise STARTS nearer the water → wider, gentler wall
    approach: 30, // how far PAST the abutment (outward, away from the river) the bank holds full height before tapering — the road approach
    alongHalf: 75, // half-length of the valley ALONG the river (up/downstream of the bridge) before it fades back to natural terrain. Lengthened (was 55) so the valley eases out over a longer distance — a polished fade instead of an abrupt mound around the deck
    taper: 80, // smooth taper distance back to natural terrain at every outer edge — the dominant "beside the bridge" blend; bigger = gentler, more polished
  },
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
  fireCells: 160, // grid resolution per side AT THE CANONICAL SQUARE WORLD (160² over the 2100u map ≈ 13.125u
  // cells) — this fixes the CANONICAL CELL SIZE `CELL_U = WORLD3D.size / fireCells = 13.125u`. Rectangular /
  // resized maps keep that SAME physical cell size (nx = round(sizeX/CELL_U), nz = round(sizeZ/CELL_U)) so the
  // fire game never silently rescales — see `fireGridFor` in sim/FireSystem.ts. (bumped 128→160 earlier so the
  // bigger world keeps fire fronts crisp; the forest cut below funds the extra grid cost)
  maxCells: 25600, // 160² — the fire-grid CELL BUDGET (mobile cap on the per-frame Float32Array cost). A province
  // larger than ~2100² at the canonical cell size would exceed this; `fireGridFor` then COARSENS the cell size
  // (cellSize = max(CELL_U, √(area/maxCells))) so SK and bounds-SK are untouched and only oversized maps coarsen.
  blobCells: 24, // coarse grid the field is clustered into → up to maxActive rendered "fires"
  seedHeat: 0.2, // heat a freshly-ignited cell starts at (0..1) — a weak lick that must build
  seedRadiusU: 13, // radius (WORLD UNITS) of the disc lit when a fire is seeded/spotted — start as a SPOT.
  // Authored in units (≈1 cell at CELL_U=13.125) not cells, so a coarser grid still seeds the same physical spot.
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
  // CONTAINMENT (the "tide turns" rule — completability guarantee for `extinguishAll` score races like
  // Daily Burn). A mission may set `fire.containAfter` (FireTuning) = the number of fires the pilot must
  // knock out before the blaze is CONTAINED: from that moment the front stops throwing NEW spot fires and
  // its creep is throttled to `containedSpreadScale`, so the remaining fire can only SHRINK (doused cells
  // scorch permanently → no new heads can out-breed one bucket). Without this, a windy "clear every fire"
  // day can refill to the cap faster than a solo pilot clears it — a never-ending treadmill. Omit
  // `containAfter` (or 0) → no containment, existing missions byte-identical.
  containedSpreadScale: 0.2, // spread-rate multiplier once a mission's `containAfter` fires are out (spotting → 0
  // entirely). 0.2 = a slow residual creep the bucket trivially outpaces; raise toward 1 to keep more pressure.
  litresToClear: 35, // water litres that fully zero a cell's heat. A full 100L bambi dump (knockRef≈2.9) DECISIVELY
  // clears the cells it lands on — every cell in the ~27u disc is driven to 0, SCORCHES to mud, and locks out
  // (can't re-light). So actively bucketing a fire puts it OUT (was 135 > the 100L tank → impossible to clear a hot
  // cell; eased again 45 → 35 so it's reliably easy). A fire wider than one disc is walked pass by pass (≈1–2 passes
  // for a typical fire with the wider dropRadius); bigger buckets (212/UH-60) clear more. Pairs with DROP_PHYSICS.extinguishLock.
  fullSizeArea: 7924, // burning FOOTPRINT (world-u²) that reads as cluster size 1 (≈46 cells at CELL_U=13.125²).
  // Authored as an AREA so re-resolution converts it to this map's cells (round(area/cellSize²)) and the flame/
  // smoke scale tracks the same PHYSICAL footprint regardless of grid resolution. (raised earlier for the larger fronts)
  fireArea: 1378, // world-u² that counts as one "fire" for the burned-out / doused scoring counters (≈8 cells at CELL_U²)
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
  // Cabin detailing — the homestead read from the chase cam (all procedural, built once). The roof
  // peak stays ~4u, still well under the ~6–8u boreal canopy, so cabins don't poke above the trees.
  roofRiseFactor: 0.9, // gable rise as a fraction of cabinSize (the pitch)
  roofOverhang: 0.28, // eave/gable overhang as a fraction of the body footprint (real eaves, not flush)
  foundationTint: 0x4f4a44, // stone/earth footing skirt at the base (grounds the cabin)
  trimTint: 0x8a7a5e, // window/door frame
  windowTint: 0x241f19, // dark glazing (kept emissive-free so the fire glow owns the emissive channel)
  porchChance: 0.45, // chance of a covered front porch (two posts + a low shed roof)
  stovepipeChance: 0.4, // chance the chimney is a thin metal stovepipe instead of a stone stack
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

// Settlement DECORATION ("populate the map" pass, 2026-06-05). A non-gameplay building scatter that fills
// EVERY settlement so the province reads as lived-in: a DENSE skyline at the cities, a MEDIUM cluster at the
// fire bases, a SPARSE handful of cabins at the communities. Built once at load, merged to ≈one draw call per
// settlement (deferred + frustum-culled), off a LOCAL seed (never world.rng) so determinism + the campaign
// verifier are untouched. Pure scenery — NOT damageable Structures, NOT mission `protect` targets. Tiers are
// keyed off World's CommunitySite.tier; a DEFENDED hamlet is skipped (its real burnable cabins stand instead).
export const SETTLEMENT3D = {
  enabled: true,
  // Per tier: count = buildings, spread = scatter radius (u), minH/maxH = height range (u), footMin/Max =
  // footprint (u), spacing = min gap (u), flatRoof = city blocks vs gabled cabins, clearRadius = forest-cleared +
  // dirt-yard radius (u), innerHole = keep-clear radius at the centre (so a base's depot/pad isn't buried).
  tiers: {
    city: { count: 15, spread: 100, minH: 3, maxH: 8, footMin: 3, footMax: 6, spacing: 6, flatRoof: true, clearRadius: 100, innerHole: 0 },
    base: { count: 8, spread: 44, minH: 2, maxH: 3.5, footMin: 2.5, footMax: 4, spacing: 5, flatRoof: false, clearRadius: 40, innerHole: 16 },
    community: { count: 5, spread: 26, minH: 2, maxH: 2.5, footMin: 2, footMax: 3.5, spacing: 4, flatRoof: false, clearRadius: 26, innerHole: 0 },
  },
  baseInnerHole: 18, // any BASE (even one rendered city-tier, e.g. Prince Albert) keeps at least this clear at the centre for its depot
  padClear: 12, // keep decorative buildings at least this far from any landing pad / crew LZ (so you can still set down)
  // Palettes (hex) — vertex-coloured into the merged mesh (one shared material for all settlements):
  cityWalls: [0x9aa3ad, 0x8b9099, 0xb0a698, 0x7f8a95, 0xa6a097, 0x707880], // concrete / brick / glass-grey high-rise
  cityRoof: 0x474b51, // flat-roof parapet + rooftop mechanicals
  townWalls: [0x6b4f34, 0x7a5a3c, 0x5e4630, 0x836a4a, 0x4f4636], // log / timber cabin tints
  townRoof: [0x3a4756, 0x46352a, 0x2f3a44, 0x55392a], // dark shingle / metal / rust roofs
  speckle: 0.1, // per-building brightness wobble (worn look; 0 = flat)
  sink: 0.7, // sink each building this far into the ground so a flat base covers a gentle slope (no floating corner)
} as const;

// Highways (Track A5). A road network linking the communities — drawn as draped 3D
// asphalt ribbons that CONFORM to the terrain (a low causeway where they cross water) plus
// lines on the minimap. The network is a minimum spanning tree over the community centers
// (so every settlement is reachable, no redundant loops). Named after fictional bush
// routes. Built in World; meshes/road.ts draws them (procedural, zero assets).
export const ROADS = {
  // Master switch: the generated highway network is OFF — northern Saskatchewan is roadless bush, and the
  // road routing (avoid-water + bridge crossings) added complexity that didn't read as real. `false` makes
  // World.makeRoads return [] (no grid, no A*, no meshes; bridges + everything else unaffected). Flip to true
  // to bring the network back. Hand-painted authored roads (map editor) are also gated off by this.
  enabled: false,
  // Northern bush roads are GRAVEL, not painted asphalt — matte tan-brown, no centre line,
  // with speckled, slightly ragged shoulders so they read as worn dirt, not a cartoon strip.
  // A realistic narrow ~3u carriageway: about a third of the heli's length. Half-width here.
  width: 1.2, // half-width of the gravel ribbon (units) → ~3u carriageway
  lift: 0.2, // sit the road this far above the ground it hugs (clears z-fighting only)
  bridgeLift: 0.7, // extra height where a road crosses water (a low causeway over the surface)
  shoreClear: 0.8, // ride the road this far ABOVE a lake's surface (units) — clears the sub-water shore shelf so the deck doesn't drape at/under the waterline (the "road in the lake" 3D bug). Raise to push roads further up the bank
  smoothPasses: 2, // Laplacian smoothing passes over a road's interior points — gentle polish on the routed path (never relaxes a point onto water or a lake shelf)
  resample: 4.5, // ribbon cross-section spacing (units) — smaller = smoother road edges + better drape
  // --- Generated-network routing (World.makeRoads) — a water-aware grid A* lays each MST/corridor edge as a
  // path that goes AROUND lakes, crosses rivers SHORT (then bridged), prefers flatter ground, and MERGES onto
  // an existing road when it runs close, instead of the old straight-line-nudged-sideways (which zig-zagged). ---
  routeCell: 18, // A* grid cell size (units). Finer = tighter hug around shores + smoother detours, but more cells to build at load (cost ∝ 1/cell²)
  riverCrossCost: 5, // extra A* step cost through a river cell AWAY from a bridge → crossings stay short + roughly square; higher = the road detours harder to reach a bridge
  slopeCost: 6, // extra A* step cost × local slope → roads prefer flatter ground (gentler grades, fewer hill-climbs)
  mergeDiscount: 0.45, // cost multiplier (≤1) for a cell already carrying a road → a nearby road COALESCES onto the shared corridor (merge) rather than running parallel; 1 = no merging
  simplifyTol: 7, // line-of-sight simplify sampling step (units) — collapses the grid staircase into long straight runs that arc around lakes (kills the zigzag); the straighten never cuts across water
  // --- Bridge crossings: a road must cross a river ON its bridge, not causeway right beside it (which looks bad).
  // Within `bridgeAttract` of a bridge the river crossing is CHEAP (`bridgeCrossCost` ≪ `riverCrossCost`) and the
  // dry approach is discounted (`bridgeApproachDiscount`), so A* funnels through the deck; `snapRoadsToBridges`
  // (BRIDGE.roadSnapDist) then pins the exact crossing point onto the deck centre. ---
  bridgeAttract: 70, // radius (units) within which a bridge pulls a road's river crossing onto itself (≤ BRIDGE.roadSnapDist so the snap finishes the alignment)
  bridgeCrossCost: 0.3, // river-cross cost AT a bridge (≪ riverCrossCost) → crossing on the deck is far cheaper than a causeway elsewhere
  bridgeApproachDiscount: 0.75, // cost multiplier (≤1) for dry cells near a bridge → the road funnels its approach toward the deck
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
//   • SKILL      — precise drops, a fast clean run, fuel left in the tank, no airframe dents.
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
  hardLandingPenalty: 9, // each airframe-denting hard landing (a crash is its own 0-score loss)
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
  lzClearRadius: 30, // forest cleared within this of an LZ so the skids reach the ground (inner core fully
  // clear within radius·yardInner ≈ 15u — wider than lzRadius so NO trees sit beside the hover/landing spot
  // where the rotor could strike; trees feather back in only outside the whole acceptance circle)
  landAgl: 1.2, // height above the eased pad floor (units) below which the heli counts as LANDED (skids down)
  landSpeed: 2.0, // airspeed (units/s) below which the heli counts as stopped (no boarding on the roll)
  pickupSec: 2.2, // landed dwell to BOARD a crew at a pickup/base zone
  dropSec: 2.2, // landed dwell to set a crew DOWN at a dropoff zone
  // HOVER delivery (a zone flagged `hover`, e.g. the hover-training mission): instead of landing, HOLD A
  // STATIONARY HOVER over the spot — airborne (above skids height), under the ceiling, near-still — for
  // `hoverSec`. Board on the pad, lift to a hover over the drop area, hold it, then set them down. CrewTransport reads these.
  hoverSec: 5, // seconds of held hover over a hover-zone to complete the drop (the "5-second hover" drill)
  hoverAglMax: 12, // ceiling (units above the eased floor) for a valid hover — above landAgl, below this
  hoverSpeed: 3.5, // airspeed (units/s) below which the hover counts as "holding station" (a touch looser than landSpeed)
  // LOW HOVER DRILL: drop into a TIGHT clearing ringed by trees and hold a low, steady hover. The skill
  // is now LATERAL precision, not knife-edge altitude: the HOLD is forgiving (a generous low band, a brief
  // wobble PAUSES the timer instead of zeroing it — `lowHoverGraceSec`), but the clearing is small
  // (`lowHoverClearRadius`, far tighter than a landing LZ) so the conifer ring stands close — drift into it
  // and the rotor strikes the canopy (the normal CRASH path → mission lost). AGL is GROUND-relative (rides
  // the flight floor); keep the ceiling LOW so the belly sits down among the treetops where the ring bites.
  lowHoverSec: 8, // seconds to hold the low hover at each spot (was 12 — shortened; the tree ring is the challenge now)
  lowHoverAglMax: 10, // ceiling (units above the eased pad floor) for a valid low hover — raised 3.5→10 so the
  // insertion hover holds comfortably over the clearing instead of knife-edge among the treetops; lateral
  // precision (stay inside `lowHoverRadius`, off the ring) is the skill now, not pinning the altitude
  lowHoverSpeed: 3.0, // max airspeed (units/s) — near-stationary, a touch forgiving for the drill
  lowHoverGraceSec: 1.2, // a brief breach (drift/climb/overspeed) shorter than this PAUSES the dwell instead of resetting it
  lowHoverRadius: 11, // horizontal acceptance radius (units) for a low-hover spot — tighter than lzRadius (the hole is small)
  lowHoverClearRadius: 19, // forest cleared within this of a low-hover spot — much TIGHTER than lzClearRadius so trees ring close
  zoneSmoke: 0x39d0ff, // marker-smoke / ring tint for an ACTIVE (next) zone (cyan)
  zoneSmokeDone: 0x5a6b72, // tint once a zone is satisfied (greyed out)
  zoneHome: 0x5fe0a0, // persistent tint for the reusable HOME base zone — always lit, distinct green from the cyan LZs
  zoneLost: 0x8a3b34, // tint for a zone whose trapped family the fire reached first (a dead, ashen red — beacon out)

  // --- Casualties (the `rescue` fail): a trapped family at a single LOAD zone the FIRE reaches first ---
  // While fire heat at a pending pickup zone stays at/above `casualtyHeat`, exposure accrues; past
  // `casualtyGrace` seconds the family is LOST (the fire overran them). Dousing near them knocks the
  // heat down and RESETS the timer — so watering a trapped family buys time to reach them. Tuned
  // forgiving (a competent pilot who beelines for them gets there); raise the grace to soften.
  casualtyHeat: 0.5, // fire heat (0..1) at the family's spot that counts as "the fire's on them"
  casualtyGrace: 20, // seconds of sustained that-hot exposure before the family is lost (resets if doused)

  // --- Backburn / helitorch (the `controlLine` + `torch` loadout mechanic) ---
  // Lay a deliberate firebreak between an advancing head fire and a town: fly the marked control line
  // LOW with IGNITE held; each segment within reach lights a real backfire that scorches a permanent
  // break. `torchLightRadius` is how close the slung torch must pass a segment to light it; `torchAgl`
  // is the ceiling to light (it's a low, raking drip-torch pass, not a high drop); the laid backfire is
  // seeded at `torchIgniteRadius` cells / `torchIgniteHeat` starting heat (a modest catch that grows).
  torchLightRadius: 18, // horizontal distance (units) within which a low IGNITE pass lights a control-line segment
  torchAgl: 42, // radar altitude (units) below which the torch can light (a low pass; mirrors the drop band)
  torchIgniteRadius: 2, // ignition disc (cells) of the seeded backfire at each lit segment (≈ a 'small' catch)
  torchIgniteHeat: 0.5, // starting heat (0..1) of the seeded backfire — catches and grows into a firebreak
  torchLineColor: 0xff7a2a, // control-line marker tint — a warm ember-orange (vs the cyan crew LZs), reads as "fire line"

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

// LOW-HOVER tree ring (the Low Hover Drill feature) — a deliberate WALL of conifers ringing each
// drill clearing so the spot reads as a real "hole in the timber", not a random forest gap. The
// natural forest only THINS here (clearingFactor over `lowHoverClearRadius`); this lays a dense,
// deterministic ring in the cleared annulus, leaving a clean cutout at centre to drop into and hold.
// The ring trees register as canopy colliders (fed into Obstacles), so drifting into the wall strikes
// the rotor — the wall IS the hazard the drill trains against. `innerR` must stay ≥ `lowHoverRadius`
// so the acceptance zone stays open; `outerR` ≈ `lowHoverClearRadius` so the wall fills the cleared gap.
export const HOVER_RING = {
  innerR: 13, // clear cutout radius (units) — keep ≥ MISSIONS.lowHoverRadius (11) so the hold zone stays open
  outerR: 20, // outer edge of the tree wall (≈ MISSIONS.lowHoverClearRadius) — the cleared annulus becomes timber
  treesPerU2: 0.13, // areal density of the band → how solid the wall reads (higher = thicker, fewer gaps to clip through)
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
    // terrain/waterSegments TRIMMED in the load-perf pass: every terrain vertex + lake-disc edge samples
    // groundHeightAt (which loops all lakes/rivers) at BUILD time, so grid resolution drives boot cost O(n²).
    // Lower res = faster boot + fewer runtime verts, at a slightly softer carved shoreline.
    low: { name: 'low', dprCap: 1, shadows: false, shadowMapSize: 512, waterSegments: 88, terrainSegments: 128, bloom: 0, msaa: 0 }, // dprCap 1: low-end devices skip the ~2.5s startup jank of rendering at 2× before the watchdog steps down
    med: { name: 'med', dprCap: 2, shadows: true, shadowMapSize: 1024, waterSegments: 128, terrainSegments: 168, bloom: 1, msaa: 0 },
    high: { name: 'high', dprCap: 2, shadows: true, shadowMapSize: 2048, waterSegments: 160, terrainSegments: 208, bloom: 1, msaa: 4 },
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

// Image-based environment lighting (downloaded CC0 HDRI, see public/textures/ATTRIBUTION.txt). A
// PMREM-prefiltered equirect map is set as `scene.environment` ONLY — the procedural sky dome stays
// the visible background — so it adds realistic specular reflections + soft ambient to the heli
// body and lake water without touching the carefully-tuned sun/hemi/fog. One-time PMREM cost at
// load, zero per-frame work. Gated OFF on the low tier (saves the extra IBL ambient + a little
// VRAM). Keep `intensity` low: the hemisphere light still does the heavy lifting; this is polish.
export const ENV = {
  enabled: false,
  file: 'textures/hdri/autumn_field_puresky_1k.hdr',
  intensity: 0.35,
} as const;

// Helipad deck surfacing (downloaded CC0 PBR concrete, see public/textures/ATTRIBUTION.txt). The pad
// geometry/markings stay procedural; this just drops a real concrete albedo/normal/roughness onto the
// slab + deck cap so the surface reads as poured concrete instead of flat plastic. Shared singleton
// materials (one set for every pad, survives the in-place mission switch). `repeat` tiles the texture
// across the ~7u pad; `normalScale` is the bump depth.
export const HELIPAD = {
  textured: true,
  concrete: 'brushed_concrete_03', // slug under public/textures/pbr/<slug>/
  concreteRepeat: 2.2,
  normalScale: 0.6,
  // Terrain GRADE under each base pad: World levels the ground flat within `gradeRadius` of the pad centre,
  // blending back to natural terrain at the rim — so the flat concrete slab sits flush and the hillside can't
  // poke through it (the "cutoff"). The slab+apron (~9u) must fit inside the perfectly-level inner zone.
  gradeRadius: 16, // units — flatten-to-rim radius around a base pad
  gradeFlatInner: 0.62, // fraction of gradeRadius kept PERFECTLY level (covers slab + apron); the rest blends out
} as const;

// Terrain ground texturing (downloaded CC0 PBR albedo, see public/textures/ATTRIBUTION.txt). Adds
// real photographic grain ON TOP of the procedural biome palette via in-shader TRIPLANAR sampling
// (world-space, so it tiles seamlessly and never stretches on a cliff). It MODULATES, not replaces:
// the ground texture pushes only LIGHTNESS (keeps each biome's hue), steep faces blend toward real
// rock albedo, and the burn scar shows charred-earth detail instead of flat black. Gated to med/high
// tier (adds ~7 texture taps/fragment — low stays fully procedural). Load-time (↻ reload to apply).
export const TERRAIN_TEX = {
  enabled: true,
  ground: 'forest_ground_04', // flats — pine-forest floor grain
  rock: 'rock_ground', // steep faces — boreal-shield granite
  scorch: 'burned_ground_01', // the burn scar — cracked charred earth
  scale: 0.05, // world→uv frequency (smaller = larger surface features)
  groundStrength: 0.45, // how much ground grain modulates the biome lightness (0 = off, 1 = full)
  groundMidLuma: 0.42, // the ground texture's average luma — divides it out so the multiply is brightness-neutral
  rockStrength: 0.7, // how strongly real rock albedo takes over on steep faces
  rockBright: 1.7, // scales the rock albedo into a believable lit-granite brightness
  scorchStrength: 0.6, // charred-earth detail blended into the burn scar
} as const;

// Tree bark + foliage texturing (downloaded CC0 PBR albedo, see public/textures/ATTRIBUTION.txt). Real bark on the
// trunks (pine_bark) and broadleaf-litter detail on the foliage cones (forest_leaves_04, modulating the biome tint so
// the canopy reads less like flat plastic up close). Both 512 webp, loaded once + shared (loadAlbedo). Cheap — the
// trunks/cones are instanced, so it's one extra texture each, not per-tree.
export const TREE_TEX = {
  enabled: true,
  bark: 'pine_bark', // trunk slug
  leaves: 'forest_leaves_04', // foliage slug
  barkRepeat: 2.0, // tiling up the trunk
  leafRepeat: 1.6, // tiling across the canopy cones
  leafStrength: 0.5, // how strongly the leaf albedo modulates the foliage tint (0 = off/procedural, 1 = full photo)
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
  samples: 36, // ray-march steps from each pixel toward the sun (compile-time constant). Perf pass 48→36:
  // the shaft quality is near-identical but it's a per-fragment loop on med/high, so fewer steps = real headroom.
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
  warmHighlights: 0.07, // how far highlights push warm (orange) — nudged for a touch more golden pop
  coolShadows: 0.05, // how far shadows push cool (teal)
  saturation: 1.18, // saturation lift (>1 richer, 1 = neutral). 1.08→1.18 in the colour pass — the boreal
  // greens + lake blues read fuller instead of dull/washed; kept under ~1.2 so it enriches, not over-cooks.
  contrast: 1.07, // gentle S-curve contrast around mid grey (1.05→1.07 — a hair more punch with the saturation)
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
  // Anti-POP recycle window (heavy stages): emit() scans this many slots forward from the cursor for a
  // genuinely DEAD slot before reusing one — so it never stomps a still-rising puff while free slots
  // exist (the cause of the mid-distance teleport pop). If the whole window is alive it recycles the
  // MOST-FADED puff in it (a near-gone puff blinking out is invisible). FIXED → O(1)/emit, no growth.
  recycleScan: 24, // slots scanned per emit for a free/faded victim (8 fires × ~6 puffs/burst worst case)
  // Distance-gated spawn budget (heavy stages can demand ~16× the pool): a fire this far from the eye
  // emits FEWER puffs (its column is small on-screen anyway), so the pool's budget is spent on the
  // columns the player can actually see instead of starving every column to flicker. 0 = no culling.
  spawnNearDist: 700, // within this (world units) a fire emits its full per-burst puff count
  spawnFarDist: 2600, // by this distance it emits the FLOOR count; beyond, still the floor (never 0)
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
  // --- Nebula-style LIFE: churn + convective billow + lit-by-fire flicker (GPU-only, uTime-driven) -
  // The redstapler "nebula" look = soft cloud sprites that slowly ROTATE and are LIT by coloured
  // fire lights. We bring that life to the column without a 2nd draw call: each puff churns (its
  // sprite rotates over its life, mixed CW/CCW), the column BILLOWS (a travelling sideways S-wave so
  // it convects instead of rising as a straight cone), and the fire-lit base FLICKERS like firelight.
  spin: 0.28, // churn: per-puff sprite rotation rate (rad/s); mixed direction by seed (0 = old static look)
  swayAmp: 7, // convective billow: max lateral wander (world units) at the top of a puff's life
  swayFreq: 0.5, // temporal frequency of that billow (how fast the column meanders)
  swayWave: 0.02, // spatial frequency vs rise — gives a travelling S-curve up the column (0 = sways as a block)
  emberColor: 0xff2e08, // deep-red ember tone the DENSE core of a lit base puff glows (orange rim → red core)
  warmFlicker: 0.4, // 0..1: how much the fire-lit base glow pulses like living firelight
  flickerSpeed: 7, // temporal frequency of that base flicker (Hz-ish)
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
  crashVolume: 0.75, // the impact boom when the airframe hits the ground / explodes (the loudest cue — it's a crash)
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
  // Free-look (drag ANYWHERE on the flight view — the eye button was retired): the camera orbits the
  // heli 1:1 with the drag. Each dragged pixel adds this many radians of orbit; release eases the view
  // back to the default chase pose. Tune these for drag sensitivity (bigger = the view swings faster).
  lookDragYaw: 0.009, // rad of horizontal orbit per px dragged (~a 200px swipe ≈ 100°)
  lookDragPitch: 0.006, // rad of vertical orbit per px dragged (lower = gentler tilt; clamped by lookPitch*)
  lookPitchMin: -0.45, // lowest the cam tilts (below the heli, looking up) — radians
  lookPitchMax: 1.15, // highest the cam tilts (overhead, looking down) — radians
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

// Free-for-all "Open Skies" — the endless, shared-map score race the planned co-op became. Everyone
// flies the SAME daily-seeded Saskatchewan; the fires never stop coming; each pilot racks up a personal
// score from the fires they knock down (no win, no lose — fly until you leave). This block is PACING
// only; the scenario (seed, opening fires, "endless" flag) lives in missions/freeforall.ts.
export const FFA = {
  targetActive: 8, // keep roughly this many fires burning — the spawner tops up toward it while below
  spawnEverySec: 5, // cadence (s) at which the spawner tries to add one fire while under targetActive
  pointsPerFire: 100, // score awarded per fire knocked down with water
  pointsPerHit: 6, // small bonus per EFFECTIVE drop (rewards steady, accurate work between kills)
  fireMilestone: 10, // in-flight "fires out  N/M" readout rounds the target up to the next multiple of this
  scoreMilestone: 500, // ditto for the live "score  N/M" readout — keeps the counters always chasing
  boardEverySec: 45, // push the running score to the shared per-day board this often (so others see you climb)
  // Live presence (Slice 3): broadcast your heli pose over a Supabase Realtime channel so OTHER pilots
  // appear as ghosts in your sky (code-split; degrades to solo when Supabase is unconfigured).
  netSendHz: 12, // own-pose broadcast rate to the shared channel
  netInterpMs: 160, // remote-pilot smoothing time constant — rides through 12Hz jitter without lag
  netStaleMs: 6000, // drop a remote pilot not heard from in this long (left / disconnected)
  netMaxRemotes: 8, // hard cap on simultaneously-rendered ghost pilots (perf)
  // Pose `flags` bitfield (set in Game.sendPose, decoded by RemotePilots). Lives here, NOT in the
  // code-split openSkies.ts, so Game can read it without statically pulling realtime-js into the bundle.
  poseFlagBucket: 1, // bit 0: a slung bucket is rigged (water payload + attached) → render the ghost's bucket
  poseFlagDropping: 2, // bit 1: pouring water right now → peers pour spray from the ghost's bucket mouth
  // Spawn scatter: every pilot's home pad is the SAME deterministic XZ, so a naive spawn stacks every ship
  // (and ghost) on one spot — they overlap and re-collide the instant immunity ends. Each client instead
  // takes a slot on a ring (this radius, world units) around the pad: deterministic from its own id when it
  // can't yet see peers (initial spawn), then occupancy-aware against the ghosts it sees (respawn).
  spawnRing: 18, // radius (u) of the home-pad spawn ring — ≥ 2× collideRadius so neighbouring slots clear
  // Pilot-vs-pilot: a mid-air collision blows BOTH ships out of the sky (each client detects it locally
  // against the ghost it renders → no host needed), then they respawn in flight.
  collideRadius: 9, // world units — centre-to-centre distance that counts as a collision (~an airframe length)
  collideMinAgl: 6, // both ships must be at least this high → helis parked at a base don't "collide"
  respawnSec: 1.6, // how long the wreck burns before respawning airborne (the free-for-all death hold)
  respawnInvulnSec: 2.5, // collision immunity right after a respawn → can't be re-killed instantly by a ship camping the pad
} as const;

// --- Live tuning registry (dev tooling) -------------------------------------
// Every tunable block, by name. The dev slider panel (`dev/ConfigPanel.ts`, toggled with the
// backtick key under `import.meta.env.DEV || ?qa || ?tune`) walks this to auto-generate a control
// per value, and mutates these SAME object references — so a runtime knob (flight/bucket/fire/
// camera/drop/audio…) updates on the next frame. The objects are `as const` for editing safety in
// source, but JS lets us mutate them at runtime through this loosely-typed view (intentional, dev-only).
export const CONFIG_REGISTRY: Record<string, Record<string, unknown>> = {
  WORLD3D, MAPGEO, TERRAIN, LAKE_SHAPE, STREAM, BIOMES, FOREST,
  FLIGHT, STARTUP, WASH, INSTRUMENTS, BUCKET3D, DROP_PHYSICS, DROP_FX, FIREHEAD,
  HELI_CLASSES, HEALTH, CRASH, BRIDGE,
  FIRE3D, STRUCTURES, STRUCT_FIRE, COMMUNITIES, SETTLEMENT3D, ROADS, SCORE, MISSIONS, FFA, FAUNA, HELIPAD, TERRAIN_TEX, TREE_TEX,
  QUALITY, POSTFX, ENV, GODRAYS, GRADE, FIRELIGHT, EMBERS, AMBIENT_EMBERS,
  WATER, CLOUDS, SPRAY, SMOKE, HAZE, AUDIO, CAMERA, TITLE,
};

// A deep clone captured BEFORE overrides are applied — the panel's "reset to default" baseline.
// (JSON round-trip is safe here: these blocks are pure number/string/boolean/array/object data.)
export const CONFIG_DEFAULTS: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(CONFIG_REGISTRY));

// Re-apply whatever the tuning panel saved last session, so load-time knobs (terrain, world-gen,
// quality…) take effect too. No-op in the headless Node bundle and when nothing is stored.
applyConfigOverrides(CONFIG_REGISTRY);
