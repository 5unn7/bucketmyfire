import * as THREE from 'three';
import { createTerrain } from './meshes/terrain';
import { createTreeField, TreeField } from './meshes/trees';
import { deciduousSpecies, snagSpecies, speciesRng } from './meshes/treeSpecies';
import { createRiverMesh } from './meshes/river';
import { createRoadMesh } from './meshes/road';
import { createYardPatch, createYardMaterial } from './meshes/clearing';
import { createDock } from './meshes/dock';
import { createHelipad } from './meshes/helipad';
import { applyFoliageSway, type LeafDetail } from './meshes/foliageWind';
import { loadAlbedo } from './meshes/pbrTextures';
import { createHelicopter, HelicopterMesh } from './meshes/helicopter';
import { createBucket, BucketMesh } from './meshes/bucket';
import { HelicopterSim } from './sim/HelicopterSim';
import { BucketSim } from './sim/BucketSim';
import { Wind } from './sim/Wind';
import { RotorWash } from './sim/RotorWash';
import { FireSystem, fireGridFor } from './sim/FireSystem';
import { Structures } from './sim/Structures';
import { createFire, FireMesh } from './meshes/fire';
import { createStructure, StructureMesh } from './meshes/cabin';
import { Lake } from './Lake';
import { World, type CommunitySite } from './World';
import { createSettlement, createSettlementMaterial, type SettlementTier } from './meshes/settlement';
import { Fauna } from './Fauna';
import { buildMinimap } from './world/minimap';
import { ChaseCamera } from './ChaseCamera';
import { Obstacles } from './Obstacles';
import { Input, ControlState } from './Input';
import { HUD } from './HUD';
import { FrameContext } from './render/FrameContext';
import { FireFieldTexture } from './render/FireFieldTexture';
import { QualityTier } from './render/QualityTier';
import { Ripples } from './water/Ripples';
import { createWaterMaterial } from './water/WaterMaterial';
import { WaterSpray } from './vfx/WaterSpray';
import { DropMarker } from './vfx/DropMarker';
import { FireHeadMarkers } from './vfx/FireHeadMarkers';
import { SmokePlume } from './vfx/SmokePlume';
import { Embers } from './vfx/Embers';
import { AmbientEmbers } from './vfx/AmbientEmbers';
import { createSkyDome } from './sky/SkyDome';
import { applyAtmosphere, SKY_PRESETS, SUN_DISTANCE } from './sky/TimeOfDay';
import { HeroFireLights } from './lighting/HeroFireLights';
import type { HazeSource } from './postfx/Composer';
import { HeliAudio } from './audio/HeliAudio';
import { Profile } from './ui/profile';
import { createCrewFigures, CrewFigures } from './meshes/crewFigures';
import { createLandingZone, LandingZoneMesh } from './meshes/landingZone';
import { createBridge, type Bridge } from './meshes/bridges';
import { CrewTransport, CrewZone } from './sim/CrewTransport';
import { Backburn } from './sim/Backburn';
import { FuelSim } from './sim/FuelSim';
import { HealthSim } from './sim/HealthSim';
import { MissionRuntime } from './missions/MissionRuntime';
import { MissionDirector } from './missions/MissionDirector';
import { recordWin, getProgress } from './missions/progress';
import { isDailyId } from './missions/daily';
import { recordDailyClear } from './missions/streak';
import { newlyUnlockedHelis, markColdStartSeen } from './ui/profile';
import { submitScore } from './leaderboard/client';
import { cloudAutoSave } from './leaderboard/cloudSave';
import { button, UI, FW } from './ui/theme';
import { coached, coachBump } from './ui/hints';
import { CoachDirector } from './ui/coach/CoachDirector';
import { tutorialDone, markTutorialDone } from './ui/coach/coachStore';
import { CAMPAIGN } from './missions/catalog';
import type { MissionDef, MissionSignals, MissionAction, ZonePlacement, ScoreTally } from './missions/types';
import type { EndScreenHooks } from './HUD';
import { seedFires, structurePlan, crewZones, resolveCrewZone, igniteFromPlacement, backburnLine } from './missions/scenario';
import { WORLD3D, FLIGHT, STARTUP, BUCKET3D, DROP_PHYSICS, DROP_FX, FIREHEAD, CAMERA, FIRE3D, WATER, WASH, SPRAY, SMOKE, EMBERS, INSTRUMENTS, ROADS, MISSIONS, COMMUNITIES, SETTLEMENT3D, HELIPAD, SCORE, FOREST, TREE_TEX, STRUCT_FIRE, CRASH, BRIDGE, resolveHeliClass } from './config';

// Instrument calibration factors (world units → real-world HUD units). Derived from
// the FLIGHT caps so the gauges stay consistent if those are retuned.
const KT_PER_UNIT = INSTRUMENTS.topSpeedKt / FLIGHT.maxSpeed; // airspeed → knots
const FT_PER_UNIT = INSTRUMENTS.ceilingFt / FLIGHT.maxClearance; // AGL → feet
const FPM_PER_UNIT = FT_PER_UNIT * 60; // vertical speed → ft/min (coherent with the altitude scale)
const SEA_LEVEL = 0; // world-Y datum the MSL altimeter measures from (terrain centers near 0)

// Scratch objects for posing the slung bucket each frame (no per-frame allocation —
// mobile-60fps invariant). _UP/_X are constant local axes; the rest are reused temps.
const _UP = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _ropeDir = new THREE.Vector3();
const _swingQuat = new THREE.Quaternion();
const _tipQuat = new THREE.Quaternion();
const _bucketQuat = new THREE.Quaternion();
const _swivel = new THREE.Vector3();
const _bellyAnchor = new THREE.Vector3(); // cargo hook world position (belly of heli, above skid line)

/**
 * The 3D scene + per-frame orchestration. Owns the Three scene graph (sky, light,
 * terrain, forest, lakes, fires, helicopter + slung bucket), the engine-agnostic
 * sims (flight, bucket, wind), the chase camera, input, and the DOM HUD. Each
 * frame it advances the sims, poses meshes from their numbers, runs the scoop /
 * drop / fire-spread game logic, trails the camera, and syncs the HUD. All the
 * "feel" math lives in the sim modules so Game.ts stays "draw + rules".
 */
export class Game {
  readonly scene = new THREE.Scene();
  private readonly chase: ChaseCamera;
  private readonly sun: THREE.DirectionalLight;
  // The sun's world offset from the heli (preset.sunDir × SUN_DISTANCE) — set once from the
  // mission's time-of-day preset, re-added to the heli each frame so shadows + god-rays track it.
  private readonly sunOffset = new THREE.Vector3();
  private readonly skyDome: THREE.Object3D; // gradient sky (B2) — follows the camera
  private readonly input: Input;
  private readonly hud: HUD;

  private readonly heliSim: HelicopterSim; // built in the ctor with the selected heli's class
  private readonly healthSim: HealthSim; // airframe health/damage (crash on zero) — every mission
  private readonly heli: HelicopterMesh;
  private readonly bucketSim: BucketSim;
  private readonly bucket: BucketMesh;
  private readonly rope: THREE.Line;
  private readonly ropeGeom: THREE.BufferGeometry;

  private readonly wind: Wind; // seeded from the mission's wind override (angle + strength)
  private readonly wash = new RotorWash(); // C4: rotor-downwash signal (water/foliage/fire + ground effect)
  private readonly world: World; // built from the mission seed (assigned first in the ctor)
  private readonly fauna: Fauna; // wildlife (moose/deer/loons…) — depends on world
  private readonly forest: TreeField; // chunked conifer forest (DEFERRED) — culled each frame to what's in view
  private readonly forestNear: TreeField; // small SYNCHRONOUS conifer patch around the spawn — present at first frame
  // Decorative accent fields, built one tick AFTER the first frame (see buildAccentFoliage): they're
  // not colliders and the sim is frozen on the briefing/cold-start deck while they pop in, so deferring
  // them off the construction critical path shaves the first-frame freeze with no visible cost. Null
  // until that deferred build runs (and again after dispose), so the per-frame use sites guard with `?.`.
  private groves: TreeField | null = null; // deciduous (birch/aspen) accent trees
  private snags: TreeField | null = null; // burnt dead-standing snags
  private accentFoliageTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false; // set by dispose(): stops deferred work + per-frame stepping after teardown
  // Deferred scene build (load-perf): the heavy NON-critical meshing (lakes/rivers/roads/yards + the
  // FOREST) is queued here and pumped a few-ms/frame by main.ts AFTER the first frame, so it streams in
  // under the cold-start spool instead of freezing the boot. The CRITICAL scene (terrain, heli, pad,
  // sky, fire, structures) is still built synchronously in the constructor. Each item is a budget-aware
  // stepper `(budgetMs) => done`: one-shot items (a lake/river/road) ignore the budget and return true;
  // the forest returns false until its internal `buildStep` has scattered + meshed every chunk.
  private readonly deferredBuild: ((budgetMs: number) => boolean)[] = [];
  private deferredIdx = 0;
  private obstacles: Obstacles; // bucket collision height field — rebuilt when the deferred forest finishes
  private readonly frame = new FrameContext(); // shared time/wind/sun uniform bus (B0)
  private readonly ripples = new Ripples(); // 8-slot water ripple pool (B1)
  private readonly spray = new WaterSpray(); // pooled water-drop spray (B4/C2)
  private readonly smoke = new SmokePlume(this.frame); // pooled per-fire smoke plumes (B4); shares the uTime bus
  private readonly embers = new Embers(); // pooled per-fire sparks/embers (cinematic layer)
  private readonly ambientEmbers = new AmbientEmbers(); // subtle drifting amber motes around the camera
  private readonly audio = new HeliAudio(); // procedural rotor drone + scoop/drop/win SFX
  private readonly lakes: Lake[] = [];
  // C3: engine-agnostic fire sim (owns fire state as numbers) + a FIXED pool of fire
  // meshes synced to its active fires each frame (no runtime scene add/remove → no
  // shader recompiles, honoring the mobile-60fps invariant).
  private readonly fireSystem: FireSystem;
  private readonly fireMeshes: FireMesh[] = [];
  // C5 continuous burn: the live fire field packed into a DataTexture each frame, sampled by the
  // terrain (char + ember glow) and rasterized onto the radar (burn scar) — so the fire reads as
  // one advancing region, not ≤14 dots, and the ground it crosses chars + the minimap shades it.
  // Sized to the world's RECTANGULAR fire grid → built in the ctor after `this.world` exists (TDZ).
  private readonly fireField: FireFieldTexture;
  private readonly heroFire = new HeroFireLights(this.scene); // B3: fixed pool of fire lights
  // C3 stakes: structures to defend (engine-agnostic state) + a fixed pool of meshes
  // synced to them each frame. Lose when every structure burns down.
  private readonly structures: Structures;
  // Burning-structure event tracking: edge-detect ignite/lost per structure for the radio callouts,
  // with a cooldown so a whole hamlet catching doesn't spam comms. (Indices align with structures.list.)
  private structIgniteTimer = 0;
  private readonly structBurnPrev: boolean[] = [];
  private readonly structDeadPrev: boolean[] = [];
  private readonly structureMeshes: StructureMesh[] = [];

  private water = 0;
  private dumping = false; // 'bambi' bucket: a one-tap dump is in progress (drains to empty)
  // --- Water-drop physical model (height → footprint, wind drift) ----------------------------------
  private readonly dropMarker: DropMarker; // predicted-impact ring (built in the ctor once scene exists)
  private readonly fireHeads: FireHeadMarkers; // hot chevrons on each fire's advancing head (where to drop)
  private bucketObstacleY = 0; // cached collision surface under the bucket (set in update) → drop AGL
  // Reused scratch for the resolved drop geometry (alloc-free): impact center, footprint, density, AGL.
  private readonly _drop = { cx: 0, cz: 0, radius: BUCKET3D.dropRadius, densityMul: 1, agl: 0, inBand: true };
  private dropActive = false; // a drop is currently pouring (drives the one-shot readout on release)
  // Per-drop tally (reused) → the post-drop Dispatch readout: cumulative heat removed, peak heat present,
  // and density-weighted litres so we can classify "Direct hit" / "Edge only" / "Too high" / "Missed".
  private readonly dropTally = { heatRemoved: 0, peakHeatPresent: 0, effSum: 0, litreSum: 0 };
  // Cold engine start: every mission begins shut down on the deck at base. The pilot HOLDS the START
  // dial to spool the rotor from rest to full; flight + the mission clock stay frozen until then.
  // `rotorRpm` scales the rotor visuals + the audio drone; `engineStarted` latches at full RPM.
  // Headless QA skips the ritual (engineStarted true, rpm 1, airborne at origin as before).
  private rotorRpm: number;
  private engineStarted: boolean;
  private won = false;
  private lost = false; // C3: every structure destroyed → mission failed (latches the sim off)
  private crashed = false; // airframe destroyed (a Game-level loss, any mission) — explosion has fired
  private crashCause: 'tree' | 'impact' | 'airframe' | 'bridge' | null = null; // why the wreck — picks the mayday copy
  /** The scenic bridges on this map (empty on maps without any / when BRIDGE.enabled is false). Public for QA via __game. */
  bridges: Bridge[] = [];
  // Per-bridge clean-pass tracking (indices align with `bridges`): are we under it, which side we
  // entered from, and the per-bridge cooldown until another clean pass can be acknowledged.
  private bridgePass: { under: boolean; enterU: number; cd: number }[] = [];
  /** Clean pass-throughs under any bridge this session (read by QA / future achievements). */
  bridgePasses = 0;
  private crashHold = 0; // s remaining to linger on the explosion before the MISSION FAILED modal (CRASH.deathHold)
  private airframeHitCd = 0; // cooldown (s) so one hard landing fires ONE damage warning, not a per-frame burst
  private bucketFull = false; // latched once a scoop tops off — one "bucket full" cue per fill, re-armed on release
  private finalScore = 0; // computed once when the mission ends (win or loss)
  // --- Score telemetry (feeds the reworked ScoreTally → missions/score.ts) ---------------------------
  // Accumulated over the run: drop precision (effective vs wasted pours), the worst conditions actually
  // faced (peak threat + peak fire load → dynamic hardship), and airframe-denting hard landings (a penalty).
  private scoreDrops = 0; // committed pours that released water
  private scoreDropsEffective = 0; // pours that knocked down meaningful heat (a "hit")
  private scoreDropsWasted = 0; // pours that missed or dispersed too high
  private peakThreat = 0; // worst structure threat survived, 0..1
  private peakFireLoad = 0; // most fires active at once
  private hardLandings = 0; // airframe-denting touchdowns
  private elapsed = 0; // total seconds, drives fire flicker
  private rippleTimer = 0; // throttles ripple-ring spawns while scooping/dropping
  // Reused HUD-radar buffers so the per-frame HUD payload allocates NO new arrays/objects for the
  // radar (the mobile-60fps no-per-frame-alloc invariant). `fireRadar` is a pooled {x,z} list refilled
  // in place and trimmed to the live fire count; `lakeRadar` is cached + invalidated once the deferred
  // lake build drains (pumpBuild), since lakes now stream in over the first frames.
  private readonly fireRadar: { x: number; z: number }[] = [];
  private lakeRadar: { x: number; z: number; r: number }[] | null = null;
  private washRippleTimer = 0; // throttles the downwash ripple rings under a low heli (C4)
  private sprayAccum = 0; // throttles drop-spray emission to SPRAY.emitInterval
  private smokeAccum = 0; // throttles per-fire smoke puff bursts to SMOKE.emitInterval
  private emberAccum = 0; // throttles per-fire ember bursts to EMBERS.emitInterval
  private smokeVeil = 0; // C5: eased blinding-smoke veil opacity (camera-in-plume)
  // B4 heat haze: a pooled list of the active fire crowns + heat, refreshed each frame and read
  // by the postfx HeatHaze pass (Composer.render). Pooled to maxActive so there's no per-frame
  // alloc; entries past `hazeCount` carry heat 0 and the pass skips them.
  readonly hazeSources: HazeSource[] = Array.from({ length: FIRE3D.maxActive }, () => ({
    x: 0,
    y: 0,
    z: 0,
    heat: 0,
  }));
  private hazeCount = 0;

  private readonly pilotName?: string; // callsign from onboarding (display only)
  // Aircraft whose campaign gate this win just crossed — computed once at latchOutcome, shown on the
  // end screen as a "NEW AIRCRAFT UNLOCKED" callout. Empty on a loss / replay / non-threshold win.
  private newlyUnlocked: { name: string; tagline: string }[] = [];
  private readonly mapId?: string; // selected map id (v1: nominal — one playable map)
  private readonly heliId?: string; // selected helicopter id (v1: nominal — one playable heli)
  private readonly capacity: number; // this heli's bucket capacity (litres) — from HELI_CLASSES
  private readonly fillRate: number; // this heli's scoop fill rate (litres/sec) — from HELI_CLASSES

  // --- Campaign layer -------------------------------------------------------
  private readonly mission: MissionDef;
  private readonly runtime: MissionRuntime; // objective/fail evaluation (engine-agnostic)
  private readonly director: MissionDirector; // reactive beats: comms / flare-ups / wind shifts
  private readonly fireBoundX: number; // valid-fire-site X half-extent (rect-aware; matches scenario seeding)
  private readonly fireBoundZ: number; // …and Z half-extent (= fireBoundX on square maps)
  private inBriefing = true; // pre-flight briefing card up → sim + clock paused until BEGIN
  private readonly coach: CoachDirector; // interactive first-flight tutorial (inert unless gated on)
  private coachShown = false; // the coach overlay has been surfaced this game
  private coachCompleted = false; // tutorial finished/skipped → stop driving the coach
  private payloadMode: 'water' | 'crew' | 'torch'; // CURRENT slung loadout (mutable: mixed missions re-rig at base)
  private bucketAttached = true; // water missions: is the slung bucket rigged? DETACH jettisons it; a base re-rigs a fresh one
  private readonly loadouts: ('water' | 'crew' | 'torch')[]; // loadouts the pilot can re-rig between; >1 → swap enabled
  private loadoutIdx = 0; // index into `loadouts` of the current payload
  private readonly bucketType: 'bambi' | 'valve';
  private readonly crew?: CrewTransport; // crew land-and-board transport (crew payload missions)
  private backburn?: Backburn; // backburn control-line tracker (torch missions) — lit as you fly the line
  private readonly backburnMeshes: LandingZoneMesh[] = []; // control-line segment markers (parallel to backburn.views)
  private readonly lzMeshes: LandingZoneMesh[] = []; // landing-zone markers (parallel to crew zones)
  private readonly crewFigures: CrewFigures[] = []; // animated crew at each zone (parallel to crew zones)
  private readonly crewZones: CrewZone[] = []; // resolved world-space crew endpoints (refined to flat landing spots)
  private readonly landingPads: { x: number; z: number }[] = []; // where the flight floor eases to skids height (every base helipad + crew LZs)
  private readonly homeBeacons: { zone: LandingZoneMesh; x: number; z: number }[] = []; // green home columns to dim while the heli is parked on the pad
  private readonly fuelSim?: FuelSim; // range model — now universal (every mission unless `fuel:false`)
  private rtbWarned = false; // latched once Dispatch has called the low-fuel return-to-base (re-arms above the warn line)
  private lowFuelAlert: string | null = null; // persistent centred caption while on the reserve (cleared on refuel/shutdown)
  private fuelLost = false; // Game-level dry-tank loss (universal, not just `fuelOut` missions) — routes the fuel end-banner cause
  private readonly slung: THREE.Group; // the mesh hanging on the longline (bucket or crew basket)
  private readonly slungAnchorY: number; // its swivel-head local Y (rope attach point)
  private readonly depotXZ: { x: number; z: number } | null; // HOME base/depot site (cold-start + crew base + radar anchor)
  private readonly baseSites: { x: number; z: number }[] = []; // ALL lakeside bases (home + forward refuel pads) — drives nearest-base refuel + RTB
  private readonly helipadXZ: { x: number; z: number; yaw: number } | null; // home cold-start landing pad (off the home depot)
  private firesInitial = 0; // active fire count captured once the scenario is seeded
  private missionElapsed = 0; // seconds the mission has been active (stops on win/lose)
  private readonly end?: EndScreenHooks;

