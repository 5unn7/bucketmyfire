// Central tuning for the 3D build. The world is a real Y-up scene now: the
// helicopter flies in the XZ plane with altitude along +Y. Values are in world
// units (the terrain spans ~600 units; the aircraft is ~8 units long), retuned
// down from the old 2D pixel scale but preserving the same momentum "feel".

export const WORLD3D = {
  size: 600, // square terrain extent, centered at origin
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
  // Palette (hex)
  colorShore: 0x9c8d63, // gravel/sand
  colorMeadow: 0x6f8f3f, // light grassy green
  colorForest: 0x355e2c, // deep boreal green
  colorRock: 0x6f7176, // granite grey
  // Tree placement (acceptance probability + foliage tint per biome)
  densForest: 1.0,
  densMeadow: 0.32, // denser meadow scatter — more trees overall
  densShore: 0.06,
  densRock: 0.03,
  tintForest: 0x2f5d34,
  tintMeadow: 0x4f7e40,
} as const;

// Flight model — momentum integrator with helicopter-style steering: the pilot
// yaws the nose directly and applies variable throttle ALONG it; thrust adds to
// velocity, drag bleeds it, speed is capped, and the airframe banks into turns /
// pitches with the throttle. Altitude (collective) carries its own inertia so
// climbs/descents feel weighty.
export const FLIGHT = {
  enginePower: 140, // horizontal thrust (units/s^2) in the input direction
  linearDrag: 1.6, // horizontal air resistance: higher = settles faster
  maxSpeed: 70, // horizontal speed cap (units/s)
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
  maxPitch: 0.4, // radians of dive/flare at full fore/aft acceleration
  cruisePitch: 0.1, // extra persistent nose-down at top speed (disc tilted to hold cruise)
  bodyEase: 0.1, // how fast bank/pitch ease toward their targets (lower = softer/heavier)
  // Collective: the pilot raises/lowers altitude directly. To scoop you simply
  // descend over a lake until the slung bucket dips into the water (no scoop
  // button — the fill is physical). Vertical speed EASES in (rotor inertia) instead
  // of snapping, and the ease is now framerate-independent.
  climbSpeed: 22, // max climb rate (units/s) at full UP collective, empty bucket
  descendSpeed: 24, // max descent rate (units/s) at full DOWN collective (weight assists — no payload cut)
  collectiveResponse: 0.07, // vertical inertia: lower = heavier/slower to spool up & down (per-60fps factor)
  startAltitude: 30,
  rotorSpin: 26, // main-rotor visual spin (rad/s)
  tailRotorSpin: 42, // tail-rotor visual spin (rad/s)

  // --- AGL flight band (replaces the old absolute min/maxAltitude) ---
  // The heli flies in a band that RIDES the flight floor from World.flightFloorAt,
  // so a fixed-clearance descent always lands the same height above whatever's
  // below — ground on land, the water surface over a lake. The floor itself bakes
  // in the surface-specific offset (canopy over land, scoop over water); these two
  // are an extra global band around it.
  minClearance: 0, // hover margin above the floor at full descent (0 = sit on the floor)
  maxClearance: 50, // ceiling above the floor at full climb
  canopyClearance: 8, // land floor = ground + this — keeps the rotor disc above the canopy
  scoopClearance: 2, // water floor = waterLevel + this — low enough that the slung bucket dips under

  // --- Weight coupling: a full bucket flies heavy and sluggish, recovers on drop ---
  // Each penalty is the fraction shaved off the parameter at a full (ratio = 1) bucket.
  payloadAccelPenalty: 0.35, // engine thrust loss when loaded
  payloadSpeedPenalty: 0.25, // top-speed loss when loaded
  payloadClimbPenalty: 0.4, // climb-rate loss when loaded (so a full bucket barely out-climbs the sink)
  // A full bucket drags the aircraft DOWN: a constant sink (units/s) the rotor must
  // fight, so you have to hold collective just to hold height when loaded — and it
  // takes longer to spool the climb (responsePenalty). Both fade as water drains.
  payloadSink: 6, // downward drift (units/s) at a full bucket
  payloadResponsePenalty: 0.5, // fraction of vertical responsiveness lost when full (laggier collective)
};