  constructor(
    container: HTMLElement,
    tier: QualityTier,
    mission: MissionDef,
    profile?: Profile,
    end?: EndScreenHooks,
    opts: { skipColdStart?: boolean; disableCoach?: boolean } = {},
  ) {
    this.mission = mission;
    // Interactive first-flight coach: only the TRUE first mission of a brand-new pilot, never under
    // headless QA (it would interfere with the verify:render scoop→drop autopilot + deploy gate).
    this.coach = new CoachDirector(!opts.disableCoach && !tutorialDone() && mission.id === CAMPAIGN[0].id);
    this.end = end;
    // Cold start (every mission) unless a headless QA boot opts out (?qa / ?autostart): then the
    // aircraft is already running and airborne at origin, so the existing autopilot/teleport flows
    // and screenshots work unchanged.
    this.engineStarted = opts.skipColdStart ?? false;
    this.rotorRpm = this.engineStarted ? 1 : 0;
    // Mixed missions list the loadouts the pilot can re-rig between (bucket↔crew) at the home base;
    // a normal mission omits `loadouts` → a single fixed loadout, exactly as before. `payload` is the
    // STARTING loadout; keep `payloadMode` derived from the cycle so the two never disagree.
    this.loadouts = mission.loadouts?.length ? mission.loadouts : [mission.payload ?? 'water'];
    const startIdx = this.loadouts.indexOf(mission.payload ?? this.loadouts[0]);
    this.loadoutIdx = startIdx >= 0 ? startIdx : 0;
    this.payloadMode = this.loadouts[this.loadoutIdx];
    this.bucketType = mission.bucket ?? (BUCKET3D.type as 'bambi' | 'valve');
    this.pilotName = profile?.name;
    this.mapId = profile?.mapId;
    this.heliId = profile?.heliId;
    // The selected airframe's class drives its feel (flight multipliers), payload (capacity/fill),
    // and durability (toughness). Unknown/undefined → the 205A-1 baseline. The flight sim + the
    // health sim take it now; capacity/fillRate replace the shared BUCKET3D constants below.
    const heliClass = resolveHeliClass(this.heliId);
    this.capacity = heliClass.capacity;
    this.fillRate = heliClass.fillRate;
    this.heliSim = new HelicopterSim(0, 0, heliClass);
    this.healthSim = new HealthSim(heliClass.toughness);
    const aspect = container.clientWidth / container.clientHeight;

    // Build the seeded world FIRST (every mesh/sim below reads from it), the mission wind,
    // and the wildlife that depends on the world. (These were field initializers; they move
    // into the ctor now that they take the per-mission seed / wind override.)
    // Grow the mission's MAP (its authored region, else the player's chosen map, else the default)
    // and lay any authored place-name pins over the seeded ones so briefings match the radar.
    this.world = new World(mission.seed, { regionId: mission.map ?? this.mapId, pins: mission.places, homeBase: mission.homeBase });
    // Bridge sites are resolved INSIDE World (after rivers, before roads) so the roads route over the decks
    // and the river VALLEYS are already shaped into the terrain. Read them here to build the meshes/colliders
    // below; empty off-SK / when disabled. (The deck-riding road draping uses these too — see roadSurfaceAt.)
    const bridgeSites = this.world.bridgeSites();
    this.wind = new Wind(mission.wind?.angle, mission.wind?.strengthScale ?? 1);
    this.fauna = new Fauna(this.scene, this.world);
    this.depotXZ = (() => {
      const base = this.world.getCommunity('base'); // 'base' = the HOME base (largest lake, cold-start)
      return base ? { x: base.x, z: base.z } : null;
    })();
    this.baseSites = this.world.bases().map((b) => ({ x: b.x, z: b.z })); // all four — refuel/repair points

    // Home cold-start helipad: a flat pad on cleared ground just off the home depot building (which sits
    // AT the home base XZ). Resolved first because the cold start (below) parks the airframe on it.
    this.helipadXZ = this.depotXZ ? this.findHelipadSpot(this.depotXZ) : null;

    // Every base (home + the three forward refuel pads) gets a helipad you can set down on, registered in
    // `landingPads` so `landingFloorAt` eases the flight floor to skids height there (a real touchdown, not
    // a hover) and the forest clears its yard (via setClearings below — all bases are in `builtSites`).
    // The HOME base's depot building is a damageable Structure (built later); each FORWARD base gets a
    // decorative depot building HERE — scenery only, never a Structure, so it never pads a mission's
    // `protect` survivor count. (For a QA skip the heli stays airborne at origin; the pads are just scenery.)
    const bases = this.world.bases();
    const padGrades: { x: number; z: number; r: number; level: number }[] = [];
    const forwardDepots: { x: number; z: number; i: number }[] = [];
    for (let i = 0; i < bases.length; i++) {
      const b = bases[i];
      const isHome = i === 0;
      const pad = isHome ? this.helipadXZ : this.findHelipadSpot({ x: b.x, z: b.z });
      if (!pad) continue;
      const padY = this.world.groundHeightAt(pad.x, pad.z); // the pad sits at — and grades the ground TO — this height
      const padMesh = createHelipad();
      padMesh.position.set(pad.x, padY, pad.z);
      this.scene.add(padMesh);
      this.landingPads.push({ x: pad.x, z: pad.z });
      padGrades.push({ x: pad.x, z: pad.z, r: HELIPAD.gradeRadius, level: padY });
      if (!isHome) forwardDepots.push({ x: b.x, z: b.z, i });
    }
    // Grade the terrain FLAT under every base pad BEFORE the terrain mesh builds (createTerrain, below), so each
    // slab sits flush on level ground — no hillside poking through the pad (the "cutoff"). Levels to the pad's own
    // height, so it barely perturbs the world. The pad Y sampled above already used the natural (pre-grade) value.
    this.world.setPadLevels(padGrades);
    // Forward-base depot buildings — placed AFTER the grade so they sit on the now-final ground (the pad grade
    // feathers out to a forward base's centre, so a pre-grade Y would float/sink the building).
    for (const d of forwardDepots) {
      const depotMesh = createStructure('depot', 7000 + d.i); // decorative forward-base building (NOT a Structure)
      depotMesh.group.position.set(d.x, this.world.groundHeightAt(d.x, d.z), d.z);
      depotMesh.group.rotation.y = d.i * 1.7;
      this.scene.add(depotMesh.group);
    }

    // Crew landing pads (crew missions): resolve each crew endpoint to a flat dry landing spot — the
    // base endpoint snaps to the home helipad you cold-start on — then register them all in `landingPads`
    // so (a) `landingFloorAt` eases the flight floor down to skids height there (a real touchdown, not
    // a hover) and (b) the forest clears a NARROW patch around each (registered with setClearings
    // below). Resolved HERE, before the cold start queries `landingFloorAt` and before the forest builds.
    if (this.mission.zones?.length) {
      for (const z of this.resolveCrewZones()) {
        this.crewZones.push(z);
        this.landingPads.push({ x: z.x, z: z.z });
      }
    }

    // HOME beacon: a persistent green marker over the home helipad in EVERY mission, so "where's
    // home / the fuel pump" is always obvious from the air. Crew missions already render this via the
    // base crew zone (the always-lit `home` LandingZone), so only add a standalone one when no crew
    // zone sits on the pad — avoids a doubled beacon. Static (always `home` state), no per-frame cost.
    if (this.helipadXZ) {
      const p = this.helipadXZ;
      const crewAtHome = this.crewZones.some((z) => Math.hypot(z.x - p.x, z.z - p.z) < 4);
      if (!crewAtHome) {
        const home = createLandingZone(true, MISSIONS.zoneSmoke, false); // beacon-only: the concrete helipad IS the pad here
        home.group.position.set(p.x, this.world.groundHeightAt(p.x, p.z), p.z);
        this.scene.add(home.group);
        this.homeBeacons.push({ zone: home, x: p.x, z: p.z });
      }
    }

    // Cold start vs QA skip: in normal play we park the airframe shut-down ON the pad so the pilot
    // spools the rotors and lifts off from home, nose pointed out to open ground. Under ?qa/?autostart
    // (skipColdStart → engineStarted) we skip the ritual but still spawn airborne OVER HOME rather than
    // the world origin — an origin spawn read as "mid air in the middle of nowhere", with the home pad
    // and the crew LZs off in some random direction.
    if (this.helipadXZ) {
      const p = this.helipadXZ;
      const floorY = this.landingFloorAt(p.x, p.z);
      if (this.engineStarted) this.heliSim.hoverAt(p.x, p.z, floorY);
      else this.heliSim.land(p.x, p.z, floorY);
      this.heliSim.yaw = p.yaw;
    }

    // POPULATED MAP (2026-06-05): every settlement is decorated below, so cleared yards + radar place-names line
    // up with real buildings everywhere — no phantom clearings, no town name floating over empty bush. Each
    // community carries a population `tier` (city / base / community) that sizes its cleared yard + its skyline.
    // The mission's structure plan still drives the DEFENDED hamlets (real, burnable cabins); those are excluded
    // from the decorative scatter so a town never doubles up (decoration doesn't burn).
    const structPlan = structurePlan(this.world, this.mission);
    const defended = new Set(structPlan.groups.map((g) => g.community)); // hamlets that get real (burnable) Structures
    const tierOf = (c: CommunitySite): SettlementTier => c.tier ?? (c.kind === 'base' ? 'base' : 'community');
    const settlements = this.world.communities.map((c) => {
      const tier = tierOf(c);
      return { name: c.name, x: c.x, z: c.z, tier, clearRadius: SETTLEMENT3D.tiers[tier].clearRadius, site: c };
    });
    // Radar place-names: every settlement (all now have buildings under them).
    const builtSites: { name: string; x: number; z: number }[] = settlements.map((s) => ({ name: s.name, x: s.x, z: s.z }));
    // Forest-clearing + dirt-yard per settlement, sized by tier (a city clears a wide pad, a hamlet a small one);
    // crew LZs get a NARROW cleared patch so the heli can set its skids down without the canopy in the way.
    const lzClearings = this.crewZones.map((z) => ({ x: z.x, z: z.z, radius: MISSIONS.lzClearRadius }));
    this.world.setClearings([...settlements.map((s) => ({ x: s.x, z: s.z, radius: s.clearRadius })), ...lzClearings]);

    // Atmosphere (B2): a gradient sky dome + aerial-perspective fog + sun/hemisphere
    // light, all configured from one time-of-day preset so they stay coherent (fog
    // fades distant hills into the sky's horizon band; the sun glows in the dome).
    const hemi = new THREE.HemisphereLight();
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = true;
    const shadowRes = tier.current.shadowMapSize; // quality-tier driven (load-time)
    this.sun.shadow.mapSize.set(shadowRes, shadowRes);
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 400;
    cam.left = -90;
    cam.right = 90;
    cam.top = 90;
    cam.bottom = -90;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target); // shadow follows the heli via this target
    // Per-mission time of day (default golden hour). The preset carries the sun's elevation/
    // azimuth too, so dawn rakes low, noon sits overhead — cache the world offset once.
    const sky = SKY_PRESETS[mission.timeOfDay ?? 'golden'];
    this.sunOffset.copy(sky.sunDir).multiplyScalar(SUN_DISTANCE);
    applyAtmosphere(this.scene, this.sun, hemi, sky);
    this.skyDome = createSkyDome(this.frame, sky);
    this.scene.add(this.skyDome); // follows the camera each frame (see update)

    // C5 fire field DataTexture — sized to the world's rectangular fire grid (square map = 160², the
    // legacy 2100u mapping byte-identical). Built HERE (not as a field initializer) so `this.world`
    // already exists; FireSystem resolves the SAME grid from world.sizeX/sizeZ below, so they agree.
    const fireGrid = fireGridFor(this.world.sizeX, this.world.sizeZ);
    this.fireField = new FireFieldTexture(
      fireGrid.nx,
      fireGrid.nz,
      -fireGrid.halfX,
      -fireGrid.halfZ,
      fireGrid.nx * fireGrid.cellSize,
      fireGrid.nz * fireGrid.cellSize,
    );

    // Terrain (vertices displaced from the World heightfield, basins carved in) +
    // lake discs (each sits at the World's flat water level, inside its bowl) + forest.
    const terrain = createTerrain(this.world, tier.current.terrainSegments, this.frame, {
      tex: this.fireField.texture,
      minX: this.fireField.worldMinX,
      minZ: this.fireField.worldMinZ,
      sizeX: this.fireField.worldSizeX,
      sizeZ: this.fireField.worldSizeZ,
    }, tier.current.name !== 'low'); // real PBR ground grain on med/high; low stays fully procedural
    this.scene.add(terrain.mesh);

    // One shared animated water material across every lake (B1), wired to the shared
    // FrameContext (time/wind) + ripple pool. Disc tessellation scales with the tier.
    const waterMat = createWaterMaterial(this.frame, this.ripples);
    const waterSegments = tier.current.waterSegments;
    // DEFERRED (one closure per lake) — ~58 tessellated discs, each sampling the shoreline, were a big
    // chunk of the boot freeze. Streamed in a few per frame after first frame. Scooping is unaffected
    // (it reads World.waterLevelAt, not the lake MESH), so a not-yet-built lake disc is purely cosmetic.
    for (const l of this.world.lakes) {
      this.deferredBuild.push(() => {
        this.lakes.push(
          new Lake(this.scene, l.x, l.z, l.r, l.waterLevel, waterSegments, (phi) => this.world.lakeRadius(l, phi), (x, z) => this.world.groundHeightAt(x, z), waterMat),
        );
        return true;
      });
    }

    // Streams / mini rivers (A4): a water ribbon per stream, sharing the same animated
    // material as the lakes. You can scoop from them too (World.waterLevelAt generalizes). DEFERRED.
    for (const r of this.world.rivers) {
      this.deferredBuild.push(() => {
        this.scene.add(createRiverMesh(r, (x, z) => this.world.groundHeightAt(x, z), waterMat));
        return true;
      });
    }

    // Cleared yards (A5 polish): a packed-dirt clearing draped under each settlement, sharing
    // one transparent vertex-coloured material. Drawn before the roads/buildings (renderOrder
    // -1) so those layer cleanly on top; the forest already thinned here via clearingFactor.
    const yardMat = createYardMaterial();
    for (const s of settlements) {
      this.deferredBuild.push(() => {
        this.scene.add(createYardPatch(s.x, s.z, (x, z) => this.world.groundHeightAt(x, z), yardMat, s.clearRadius)); // DEFERRED
        return true;
      });
    }
    // Decorative skyline / cabins POPULATING every settlement (cities dense, bases medium, communities sparse).
    // Pure scenery off a LOCAL seed (never world.rng) → determinism + the verifier are untouched. A defended
    // hamlet is skipped (its real, burnable Structures stand there instead). Each is merged to ≈1 draw call,
    // deferred, and candidates avoid the landing pads / crew LZs so you can still set down at a base.
    if (SETTLEMENT3D.enabled) {
      const settleMat = createSettlementMaterial();
      const avoid = this.landingPads.map((p) => ({ x: p.x, z: p.z, r: SETTLEMENT3D.padClear }));
      for (const s of settlements) {
        if (defended.has(s.site)) continue;
        // A base always keeps its depot/pad clear at the centre, even when it's rendered city-tier (Prince Albert).
        const innerHole = s.site.kind === 'base' ? Math.max(SETTLEMENT3D.tiers[s.tier].innerHole, SETTLEMENT3D.baseInnerHole) : SETTLEMENT3D.tiers[s.tier].innerHole;
        const seed = (Math.floor(s.x) * 73856093) ^ (Math.floor(s.z) * 19349663); // deterministic, off world.rng
        this.deferredBuild.push(() => {
          const g = createSettlement(
            { x: s.x, z: s.z, tier: s.tier, groundAt: (x, z) => this.world.groundHeightAt(x, z), isWater: (x, z) => this.world.isOverWater(x, z), seed, innerHole, avoid },
            settleMat,
          );
          if (g) this.scene.add(g);
          return true;
        });
      }
    }