// Bambi bucket slung under the heli on a rope. Spring-damped so it lags in turns
// and overshoots on stops (payload physics); water leaves the bucket's world XZ,
// not the heli's, so smooth flying bombs true. Mirrors the old 2D BUCKET_PHYS.
export const BUCKET3D = {
  ropeLength: 7, // rest hang below the heli (units)
  stiffness: 90, // LATERAL (XZ) spring pulling the bucket under the heli
  damping: 9, // lateral sway bleed
  massEmpty: 1.0,
  massFull: 1.6, // a full bucket is heavier → more lateral lag/overshoot
  // How hard the heli's velocity drags the bucket's rest target back. Higher =
  // the bucket (and the rope with it) trail further behind the faster you fly.
  // At top speed this pushes the offset toward maxSwing so the rope rakes way back.
  swayFromVel: 0.09, // heli velocity blended into the rest target (turn/speed trail)
  fullSag: 1.5, // extra hang when full
  // Vertical follow is near-rigid (high = no up/down bounce) — the rope barely
  // stretches in Y, so only the lateral swing reads. Per design feedback.
  verticalFollow: 0.5,
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
  // small downward dip offset, then levels out when it lifts clear. Vertical stays
  // near-rigid (verticalFollow) so only the tilt + tiny dip read — per design feedback.
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
  bottomOffset: 1.2, // bucket underside below its origin (body half-height) — the contact point
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

// Forest fire simulation (slowed + capped, per the 2D tuning lesson).
export const FIRE3D = {
  count: 6, // fires at the start
  maxIntensity: 100,
  regrowth: 3.5, // intensity/sec when ignored
  spreadIntervalMs: 9000, // creep cadence
  spreadChance: 0.15, // per active fire, per tick
  spreadDistance: 30, // world units a new fire spawns from its parent
  maxActive: 14, // hard cap — spread can't run away
  // Douse is by VOLUME of water delivered, not by time, so a fast one-shot dump
  // and a slow valve pour knock a fire down by the same amount per litre. With
  // capacity 100 and maxIntensity 100, ~1.2 means a full tank kills a full fire
  // (with margin) — and a half-load valve drop knocks it halfway. (Track C.)
  dousePerLitre: 1.2, // fire intensity removed per litre of water landing in radius
};

// --- Track B (visuals) ------------------------------------------------------

// Quality tiers (B0). One auto-detected preset scales every later visual phase;
// an adaptive frame-time watchdog can step DOWN a tier (cheap: DPR + shadows) if
// the device can't hold frame rate. Load-time-only fields (shadowMapSize,
// waterSegments) are read once at construction — changing them would recompile.
export const QUALITY = {
  presets: {
    low: { name: 'low', dprCap: 1, shadows: false, shadowMapSize: 512, waterSegments: 64 },
    med: { name: 'med', dprCap: 1.5, shadows: true, shadowMapSize: 1024, waterSegments: 112 },
    high: { name: 'high', dprCap: 2, shadows: true, shadowMapSize: 2048, waterSegments: 160 },
  },
  downgradeMs: 22, // EMA frame-time (≈45fps) above which we're "over budget"
  downgradeWindowSec: 2.5, // sustained over-budget time before stepping a tier down
  emaAlpha: 0.08, // smoothing on the frame-time average
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
  foamColor: 0xeaf6ff,
  depthRange: 7.0, // water depth (units) over which shallow→deep blends (gradual fade)
  foamWidth: 1.3, // shore band (units of depth) that foams
  waveAmp: 0.08, // vertical surface ripple amplitude (units) — tiny, keeps it reading flat
  waveScale: 0.12, // spatial frequency of the surface swell
  waveSpeed: 1.3, // swell scroll speed
  normalStrength: 0.5, // how hard the animated normals perturb lighting (0..1)
  fresnelPower: 4.0,
  opacity: 0.9,
  // Ripple rings (bucket dip + drop splash)
  rippleSpeed: 14, // ring expansion (units/sec)
  rippleLife: 1.6, // seconds a ring lives
  rippleWidth: 1.6, // ring thickness (units)
  dipStrength: 0.45, // ring punch from a scooping bucket dip
  dropStrength: 0.9, // ring punch from a water drop impact
} as const;

// Water-drop spray (the visible payload release). A pooled, fixed-size GPU Points
// cloud: while the DROP is held, droplets pour from the bucket mouth, fall under
// gravity (inheriting some heli velocity so the column smears forward), and die when
// they hit the surface below — over a lake that impact also spawns a ripple ring.
// Procedural soft disc in the fragment shader → zero textures, zero binary assets.
export const SPRAY = {
  max: 420, // pooled particle cap (ring buffer — never grows, never recompiles)
  perEmit: 12, // droplets spawned per emission while dropping
  emitInterval: 0.022, // seconds between emissions while the drop is held
  speedDown: 13, // initial downward speed (units/s)
  spread: 5.5, // random lateral velocity spread (units/s)
  inherit: 0.55, // fraction of heli horizontal velocity carried into the spray
  gravity: 38, // downward accel (units/s^2)
  life: 1.0, // particle lifetime (seconds) — also the impact fallback
  size: 3.4, // base point size
  color: 0xcdeaf6, // water-white
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