    // Highways (A5): draped GRAVEL ribbons linking the communities. The deck DRAPES on the
    // terrain (ground+lift), riding a low causeway over any water it crosses — it does not
    // carve the World heightfield, so flight/scoop are unaffected. One shared vertex-coloured
    // material for all roads (the per-vertex gravel speckle lives in the geometry → no
    // per-road state, no recompiles).
    const gravelMat = new THREE.MeshStandardMaterial({
      color: ROADS.gravelColor,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
    // Road draping height. Over a BRIDGE deck the road rides the deck TOP — so the carriageway crosses the span
    // (fly-under tunnel still open below, truss arching over); over other water it's a low causeway; on land it
    // hugs the ground. The deck footprint is the bridge's local (along-flow × across-span) box, grown by
    // deckRideMargin so the ribbon fully sits on it (roads were snapped to cross AT each bridge in World).
    const decks = bridgeSites.map((s) => ({
      cx: s.x,
      cz: s.z,
      ax: s.ax,
      az: s.az,
      top: s.surfaceY + BRIDGE.deckClearance + BRIDGE.deckThickness,
      halfRoad: BRIDGE.roadway / 2 + BRIDGE.deckRideMargin, // along-flow (deck depth)
      halfSpan: BRIDGE.span / 2 + BRIDGE.deckRideMargin, // across-span (deck length)
    }));
    const deckAt = (x: number, z: number): number | null => {
      for (const d of decks) {
        const dx = x - d.cx;
        const dz = z - d.cz;
        const u = dx * d.ax + dz * d.az; // along the flow (deck depth)
        const v = dx * d.az - dz * d.ax; // across the span (deck length)
        if (Math.abs(u) <= d.halfRoad && Math.abs(v) <= d.halfSpan) return d.top;
      }
      return null;
    };
    const roadSurfaceAt = (x: number, z: number): number => {
      const deck = deckAt(x, z);
      if (deck !== null) return deck;
      const wl = this.world.waterLevelAt(x, z);
      return wl !== null ? wl + ROADS.bridgeLift : this.world.groundHeightAt(x, z) + ROADS.lift;
    };
    for (const rd of this.world.roads) {
      this.deferredBuild.push(() => {
        this.scene.add(createRoadMesh(rd, roadSurfaceAt, gravelMat)); // DEFERRED
        return true;
      });
    }

    // Forest scattered by BIOME (A2): each candidate is accepted with the biome's tree density and
    // tinted by biome. This is the HEAVIEST build (the whole "forest" boot phase), so it's DEFERRED —
    // streamed chunk-by-chunk a few ms/frame after the first frame (under the cold-start spool) via the
    // stepper below. It runs on its OWN seeded rng stream (not world.rng): the candidate scatter spans
    // several frames, which would otherwise interleave with the FireSystem's gameplay draws on the shared
    // world.rng and break determinism — an independent stream (like the groves/snags) makes deferral safe.
    // Same seed → same forest. (Decoupling also removes the world.rng tier-divergence flagged for co-op.)
    const forestDensityMul = tier.current.name === 'low' ? 1 : FOREST.densityMul;
    const spawn = this.helipadXZ ?? { x: 0, z: 0 }; // the forest fills AROUND where the heli starts
    const nearR = FOREST.nearRadius;
    // Real CC0 leaf-litter detail blended into every canopy (TREE_TEX) — loaded once, module-cached + shared.
    const leaf: LeafDetail | undefined = TREE_TEX.enabled
      ? { tex: loadAlbedo(TREE_TEX.leaves), strength: TREE_TEX.leafStrength, repeat: TREE_TEX.leafRepeat }
      : undefined;
    const swayFoliage = (field: TreeField): void => {
      const fol = field.object.getObjectByName('TreeFoliage') as THREE.Mesh | null;
      if (fol) applyFoliageSway(fol.material as THREE.Material, this.frame, leaf); // B6 wind sway + leaf detail
    };

    // --- Near-spawn conifer patch (SYNCHRONOUS — present at the FIRST frame) -------------------------
    // The full forest below is DEFERRED (streams over the spool), so without this the pad would start
    // treeless. Build a small disc of conifers AROUND the spawn now (cheap vs the whole map) so cone trees
    // are already standing as the rotors spool. Built around the origin then shifted onto the spawn; the
    // full forest fades to 0 inside `nearR` so they don't double up. Static (not burnable/culled) — it's the
    // defended home pad and it's always under the camera.
    const fullDensity =
      Math.round(FOREST.baseCandidates * forestDensityMul * (this.world.sizeX / 600) * (this.world.sizeZ / 600)) /
      (this.world.sizeX * this.world.sizeZ);
    const nearPatch = createTreeField({
      candidates: Math.round(fullDensity * (2 * nearR) * (2 * nearR)), // box of candidates; radial cutoff below → disc
      size: 2 * nearR,
      heightAt: (x, z) => this.world.groundHeightAt(spawn.x + x, spawn.z + z), // local → world = spawn + local
      sample: (x, z) => {
        if (x * x + z * z > nearR * nearR) return { treeDensity: 0, treeTint: [0, 0, 0] }; // radial cutoff → a disc
        const wx = spawn.x + x;
        const wz = spawn.z + z;
        const s = this.world.biomes.sample(wx, wz);
        return { treeDensity: s.treeDensity * this.world.clearingFactor(wx, wz) * this.world.authoredFoliageMul(wx, wz), treeTint: s.treeTint };
      },
      rng: speciesRng(WORLD3D.seed ^ 0x1a2b3c4d),
      burnable: false,
    });
    nearPatch.object.position.set(spawn.x, 0, spawn.z); // shift the origin-built patch onto the spawn
    this.scene.add(nearPatch.object);
    this.forestNear = nearPatch;
    swayFoliage(nearPatch);
    const nearColliders = nearPatch.colliders.map((c) => ({ ...c, x: c.x + spawn.x, z: c.z + spawn.z })); // → world XZ

    // --- The full forest (DEFERRED, own rng) — fades to 0 inside the near patch so they don't overlap ----
    const forest = createTreeField({
      candidates: Math.round(FOREST.baseCandidates * forestDensityMul * (this.world.sizeX / 600) * (this.world.sizeZ / 600)),
      size: this.world.sizeX,
      sizeZ: this.world.sizeZ,
      heightAt: (x, z) => this.world.groundHeightAt(x, z),
      sample: (x, z) => {
        const s = this.world.biomes.sample(x, z);
        // clearingFactor thins trees in settlement yards/LZs; authoredFoliageMul is the map editor's brush.
        const dn = Math.hypot(x - spawn.x, z - spawn.z);
        const t = Math.min(1, Math.max(0, (dn - nearR) / 90));
        const nearFade = t * t * (3 - 2 * t); // 0 inside nearR (the near patch owns it) → 1 just past it
        return {
          treeDensity: s.treeDensity * this.world.clearingFactor(x, z) * this.world.authoredFoliageMul(x, z) * nearFade,
          treeTint: s.treeTint,
        };
      },
      rng: speciesRng(WORLD3D.seed ^ 0x6f1bbcdd), // own stream → safe to scatter across deferred frames
      burnable: true, // C5: conifers ignite + char + collapse when the fire field reaches them
      deferred: true, // stream the candidate scatter + per-chunk meshing via buildStep (pumped in main.ts)
    });
    this.forest = forest;
    this.scene.add(forest.object); // present but EMPTY now — fills as the deferred stepper runs
    // Collision is live from frame 1 for the near patch; rebuilt to include the full forest when it finishes.
    this.obstacles = new Obstacles(this.world, nearColliders);
    this.deferredBuild.push((budgetMs) => {
      const done = forest.buildStep!(budgetMs);
      if (done) {
        this.obstacles = new Obstacles(this.world, [...nearColliders, ...forest.colliders]); // full canopy collision now live
        swayFoliage(forest);
      }
      return done;
    });

    // The bridge meshes + colliders, built from the sites resolved above (their valleys are already
    // shaped into the terrain). Empty off-SK / when disabled, so this self-skips.
    for (const site of bridgeSites) {
      const bridge = createBridge(site);
      this.scene.add(bridge.group);
      this.bridges.push(bridge);
      this.bridgePass.push({ under: false, enterU: 0, cd: 0 });
    }

    // Mixed-forest variety (deciduous accents + burnt snags) is built one tick after the first
    // frame paints — see buildAccentFoliage. Each is seeded off its OWN stream, so deferring it
    // doesn't perturb the conifer/fire layout, and it's not a collider, so nothing gameplay-side
    // waits on it. `forestDensityMul` is captured for the deferred closure. The sim is frozen on
    // the briefing/cold-start deck while they pop in (a frame or two later), so it's invisible.
    if (this.accentFoliageTimer) clearTimeout(this.accentFoliageTimer); // drop any pending deferred build first
    this.accentFoliageTimer = setTimeout(() => {
      this.accentFoliageTimer = null;
      this.buildAccentFoliage(forestDensityMul, leaf);
    }, 0);

    // C3 fire sim: World fields injected as callbacks (so the sim never imports
    // World). A fixed pool of fire meshes (size maxActive) is built once and synced
    // to the sim's active fires each frame — fires never add/remove scene objects.
    // Valid-fire-site half-extents — per axis so random fires stay inside the true-shape rectangle (on a
    // square map both = WORLD3D.size/2 − 40, so seeding is byte-identical). Captured for the director beats too.
    this.fireBoundX = this.world.sizeX / 2 - 40;
    this.fireBoundZ = this.world.sizeZ / 2 - 40;
    this.fireSystem = new FireSystem(
      {
        rng: this.world.rng,
        groundHeightAt: (x, z) => this.world.groundHeightAt(x, z),
        isOverWater: (x, z) => this.world.isOverWater(x, z),
        fuelAt: (x, z) => this.world.placement.fuelAt(x, z),
        pickSite: (minFromOrigin) => this.world.placement.fireSite(this.world.rng, this.fireBoundX, minFromOrigin, this.fireBoundZ),
        sizeX: this.world.sizeX, // rectangular fire grid (square map → WORLD3D.size, byte-identical)
        sizeZ: this.world.sizeZ,
      },
      {
        spreadScale: this.mission.fire?.spreadScale, // per-mission spread pacing (FIRE3D baseline × this)
        spotScale: this.mission.fire?.spotScale, // throttle ember-spotting WITHOUT slowing the front (solo balance)
        maxActive: this.mission.fire?.maxActive, // cap simultaneous fires below the pool (solo ceiling)
        containAfter: this.mission.fire?.containAfter, // "tide turns": after N fires out, stop spotting + slow creep (completability)
      },
    );
    for (let i = 0; i < FIRE3D.maxActive; i++) {
      const m = createFire();
      m.light.visible = false; // perf: many dynamic lights force recompiles (see meshes/fire.ts)
      m.group.visible = false;
      this.scene.add(m.group);
      this.fireMeshes.push(m);
    }
    // Seed the mission's fires at their chosen sites/sizes (vs the random sandbox seeding) via
    // the shared scenario resolver, then capture the active count as the "initial fires" baseline.
    seedFires(this.world, this.fireSystem, this.mission, { vx: this.wind.vx, vz: this.wind.vz }, this.fireBoundX, this.fireBoundZ);
    this.firesInitial = this.fireSystem.activeCount;

    // C3 stakes: cabins + lakeside depot. The mission drives placement explicitly (which
    // hamlets to defend), falling back to a depot-only plan so the base always exists (it's
    // the refuel point + crew base + radar anchor).
    this.structures = new Structures({
      groundHeightAt: (x, z) => this.world.groundHeightAt(x, z),
      isOverWater: (x, z) => this.world.isOverWater(x, z),
      pickSite: (minFromOrigin) => this.world.placement.fireSite(this.world.rng, this.fireBoundX, minFromOrigin, this.fireBoundZ),
      lakes: this.world.lakes.map((l) => ({ x: l.x, z: l.z, r: l.r })),
      rng: this.world.rng,
      communities: this.world.communities,
      plan: structPlan,
    });
    this.structures.list.forEach((s, i) => {
      const m = createStructure(s.kind, s.id + 1); // +1 so id 0 still seeds varied geometry
      m.group.position.set(s.x, s.y, s.z);
      m.group.rotation.y = i * 1.3; // deterministic per-index yaw for variety
      this.scene.add(m.group);
      this.structureMeshes.push(m);
    });

    // Authored decorative buildings (map editor): pure scenery dropped on the terrain — NOT pushed into
    // structureMeshes (that array is index-paired with sim/Structures; a mismatch would crash the damage
    // loop) and never a Structure, so they never burn-count or affect win/lose. Empty when none are painted.
    this.world.authoredBuildings.forEach((b, i) => {
      const m = createStructure(b.kind, 9000 + i);
      m.group.position.set(b.x, this.world.groundHeightAt(b.x, b.z), b.z);
      m.group.rotation.y = (b.rotationDeg * Math.PI) / 180;
      this.scene.add(m.group);
    });

    // Dock (A5 polish): a jetty off EACH lakeside base, reaching out over its lake — sells every base
    // as a real waterfront refuel stop (and a scoop source on hand). Built once per base.
    for (const b of this.world.bases()) this.addBaseDock(b);

    // Helicopter + the bucket slung beneath it on a rope. The selected model (if any)
    // swaps in behind the procedural hero; unknown ids fall back to the Bell 205A-1.
    this.heli = createHelicopter(this.heliId);
    this.scene.add(this.heli.group);
    const p = this.heliSim.position;
    this.bucketSim = new BucketSim(p.x, p.y, p.z);
    this.bucket = createBucket();
    this.scene.add(this.bucket.group);
    // Payload: water missions sling the Bambi bucket. Crew missions carry the crew IN THE CABIN —
    // the heli LANDS to load/unload — so there's no slung load and no longline at all; the bucket
    // is hidden and the rope (below) is switched off. `slung` is left pointing at the hidden bucket
    // only to satisfy the field; it's never posed for crew (the bucket/rope block is water-gated).
    this.slung = this.bucket.group;
    this.slungAnchorY = this.bucket.topAnchorY;
    // Only a WATER mission slings the bucket. Crew ride in the cabin; the torch (helitorch) lays fire
    // from the aircraft itself — both hide the bucket + rope (the slung-bucket block is water-gated).
    if (this.payloadMode !== 'water') this.bucket.group.visible = false;
    // The longline is drawn as a short chain of segments so it can BOW into a
    // catenary (a single straight segment can't sag). Endpoints + sag are set every
    // frame in update(); the depth of the sag scales with how full the bucket is.
    const ropePts = BUCKET3D.ropeSegments + 1;
    this.ropeGeom = new THREE.BufferGeometry();
    this.ropeGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ropePts * 3), 3));
    this.rope = new THREE.Line(this.ropeGeom, new THREE.LineBasicMaterial({ color: 0x2a2118 }));
    // The geometry's bounding sphere is computed once from the initial (0,0,0)
    // endpoints (radius 0 at the origin); we move the endpoints every frame but
    // never recompute it, so once the heli flies away from the origin the line
    // gets frustum-culled and vanishes. It's only two points — skip culling.
    this.rope.frustumCulled = false;
    if (this.payloadMode !== 'water') this.rope.visible = false; // no longline in crew / torch missions
    this.scene.add(this.rope);
    this.dropMarker = new DropMarker(this.scene); // predicted-impact ring (adds itself to the scene)
    this.fireHeads = new FireHeadMarkers(this.scene); // fire-head chevrons (adds itself to the scene)
    this.scene.add(this.spray.points); // pooled drop-spray particle cloud
    this.scene.add(this.smoke.points); // pooled per-fire smoke plumes
    this.scene.add(this.embers.points); // pooled per-fire sparks/embers
    this.scene.add(this.ambientEmbers.points); // subtle ambient amber motes (atmosphere)

    // Crew landing zones (delivery/evac missions): the endpoints were resolved to flat landing spots
    // up front (`this.crewZones`). Drop a marker + a knot of standing crew at each, then hand the list
    // to the transport sim. The crew figures are toggled per-frame from the transport state (waiting →
    // boarded → set down). No-op for water missions.
    if (this.crewZones.length) {
      for (const z of this.crewZones) {
        const gy = this.world.groundHeightAt(z.x, z.z);
        const lz = createLandingZone(!z.single, MISSIONS.zoneSmoke, z.single); // base zone (!single) sits on the concrete helipad → beacon-only, no doubled ring
        lz.group.position.set(z.x, gy, z.z);
        this.scene.add(lz.group);
        this.lzMeshes.push(lz);
        if (!z.single) this.homeBeacons.push({ zone: lz, x: z.x, z: z.z }); // the green HOME column — dim it while parked on the pad
        const figs = createCrewFigures();
        figs.group.position.set(z.x, gy, z.z);
        this.scene.add(figs.group);
        this.crewFigures.push(figs);
      }
      this.crew = new CrewTransport(this.crewZones, this.mission.startLoaded ?? false);
    }

    // Backburn control line (torch missions): resolve the marked segments through the SAME scenario
    // code the verifier uses, drop an ember-orange marker over each, and hand the points to the tracker.
    // The pilot lights each by flying it low with IGNITE held (the per-frame torch block in update()).
    const bbPoints = backburnLine(this.world, this.mission, { vx: this.wind.vx, vz: this.wind.vz });
    if (bbPoints.length) {
      for (const p of bbPoints) {
        const gy = this.world.groundHeightAt(p.x, p.z);
        const m = createLandingZone(false, MISSIONS.torchLineColor); // ember-orange "fire line" marker
        m.group.position.set(p.x, gy, p.z);
        this.scene.add(m.group);
        this.backburnMeshes.push(m);
      }
      this.backburn = new Backburn(bbPoints);
    }

    // Fuel/range model (Track C6) — only constructed when the mission opts in.
    // Fuel/range (C6) is now the UNIVERSAL pressure: every mission burns fuel and you return to a base
    // to top up. A mission may still opt out with `fuel: false` (e.g. a pure tutorial). Running the tank
    // dry is now a UNIVERSAL loss (loseOnFuel) — the opt-in `fuelOut` FAIL still drives a mission's stated
    // stakes, but every fuel mission now ends if you run empty. The 20% RTB callout + held LOW FUEL — RTB
    // caption warn you long before that.
    if (this.mission.fuel !== false) this.fuelSim = new FuelSim();

    this.runtime = new MissionRuntime(this.mission);
    this.director = new MissionDirector(this.mission); // reactive arc (briefing/beats/debrief)

    this.chase = new ChaseCamera(aspect, this.world);
    this.input = new Input(container);
    if (this.payloadMode === 'torch') this.input.setActionLabel('IGNITE'); // helitorch: DROP lays a backburn
    this.hud = new HUD(
      container,
      buildMinimap(this.world, 320),
      {
        // Only label communities that were actually BUILT (the depot base + defended hamlets),
        // so a radar place-name always has a real settlement under it — no town names floating
        // over empty bush. `builtSites` is the same set that gets cleared yards + buildings.
        communities: builtSites.map((c) => ({ name: c.name, x: c.x, z: c.z })),
        // Only label NAMED larger lakes — on the anchored SK map the random background ponds are
        // nameless (World), so this is just the real pinned lakes; no fake names floating on the radar.
        lakes: this.world.lakes.filter((l) => l.r >= 30 && l.name).map((l) => ({ name: l.name, x: l.x, z: l.z })),
        // Decorative reference places (far-north settlements + southern cities) so the WHOLE province reads as
        // Saskatchewan on the expanded radar — pure labels, no buildings/yards (not gameplay anchors).
        landmarks: this.world.landmarks(),
        // Real province boundary (world XZ) — the expanded radar fits + clips to this so the map reads
        // as Saskatchewan's shape, north-up. Null on procedural maps (radar stays the local scope).
        outline: this.world.provinceOutline() ?? undefined,
      },
      this.pilotName,
      this.end,
    );
    // Tuck the controls "?" button into the radar's corner (top-right, under the minimap) so it
    // shares the map column and reflows down when the radar is expanded.
    this.hud.mountUnderRadar(this.input.helpButton);
    // On-screen mute toggle, beside the "?" under the radar — the only way to silence the rotor on
    // touch (the 'M' key is desktop-only). Persisted; stays in sync if 'M' flips it.
    this.hud.mountUnderRadar(this.buildMuteButton());
    // C5: hand the radar the live fire field so it shades the burnt area (and the live front).
    this.hud.setBurnField(this.fireSystem.fieldView());
    // The reactive arc opens with a pre-flight DISPATCH briefing card; the sim + mission clock stay
    // paused (inBriefing) until the pilot hits BEGIN, then the authored 'start' beat radios in.
    this.hud.showBriefing(this.mission, () => {
      this.inBriefing = false;
      // Cold start: the briefing hands off to the engine-start dial — hold it to spool the rotors
      // before the aircraft will fly. (Already running under a QA skip → straight to flight.) Arm the
      // cinematic fly-in here too: the camera snaps CLOSE to the parked heli and pulls out to the normal
      // trail as the rotor spools, so the view settles into flight as the start cycle completes.
      if (!this.engineStarted) {
        this.hud.showEngineStart();
        this.chase.beginIntro();
      }
      // First-time pilots are now taught by the interactive CoachDirector (driven in update once the
      // rotors are up), not an auto-popped manual. The "?" reference modal stays reopenable anytime.
    });
  }

  /**
   * Pump the deferred (non-critical) scene build — lakes / rivers / roads / yards — for up to
   * `budgetMs` per call, so it streams in AFTER the first frame (under the cold-start spool) instead
   * of freezing the boot. `main.ts` calls this each frame until it returns true. When the queue drains
   * the cached lake radar is invalidated so it rebuilds with the full lake set. No-op once disposed.
   */
  pumpBuild(budgetMs = 6): boolean {
    if (this.disposed) return true;
    const t0 = performance.now();
    while (this.deferredIdx < this.deferredBuild.length) {
      const remaining = budgetMs - (performance.now() - t0);
      if (remaining <= 0) break;
      const itemDone = this.deferredBuild[this.deferredIdx](remaining);
      if (itemDone) this.deferredIdx++; // one-shot item built (or the forest finished) — advance
      else break; // a multi-frame stepper (the forest) isn't done yet — resume it next frame
    }
    const done = this.deferredIdx >= this.deferredBuild.length;
    if (done) this.lakeRadar = null; // refresh the radar now that every lake disc exists
    return done;
  }

  /**
   * Decorative accent foliage — deciduous (birch/aspen) groves + burnt snags — built one tick
   * AFTER the first frame so it stays off the construction critical path (see the constructor's
   * deferred schedule). Reuses the conifer's chunk/LOD machinery via the species slot, on its OWN
   * seeded stream (so it never perturbs the conifer/fire layout) with its own tint. Birch sways too.
   * (No colliders — conifers are the snag the bucket catches.) Guarded against a dispose racing the
   * timer: if the scene's gone there's nothing to add to.
   */
  private buildAccentFoliage(forestDensityMul: number, leafDetail: LeafDetail | undefined): void {
    if (this.disposed) return;
    this.groves = createTreeField({
      candidates: Math.round(2800 * forestDensityMul * (this.world.sizeX / 600) * (this.world.sizeZ / 600)), // bumped 2200→2800 (deferred — more birch/aspen)
      size: this.world.sizeX,
      sizeZ: this.world.sizeZ,
      heightAt: (x, z) => this.world.groundHeightAt(x, z),
      sample: (x, z) => ({ treeDensity: this.world.biomes.sample(x, z).treeDensity * 0.38 * this.world.clearingFactor(x, z), treeTint: [0.62, 0.66, 0.33] }),
      rng: speciesRng(WORLD3D.seed ^ 0x2bd1e995),
      species: deciduousSpecies(),
      burnable: true, // C5: birch/aspen groves burn too
    });
    this.scene.add(this.groves.object);
    const gFol = this.groves.object.getObjectByName('TreeFoliage') as THREE.Mesh | null;
    if (gFol) applyFoliageSway(gFol.material as THREE.Material, this.frame, leafDetail);

    this.snags = createTreeField({
      candidates: Math.round(950 * (this.world.sizeX / 600) * (this.world.sizeZ / 600)), // bumped 700→950 (more snags)
      size: this.world.sizeX,
      sizeZ: this.world.sizeZ,
      heightAt: (x, z) => this.world.groundHeightAt(x, z),
      sample: (x, z) => ({ treeDensity: this.world.biomes.sample(x, z).treeDensity * 0.07 * this.world.clearingFactor(x, z), treeTint: [0.3, 0.28, 0.25] }),
      rng: speciesRng(WORLD3D.seed ^ 0x7f4a7c13),
      species: snagSpecies(),
    });
    this.scene.add(this.snags.object);
  }

  get camera(): THREE.PerspectiveCamera {
    return this.chase.camera;
  }

  /** Unit vector pointing TOWARD the sun (world space) — drives the post-process god-rays. */
  get sunDir(): THREE.Vector3 {
    return this.frame.uSunDir.value;
  }

  /** Read-only state for QA/debug autopilot (see the window hook in main.ts). */
  get debug() {
    return {
      pilot: this.pilotName, // onboarding selections (v1: map/heli are nominal)
      mapId: this.mapId,
      heliId: this.heliId,
      x: this.heliSim.position.x,
      y: this.heliSim.position.y,
      z: this.heliSim.position.z,
      agl: this.heliSim.agl,
      floor: this.world.flightFloorAt(this.heliSim.position.x, this.heliSim.position.z),
      bucketY: this.bucketSim.position.y,
      bucketContact: this.bucketSim.contact,
      bucketDragSpeed: this.bucketSim.dragSpeed,
      // C4 rotor downwash: surface strength (water/foliage/fire) + ground-effect cushion.
      wash: this.wash.surface,
      groundEffect: this.wash.groundEffect,
      water: this.water,
      health: this.healthSim.health, // airframe health 0..1 (for headless damage/crash assertions)
      crashed: this.crashed,
      crashing: this.heliSim.crashing, // mid-air crash fall in progress (tree strike → crumble + drop)
      firesLeft: this.fireSystem.activeCount,
      burnedOut: this.fireSystem.burnedOut, // C3: fires that consumed their fuel and self-extinguished
      lakes: this.lakes.map((l) => ({ x: l.x, z: l.z, r: l.r })),
      // C3: expose fuel + intensity so the new dynamics (burn-out, spread) are headless-assertable.
      fires: this.fireSystem.active().map((f) => ({ x: f.x, z: f.z, y: f.y, intensity: f.intensity, size: f.size, fuel: f.fuel })),
      // C3 stakes: structures, threat, win/lose + score for headless verification.
      won: this.won,
      lost: this.lost,
      score: this.finalScore,
      threat: this.structures.threat,
      structuresLeft: this.structures.aliveCount,
      structures: this.structures.list.map((s) => ({ x: s.x, z: s.z, kind: s.kind, health: s.health, burning: s.burning, destroyed: s.destroyed })),
      // A5 map polish: hydrology density + settlements + highways, headless-assertable.
      rivers: this.world.rivers.length,
      communities: this.world.communities.map((c) => ({ name: c.name, x: c.x, z: c.z, kind: c.kind })),
      roads: this.world.roads.map((r) => ({ name: r.name, points: r.pts.length })),
      // Campaign layer — headless-assertable mission state (objectives, crews, fuel).
      mission: {
        id: this.mission.id,
        index: this.mission.index,
        state: this.runtime.state,
        verified: this.runtime.verified, // every goal sub-task latched done
        payload: this.payloadMode,
        firesInitial: this.firesInitial,
        elapsed: this.missionElapsed,
        events: this.runtime.events.map((e) => ({ at: e.at, type: e.type, label: e.label })),
        crewsDelivered: this.crew?.delivered ?? 0,
        crewsTotal: this.crew?.total ?? 0,
        carrying: this.crew?.carrying ?? false,
        fuel: this.fuelSim?.fuel,
        starved: this.fuelSim?.starved ?? false,
        objectives: this.runtime.tracker.map((t) => ({
          label: t.label,
          done: t.done,
          failed: t.failed,
          current: t.current,
          target: t.target,
          timeLeft: t.timeLeft,
        })),
      },
    };
  }

  resize(aspect: number): void {
    this.chase.setAspect(aspect);
  }

  /** "Skip tutorial" from the coach overlay: mark it done, fold the overlay + spotlight away, and
   *  stop driving the coach for the rest of this game. */
  private skipCoach(): void {
    this.coach.skip();
    this.coachCompleted = true;
    markTutorialDone();
    this.hud.hideCoach();
    this.input.setHighlight(null);
  }

  /**
   * Tear down for an in-place mission switch (no page reload). Detaches every owned external
   * resource — the audio context (browsers cap them, so this MUST close), the input + HUD window
   * listeners and DOM overlays, the deferred-foliage timer, the fire-and-forget fauna load — then
   * disposes the scene's GPU geometries/materials/textures so VRAM doesn't grow per switch. The
   * renderer + composer are owned by main.ts and reused (it re-points the composer at the new
   * Game's scene). After this the instance is dead. Order: stop stepping → detach → free GPU.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.accentFoliageTimer) clearTimeout(this.accentFoliageTimer);
    this.audio.dispose(); // CLOSE the AudioContext — browsers cap ~6/page, so retries would go silent
    this.input.dispose(); // window key listeners + the touch overlay (+ help modal scrim)
    this.hud.dispose(); // HUD root + its layout subscription + engine-start key listeners
    this.fauna.dispose(); // block the async animal pack from populating a dead scene
    this.disposeSceneGPU(); // free geometries/materials/textures (skips module-shared singletons)
  }

  /**
   * Free every GPU resource the scene holds: geometries, materials, and the textures those
   * materials reference (standard map slots + ShaderMaterial uniform textures). THREE frees no GPU
   * memory on GC — only dispose() does — so without this VRAM climbs every mission switch. Materials
   * flagged `userData.shared` (the module-level procedural rotor mats) are SKIPPED: they're reused by
   * the next Game. A `seen` set avoids re-disposing the shared-per-game materials (water/yard/gravel)
   * that many meshes point at. Finally the fire-field DataTexture + the scene's children are dropped.
   */
  private disposeSceneGPU(): void {
    const seenMat = new Set<THREE.Material>();
    const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'envMap'] as const;
    const disposeMat = (m: THREE.Material): void => {
      if (seenMat.has(m) || m.userData?.shared) return;
      seenMat.add(m);
      const anyM = m as unknown as Record<string, unknown> & { uniforms?: Record<string, { value?: unknown }> };
      for (const slot of TEX_SLOTS) {
        const tex = anyM[slot];
        if (tex instanceof THREE.Texture && !tex.userData?.shared) tex.dispose(); // skip module-cached PBR/albedo textures
      }
      if (anyM.uniforms) {
        for (const u of Object.values(anyM.uniforms)) {
          const tex = u?.value as THREE.Texture | undefined;
          if (tex?.isTexture && !tex.userData?.shared) tex.dispose(); // skip shared (loadAlbedo/loadPBR) textures
        }
      }
      m.dispose();
    };
    this.scene.traverse((obj) => {
      const mesh = obj as Partial<THREE.Mesh> & { material?: THREE.Material | THREE.Material[] };
      if (mesh.geometry) (mesh.geometry as THREE.BufferGeometry).dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(disposeMat);
      else if (mat) disposeMat(mat);
    });
    this.fireField.texture.dispose(); // per-game DataTexture (also referenced by the terrain uniform)
    this.scene.clear();
  }

  /**
   * Refill the pooled fire-radar buffer in place from the live fires, trimmed to the live count, so
   * the per-frame HUD payload allocates nothing for the radar (the {x,z} objects are reused frame to
   * frame; only a change in fire count touches the pool). Returns the SAME array each frame — the HUD
   * consumes it synchronously while drawing the radar, so the shared reference is safe.
   */
  private refillFireRadar(active: readonly { x: number; z: number }[]): { x: number; z: number }[] {
    const buf = this.fireRadar;
    const n = active.length;
    for (let i = 0; i < n; i++) {
      const f = active[i];
      const slot = buf[i];
      if (slot) {
        slot.x = f.x;
        slot.z = f.z;
      } else {
        buf[i] = { x: f.x, z: f.z };
      }
    }
    if (buf.length > n) buf.length = n; // drop the stale tail when fewer fires are active
    return buf;
  }

  update(dt: number): void {
    if (this.disposed) return; // a frame slipped in after an in-place switch began — do nothing
    const dtMs = dt * 1000;
    this.elapsed += dt;
    const c = this.input.read();

    // --- Cold engine start: after BEGIN, the rotors sit still until the pilot HOLDS the START dial
    // to spool them to full RPM. Hold accumulates, releasing bleeds it back down; rotor visuals +
    // audio scale by `rotorRpm` so the disc and the drone wind up together. Flight and the mission
    // clock stay frozen (below) until the engine is up, then the authored 'start' beat radios in. ---
    if (!this.engineStarted && !this.inBriefing) {
      const holding = this.hud.engineHold;
      const rate = holding ? dt / STARTUP.holdSeconds : -dt / STARTUP.spinDownSeconds;
      this.rotorRpm = Math.max(0, Math.min(1, this.rotorRpm + rate));
      this.hud.setEngineStart(this.rotorRpm, holding);
      if (this.rotorRpm >= 1) {
        this.engineStarted = true;
        this.hud.hideEngineStart();
        markColdStartSeen(); // #9: ritual done once → later missions boot with the engine already running
      }
    }

    // Freeze the sim when the mission is over (win/loss), the airframe has been DESTROYED (the
    // explosion has fired — gameplay stops while we linger on the wreck), while the pre-flight briefing
    // card is up, or while the engine is still spooling — so the fire doesn't spread and the mission
    // clock doesn't run before the pilot hits BEGIN and brings the rotors up to speed.
    const frozen = this.won || this.lost || this.crashed || this.inBriefing || !this.engineStarted;
    let hazardAlert: string | null = null; // GPWS-style caption to show this frame (null = clear it)

    // Death hold: after a detonation the sim is frozen but the explosion VFX keep animating (the pools
    // update every frame). Linger for CRASH.deathHold so the player SEES the crash, winding the rotor
    // down meanwhile, THEN drop the MISSION FAILED modal (finishCrash latches `lost` → banner).
    if (this.crashed && !this.lost) {
      this.rotorRpm = Math.max(0, this.rotorRpm - dt / CRASH.rotorCutSeconds);
      this.crashHold -= dt;
      if (this.crashHold <= 0) this.finishCrash();
    }

    // Loadout re-rig (mixed crew+water missions): set down at the home base to SWAP the slung load
    // bucket↔crew. Only a >1-loadout mission shows the button / accepts G; everyone else: button hidden,
    // swap inert — zero behaviour change for normal missions.
    if (this.loadouts.length > 1) {
      const canSwap = !frozen && !this.heliSim.crashing && this.atHomeBaseLanded();
      this.input.setSwapVisible(canSwap);
      if (canSwap && c.swapPressed) this.swapLoadout();
    }

    // Bucket DETACH / re-attach (water missions). The DETACH button jettisons the slung bucket anytime
    // in flight — you then fly with no scoop/no drop until you set down at a base, where a fresh bucket
    // is auto-rigged. Hidden at base (you'd just re-rig there) and on crew missions (no bucket).
    if (this.payloadMode === 'water') {
      const live = !frozen && !this.heliSim.crashing;
      this.input.setDetachVisible(live && this.bucketAttached && !this.atHomeBaseLanded());
      if (live && this.bucketAttached && c.detachPressed) this.detachBucket();
      if (live && !this.bucketAttached && this.canRefuel()) this.attachBucket(); // back at a base → new bucket
    } else {
      this.input.setDetachVisible(false);
    }

    if (this.heliSim.crashing && !this.crashed) {
      // CRASH FALL: the airframe flew into the canopy — the pilot has no control. It crumbles and FALLS
      // under gravity (updateCrash), the rotor winds down, and when it hits the ground we detonate the
      // wreck (which sets `crashed` → this branch stops and the death hold takes over). The pose block
      // below copies the tumbling sim transform to the mesh, so the fall is all visible.
      const floorY = this.landingFloorAt(this.heliSim.position.x, this.heliSim.position.z);
      this.heliSim.updateCrash(dt, floorY);
      this.rotorRpm = Math.max(0, this.rotorRpm - dt / CRASH.rotorCutSeconds);
      if (this.heliSim.crashLanded) this.detonate(this.crashCause ?? 'tree');
    } else if (!frozen) {
      this.missionElapsed += dt; // mission clock (drives survive/timeout; stops on win/lose)
      this.wind.update(dtMs);
      // AGL flight: the altitude band rides the World floor under the heli, and a
      // full bucket flies heavy (weight coupling).
      const floorY = this.landingFloorAt(this.heliSim.position.x, this.heliSim.position.z);
      const payloadRatio = this.water / this.capacity;
      // Wind drift in world units/s — pushes the heli over the ground (headwind hurts).
      const windX = this.wind.vx * FLIGHT.windSpeed;
      const windZ = this.wind.vz * FLIGHT.windSpeed;
      // C4 rotor downwash: recompute from LAST frame's AGL + the collective demand (one-
      // frame lag is imperceptible). Its groundEffect cushions low passes; surface drives
      // the water/foliage/fire response below.
      this.wash.update(this.heliSim.agl, c.lift);
      // Fuel starvation (C6): a dry tank cuts engine power — zero throttle and force a
      // sinking collective, so the player makes a forced landing wherever they are.
      const turn = c.turn;
      let throttle = c.throttle;
      let lift = c.lift;
      if (this.fuelSim?.starved) {
        throttle = 0;
        lift = Math.min(lift, MISSIONS.starveSinkLift);
      }
      this.heliSim.update(dt, { turn, throttle, lift }, floorY, payloadRatio, windX, windZ, this.wash.groundEffect);

      // Drain / refuel after the flight step (so speed + AGL reflect this frame).
      if (this.fuelSim) {
        const climbUp = Math.max(0, this.heliSim.vertSpeed / FLIGHT.climbSpeed);
        const refueling = this.canRefuel();
        this.fuelSim.update(dt, {
          throttle01: Math.abs(c.throttle),
          climbUp,
          payloadRatio,
          refueling,
        });
        // Universal low-fuel callout: the first time you cross onto the reserve away from a base,
        // Dispatch tells you to return to the nearest base. Re-arms once you're back above the warn
        // line (a fresh top-up), so each genuine low-fuel run gets one call, not a per-frame spam.
        if (this.fuelSim.low && !this.rtbWarned && !refueling) {
          this.rtbWarned = true;
          this.hud.pushComms('warning', 'Water-1, fuel low — set down at the nearest base to refuel.', 'warn');
          this.audio.playSquelch('warn');
        } else if (!this.fuelSim.low) {
          this.rtbWarned = false;
        }
        // Persistent low-fuel caption: an unmissable centred warning HELD while airborne below the reserve,
        // and cleared the instant you refuel back above the line (or shut down). It shares the GPWS caption
        // slot but yields to a crash hazard, which takes priority — see the setAlert combine below.
        this.lowFuelAlert = this.fuelSim.low && !this.fuelSim.starved && !refueling ? 'LOW FUEL — RTB' : null;
        // Dry tank is now a UNIVERSAL loss: run the tank empty on ANY fuel mission and the mission is over
        // (the opt-in `fuelOut` fail used to be the only one that lost — elsewhere the engine just cut).
        if (this.fuelSim.starved) this.loseOnFuel();
      }

      // Crash hazards (after the flight step so position/AGL/sink are current): detect a tree strike
      // (→ begin the crumble-and-fall) and compute the GPWS-style caption (SINK RATE / PULL UP /
      // TERRAIN) that warns the player BEFORE they slam in. Returns the caption (or null to clear).
      hazardAlert = this.checkHazards();
      // Easter-egg: acknowledge a clean thread UNDER the Missinipe bridge (no-op without one).
      this.updateBridgePass(dt);
    }

    // Drive the centred caption — cleared whenever the sim is frozen or already crashing. A crash hazard
    // (SINK RATE / PULL UP) takes the slot first; otherwise a held LOW FUEL — RTB warning shows.
    this.hud.setAlert(frozen || this.heliSim.crashing ? null : (hazardAlert ?? this.lowFuelAlert));

    // --- Pose the airframe from the sim (YZX: yaw about +Y, pitch +Z, roll +X) ---
    const g = this.heli.group;
    g.position.copy(this.heliSim.position);
    // bankSign flips the roll for a chirality-mirrored model (the UH-60 glTF) so every airframe banks
    // the same way off the one shared `bank`; +1 for the rest. Pitch/yaw are mirror-invariant.
    g.rotation.set(this.heliSim.bank * this.heli.bankSign, this.heliSim.yaw, this.heliSim.pitch, 'YZX');
    // Rotors spin at a rate scaled by the live RPM (0 on the cold deck → full once spooled).
    this.heli.rotor.rotation.y += FLIGHT.rotorSpin * this.rotorRpm * dt;
    this.heli.tailRotor.rotation.x += FLIGHT.tailRotorSpin * this.rotorRpm * dt;

    // --- Swing the bucket, pose it, and redraw the rope between heli and bucket ---
    // "Submerged" is read from the World water plane under the bucket's XZ (using
    // last frame's position — one-frame lag is imperceptible), and is consistent
    // with the flight floor and every other height query.
    // Slung bucket + scoop/scrape/drop is WATER payload only. Crew missions carry the crew in the
    // CABIN and LAND to load/unload — no slung load, no rope, no scoop — so for them this is skipped
    // and the readouts stay inert; the crew-transport block below drives those missions instead.
    let scooping = false;
    let scraping = false;
    let dropping = false;
    let overWater = false;
    if (this.payloadMode === 'water' && this.bucketAttached) {
      ({ scooping, scraping, dropping, overWater } = this.updateSlungBucket(dtMs, c, frozen));
    }

    // --- Crew transport (delivery/evac missions): advance the LAND-and-board ferry, recolor the
    // landing-zone markers, and show/hide the standing crew at each zone so a pickup/drop reads. ---
    if (this.crew) {
      // The ferry only advances while the CREW sling is the rigged loadout — on a mixed mission the
      // crew sit tight (markers still drawn below, greyed) until the pilot re-rigs from the bucket.
      if (!frozen && !this.heliSim.crashing && this.payloadMode === 'crew') {
        this.crew.update(dt, this.heliSim.position.x, this.heliSim.position.z, this.heliSim.agl, this.heliSim.speed);
      }
      // Casualties: a trapped family the FIRE reaches first is lost — and that happens whatever you're
      // rigged for (they burn while you're off fighting flames in the water loadout). Warn when the
      // fire's on them, mayday when it's too late; the `rescue` fail (if the mission has one) then
      // latches the loss off `crewsLost`.
      if (!frozen && !this.heliSim.crashing && this.crew.total > 0) {
        const cas = this.crew.checkCasualties((x, z) => this.fireSystem.heatAt(x, z), dt);
        if (cas.danger >= 0) {
          const label = this.crew.views[cas.danger]?.label ?? 'the LZ';
          this.hud.pushComms('warning', `Fire's on the family at ${label} — get them out, now!`, 'warn');
          this.audio.playSquelch('warn');
        }
        if (cas.lost >= 0) {
          const label = this.crew.views[cas.lost]?.label ?? 'the LZ';
          this.hud.pushComms('warning', `We've lost the family at ${label}. The fire got there first.`, 'alert');
          this.hud.flashDamage(0.6);
          this.audio.playSquelch('alert');
        }
      }
      const views = this.crew.views;
      const delivered = this.crew.delivered;
      const total = this.crew.total;
      const activeZone = this.crew.activeZone; // the zone currently being worked (or -1)
      const prog = this.crew.progress; // 0..1 dwell on that zone — drives the walk in/out
      for (let i = 0; i < this.lzMeshes.length; i++) {
        const v = views[i];
        // A lost family's pad dies (ashen red, beacon out); otherwise the base is the lit HOME pad and
        // the rest cycle active/inactive/done.
        this.lzMeshes[i].setState(v.lost ? 'lost' : v.home ? 'home' : v.done ? 'done' : v.active ? 'active' : 'inactive');
        const figs = this.crewFigures[i];
        if (!figs) continue;
        if (i === activeZone) {
          // Crew on the move: walk INTO the heli at a LOAD zone, OUT of it at an UNLOAD zone.
          figs.setMode(v.role === 'load' ? 'boarding' : 'disembarking', prog);
        } else {
          // Idle figures, decoupled from which zone is the single LIT target (so an evac shows ALL
          // the waiting families, not just the next one). A LOAD zone shows crew while it still has
          // someone to give — a single cabin until it's picked up (and NOT once the fire took them),
          // the reusable base while crews remain. An UNLOAD zone shows them once SET DOWN.
          const show =
            v.role === 'load'
              ? v.single
                ? !v.done && !v.lost
                : delivered < total
              : v.single
                ? v.done
                : delivered > 0;
          figs.setMode(show ? 'standing' : 'hidden');
        }
      }
    }

    // --- Backburn (torch missions): lay the control-line backfire. Fly each marked segment LOW with
    // IGNITE (the DROP button) held; lighting a segment seeds a real backfire — it burns the fuel out and
    // scorches a permanent firebreak that stalls the head — and its marker goes from ember-orange to
    // spent. Laying the whole line meets the `backburn` objective (the win latches before the head lands). ---
    if (this.backburn) {
      if (!frozen && !this.heliSim.crashing && this.payloadMode === 'torch' && c.drop && this.heliSim.agl <= MISSIONS.torchAgl) {
        const lit = this.backburn.tryLight(this.heliSim.position.x, this.heliSim.position.z, MISSIONS.torchLightRadius);
        if (lit) {
          this.fireSystem.igniteAt(lit.x, lit.z, MISSIONS.torchIgniteRadius, MISSIONS.torchIgniteHeat);
          this.audio.playSquelch('info'); // a blip per segment laid
        }
      }
      const bbViews = this.backburn.views;
      for (let i = 0; i < this.backburnMeshes.length; i++) {
        this.backburnMeshes[i].setState(bbViews[i].lit ? 'done' : 'active');
      }
    }

    // Dim the green HOME beacon column while the heli is parked on (or in a low hover right over) its
    // pad — the additive marker otherwise fires straight up through the parked airframe at cold-start
    // and clutters the view. It pops back as soon as you climb away, so it still guides you home. The
    // painted ring/pad always stay. (Only the green home zones are registered here — the cyan crew LZs
    // keep their beacon so the active target still reads while you set down on it.)
    if (this.homeBeacons.length) {
      const hx = this.heliSim.position.x;
      const hz = this.heliSim.position.z;
      const low = this.heliSim.agl < 15; // still on the deck / a low hover, not overflying home at altitude
      for (let i = 0; i < this.homeBeacons.length; i++) {
        const b = this.homeBeacons[i];
        const onPad = low && Math.hypot(hx - b.x, hz - b.z) < MISSIONS.lzRadius;
        b.zone.setBeaconVisible(!onPad);
      }
    }

    // --- C3 fire dynamics: burn + fuel depletion + wind/slope spread; fires damage any
    // structures they reach. The MISSION decides win/lose (below), not these directly. ---
    if (!frozen) {
      this.fireSystem.update(dtMs, this.wind);
      this.structures.update(dtMs, this.fireSystem.active());
      const sig = this.missionSignals();
      this.runtime.update(sig);
      // Reactive arc: fire the mission's authored beats for the current state, then execute their
      // actions. This is the ONLY mission layer that touches the world/HUD/audio (the director is pure).
      if (!this.director.spent) {
        const actions = this.director.update(sig, this.runtime);
        // Apply any WIND shift FIRST, so a same-beat ignite lays its new fire along the NEW wind
        // (the ignite reads wind.intendedVx/Vz — the heading the gust is now easing toward).
        for (let i = 0; i < actions.length; i++) if (actions[i].do === 'wind') this.runMissionAction(actions[i]);
        for (let i = 0; i < actions.length; i++) if (actions[i].do !== 'wind') this.runMissionAction(actions[i]);
      }
      if (this.runtime.state !== 'active') this.latchOutcome();
    }
    // C5: repack the live fire field into the shared DataTexture the terrain chars/glows from —
    // the continuous burn the player sees. O(cells) memcpy after the sim steps; skipped while
    // frozen (won/lost) since the field can't change then — no wasted per-frame work.
    if (!frozen) this.fireField.pack(this.fireSystem.fieldView());
    // Sync the fixed fire-mesh pool to the sim's active fires (burned-out + put-out vanish).
    // C4: a fire within the wash radius of a low heli gets fanned (cosmetic flame whip).
    const activeFires = this.fireSystem.active();
    const washX = this.heliSim.position.x;
    const washZ = this.heliSim.position.z;
    for (let i = 0; i < this.fireMeshes.length; i++) {
      const m = this.fireMeshes[i];
      const f = activeFires[i];
      if (f) {
        m.group.visible = true;
        m.group.position.set(f.x, f.y, f.z);
        m.setIntensity(f.intensity / FIRE3D.maxIntensity);
        m.setSize(f.size); // C3.1: footprint grows with the fire's size class
        const fanFall = Math.max(0, 1 - Math.hypot(f.x - washX, f.z - washZ) / WASH.fanRadius);
        m.setFan(this.wash.surface * fanFall * WASH.fanStrength);
        m.flicker(this.elapsed);
      } else if (m.group.visible) {
        m.group.visible = false;
      }
    }
    // --- Airframe health: a hard-landing IMPACT model only — a high-sink floor contact dents the
    // airframe (toughness divides it), repair grounded/slow at a base. Zero health → crash (instant
    // fail, any mission). Flying low through fire, scraping the bucket, and overspeed no longer cook
    // the airframe — FUEL is the resource that ticks down and forces a return to base (FuelSim). ---
    if (!frozen && !this.heliSim.crashing) {
      const hpBefore = this.healthSim.health;
      this.healthSim.update(dt, {
        impact: this.heliSim.landingImpact,
        repairing: this.canRefuel(),
        // A contact on the water floor (a scoop) is cushioned — it can dent but never explodes, so a
        // firm scoop descent isn't a death sentence (the explosion gate is for slamming the ground).
        overWater: this.world.isOverWater(this.heliSim.position.x, this.heliSim.position.z),
      });
      // A hard landing dents the airframe SILENTLY in the model — players never noticed the number drop.
      // Detect the loss here (delta > 0 only on a damage frame; repair raises it) and FIRE feedback:
      // a red impact flash + a severity-scaled Dispatch warning + a squelch. A short cooldown means a
      // touchdown that bottoms out over a couple frames reads as one hit, not a burst.
      if (this.airframeHitCd > 0) this.airframeHitCd -= dt;
      const hpLost = hpBefore - this.healthSim.health;
      if (hpLost > 0.001 && this.airframeHitCd <= 0 && !this.healthSim.dead) {
        this.airframeHitCd = 0.8;
        this.hardLandings++; // score penalty: a denting touchdown
        this.reportAirframeHit(hpLost);
      }
      // Airframe destroyed: an unsurvivable slam (fatalImpact → explode in place) or ground down across
      // several bad landings. Either way the airframe is gone → detonate it (VFX + boom + mission loss).
      if (this.healthSim.dead && !this.won && !this.lost && !this.crashed) {
        this.detonate(this.healthSim.fatalImpact ? 'impact' : 'airframe');
      }
    }
    // Sync the structure meshes: char + progressive collapse with damage, flames + HDR glow while
    // burning, advance their flame animation, and edge-detect ignite/lost for the radio callouts.
    const sList = this.structures.list;
    this.structIgniteTimer -= dt;
    let newCabinIgnite = false;
    for (let i = 0; i < this.structureMeshes.length; i++) {
      const s = sList[i];
      const m = this.structureMeshes[i];
      m.setDamage(1 - s.health);
      m.setBurning(s.burning);
      m.flicker(this.elapsed);
      if (s.burning && !this.structBurnPrev[i]) {
        // Just caught fire. The base always announces (it's the lifeline); cabins are pooled behind a
        // cooldown so a hamlet lighting up doesn't spam the radio.
        if (s.kind === 'depot') this.hud.pushComms('warning', 'The base is alight — we lose it, we lose our fuel and water. Get on it!', 'alert');
        else newCabinIgnite = true;
      }
      if (s.destroyed && !this.structDeadPrev[i]) {
        this.hud.pushComms('warning', s.kind === 'depot' ? 'We’ve lost the base!' : 'A cabin’s gone — we couldn’t hold it.', 'alert');
      }
      this.structBurnPrev[i] = s.burning;
      this.structDeadPrev[i] = s.destroyed;
    }
    if (newCabinIgnite && this.structIgniteTimer <= 0) {
      this.structIgniteTimer = STRUCT_FIRE.igniteCooldown;
      this.hud.pushComms('crew', 'Fire’s into the cabins — structures alight down there.', 'warn');
    }
    // B3: point the fixed pool of hero fire-lights at the nearest hottest fires. Pass HEAT
    // (intensity × size) so a big blaze throws more, reachier light than a small spot.
    const lightTargets = activeFires.map((f) => ({ x: f.x, y: f.y, z: f.z, intensity: fireHeat(f) }));
    // A burning structure joins the candidate pool so a burning town actually lights the night (the
    // base reads hotter). The fixed 5-light pool still picks the top few by heat×proximity.
    for (const s of sList) {
      if (!s.burning || s.destroyed) continue;
      const heat = (s.kind === 'depot' ? STRUCT_FIRE.lightHeatDepot : STRUCT_FIRE.lightHeatCabin) * (0.5 + 0.5 * (1 - s.health));
      lightTargets.push({ x: s.x, y: s.y + 2, z: s.z, intensity: heat });
    }
    this.heroFire.update(lightTargets, this.heliSim.position, this.elapsed);

    // B4 heat haze: refresh the pooled fire-crown list the postfx HeatHaze pass reads. Pooled
    // (no per-frame alloc); entries past hazeCount keep heat 0 so the pass skips them.
    this.hazeCount = 0;
    for (let i = 0; i < activeFires.length && this.hazeCount < this.hazeSources.length; i++) {
      const f = activeFires[i];
      const s = this.hazeSources[this.hazeCount++];
      s.x = f.x;
      s.y = f.y;
      s.z = f.z;
      s.heat = fireHeat(f);
    }
    for (let i = this.hazeCount; i < this.hazeSources.length; i++) this.hazeSources[i].heat = 0;

    // B4/C3.1: per-fire smoke plumes — a big, hot fire emits MORE puffs per burst from a
    // HIGHER crown, and (in the shader) bigger/denser/darker ones, so its column towers and
    // obscures the seat of the fire. Then integrate the pool (rise + bend downwind).
    this.smokeAccum += dt;
    const puff = this.smokeAccum >= SMOKE.emitInterval;
    if (puff) this.smokeAccum -= SMOKE.emitInterval;
    if (puff) {
      for (const f of activeFires) {
        const heat = fireHeat(f);
        if (heat <= SMOKE.minIntensity) continue;
        const crown = f.y + SMOKE.crownBase + SMOKE.crownPerSize * f.size;
        // Floor of 2 so even a small spot fire throws a readable column, scaling up to a dense
        // wall of puffs for a big blaze (which then obscures its own seat).
        const puffs = 2 + Math.round(heat * (SMOKE.maxPuffsPerBurst - 2));
        for (let k = 0; k < puffs; k++) this.smoke.emit(f.x, crown, f.z, heat);
      }
      // Burning structures throw their own column off the rooftop — the base belches a heavy one.
      for (const s of sList) {
        if (!s.burning || s.destroyed) continue;
        const heat = THREE.MathUtils.clamp(STRUCT_FIRE.flameBase + (1 - s.health) * STRUCT_FIRE.flameGain, 0, 1);
        const crown = s.y + (s.kind === 'depot' ? STRUCT_FIRE.smokeCrownDepot : STRUCT_FIRE.smokeCrownCabin);
        const puffs = s.kind === 'depot' ? STRUCT_FIRE.smokePuffsDepot : STRUCT_FIRE.smokePuffsCabin;
        for (let k = 0; k < puffs; k++) this.smoke.emit(s.x, crown, s.z, heat);
      }
    }
    this.smoke.update(dt, this.wind.vx, this.wind.vz);

    // Cinematic embers/sparks — stream up off the flame body of each burning fire, scaled
    // by heat, then integrate the pool (buoyant rise → arc over → bend downwind → twinkle).
    this.emberAccum += dt;
    const spark = this.emberAccum >= EMBERS.emitInterval;
    if (spark) this.emberAccum -= EMBERS.emitInterval;
    if (spark) {
      for (const f of activeFires) {
        const heat = fireHeat(f);
        if (heat <= EMBERS.minHeat) continue;
        const crown = f.y + 1.5 + 6 * f.size; // sparks leave the flame body, low-to-mid
        const n = 1 + Math.round(heat * (EMBERS.maxPerBurst - 1));
        for (let k = 0; k < n; k++) this.embers.emit(f.x, crown, f.z, heat);
      }
      // Sparks off burning structures (the base showers more).
      for (const s of sList) {
        if (!s.burning || s.destroyed) continue;
        const heat = THREE.MathUtils.clamp(STRUCT_FIRE.flameBase + (1 - s.health) * STRUCT_FIRE.flameGain, 0, 1);
        const rate = s.kind === 'depot' ? STRUCT_FIRE.emberRateDepot : STRUCT_FIRE.emberRateCabin;
        const n = Math.max(1, Math.round(heat * EMBERS.maxPerBurst * rate));
        const crown = s.y + (s.kind === 'depot' ? 3 : 1.5);
        for (let k = 0; k < n; k++) this.embers.emit(s.x, crown, s.z, heat);
      }
    }
    this.embers.update(dt, this.wind.vx, this.wind.vz, this.elapsed);

    // --- Sun shadow follows the aircraft; camera trails it; HUD reflects state ---
    const hp = this.heliSim.position;
    // The sun rides at the mission's time-of-day offset (set once from the preset's sunDir):
    // low + raking for dawn/golden/dusk, high overhead for noon. The god-ray pass reads this
    // direction (via frame.uSunDir) so the shafts emanate from wherever the sun actually sits.
    this.sun.position.copy(hp).add(this.sunOffset);
    this.sun.target.position.set(hp.x, hp.y, hp.z);
    // Bombing-run assist (portrait readability, concern 6): when lining up a drop — low, slow, carrying
    // water near a fire — arm the camera's gentle look-down so the impact zone shows. ChaseCamera eases
    // it in/out and ignores it in landscape / while free-looking.
    const armBombing =
      CAMERA.bombingRun &&
      this.payloadMode === 'water' &&
      this.water >= CAMERA.bombingArmWater &&
      this.heliSim.agl < CAMERA.bombingArmAgl &&
      this.heliSim.speed < CAMERA.bombingArmSpeed &&
      this.nearestFireDist(hp.x, hp.z, activeFires) < CAMERA.bombingArmFireDist
        ? 1
        : 0;
    // Spool progress (0..1) drives the cold-start fly-in pull-out; 1 once the engine is up (or under a
    // QA skip) so the camera holds the normal flight trail thereafter.
    const spool = this.engineStarted ? 1 : this.rotorRpm;
    this.chase.update(dt, this.heliSim.position, this.heliSim.yaw, this.input.look, armBombing, spool);
    this.skyDome.position.copy(this.chase.camera.position); // keep the sky centered on the eye
    // Ambient amber motes drift in the air around the eye and thicken near a blaze (atmosphere).
    const cam = this.chase.camera.position;
    this.ambientEmbers.update(dt, cam.x, cam.y, cam.z, this.wind.vx, this.wind.vz, this.elapsed, activeFires, FIRE3D.maxIntensity);
    // Forest LOD: only keep the tree chunks near the camera (frustum culling drops the
    // rest); centered on the eye so chunks ahead/behind toggle correctly.
    this.forest.cull(this.chase.camera.position.x, this.chase.camera.position.z);
    this.forestNear.cull(this.chase.camera.position.x, this.chase.camera.position.z); // the sync near-spawn patch
    this.groves?.cull(this.chase.camera.position.x, this.chase.camera.position.z); // null until the deferred build runs
    this.snags?.cull(this.chase.camera.position.x, this.chase.camera.position.z);
    // C5: trees the fire field reaches ignite, char, and collapse into black snags.
    const fireHeatAt = (x: number, z: number): number => this.fireSystem.heatAt(x, z);
    this.forest.updateFire(dt, fireHeatAt);
    this.groves?.updateFire(dt, fireHeatAt);
    this.fauna.update(dt, this.elapsed, this.chase.camera.position, fireHeatAt); // wildlife bob/wander/flee + cull

    // C5: BLINDING SMOKE — thicken a full-screen veil when the camera is downwind of (inside)
    // a plume. Sample fire heat UPWIND of the eye (smoke drifts downwind from the fire); fade
    // it out at altitude so climbing out of the column restores visibility (read the wind!).
    {
      const cp = this.chase.camera.position;
      const wl = Math.hypot(this.wind.vx, this.wind.vz);
      const ux = wl > 1e-3 ? this.wind.vx / wl : 0;
      const uz = wl > 1e-3 ? this.wind.vz / wl : 0;
      const R = FIRE3D.smokeBlindRadius;
      let s = this.fireSystem.heatAt(cp.x, cp.z);
      for (const d of [0.4, 0.75, 1.0]) {
        s = Math.max(s, this.fireSystem.heatAt(cp.x - ux * R * d, cp.z - uz * R * d));
      }
      const aglFade = THREE.MathUtils.clamp(1 - (this.heliSim.agl - 90) / 170, 0, 1);
      const target = Math.min(FIRE3D.smokeBlindMax, s * 1.3) * aglFade;
      this.smokeVeil += (target - this.smokeVeil) * Math.min(1, 4 * dt);
      this.hud.setSmoke(this.smokeVeil);
    }

    // --- Animate the water: age ripples, spawn rings from scoop/drop, tick the
    // shared time/wind/sun uniforms once for every material that reads them. ---
    this.ripples.update(dt);
    this.rippleTimer -= dt;
    if (this.rippleTimer <= 0) {
      if (dropping) {
        // Rings appear where the water LANDS — the wind-drifted impact center (resolveDrop set _drop
        // this frame), not under the bucket — so the splash agrees with the doused cells + the spray.
        this.ripples.spawn(this._drop.cx, this._drop.cz, WATER.dropStrength);
        this.rippleTimer = 0.1;
      } else if (scooping) {
        this.ripples.spawn(this.bucketSim.position.x, this.bucketSim.position.z, WATER.dipStrength);
        this.rippleTimer = 0.18;
      }
    }

    // C4 rotor downwash on water: when the heli flies low over a lake, the wash dimples
    // the surface into concentric rings emanating from beneath it (separate cadence from
    // the bucket dip/drop rings; punch scales with how hard the wash reaches the surface).
    this.washRippleTimer -= dt;
    if (this.wash.surface > 0.05 && this.washRippleTimer <= 0 && this.world.isOverWater(washX, washZ)) {
      this.ripples.spawn(washX, washZ, WASH.rippleStrength * this.wash.surface);
      this.washRippleTimer = WASH.rippleInterval;
    }
    // Share the downwash disc with the foliage shader (canopy bends outward beneath the heli).
    this.frame.setWash(washX, washZ, WASH.foliageRadius, this.wash.surface);

    // --- Water-drop spray: pour droplets from the bucket mouth while dropping, then
    // integrate them (gravity + impact). Droplets that land on a lake nudge a ripple. ---
    this.sprayAccum += dt;
    const leaking = dropping || (scraping && this.water > 0); // dump OR slop-from-scrape
    if (leaking && this.sprayAccum >= SPRAY.emitInterval) {
      this.sprayAccum = 0;
      // Launch the sheet from the bucket mouth, but carry the WIND as a constant velocity so a droplet
      // that lives ~its life drifts the same offset resolveDrop applied to the douse center — the
      // visible curtain blows downwind exactly as far as the water actually lands.
      this.spray.emit(
        this.bucketSim.position.x,
        this.bucketSim.position.y,
        this.bucketSim.position.z,
        this.heliSim.velX + this.wind.vx * DROP_PHYSICS.windDriftGain,
        this.heliSim.velZ + this.wind.vz * DROP_PHYSICS.windDriftGain,
      );
    }
    this.spray.update(dt, (x, z) => this.surfaceAt(x, z), (x, z) => {
      if (this.world.isOverWater(x, z) && Math.random() < 0.15) this.ripples.spawn(x, z, WATER.dipStrength);
    });

    // --- Predicted-impact ring (concern 1 + 6): while carrying water low, draw a ground ring at the
    // SAME wind-drifted center + footprint the douse would use, colored by quality — green (will bite) /
    // amber (too high, dispersed) / red (no fire under it, you'll miss). Hidden when cruising high or
    // with no fire in reach. It's literally a visualization of resolveDrop, so what you aim is what hits. ---
    if (this.payloadMode === 'water' && this.water > 0 && !this.won && !this.lost) {
      const pm = this.resolveDrop(this.bucketSim.position.x, this.bucketSim.position.z, this.bucketSim.position.y);
      const nearFire = this.nearestFireDist(pm.cx, pm.cz, activeFires);
      if (pm.agl >= DROP_FX.markerShowAGL || nearFire > DROP_FX.markerHideDist) {
        this.dropMarker.hide();
      } else {
        let color: number;
        let opacity: number;
        if (nearFire > DROP_FX.markerWideDist) {
          color = DROP_FX.markerColorWide; // a fire's in reach but your predicted center misses it
          opacity = DROP_FX.markerMinOpacity + 0.18;
        } else if (!pm.inBand) {
          color = DROP_FX.markerColorTooHigh; // over the fire but too high → fades toward min as you climb
          const k = Math.min(1, Math.max(0, (pm.agl - DROP_PHYSICS.bandHi) / (DROP_FX.markerShowAGL - DROP_PHYSICS.bandHi)));
          opacity = DROP_FX.markerMaxOpacity + (DROP_FX.markerMinOpacity - DROP_FX.markerMaxOpacity) * k;
        } else {
          color = DROP_FX.markerColorInBand; // dead on — this drop bites
          opacity = DROP_FX.markerMaxOpacity;
        }
        this.dropMarker.show(pm.cx, pm.cz, pm.radius * DROP_FX.ringScale, color, opacity, this.world.groundHeightAt(pm.cx, pm.cz));
      }
    } else {
      this.dropMarker.hide();
    }

    // --- Fire-HEAD chevrons: mark each active fire's advancing (downwind) head so the player can read
    // where to drop. The chevron sits on the leading edge and POINTS the way the fire runs; opacity
    // scales with the fire's heat relative to the strongest head (so the main head pops) and pulses. ---
    {
      const wl = Math.hypot(this.wind.vx, this.wind.vz);
      const wux = wl > 1e-3 ? this.wind.vx / wl : 1;
      const wuz = wl > 1e-3 ? this.wind.vz / wl : 0;
      let maxHeat = 0;
      for (let i = 0; i < activeFires.length; i++) {
        const h = fireHeat(activeFires[i]);
        if (h > maxHeat) maxHeat = h;
      }
      const pulse = 1 - FIREHEAD.pulseDepth * (0.5 + 0.5 * Math.sin(this.elapsed * FIREHEAD.pulseHz * Math.PI * 2));
      let shown = 0;
      for (let i = 0; i < activeFires.length; i++) {
        const f = activeFires[i];
        const heat = fireHeat(f);
        if (heat < FIREHEAD.minHeat) continue;
        const lead = FIREHEAD.lead * (0.4 + 0.6 * f.size) * (0.3 + 0.7 * Math.min(1, wl));
        const hx = f.x + wux * lead;
        const hz = f.z + wuz * lead;
        const rel = maxHeat > 0 ? heat / maxHeat : 1;
        const opacity = FIREHEAD.baseOpacity * (FIREHEAD.minOpacityFrac + (1 - FIREHEAD.minOpacityFrac) * rel) * pulse;
        this.fireHeads.show(shown, hx, hz, this.world.groundHeightAt(hx, hz), wux, wuz, f.size, opacity);
        shown++;
      }
      this.fireHeads.hideFrom(shown);
    }

    this.frame.update(dt, this.wind.vx, this.wind.vz, this.sun.position, this.sun.target.position);

    const firesLeft = this.fireSystem.activeCount;

    // --- Interactive first-flight coach: read the loop state we just computed and drive the overlay +
    // control spotlight. Inert (active=false) on every mission but a new pilot's first mission. ---
    if (!this.coachCompleted && (this.coach.active || this.coachShown)) {
      const cs = this.coach.update({
        dt,
        engineStarted: this.engineStarted,
        inBriefing: this.inBriefing,
        frozen,
        speed: this.heliSim.speed,
        yawRate: Math.abs(c.turn),
        overWater,
        scooping,
        water: this.water,
        capacity: this.capacity,
        dropping,
        firesLeft,
        won: this.won,
        lost: this.lost,
      });
      if (cs.kind === 'running') {
        if (!this.coachShown) {
          this.hud.showCoach({ onSkip: () => this.skipCoach() });
          this.coachShown = true;
        }
        this.hud.setCoach(cs.prompt);
        this.input.setHighlight(cs.prompt.highlight);
      } else if (cs.kind === 'complete') {
        this.coachCompleted = true;
        markTutorialDone();
        this.hud.completeCoach();
        this.input.setHighlight(null);
      } else if (this.coachShown) {
        // Inactive after it had been running → the mission ended (loss); fold the coach away.
        this.hud.hideCoach();
        this.coachShown = false;
        this.input.setHighlight(null);
      }
    }

    // Crew missions guide to the next zone; water missions warn on scrape, else guide the scoop. On a
    // mixed mission the hint follows the RIGGED loadout, and a "re-rig at base" cue shows once set down.
    const swapHint =
      this.loadouts.length > 1 && this.atHomeBaseLanded()
        ? `⇄ SWAP / G → re-rig to the ${this.loadouts[(this.loadoutIdx + 1) % this.loadouts.length] === 'water' ? 'bucket' : 'crew sling'}`
        : null;
    const hint =
      swapHint ??
      (this.crew && this.payloadMode === 'crew'
        ? this.crew.hint()
        : scraping
          ? this.water > 0
            ? 'Bucket dragging — climb! (spilling water)'
            : 'Bucket dragging — climb!'
          : this.scoopHint(overWater, scooping));
    this.hud.update({
      water: this.water,
      waterMax: this.capacity,
      scooping, // bucket actively filling → the HUD glows the water bar so "keep dipping" reads
      bucketDetached: this.payloadMode === 'water' && !this.bucketAttached, // jettisoned → water pod reads "NO BUCKET"

      health: this.healthSim.health,
      healthLow: this.healthSim.low,
      firesLeft,
      hint,
      won: this.won,
      // MSL altimeter: height above the sea-level datum — rises whenever you climb,
      // independent of the terrain below (fixes "reads low when high over a hill").
      altFt: Math.max(0, (this.heliSim.position.y - SEA_LEVEL) * FT_PER_UNIT),
      // Radar altitude: true height above the surface (water or ground) directly below —
      // the number you fly down to the pad on, and what the LOW warning keys off.
      raFt: Math.max(
        0,
        (this.heliSim.position.y - this.surfaceAt(this.heliSim.position.x, this.heliSim.position.z)) *
          FT_PER_UNIT,
      ),
      speed: this.heliSim.speed * KT_PER_UNIT, // knots airspeed
      vertSpeed: this.heliSim.vertSpeed * FPM_PER_UNIT, // ft/min
      heliX: this.heliSim.position.x,
      heliZ: this.heliSim.position.z,
      yaw: this.heliSim.yaw,
      windKt: this.wind.strength * FLIGHT.windSpeed * KT_PER_UNIT,
      windDir: this.wind.angle, // Wind.vx/vz = cos/sin(angle) → blows toward `angle`
      fires: this.refillFireRadar(activeFires),
      lakes: this.lakeRadar ?? (this.lakeRadar = this.lakes.map((l) => ({ x: l.x, z: l.z, r: l.r }))),
      worldSize: WORLD3D.size, // bounding square (= fire-field/burn-overlay extent), unchanged
      worldSizeX: this.world.sizeX, // true playfield rect — drives the radar's satellite-map blit
      worldSizeZ: this.world.sizeZ,
      // C3 stakes: structures to defend, the threat gauge, lose state + final score.
      structures: sList.map((s) => ({ x: s.x, z: s.z, kind: s.kind, health: s.health, burning: s.burning })),
      // Refuel bases (home + forward pads) — radar markers + the low-fuel RTB cue point to the nearest.
      bases: this.baseSites,
      threat: this.structures.threat,
      threatName: this.structures.threatName,
      lost: this.lost,
      score: this.finalScore,
      // Campaign layer: live objective checklist, fuel gauge, crew landing-zone radar blips.
      objectives: this.runtime.tracker,
      fuel: this.fuelSim ? this.fuelSim.fuel : undefined,
      fuelLow: this.fuelSim ? this.fuelSim.low : undefined,
      zones: this.crew ? this.crew.views.map((v) => ({ x: v.x, z: v.z, active: v.active, done: v.done, home: v.home, lost: v.lost })) : undefined,
      // Crew aboard count + live board/disembark dwell → the strip's crew icon + the BOARDING bar.
      crew: this.crew
        ? {
            onboard: this.crew.onboard,
            delivered: this.crew.delivered,
            total: this.crew.total,
            mode: this.crew.mode,
            progress: this.crew.progress,
          }
        : undefined,
      // Debrief summary (only meaningful at outcome; the banner reads it when it shows).
      debrief:
        this.won || this.lost
          ? {
              firesOut: Math.max(0, this.firesInitial - firesLeft),
              firesTotal: this.firesInitial,
              structSaved: this.structures.aliveCount,
              structTotal: this.structures.total,
              crewDone: this.crew?.delivered ?? 0,
              crewTotal: this.crew?.total ?? 0,
              timeSec: this.missionElapsed,
              breakdown: this.runtime.breakdown ?? undefined, // line-itemed score + grade (null on a crash)
              cause: this.lost ? this.failCause() : undefined, // drives the blunt cause-aware loss sub-line
            }
          : undefined,
      // Aircraft just unlocked by this win → the end screen's celebratory callout (empty otherwise).
      unlocked: this.won && this.newlyUnlocked.length ? this.newlyUnlocked : undefined,
    });

    // --- Audio: constant rotor drone whose blade-slap swells with effort, plus
    // scoop/drop/win one-shots (edge-detected inside HeliAudio). ---
    this.audio.update({
      throttle: c.throttle,
      lift: c.lift,
      speed: this.heliSim.speed,
      maxSpeed: FLIGHT.maxSpeed,
      scooping,
      dropping,
      won: this.won,
      rpm: this.rotorRpm, // cold-start spool: the drone winds up with the rotor
      engineHolding: !this.engineStarted && this.hud.engineHold, // crank only sounds while START is held
    });
  }

  /** Execute one reactive-beat action — the thin Game-side bridge from the pure director to the
   *  world / HUD / audio. Posts a radio line (+ squelch), ignites a flare-up, or shifts the wind. */
  private runMissionAction(a: MissionAction): void {
    if (a.do === 'comms') {
      const urgency = a.urgency ?? 'info';
      this.hud.pushComms(a.speaker, a.text, urgency);
      this.audio.playSquelch(urgency === 'info' ? 'info' : urgency === 'warn' ? 'warn' : 'alert');
    } else if (a.do === 'ignite') {
      // Use the wind the gust is easing TOWARD (intended), so a fire lit in the same beat as a wind
      // shift orients to the NEW wind, not the pre-shift vector.
      igniteFromPlacement(this.world, this.fireSystem, a.place, { vx: this.wind.intendedVx, vz: this.wind.intendedVz }, this.fireBoundX, this.fireBoundZ);
    } else if (a.do === 'wind') {
      this.wind.shiftTo(a.angle, a.strengthScale, a.ease);
    } else if (a.do === 'addObjective') {
      // A crew objective with no transport can never be delivered → it would softlock the mission.
      // Warn loud (authoring guardrail) rather than fail silently; the catalog always pairs these.
      if ((a.objective.kind === 'deliver' || a.objective.kind === 'evacuate') && !this.crew)
        console.warn('[mission] addObjective added a crew goal but this mission has no crew transport — give it a base `zones` endpoint or it cannot be completed.');
      this.runtime.addObjective(a.objective); // a rescue/task pops up mid-mission
    } else if (a.do === 'addZone') {
      this.addCrewZoneRuntime(a.zone); // its cabin/family appears in the world
    }
  }

  /**
   * Spawn a pop-up rescue endpoint at runtime (the `addZone` beat): resolve + refine to a flat
   * landable spot like the opening zones, drop its marker + waiting crew, register it as a landing pad
   * (so the flight floor eases for a touchdown), then hand it to the live transport. Requires the
   * mission to be crew-capable from the start (CrewTransport already built); otherwise a no-op.
   */
  private addCrewZoneRuntime(spec: ZonePlacement): void {
    if (!this.crew) {
      console.warn('[mission] addZone fired but this mission has no crew transport — give it a base `zones` endpoint to enable pop-up rescues.');
      return;
    }
    const base = resolveCrewZone(this.world, spec);
    const depot = this.depotXZ;
    const pad = this.helipadXZ;
    let refined: CrewZone;
    if (depot && pad && Math.hypot(base.x - depot.x, base.z - depot.z) < 2) {
      refined = { ...base, x: pad.x, z: pad.z }; // a base endpoint boards on the cold-start helipad
    } else {
      const spot = this.findFlatSpotNear(base.x, base.z, 10);
      refined = { ...base, x: spot.x, z: spot.z };
    }
    const gy = this.world.groundHeightAt(refined.x, refined.z);
    const lz = createLandingZone(!refined.single, MISSIONS.zoneSmoke, refined.single); // a base endpoint sits on the helipad → beacon-only
    lz.group.position.set(refined.x, gy, refined.z);
    this.scene.add(lz.group);
    this.lzMeshes.push(lz);
    if (!refined.single) this.homeBeacons.push({ zone: lz, x: refined.x, z: refined.z });
    const figs = createCrewFigures();
    figs.group.position.set(refined.x, gy, refined.z);
    this.scene.add(figs.group);
    this.crewFigures.push(figs);
    this.crewZones.push(refined);
    this.landingPads.push({ x: refined.x, z: refined.z }); // ease the flight floor so the skids meet ground here
    this.crew.addZone(refined);
  }

  /** Build the per-frame snapshot the mission evaluator reads (Game already tracks all of it). */
  private missionSignals(): MissionSignals {
    // Track the worst conditions actually faced — these only grow, captured up to the outcome frame
    // (this runs only while the sim is live), and feed the dynamic-hardship score multiplier.
    if (this.structures.threat > this.peakThreat) this.peakThreat = this.structures.threat;
    if (this.fireSystem.activeCount > this.peakFireLoad) this.peakFireLoad = this.fireSystem.activeCount;
    return {
      firesActive: this.fireSystem.activeCount,
      firesInitial: this.firesInitial,
      firesDoused: this.fireSystem.doused,
      structuresAlive: this.structures.aliveCount,
      structuresTotal: this.structures.total,
      crewsDelivered: this.crew?.delivered ?? 0,
      crewsTotal: this.crew?.total ?? 0,
      crewsLost: this.crew?.lostCount ?? 0,
      backburnLit: this.backburn?.lit ?? 0,
      elapsed: this.missionElapsed,
      fuel: this.fuelSim?.fuel ?? 1,
      starved: this.fuelSim?.starved ?? false,
      threat: this.structures.threat,
      windAngle: this.wind.angle,
      tally: this.scoreTally(),
    };
  }

  /** Snapshot the run aggregates the scorer reads at the win/lose frame (see missions/score.ts). */
  private scoreTally(): ScoreTally {
    const saved = this.structures.aliveCount;
    const pristine = this.structures.list.reduce((n, s) => n + (s.health >= SCORE.pristineHealth ? 1 : 0), 0);
    return {
      firesDoused: this.fireSystem.doused,
      firesBurnedOut: this.fireSystem.burnedOut,
      firesInitial: this.firesInitial,
      structuresSaved: saved,
      structuresTotal: this.structures.total,
      structuresLost: this.structures.total - saved,
      structuresPristine: pristine,
      crewsDelivered: this.crew?.delivered ?? 0,
      crewsTotal: this.crew?.total ?? 0,
      drops: this.scoreDrops,
      dropsEffective: this.scoreDropsEffective,
      dropsWasted: this.scoreDropsWasted,
      peakThreat: this.peakThreat,
      peakFireLoad: this.peakFireLoad,
      fuelEnd: this.fuelSim?.fuel ?? 1,
      hardLandings: this.hardLandings,
      crashed: this.crashed,
    };
  }

  /** Build the on-screen mute toggle (mounted under the radar). A round glass button that flips the
   *  rotor audio + reflects state; subscribes to HeliAudio so the 'M' key keeps the glyph in sync. */
  private buildMuteButton(): HTMLDivElement {
    const btn = button(this.audio.isMuted ? '🔇' : '🔊', {
      position: 'relative',
      width: '40px',
      height: '40px',
      fontSize: '18px',
      color: UI.dim,
      fontWeight: FW.semibold,
    });
    btn.title = 'Mute / unmute sound (M)';
    btn.setAttribute('aria-label', 'Mute or unmute sound');
    const sync = (m: boolean): void => {
      btn.textContent = m ? '🔇' : '🔊';
      btn.style.color = m ? UI.warn : UI.dim;
    };
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.audio.toggleMute();
    });
    this.audio.onMuteChange(sync);
    sync(this.audio.isMuted);
    return btn;
  }

  /**
   * Active/background toggle (driven by main.ts off `visibilitychange`): when the tab is hidden we
   * suspend the audio graph so a backgrounded game goes silent and stops draining battery, restoring
   * the exact prior level (muted or not) on return. The render loop is gated separately in main.ts.
   */
  setActive(active: boolean): void {
    this.audio.setSuspended(!active);
  }

  /** Latch the mission outcome from the runtime once (freezes the sim, persists a win). */
  private latchOutcome(): void {
    if (this.won || this.lost) return;
    this.won = this.runtime.state === 'won';
    this.lost = this.runtime.state === 'lost';
    this.finalScore = this.runtime.score;
    if (this.won) {
      // Heli unlocks gate on the COUNT of cleared missions, so sample it either side of recording the
      // win: an airframe whose `unlockAfter` lands in that gap just opened → celebrate it on the end
      // screen. (recordWin only grows the count on a FIRST clear, so a replay announces nothing.)
      const clearedBefore = getProgress().completed.length;
      recordWin(this.mission.id, this.finalScore, this.runtime.completion());
      // Daily Burn streak (audit VISION-3): a clear today extends the consecutive-UTC-day chain. The
      // streak store is idempotent per UTC day, so a same-day replay (or a per-frame outcome latch)
      // never double-counts. Gated to daily ids so a campaign clear can't bump the daily streak.
      if (isDailyId(this.mission.id)) recordDailyClear();
      const clearedAfter = getProgress().completed.length;
      this.newlyUnlocked = newlyUnlockedHelis(clearedBefore, clearedAfter).map((h) => ({ name: h.name, tagline: h.tagline }));
      // Global leaderboard (optional): fire-and-forget — submitScore never throws and no-ops
      // when Supabase isn't configured, so the win flow is unaffected if the network/board is down.
      void submitScore({
        pilot: this.pilotName ?? 'Pilot',
        missionId: this.mission.id,
        score: this.finalScore,
        timeS: this.missionElapsed,
      });
      // Cloud progress sync (optional): if this device is linked to an email account, push the
      // freshly-recorded unlocks/scores. No-ops when unlinked or Supabase is unconfigured.
      void cloudAutoSave();
    } else if (this.lost) {
      // Loss capstone: Dispatch closes the loop straight, no sugar (every mission authors a triumphant
      // 'won' beat but none a 'lost' one, and losing was otherwise silent on the radio). Crashes never
      // reach here — they go through finishCrash and already mayday'd — so this is the mission-rule
      // loss, keyed off the constraint that actually latched. ('Water-1' → the pilot's callsign.)
      const line =
        this.runtime.failedKind === 'rescue'
          ? "Water-1, the family's gone — the fire beat you to them. Break it off."
          : this.runtime.failedKind === 'fuelOut'
            ? "Water-1, you're out of fuel. That's the mission — should've watched the gauge."
            : this.runtime.failedKind === 'timeout'
              ? "Water-1, that's time — the fire got past us. Break it off."
              : this.runtime.failedKind === 'protect'
                ? "Water-1, break it off. The community's gone — we lost this one."
                : "Water-1, break it off. The fire beat us this time.";
      this.hud.pushComms('dispatch', line, 'alert');
      this.audio.playSquelch('alert');
    }
  }

  /**
   * Why the run ended in failure — drives the blunt, cause-specific end-banner sub-line. A crash
   * carries its sub-cause (`crashCause`, set at the strike/slam); a mission-rule loss is read live
   * from the signals (dry tank → fuel, a structure past the protect line → structures). 'fire' is the
   * catch-all (e.g. a timeout, or a structures-min loss with everything still standing).
   */
  private failCause(): 'tree' | 'impact' | 'airframe' | 'bridge' | 'fuel' | 'casualty' | 'timeout' | 'structures' | 'fire' {
    if (this.crashed) return this.crashCause ?? 'airframe'; // a crash isn't a mission-rule loss
    if (this.fuelLost) return 'fuel'; // universal dry-tank loss (latched Game-level, runtime may not have failed)
    // Otherwise map the constraint that actually latched (precise — not a re-guess from signals).
    switch (this.runtime.failedKind) {
      case 'rescue':
        return 'casualty';
      case 'fuelOut':
        return 'fuel';
      case 'protect':
        return 'structures';
      case 'timeout':
        return 'timeout';
      default:
        return 'fire';
    }
  }

  /**
   * Finish a crash: latch the mission LOSS once the death hold has elapsed (the modal trigger — `lost`
   * keeps `frozen` true and the HUD shows the MISSION FAILED banner next frame). `detonate()` already
   * fired the explosion + mayday at the impact; this is just the delayed end-of-run. Kept Game-level
   * (not a MissionRuntime fail) so it's universal and the campaign verifier is untouched.
   */
  private finishCrash(): void {
    if (this.won || this.lost) return;
    this.lost = true;
    this.finalScore = this.runtime.score;
  }

  /**
   * Universal fuel-out loss: running the tank completely dry now ends the mission on EVERY fuel mission,
   * not just the opt-in `fuelOut`-fail ones. Kept Game-level (like finishCrash) so it's universal and the
   * campaign verifier is untouched; `fuelLost` routes the end banner to the fuel cause/sub-line. Fires
   * once (guarded on the outcome). The same dispatch line covers both the universal and opt-in paths.
   */
  private loseOnFuel(): void {
    if (this.won || this.lost || this.crashed) return;
    this.lost = true;
    this.fuelLost = true;
    this.finalScore = this.runtime.score;
    this.lowFuelAlert = null;
    this.hud.setAlert(null);
    this.hud.pushComms('dispatch', "Water-1, you're out of fuel. That's the mission — should've watched the gauge.", 'alert');
    this.audio.playSquelch('alert');
  }

  /**
   * Blow up the wreck: the airframe has been destroyed (a tree strike that just hit the ground, an
   * unsurvivable hard-landing slam, or the airframe ground to zero). Bursts a ball of embers + smoke at
   * the airframe, flashes the screen, fires the impact boom + cause-specific mayday call — all RIGHT NOW
   * — then starts the death hold (`crashed` freezes gameplay; the modal waits CRASH.deathHold so the
   * player SEES the crash). Fires ONCE (guarded on `crashed`). `cause` picks the radio line.
   */
  private detonate(cause: 'tree' | 'impact' | 'airframe' | 'bridge'): void {
    if (this.crashed) return; // the wreck only blows once
    this.crashed = true;
    this.crashHold = CRASH.deathHold;
    const p = this.heliSim.position;
    // Explosion: a fountain of sparks + a few dense smoke puffs off the impact point (reuses the
    // fire VFX pools — no new scene objects, no recompiles), plus a hard red screen flash + boom.
    for (let i = 0; i < CRASH.explodeEmbers; i++) this.embers.emit(p.x, p.y + 1.5, p.z, 1);
    for (let i = 0; i < CRASH.explodeSmoke; i++) this.smoke.emit(p.x, p.y + 2, p.z, 1);
    this.hud.flashDamage(1);
    this.hud.setAlert(null); // the warnings have done their job — it's a wreck now
    this.audio.playCrash();
    const message =
      cause === 'tree'
        ? 'Airframe down in the trees — mayday, mayday.'
        : cause === 'impact'
          ? 'Heavy impact — she’s gone. Mayday.'
          : cause === 'bridge'
            ? 'She’s in the river by the bridge — mayday.'
            : 'Mayday — airframe down!';
    this.hud.pushComms('warning', message, 'alert');
    this.audio.playSquelch('alert');
  }

  /**
   * Begin a tree-strike crash: the airframe flew into the canopy. Hands the flight model into its
   * crumble-and-fall state (it now tumbles to the ground, where detonate() finishes it), and sells the
   * strike immediately with a red flash + an alert squelch + a mayday call. No-op if already going down.
   */
  private beginTreeCrash(): void {
    if (this.heliSim.crashing || this.won || this.lost) return;
    this.crashCause = 'tree';
    this.heliSim.beginCrash();
    this.hud.flashDamage(1);
    this.hud.setAlert(null);
    this.hud.pushComms('warning', 'Mayday — rotor strike! Going down!', 'alert');
    this.audio.playSquelch('alert');
  }

  /**
   * Begin a bridge-strike crash: the airframe clipped a bridge while threading it. Same crumble-and-
   * fall as a tree strike (it tumbles to the river, where detonate('bridge') finishes it), with a
   * bridge-specific mayday so the cause is unmistakable. No-op if already going down.
   */
  private beginBridgeCrash(): void {
    if (this.heliSim.crashing || this.won || this.lost) return;
    this.crashCause = 'bridge';
    for (const st of this.bridgePass) st.under = false; // a clipped pass is not a clean one
    this.heliSim.beginCrash();
    this.hud.flashDamage(1);
    this.hud.setAlert(null);
    this.hud.pushComms('warning', 'Clipped the bridge — mayday, going in!', 'alert');
    this.audio.playSquelch('alert');
  }

  /**
   * Track threading the bridges for the clean-pass reward (the "secret trick"). A pass counts when the
   * airframe enters the tunnel under a deck on one side and exits the OTHER side without striking —
   * acknowledged with a quiet radio nod naming that bridge (recognition only, no score change), rate-
   * limited per bridge so hovering can't farm it. No-op (and cheap) on maps without any bridges.
   */
  private updateBridgePass(dt: number): void {
    const p = this.heliSim.position;
    for (let i = 0; i < this.bridges.length; i++) {
      const bridge = this.bridges[i];
      const st = this.bridgePass[i];
      if (st.cd > 0) st.cd -= dt;
      const { under, u } = bridge.collider.pass(p.x, p.y, p.z);
      if (under && !st.under) {
        // Entered the tunnel — remember which side, so a straight-through pass can be told from a back-out.
        st.enterU = Math.sign(u) || 1;
      } else if (!under && st.under) {
        // Left the tunnel: a clean pass is an exit on the opposite side (crossed under, didn't reverse out).
        if (Math.sign(u) === -st.enterU && st.cd <= 0 && !this.crashed && !this.won && !this.lost) {
          this.bridgePasses++;
          st.cd = BRIDGE.rewardCooldown;
          const lines = [
            `Whoo! Clean under the ${bridge.name} bridge — that was flying.`,
            `Right under the ${bridge.name} deck — nerves of steel, Water-1.`,
            `Did you just thread the ${bridge.name} bridge? Don’t tell the chief.`,
          ];
          this.hud.pushComms('crew', lines[(this.bridgePasses - 1) % lines.length], 'info');
          this.audio.playSquelch('info');
        }
      }
      st.under = under;
    }
  }

  /**
   * Per-frame crash hazards, evaluated after the flight step. Detects a TREE STRIKE — the airframe's
   * disc overlapping a treetop's solid core, deep enough (`CRASH.strikeBite`) to be fatal — and, if so,
   * begins the crumble-and-fall. Otherwise it returns the GPWS-style hazard caption (or null): a
   * "SINK RATE" / "PULL UP" descent warning and a "TERRAIN" / "TERRAIN — PULL UP" canopy-proximity
   * warning, so the player gets honest, aviation-correct notice before they slam in. Returns null when
   * a strike was triggered (the crash takes over) or when there's nothing to warn about.
   */
  private checkHazards(): string | null {
    const x = this.heliSim.position.x;
    const z = this.heliSim.position.z;
    const belly = this.heliSim.position.y; // the heli's lowest point (skid line) = its group Y
    const agl = this.heliSim.agl;
    const sink = -this.heliSim.vertSpeed; // + = descending

    // Bridge strike: the airframe clipped the deck, truss, or a bank pier of any bridge. (One O(1)
    // box test per bridge; harmless when there are none.) Threading cleanly UNDER returns false.
    for (const bridge of this.bridges) {
      if (bridge.collider.strike(x, belly, z)) {
        this.beginBridgeCrash();
        return null;
      }
    }

    // Tree strike / canopy proximity (one O(1) grid query for the worst treetop near the airframe).
    const strike = this.obstacles.heliStrike(x, z, belly, CRASH.heliRadius, CRASH.canopyCore);
    if (strike && strike.pen >= CRASH.strikeBite) {
      this.beginTreeCrash();
      return null;
    }
    const terrainClose = !!strike && strike.pen >= CRASH.warnBite;
    // Descending onto WATER is a scoop — an intended low, sometimes fast, approach the lake cushions —
    // so the sink callouts are suppressed there (no nag every scoop). Terrain warnings can't fire over
    // water anyway (no trees), so they're unaffected.
    const overWater = this.world.isOverWater(x, z);
    const sinkArmed = !overWater;

    // Priority: an imminent slam (fast sink, very low) → PULL UP; closing on the canopy that low →
    // TERRAIN — PULL UP; an approaching canopy → TERRAIN. (The lower-severity "SINK RATE" caution was
    // retired — only the imminent-slam PULL UP fires for a fast descent now.)
    if (sinkArmed && agl < CRASH.pullUpAlt && sink >= CRASH.sinkWarningRate) return 'PULL UP';
    if (terrainClose && agl < CRASH.pullUpAlt) return 'TERRAIN — PULL UP';
    if (terrainClose) return 'TERRAIN';
    return null;
  }

  /**
   * Hard-landing feedback: the airframe number quietly dropping went unnoticed, so a dent now FIRES a
   * red impact flash + a severity-scaled Dispatch warning + a squelch. `lost` is the health fraction
   * shed this touchdown; once the airframe crosses the warn line it escalates to a critical alert. The
   * HEALTH bar in the strip visibly drops alongside (animated). detonate() owns the mayday + explosion
   * when a slam is fatal (or grinds the airframe to zero); this is only the SURVIVABLE-dent feedback.
   */
  private reportAirframeHit(lost: number): void {
    const critical = this.healthSim.low; // airframe now in the warning band
    const sev = Math.min(1, lost / 0.25); // a ~quarter-bar loss reads as a full-strength flash
    this.hud.flashDamage(critical ? Math.max(sev, 0.7) : sev);
    if (critical) {
      this.hud.pushComms('warning', 'Hard impact — airframe critical! Set down at a base to repair.', 'alert');
      this.audio.playSquelch('alert');
    } else {
      const text = lost > 0.15 ? 'Heavy landing — airframe damage taken.' : 'Hard landing — ease the descent on touchdown.';
      this.hud.pushComms('warning', text, 'warn');
      this.audio.playSquelch('warn');
    }
  }

  /** Grounded + slow within refuel range of ANY base (home or a forward pad) → refuelling/repairing. */
  private canRefuel(): boolean {
    if (this.baseSites.length === 0) return false;
    if (this.heliSim.agl > MISSIONS.refuelAgl || this.heliSim.speed > MISSIONS.refuelSpeed) return false;
    for (const b of this.baseSites) {
      if (Math.hypot(this.heliSim.position.x - b.x, this.heliSim.position.z - b.z) <= MISSIONS.refuelRadius) return true;
    }
    return false;
  }

  /**
   * WATER-payload per-frame: swing + pose the slung Bambi bucket, redraw the longline catenary,
   * fill it while dipped in a lake (scoop), spill on a hard scrape, and resolve a drop. Returns the
   * flags Game's ripple/spray/HUD/audio read. Crew missions never call this — they carry the crew in
   * the cabin and LAND to load/unload, so they fly with no slung load and no rope.
   */
  private updateSlungBucket(
    dtMs: number,
    c: ControlState,
    frozen: boolean,
  ): { scooping: boolean; scraping: boolean; dropping: boolean; overWater: boolean } {
    const fillRatio = this.water / this.capacity;
    // Cargo hook on the belly of the fuselage — above the skid line by bellyOffset.
    // This is where the longline attaches, not the heli's center/skid position.
    _bellyAnchor.set(
      this.heliSim.position.x,
      this.heliSim.position.y + BUCKET3D.bellyOffset,
      this.heliSim.position.z,
    );
    // When the heli is on the deck the slung load isn't dangling under the belly — a ground crew lays
    // it out on the pad just ahead of the nose, line slack. While AGL is below `parkAgl` we PARK the
    // bucket there (upright, motion zeroed) and hand back to the pendulum once it lifts off.
    const onGround = this.heliSim.agl < BUCKET3D.parkAgl;
    let dipping = false;
    if (onGround) {
      const fx = Math.cos(this.heliSim.yaw);
      const fz = -Math.sin(this.heliSim.yaw); // world-forward for this heading (nose = +X)
      const px = this.heliSim.position.x + fx * BUCKET3D.parkAhead;
      const pz = this.heliSim.position.z + fz * BUCKET3D.parkAhead;
      const py = this.obstacles.heightAt(px, pz) + BUCKET3D.bottomOffset; // rest on the ground
      this.bucketSim.parkAt(px, py, pz);
    } else {
      // "Submerged" is read from the World water plane under the bucket's XZ (last frame's position —
      // one-frame lag is imperceptible), consistent with the flight floor and every other height query.
      // Forgiving on both axes so a SUNK or TIPPED-OVER bucket reliably scoops, not just a perfect surface
      // kiss: (1) a small horizontal `dipReach` tolerates the bucket swinging a little past the shoreline,
      // and (2) the test is on the bucket's UNDERSIDE — so once the mouth is at/below the surface (and
      // deeper always counts) it fills, instead of demanding the higher origin point sit in a thin band.
      const wl = this.world.scoopWaterAt(this.bucketSim.position.x, this.bucketSim.position.z, BUCKET3D.dipReach);
      dipping = wl !== null && this.bucketSim.position.y - BUCKET3D.bottomOffset <= wl + BUCKET3D.dipThreshold;
      // Collision surface under the bucket (terrain raised to any treetop it'd catch on).
      const obstacleY = this.obstacles.heightAt(this.bucketSim.position.x, this.bucketSim.position.z);
      this.bucketObstacleY = obstacleY; // cache the raw surface under the bucket for the drop-AGL term
      this.bucketSim.update(dtMs, _bellyAnchor, this.heliSim.velX, this.heliSim.velZ, fillRatio, dipping, obstacleY);
    }
    const bp = this.bucketSim.position;
    this.slung.position.copy(bp);
    this.bucket.setFill(fillRatio);
    const tip = this.bucketSim.tip;
    // --- Pendulum swing: in the air the bucket HANGS ALONG the longline instead of staying bolt-
    // upright, so the lateral lag the sim already produces also reads as the body swinging out. Align
    // its local up-axis toward the belly anchor (the rope direction), partially by swingTilt so it
    // leans into the swing, then layer the scoop tip on as an extra forward pitch about local X.
    // Parked on the deck it just sits upright. ---
    if (onGround) {
      _bucketQuat.identity(); // sits upright on the pad
    } else {
      _ropeDir
        .set(
          _bellyAnchor.x - bp.x,
          _bellyAnchor.y - bp.y,
          _bellyAnchor.z - bp.z,
        )
        .normalize();
      _swingQuat.setFromUnitVectors(_UP, _ropeDir); // full hang-along-the-rope tilt
      _bucketQuat.identity().slerp(_swingQuat, BUCKET3D.swingTilt); // partial lean
      _bucketQuat.multiply(_tipQuat.setFromAxisAngle(_X, tip)); // + scoop tip (local X)
    }
    this.slung.quaternion.copy(_bucketQuat);

    // Attach the longline to the bucket's SWIVEL HEAD — but the swivel now rides wherever the swing
    // puts it, so derive its WORLD position from the bucket transform. Then draw the rope as a sagging
    // catenary that EASES with load — a light bucket bows soft, a full one pulls it taut and straight.
    _swivel.set(0, this.slungAnchorY, 0).applyQuaternion(_bucketQuat).add(bp);
    const sx = _bellyAnchor.x;
    const sy = _bellyAnchor.y;
    const sz = _bellyAnchor.z;
    const ex = _swivel.x;
    const ey = _swivel.y;
    const ez = _swivel.z;
    const sag = BUCKET3D.ropeSagEmpty + (BUCKET3D.ropeSagFull - BUCKET3D.ropeSagEmpty) * fillRatio;
    const rp = this.ropeGeom.attributes.position as THREE.BufferAttribute;
    const segs = BUCKET3D.ropeSegments;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const droop = sag * 4 * t * (1 - t); // parabolic bow: 0 at both ends, max at mid-span
      rp.setXYZ(i, sx + (ex - sx) * t, sy + (ey - sy) * t - droop, sz + (ez - sz) * t);
    }
    rp.needsUpdate = true;

    // --- Scoop is physical: fill while the bucket is dipped into a lake ---
    let scooping = false;
    if (!frozen && dipping && this.water < this.capacity) {
      this.water = Math.min(this.capacity, this.water + this.fillRate * (dtMs / 1000));
      scooping = true;
      // Topped-off cue on the rising edge to full — tells the pilot to STOP dipping and go (re-armed
      // below once the load is released). Pairs with the live "Filling… N%" hint + the water bar.
      if (this.water >= this.capacity && !this.bucketFull) {
        this.bucketFull = true;
        const teach = !coached('scoop'); // coach the first couple fills, then trust the pilot
        coachBump('scoop');
        // The spoken "bucket full" cue is a teaching line, so it stops after a couple fills (no more
        // "bucket filled, go dump" every scoop); the squelch stays as a quiet, non-verbal confirmation.
        if (teach) this.hud.pushComms('dispatch', 'Bucket full — go work the fire.', 'info');
        this.audio.playSquelch('info');
      }
    }
    if (this.water < this.capacity) this.bucketFull = false; // re-arm after any release (drop / spill)

    // --- Scrape: the bucket is dragging on terrain/treetops (the sim clamps + drags it). Drag fast
    // enough and a loaded bucket slops water out the top — the cost of flying too low. This is a
    // DIRT/CANOPY scrape only: dragging along a lake BOTTOM (deep dip) is a scoop, not a spill, so it
    // must NOT slop water out — otherwise going deeper would cancel the fill and "stop scooping". ---
    const overWater = this.world.isOverWater(bp.x, bp.z);
    let scraping = false;
    if (this.bucketSim.contact && this.bucketSim.dragSpeed > BUCKET3D.spillDragMin && !overWater && !dipping) {
      scraping = true;
      if (this.water > 0) {
        const spill = BUCKET3D.spillPerDrag * this.bucketSim.dragSpeed * (dtMs / 1000);
        this.water = Math.max(0, this.water - spill);
      }
    }

    const dropping = this.updateDrop(c, dtMs);
    return { scooping, scraping, dropping, overWater };
  }

  /** Top surface at (x, z): the lake water level over a lake, else the ground. */
  private surfaceAt(x: number, z: number): number {
    const wl = this.world.waterLevelAt(x, z);
    return wl !== null ? wl : this.world.groundHeightAt(x, z);
  }

  /**
   * Pick a flat, on-land spot for the helipad a short way off the depot building (which sits AT the
   * base XZ, so the pad can't share it). Samples a ring inside the cleared yard and takes the
   * flattest dry candidate (tie-break toward the open interior). The heli faces AWAY from the depot
   * so the parked bucket lays out over open deck and the chase camera frames the base behind it.
   */
  private findHelipadSpot(depot: { x: number; z: number }): { x: number; z: number; yaw: number } {
    const roadClear = 10; // keep the ~7u-radius deck this far off a road centreline
    let best: { x: number; z: number; yaw: number } | null = null;
    let bestScore = -Infinity;
    // Two rings inside the 34u cleared yard: the outer is the nominal offset, the inner gives the
    // search room to step OFF a road that grazes the yard (the home base is the road network's root,
    // so a highway leaves right past it — without this the deck can land square on the carriageway).
    for (const R of [16, 12]) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = depot.x + Math.cos(a) * R;
        const z = depot.z + Math.sin(a) * R;
        if (this.world.isOverWater(x, z)) continue; // a pad in the lake is no good
        // Keep the deck clear of the carriageway: a strong penalty inside `roadClear` so a truly
        // clear candidate always wins, but if a road hugs the whole yard we still pick the least-bad.
        const dRoad = this.world.distanceToRoad(x, z);
        const roadPenalty = dRoad < roadClear ? (roadClear - dRoad) * 12 : 0;
        const score = -this.world.slopeAt(x, z) * 40 - Math.hypot(x, z) * 0.04 - roadPenalty; // flat + interior + off-road
        if (score > bestScore) {
          bestScore = score;
          // world-forward (cos yaw, -sin yaw) should point from the depot OUT to this spot (and beyond).
          best = { x, z, yaw: Math.atan2(-(z - depot.z), x - depot.x) };
        }
      }
    }
    return best ?? { x: depot.x, z: depot.z, yaw: 0 };
  }

  /** True when the heli is set DOWN (skids down, stopped) on the home-base pad — the re-rig spot. */
  private atHomeBaseLanded(): boolean {
    if (!this.depotXZ) return false;
    const p = this.heliSim.position;
    return (
      this.heliSim.agl <= MISSIONS.landAgl &&
      this.heliSim.speed <= MISSIONS.landSpeed &&
      Math.hypot(p.x - this.depotXZ.x, p.z - this.depotXZ.z) <= MISSIONS.lzRadius
    );
  }

  /**
   * Re-rig the slung load to the next loadout in the cycle (bucket↔crew). The fresh rig is EMPTY (you
   * scoop after re-rigging; a crew sling carries no water), so this zeroes the tank + fill latches and
   * toggles the bucket/longline visibility. Crew progress is gated on `payloadMode` elsewhere, so the
   * ferry simply pauses while the bucket is rigged and resumes on the swap back. Radios the change.
   */
  private swapLoadout(): void {
    this.loadoutIdx = (this.loadoutIdx + 1) % this.loadouts.length;
    this.payloadMode = this.loadouts[this.loadoutIdx];
    const water = this.payloadMode === 'water';
    this.bucketAttached = water; // a swap at base always re-rigs a FRESH bucket (clears any prior jettison)
    this.bucket.group.visible = water;
    this.rope.visible = water;
    this.water = 0;
    this.bucketFull = false;
    this.dumping = false;
    // Discard any pour that was in flight when we re-rigged — otherwise `dropActive` is stranded true
    // (the water/drop block is payloadMode-gated and never closes it), surfacing a phantom "Direct hit"
    // readout + a stale score increment on the swap BACK to the bucket.
    this.dropActive = false;
    this.beginDropTally();
    this.hud.pushComms('dispatch', water ? 'Bucket rigged — fill from the lake.' : 'Crew sling rigged — go bring them out.', 'info');
  }

  /**
   * Jettison the slung bucket (the DETACH button / B). A real helitanker can release its bucket on the
   * longline — here it cuts the line: the bucket is gone, you fly LIGHTER (no payload), and you can't
   * scoop or drop until you set down at a base for a fresh one (`attachBucket`). Water-payload only;
   * no-op if already detached. Empties the tank + clears any in-flight pour so nothing is stranded.
   */
  private detachBucket(): void {
    if (!this.bucketAttached || this.payloadMode !== 'water') return;
    this.bucketAttached = false;
    this.water = 0;
    this.bucketFull = false;
    this.dumping = false;
    this.dropActive = false;
    this.beginDropTally();
    this.bucket.group.visible = false;
    this.rope.visible = false;
    this.dropMarker.hide();
    this.hud.pushComms('warning', 'Bucket released — RTB to a base to rig a fresh one.', 'warn');
    this.audio.playSquelch('warn');
  }

  /**
   * Rig a fresh bucket — fired once when a detached water mission returns to a base (grounded + slow in
   * refuel range, via `canRefuel`). Restores the slung load + longline empty (scoop to fill). No-op if
   * one's already attached. Mirrors `swapLoadout`'s fresh-rig reset, minus the loadout cycle.
   */
  private attachBucket(): void {
    if (this.bucketAttached || this.payloadMode !== 'water') return;
    this.bucketAttached = true;
    this.water = 0;
    this.bucketFull = false;
    this.bucket.group.visible = true;
    this.rope.visible = true;
    this.hud.pushComms('dispatch', 'Fresh bucket rigged — fill from the lake.', 'info');
    this.audio.playSquelch('info');
  }

  /**
   * Resolve the mission's crew endpoints to flat, landable spots. The nominal point comes from the
   * seeded scenario (`crewZones`); the BASE endpoint snaps to the helipad you cold-start on (so you
   * board where you're parked), and every other LZ is nudged to the flattest dry spot in a small
   * ring so the skids meet level ground rather than a slope. Deterministic from the world seed.
   */
  private resolveCrewZones(): CrewZone[] {
    const depot = this.depotXZ;
    const pad = this.helipadXZ;
    return crewZones(this.world, this.mission).map((z) => {
      if (depot && pad && Math.hypot(z.x - depot.x, z.z - depot.z) < 2) {
        return { ...z, x: pad.x, z: pad.z }; // the base zone boards/disembarks on the helipad
      }
      const spot = this.findFlatSpotNear(z.x, z.z, 10);
      return { ...z, x: spot.x, z: spot.z };
    });
  }

  /** Flattest dry spot in a small ring around (cx,cz) — keeps a crew LZ near its nominal point but
   *  off slopes/water so a touchdown sits level. Falls back to the nominal point. */
  private findFlatSpotNear(cx: number, cz: number, R: number): { x: number; z: number } {
    const roadClear = 9; // keep the touchdown + painted ring off the carriageway, but still roadside
    // Score a candidate: flat, dry, near the nominal point, and off the road. `rr` is its offset from
    // the nominal point (0 for the nominal itself) — so the nominal is judged on the SAME terms and a
    // nominal that landed ON a road loses to a shoulder spot instead of winning the tie by default.
    const score = (x: number, z: number, rr: number): number => {
      if (this.world.isOverWater(x, z)) return -Infinity;
      const dRoad = this.world.distanceToRoad(x, z);
      const roadPenalty = dRoad < roadClear ? (roadClear - dRoad) * 8 : 0; // steep inside the keep-clear band
      return -this.world.slopeAt(x, z) * 40 - rr * 0.1 - roadPenalty; // flat, near nominal, off-road
    };
    let best = { x: cx, z: cz };
    let bestScore = score(cx, cz, 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      // A third, wider ring gives the search room to actually clear a road running through the nominal
      // point (the inner rings can all still be on the carriageway when the LZ is sited right on it).
      for (const rr of [R * 0.5, R, R * 1.6]) {
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        const s = score(x, z, rr);
        if (s > bestScore) {
          bestScore = s;
          best = { x, z };
        }
      }
    }
    return best;
  }

  /**
   * The altitude floor the flight model rests on — `World.flightFloorAt`, but eased DOWN to the
   * landing-pad clearance within `padBlendRadius` of any landing pad (the base helipad AND every
   * crew LZ) so the heli sits skids-down on the deck and lifts off cleanly (no snap up to canopy
   * height). Takes the MIN over all pads and the real floor — easing can only ever LOWER it (so a
   * low scoop over water away from a pad still bottoms out normally).
   */
  private landingFloorAt(x: number, z: number): number {
    const real = this.world.flightFloorAt(x, z);
    let floor = real;
    for (const pad of this.landingPads) {
      const d = Math.hypot(x - pad.x, z - pad.z);
      if (d >= FLIGHT.padBlendRadius) continue;
      const padFloor = this.world.groundHeightAt(pad.x, pad.z) + FLIGHT.landClearance;
      const t = d / FLIGHT.padBlendRadius;
      const s = t * t * (3 - 2 * t); // smoothstep: pad floor at the deck → the real floor at the rim
      const eased = Math.min(real, padFloor + (real - padFloor) * s);
      if (eased < floor) floor = eased;
    }
    return floor;
  }

  /**
   * Lay one base's jetty out over its lake. Finds the base's nearest lake, marches from the base
   * toward that lake's centre to the shoreline, and places the dock there yawed so its deck (local
   * +X) runs out over the water at the lake's flat surface. No-op if there's no lake (the dock is
   * pure decoration — never gated by it). Called once per base (home + forward refuel pads).
   */
  private addBaseDock(base: { x: number; z: number }): void {
    if (this.world.lakes.length === 0) return;
    // Nearest lake to the base (it was sited on the largest lake's shore, so this is it).
    let lake = this.world.lakes[0];
    let bestD = Infinity;
    for (const l of this.world.lakes) {
      const d = Math.hypot(l.x - base.x, l.z - base.z);
      if (d < bestD) {
        bestD = d;
        lake = l;
      }
    }
    const dx = lake.x - base.x;
    const dz = lake.z - base.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    // March from the base toward the lake centre to the first point over water (the shoreline).
    let shoreX = base.x;
    let shoreZ = base.z;
    let found = false;
    for (let m = 0; m <= len; m += 1) {
      const x = base.x + ux * m;
      const z = base.z + uz * m;
      if (this.world.isOverWater(x, z)) {
        shoreX = x;
        shoreZ = z;
        found = true;
        break;
      }
    }
    if (!found) return;
    const dock = createDock(COMMUNITIES.dockLength);
    dock.position.set(shoreX, lake.waterLevel, shoreZ);
    // Local +X maps to world (cos y, 0, -sin y); aim it at the lake → y = atan2(-uz, ux).
    dock.rotation.y = Math.atan2(-uz, ux);
    this.scene.add(dock);
  }

  /**
   * Status line: COACH the dip a couple of times, then trust the pilot. A CONSTANT string (the old
   * version embedded a live % that changed every frame and so re-flashed the hint perpetually — the
   * "bucket filled, go dump" nag); the water-bar GLOW now carries the live fill feedback. Once
   * `coached('scoop')` (a few fills in) it goes quiet for good. Clears at full (the bucket-full cue +
   * the topped-off bar take over).
   */
  private scoopHint(overWater: boolean, scooping: boolean): string | null {
    if (this.water >= this.capacity) return null;
    if (coached('scoop')) return null; // taught it — the water-bar glow carries fill feedback from here
    if (scooping) return 'Hold low to fill the bucket';
    if (overWater) return 'Descend to dip the bucket in';
    return null;
  }

  /**
   * Resolve the drop for this frame and release water if active. Returns whether
   * water is actively pouring (drives the spray + ripple rings).
   *
   * 'bambi' — a tap (dropPressed) LATCHES a full dump: the whole tank empties on
   *           its own at dumpRate and can't be paused or feathered. You can't drop
   *           "just a little" — that's the real Bambi bucket, all or nothing.
   * 'valve' — water pours only while DROP is HELD and PAUSES on release, so a load
   *           can be split across several passes (the variant with a control valve).
   */
  private updateDrop(c: ControlState, dtMs: number): boolean {
    if (this.won || this.lost || this.water <= 0) {
      if (this.dropActive) this.finishDrop(); // pour ended (tank empty / mission over) → one readout
      this.dumping = false;
      return false;
    }

    if (this.payloadMode === 'crew') return false; // no water in crew payload mode

    let rate: number;
    if (this.bucketType === 'bambi') {
      if (c.dropPressed) this.dumping = true; // one tap → commit to a full dump
      if (!this.dumping) {
        if (this.dropActive) this.finishDrop();
        return false;
      }
      rate = BUCKET3D.dumpRate;
    } else {
      if (!c.drop) {
        if (this.dropActive) this.finishDrop(); // valve released → close out this pour
        return false;
      }
      rate = BUCKET3D.dropRate;
    }

    const released = Math.min(this.water, rate * (dtMs / 1000));
    this.water -= released;
    if (this.water <= 0) {
      this.water = 0;
      this.dumping = false;
    }

    // Water leaves the BUCKET's world position, not the heli's — a swung bucket misses. The shared
    // resolveDrop() then drifts the impact center downwind (more the higher you drop), widens the
    // footprint + thins the density with height, and the douse applies edge falloff + hot-resist
    // inside FireSystem. Same resolved geometry feeds the spray, ripples and aim ring, so what the
    // player saw predicted is what lands.
    if (!this.dropActive) {
      this.beginDropTally();
      this.dropActive = true;
    }
    const p = this.resolveDrop(this.bucketSim.position.x, this.bucketSim.position.z, this.bucketSim.position.y);
    const res = this.fireSystem.douse(p.cx, p.cz, p.radius, released, p.densityMul);
    const t = this.dropTally;
    t.heatRemoved += res.heatRemoved; // cumulative across the pour
    if (res.heatPresent > t.peakHeatPresent) t.peakHeatPresent = res.heatPresent; // peak (don't double-count cells)
    t.effSum += p.densityMul * released;
    t.litreSum += released;
    return released > 0;
  }

  /**
   * Resolve a drop's physical geometry from the bucket's release state — the ONE source of truth so
   * the doused cells, the spray sheet, the ripples and the predicted-impact ring all agree. Reads the
   * bucket's AGL (over the cached collision surface), the live wind, and DROP_PHYSICS. Numbers in →
   * a reused scratch out (alloc-free). Stays Game-side because it reads World/obstacle height.
   */
  private resolveDrop(bx: number, bz: number, by: number) {
    const D = DROP_PHYSICS;
    const base = BUCKET3D.dropRadius;
    const d = this._drop;
    const agl = Math.max(0, by - this.bucketObstacleY);
    // Fall time with the droplet's initial downward speed, capped at its life so the douse offset can't
    // out-drift a droplet that dies before landing (keeps the spray sheet & the impact center in lockstep).
    let tFall = 0;
    if (agl > D.minDriftAgl) {
      tFall = Math.min(SPRAY.life, (Math.sqrt(D.v0Down * D.v0Down + 2 * D.fallG * agl) - D.v0Down) / D.fallG);
    }
    // Wind carries the falling water downwind (clamped so a centered drop still partially connects).
    let dx = this.wind.vx * D.windDriftGain * tFall;
    let dz = this.wind.vz * D.windDriftGain * tFall;
    const dm = Math.hypot(dx, dz);
    if (dm > D.windDriftMax) {
      const s = D.windDriftMax / dm;
      dx *= s;
      dz *= s;
    }
    // Height → footprint + density. One-sided band: full strength at/below bandHi, thinning above.
    const k = Math.min(1, Math.max(0, (agl - D.bandHi) / (D.ceilAGL - D.bandHi))); // 0 in-band .. 1 mist
    const tR = Math.min(1, Math.max(0, agl / D.ceilAGL)); // footprint grows with height from the deck up
    d.radius = base * (D.tightRadiusMul + (D.wideRadiusMul - D.tightRadiusMul) * tR);
    d.densityMul = agl <= D.bandHi ? 1 : 1 + (D.minDensityMul - 1) * k;
    d.cx = bx + dx;
    d.cz = bz + dz;
    d.agl = agl;
    d.inBand = agl <= D.bandHi;
    return d;
  }

  /** Distance (world units) to the nearest active fire from (x,z) — Infinity if nothing burns. */
  private nearestFireDist(x: number, z: number, fires: ReadonlyArray<{ x: number; z: number }>): number {
    let best = Infinity;
    for (let i = 0; i < fires.length; i++) {
      const d = Math.hypot(fires[i].x - x, fires[i].z - z);
      if (d < best) best = d;
    }
    return best;
  }

  /** Reset the per-drop tally at the first frame water starts pouring. */
  private beginDropTally(): void {
    const t = this.dropTally;
    t.heatRemoved = 0;
    t.peakHeatPresent = 0;
    t.effSum = 0;
    t.litreSum = 0;
  }

  /**
   * Fired once when a pour ENDS (bambi tank empty / valve released): classify what the drop achieved
   * and radio a Dispatch readout + flash the water gauge, so the player KNOWS whether they hit the spot
   * (concern 1). Presentation only — never feeds the sim.
   */
  private finishDrop(): void {
    this.dropActive = false;
    const t = this.dropTally;
    if (t.litreSum <= 0) return; // nothing actually poured
    const effAvg = t.effSum / t.litreSum; // ~average density (1 in-band → 0.12 mist)
    const frac = t.heatRemoved / Math.max(1e-3, t.peakHeatPresent); // share of the fire knocked down
    let text: string;
    let urgency: 'info' | 'warn';
    let color: number;
    let wasted = false; // a missed / too-high pour — sloppy water (score precision + penalty)
    if (t.peakHeatPresent < 1e-2) {
      text = 'Missed — bucket swung wide';
      urgency = 'warn';
      color = DROP_FX.markerColorWide;
      wasted = true;
    } else if (effAvg < DROP_FX.resultTooHighEff) {
      text = 'Too high — water dispersed';
      urgency = 'warn';
      color = DROP_FX.markerColorTooHigh;
      wasted = true;
    } else if (frac >= DROP_FX.resultDirectFrac) {
      text = `Direct hit — ${Math.round(Math.min(1, frac) * 100)}% knocked down`;
      urgency = 'info';
      color = DROP_FX.markerColorInBand;
    } else if (frac >= DROP_FX.resultEdgeFrac) {
      text = 'Edge only — reposition';
      urgency = 'info';
      color = DROP_FX.markerColorTooHigh;
    } else {
      text = 'Grazing hit — light dampening';
      urgency = 'info';
      color = DROP_FX.markerColorInBand;
    }
    // Score precision: every committed pour counts; missed/too-high ones are wasted (lower hit-rate + a penalty).
    this.scoreDrops++;
    if (wasted) this.scoreDropsWasted++;
    else this.scoreDropsEffective++;
    this.hud.pushComms('dispatch', text, urgency);
    this.hud.flashGauge(cssHex(color), DROP_FX.resultGaugeTintMs);
  }
}

/**
 * A fire's "heat" 0..1 = intensity × size — the master visual signal. Size dominates so
 * the glow, hero-light reach, and smoke column all scale with the fire's size class, not
 * just its instantaneous flame brightness.
 */
function fireHeat(f: { intensity: number; size: number }): number {
  return (f.intensity / FIRE3D.maxIntensity) * (0.35 + 0.65 * f.size);
}

/** A 0xRRGGBB color number → a `#rrggbb` CSS string (for tinting the HUD water gauge on a drop result). */
function cssHex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}
