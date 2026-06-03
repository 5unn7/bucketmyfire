import * as THREE from 'three';
import { createTerrain } from './meshes/terrain';
import { createTreeField, TreeField } from './meshes/trees';
import { deciduousSpecies, snagSpecies, speciesRng } from './meshes/treeSpecies';
import { createRiverMesh } from './meshes/river';
import { createRoadMesh } from './meshes/road';
import { createYardPatch, createYardMaterial } from './meshes/clearing';
import { createDock } from './meshes/dock';
import { applyFoliageSway } from './meshes/foliageWind';
import { createHelicopter, HelicopterMesh } from './meshes/helicopter';
import { createBucket, BucketMesh } from './meshes/bucket';
import { HelicopterSim } from './sim/HelicopterSim';
import { BucketSim } from './sim/BucketSim';
import { Wind } from './sim/Wind';
import { RotorWash } from './sim/RotorWash';
import { FireSystem } from './sim/FireSystem';
import { Structures } from './sim/Structures';
import { createFire, FireMesh } from './meshes/fire';
import { createStructure, StructureMesh } from './meshes/cabin';
import { Lake } from './Lake';
import { World } from './World';
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
import { SmokePlume } from './vfx/SmokePlume';
import { Embers } from './vfx/Embers';
import { AmbientEmbers } from './vfx/AmbientEmbers';
import { createSkyDome } from './sky/SkyDome';
import { applyAtmosphere, GOLDEN } from './sky/TimeOfDay';
import { HeroFireLights } from './lighting/HeroFireLights';
import type { HazeSource } from './postfx/Composer';
import { HeliAudio } from './audio/HeliAudio';
import { Profile } from './ui/profile';
import { createCrewBasket, CrewBasketMesh } from './meshes/crewBasket';
import { createLandingZone, LandingZoneMesh } from './meshes/landingZone';
import { CrewTransport, CrewZone } from './sim/CrewTransport';
import { FuelSim } from './sim/FuelSim';
import { HealthSim } from './sim/HealthSim';
import { MissionRuntime } from './missions/MissionRuntime';
import { MissionDirector } from './missions/MissionDirector';
import { recordWin } from './missions/progress';
import { submitScore } from './leaderboard/client';
import { cloudAutoSave } from './leaderboard/cloudSave';
import type { MissionDef, MissionSignals, MissionAction } from './missions/types';
import type { EndScreenHooks } from './HUD';
import { seedFires, structurePlan, crewZones, igniteFromPlacement } from './missions/scenario';
import { WORLD3D, FLIGHT, STARTUP, BUCKET3D, FIRE3D, WATER, WASH, SPRAY, SMOKE, EMBERS, INSTRUMENTS, ROADS, MISSIONS, COMMUNITIES, HEALTH, resolveHeliClass } from './config';

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
  private readonly forest: TreeField; // chunked conifer forest — culled each frame to what's in view
  private readonly groves: TreeField; // deciduous (birch/aspen) accent trees
  private readonly snags: TreeField; // burnt dead-standing snags
  private readonly obstacles: Obstacles; // bucket collision height field (ground + tree canopy)
  private readonly frame = new FrameContext(); // shared time/wind/sun uniform bus (B0)
  private readonly ripples = new Ripples(); // 8-slot water ripple pool (B1)
  private readonly spray = new WaterSpray(); // pooled water-drop spray (B4/C2)
  private readonly smoke = new SmokePlume(); // pooled per-fire smoke plumes (B4)
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
  private readonly fireField = new FireFieldTexture(FIRE3D.fireCells, WORLD3D.size);
  private readonly heroFire = new HeroFireLights(this.scene); // B3: fixed pool of fire lights
  // C3 stakes: structures to defend (engine-agnostic state) + a fixed pool of meshes
  // synced to them each frame. Lose when every structure burns down.
  private readonly structures: Structures;
  private readonly structureMeshes: StructureMesh[] = [];

  private water = 0;
  private dumping = false; // 'bambi' bucket: a one-tap dump is in progress (drains to empty)
  // Cold engine start: every mission begins shut down on the deck at base. The pilot HOLDS the START
  // dial to spool the rotor from rest to full; flight + the mission clock stay frozen until then.
  // `rotorRpm` scales the rotor visuals + the audio drone; `engineStarted` latches at full RPM.
  // Headless QA skips the ritual (engineStarted true, rpm 1, airborne at origin as before).
  private rotorRpm: number;
  private engineStarted: boolean;
  private won = false;
  private lost = false; // C3: every structure destroyed → mission failed (latches the sim off)
  private crashed = false; // health hit zero → airframe destroyed (a Game-level loss, any mission)
  private finalScore = 0; // computed once when the mission ends (win or loss)
  private elapsed = 0; // total seconds, drives fire flicker
  private rippleTimer = 0; // throttles ripple-ring spawns while scooping/dropping
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
  private readonly mapId?: string; // selected map id (v1: nominal — one playable map)
  private readonly heliId?: string; // selected helicopter id (v1: nominal — one playable heli)
  private readonly capacity: number; // this heli's bucket capacity (litres) — from HELI_CLASSES
  private readonly fillRate: number; // this heli's scoop fill rate (litres/sec) — from HELI_CLASSES

  // --- Campaign layer -------------------------------------------------------
  private readonly mission: MissionDef;
  private readonly runtime: MissionRuntime; // objective/fail evaluation (engine-agnostic)
  private readonly director: MissionDirector; // reactive beats: comms / flare-ups / wind shifts
  private readonly fireBound = WORLD3D.size / 2 - 40; // valid-fire-site radius (matches scenario seeding)
  private inBriefing = true; // pre-flight briefing card up → sim + clock paused until BEGIN
  private readonly payloadMode: 'water' | 'crew';
  private readonly bucketType: 'bambi' | 'valve';
  private readonly crew?: CrewTransport; // crew sling transport (crew payload missions)
  private readonly crewBasket?: CrewBasketMesh; // slung crew basket (replaces the bucket)
  private readonly lzMeshes: LandingZoneMesh[] = []; // landing-zone markers (parallel to crew zones)
  private readonly crewZones: CrewZone[] = []; // resolved world-space crew endpoints
  private readonly fuelSim?: FuelSim; // range model (fuel missions only)
  private readonly slung: THREE.Group; // the mesh hanging on the longline (bucket or crew basket)
  private readonly slungAnchorY: number; // its swivel-head local Y (rope attach point)
  private readonly depotXZ: { x: number; z: number } | null; // base/depot site (refuel + crew base)
  private firesInitial = 0; // active fire count captured once the scenario is seeded
  private missionElapsed = 0; // seconds the mission has been active (stops on win/lose)
  private readonly end?: EndScreenHooks;

  constructor(
    container: HTMLElement,
    tier: QualityTier,
    mission: MissionDef,
    profile?: Profile,
    end?: EndScreenHooks,
    opts: { skipColdStart?: boolean } = {},
  ) {
    this.mission = mission;
    this.end = end;
    // Cold start (every mission) unless a headless QA boot opts out (?qa / ?autostart): then the
    // aircraft is already running and airborne at origin, so the existing autopilot/teleport flows
    // and screenshots work unchanged.
    this.engineStarted = opts.skipColdStart ?? false;
    this.rotorRpm = this.engineStarted ? 1 : 0;
    this.payloadMode = mission.payload ?? 'water';
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
    this.world = new World(mission.seed);
    this.wind = new Wind(mission.wind?.angle, mission.wind?.strengthScale ?? 1);
    this.fauna = new Fauna(this.scene, this.world);
    this.depotXZ = (() => {
      const base = this.world.getCommunity('base');
      return base ? { x: base.x, z: base.z } : null;
    })();

    // Cold start: park the airframe shut-down ON THE DECK at the base (the depot pad) so the pilot
    // spools the rotors and lifts off from home. (QA's skip leaves it airborne at origin as before.)
    if (!this.engineStarted) {
      const p = this.depotXZ ?? { x: 0, z: 0 };
      this.heliSim.land(p.x, p.z, this.world.flightFloorAt(p.x, p.z));
    }

    // Resolve the mission's building plan UP FRONT so the cleared yards — AND the radar place-
    // name labels — line up with where buildings actually stand (the depot's base + each defended
    // hamlet), not every named-but-unbuilt community site. Unbuilt sites would otherwise grow
    // phantom clearings in the bush and float a town name over empty forest. The forest scatter
    // (below) reads these via World.clearingFactor, so resolving them here, in order, matters.
    const structPlan = structurePlan(this.world, this.mission);
    const builtSites: { name: string; x: number; z: number }[] = [];
    if (structPlan.depot) {
      const b = this.world.getCommunity('base');
      if (b) builtSites.push({ name: b.name, x: b.x, z: b.z });
    }
    for (const g of structPlan.groups) builtSites.push({ name: g.community.name, x: g.community.x, z: g.community.z });
    this.world.setClearings(builtSites);

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
    applyAtmosphere(this.scene, this.sun, hemi, GOLDEN);
    this.skyDome = createSkyDome(this.frame, GOLDEN);
    this.scene.add(this.skyDome); // follows the camera each frame (see update)

    // Terrain (vertices displaced from the World heightfield, basins carved in) +
    // lake discs (each sits at the World's flat water level, inside its bowl) + forest.
    const terrain = createTerrain(this.world, tier.current.terrainSegments, this.frame, {
      tex: this.fireField.texture,
      min: this.fireField.worldMin,
      size: this.fireField.worldSize,
    });
    this.scene.add(terrain.mesh);

    // One shared animated water material across every lake (B1), wired to the shared
    // FrameContext (time/wind) + ripple pool. Disc tessellation scales with the tier.
    const waterMat = createWaterMaterial(this.frame, this.ripples);
    const waterSegments = tier.current.waterSegments;
    for (const l of this.world.lakes) {
      this.lakes.push(
        new Lake(
          this.scene,
          l.x,
          l.z,
          l.r,
          l.waterLevel,
          waterSegments,
          (phi) => this.world.lakeRadius(l, phi),
          (x, z) => this.world.groundHeightAt(x, z),
          waterMat,
        ),
      );
    }

    // Streams / mini rivers (A4): a water ribbon per stream, sharing the same animated
    // material as the lakes. You can scoop from them too (World.waterLevelAt generalizes).
    for (const r of this.world.rivers) {
      this.scene.add(createRiverMesh(r, (x, z) => this.world.groundHeightAt(x, z), waterMat));
    }

    // Cleared yards (A5 polish): a packed-dirt clearing draped under each settlement, sharing
    // one transparent vertex-coloured material. Drawn before the roads/buildings (renderOrder
    // -1) so those layer cleanly on top; the forest already thinned here via clearingFactor.
    const yardMat = createYardMaterial();
    for (const c of builtSites) {
      this.scene.add(createYardPatch(c.x, c.z, (x, z) => this.world.groundHeightAt(x, z), yardMat));
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
    const roadSurfaceAt = (x: number, z: number): number => {
      const wl = this.world.waterLevelAt(x, z);
      return wl !== null ? wl + ROADS.bridgeLift : this.world.groundHeightAt(x, z) + ROADS.lift;
    };
    for (const rd of this.world.roads) {
      this.scene.add(createRoadMesh(rd, roadSurfaceAt, gravelMat));
    }

    // Forest scattered by BIOME (A2): each candidate is accepted with the biome's
    // tree density (dense in moist forest, sparse in meadow, ~none on rock/water) and
    // tinted by biome. Seeded off the World rng so the same seed grows the same forest.
    const forest = createTreeField({
      // Scale candidates with world AREA so forest density stays constant as the map grows.
      candidates: Math.round(5200 * (WORLD3D.size / 600) ** 2),
      size: WORLD3D.size,
      heightAt: (x, z) => this.world.groundHeightAt(x, z),
      sample: (x, z) => {
        const s = this.world.biomes.sample(x, z);
        return { treeDensity: s.treeDensity * this.world.clearingFactor(x, z), treeTint: s.treeTint };
      },
      rng: this.world.rng,
      burnable: true, // C5: conifers ignite + char + collapse when the fire field reaches them
    });
    this.forest = forest;
    this.scene.add(forest.object);
    // B6: make the canopy sway in the shared wind (the same one that bends the smoke).
    const foliage = forest.object.getObjectByName('TreeFoliage') as THREE.Mesh | null;
    if (foliage) applyFoliageSway(foliage.material as THREE.Material, this.frame);
    // Bucket collision height field: World ground raised to the forest canopy. The
    // bucket scrapes terrain and snags treetops against this (see bucketSim below).
    this.obstacles = new Obstacles(this.world, forest.colliders);

    // Mixed-forest variety: deciduous (birch/aspen) accents + burnt snags, each reusing
    // the conifer's chunk/LOD machinery via the species slot, on its OWN seeded stream
    // (so it doesn't perturb the conifer/fire layout) with its own tint. Birch sways too.
    // (Their colliders are left out of the bucket field for now — conifers are the snag.)
    this.groves = createTreeField({
      candidates: Math.round(2200 * (WORLD3D.size / 600) ** 2),
      size: WORLD3D.size,
      heightAt: (x, z) => this.world.groundHeightAt(x, z),
      sample: (x, z) => ({ treeDensity: this.world.biomes.sample(x, z).treeDensity * 0.38 * this.world.clearingFactor(x, z), treeTint: [0.62, 0.66, 0.33] }),
      rng: speciesRng(WORLD3D.seed ^ 0x2bd1e995),
      species: deciduousSpecies(),
      burnable: true, // C5: birch/aspen groves burn too
    });
    this.scene.add(this.groves.object);
    const gFol = this.groves.object.getObjectByName('TreeFoliage') as THREE.Mesh | null;
    if (gFol) applyFoliageSway(gFol.material as THREE.Material, this.frame);

    this.snags = createTreeField({
      candidates: Math.round(700 * (WORLD3D.size / 600) ** 2),
      size: WORLD3D.size,
      heightAt: (x, z) => this.world.groundHeightAt(x, z),
      sample: (x, z) => ({ treeDensity: this.world.biomes.sample(x, z).treeDensity * 0.07 * this.world.clearingFactor(x, z), treeTint: [0.3, 0.28, 0.25] }),
      rng: speciesRng(WORLD3D.seed ^ 0x7f4a7c13),
      species: snagSpecies(),
    });
    this.scene.add(this.snags.object);

    // C3 fire sim: World fields injected as callbacks (so the sim never imports
    // World). A fixed pool of fire meshes (size maxActive) is built once and synced
    // to the sim's active fires each frame — fires never add/remove scene objects.
    const fireBound = WORLD3D.size / 2 - 40;
    this.fireSystem = new FireSystem(
      {
        rng: this.world.rng,
        groundHeightAt: (x, z) => this.world.groundHeightAt(x, z),
        isOverWater: (x, z) => this.world.isOverWater(x, z),
        fuelAt: (x, z) => this.world.placement.fuelAt(x, z),
        pickSite: (minFromOrigin) => this.world.placement.fireSite(this.world.rng, fireBound, minFromOrigin),
      },
      { spreadScale: this.mission.fire?.spreadScale }, // per-mission spread pacing (FIRE3D baseline × this)
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
    seedFires(this.world, this.fireSystem, this.mission, { vx: this.wind.vx, vz: this.wind.vz }, fireBound);
    this.firesInitial = this.fireSystem.activeCount;

    // C3 stakes: cabins + lakeside depot. The mission drives placement explicitly (which
    // hamlets to defend), falling back to a depot-only plan so the base always exists (it's
    // the refuel point + crew base + radar anchor).
    this.structures = new Structures({
      groundHeightAt: (x, z) => this.world.groundHeightAt(x, z),
      isOverWater: (x, z) => this.world.isOverWater(x, z),
      pickSite: (minFromOrigin) => this.world.placement.fireSite(this.world.rng, fireBound, minFromOrigin),
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

    // Dock (A5 polish): a jetty off the lakeside base, reaching out over its lake — sells the
    // depot as a real waterfront base. Built once: find the base's nearest lake, march from the
    // base to the shoreline, then lay the deck (local +X) out over the water at the lake level.
    this.addBaseDock();

    // Helicopter + the bucket slung beneath it on a rope. The selected model (if any)
    // swaps in behind the procedural hero; unknown ids fall back to the Bell 205A-1.
    this.heli = createHelicopter(this.heliId);
    this.scene.add(this.heli.group);
    const p = this.heliSim.position;
    this.bucketSim = new BucketSim(p.x, p.y, p.z);
    this.bucket = createBucket();
    this.scene.add(this.bucket.group);
    // Payload: water missions sling the Bambi bucket; crew missions hide it and sling a crew
    // basket on the SAME rope/pendulum (BucketSim is pure physics — only the mesh swaps).
    if (this.payloadMode === 'crew') {
      this.bucket.group.visible = false;
      this.crewBasket = createCrewBasket();
      this.scene.add(this.crewBasket.group);
      this.slung = this.crewBasket.group;
      this.slungAnchorY = this.crewBasket.topAnchorY;
    } else {
      this.slung = this.bucket.group;
      this.slungAnchorY = this.bucket.topAnchorY;
    }
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
    this.scene.add(this.rope);
    this.scene.add(this.spray.points); // pooled drop-spray particle cloud
    this.scene.add(this.smoke.points); // pooled per-fire smoke plumes
    this.scene.add(this.embers.points); // pooled per-fire sparks/embers
    this.scene.add(this.ambientEmbers.points); // subtle ambient amber motes (atmosphere)

    // Crew landing zones (delivery/evac missions): resolve each spec to a world point, drop a
    // marker mesh, and hand the list to the transport sim. No-op for water missions.
    if (this.mission.zones?.length) {
      for (const z of crewZones(this.world, this.mission)) {
        this.crewZones.push(z);
        const lz = createLandingZone();
        lz.group.position.set(z.x, this.world.groundHeightAt(z.x, z.z), z.z);
        this.scene.add(lz.group);
        this.lzMeshes.push(lz);
      }
      this.crew = new CrewTransport(this.crewZones);
    }

    // Fuel/range model (Track C6) — only constructed when the mission opts in.
    if (this.mission.fuel) this.fuelSim = new FuelSim();

    this.runtime = new MissionRuntime(this.mission);
    this.director = new MissionDirector(this.mission); // reactive arc (briefing/beats/debrief)

    this.chase = new ChaseCamera(aspect, this.world);
    this.input = new Input(container);
    this.hud = new HUD(
      container,
      buildMinimap(this.world, WORLD3D.size, 320),
      {
        // Only label communities that were actually BUILT (the depot base + defended hamlets),
        // so a radar place-name always has a real settlement under it — no town names floating
        // over empty bush. `builtSites` is the same set that gets cleared yards + buildings.
        communities: builtSites.map((c) => ({ name: c.name, x: c.x, z: c.z })),
        // Only label the larger lakes (smaller ponds would clutter the radar).
        lakes: this.world.lakes.filter((l) => l.r >= 30).map((l) => ({ name: l.name, x: l.x, z: l.z })),
      },
      this.pilotName,
      this.end,
    );
    // C5: hand the radar the live fire field so it shades the burnt area (and the live front).
    this.hud.setBurnField(this.fireSystem.fieldView());
    // The reactive arc opens with a pre-flight DISPATCH briefing card; the sim + mission clock stay
    // paused (inBriefing) until the pilot hits BEGIN, then the authored 'start' beat radios in.
    this.hud.showBriefing(this.mission, () => {
      this.inBriefing = false;
      // Cold start: the briefing hands off to the engine-start dial — hold it to spool the rotors
      // before the aircraft will fly. (Already running under a QA skip → straight to flight.)
      if (!this.engineStarted) this.hud.showEngineStart();
    });
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

  update(dt: number): void {
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
      }
    }

    // Freeze the sim when the mission is over (win/loss), while the pre-flight briefing card is up,
    // or while the engine is still spooling — so the fire doesn't spread and the mission clock doesn't
    // run before the pilot hits BEGIN and brings the rotors up to speed.
    const frozen = this.won || this.lost || this.inBriefing || !this.engineStarted;

    if (!frozen) {
      this.missionElapsed += dt; // mission clock (drives survive/timeout; stops on win/lose)
      this.wind.update(dtMs);
      // AGL flight: the altitude band rides the World floor under the heli, and a
      // full bucket flies heavy (weight coupling).
      const floorY = this.world.flightFloorAt(this.heliSim.position.x, this.heliSim.position.z);
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
      let turn = c.turn;
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
        this.fuelSim.update(dt, {
          throttle01: Math.abs(c.throttle),
          climbUp,
          payloadRatio,
          refueling: this.canRefuel(),
        });
      }
    }

    // --- Pose the airframe from the sim (YZX: yaw about +Y, pitch +Z, roll +X) ---
    const g = this.heli.group;
    g.position.copy(this.heliSim.position);
    g.rotation.set(this.heliSim.bank, this.heliSim.yaw, this.heliSim.pitch, 'YZX');
    // Rotors spin at a rate scaled by the live RPM (0 on the cold deck → full once spooled).
    this.heli.rotor.rotation.y += FLIGHT.rotorSpin * this.rotorRpm * dt;
    this.heli.tailRotor.rotation.x += FLIGHT.tailRotorSpin * this.rotorRpm * dt;

    // --- Swing the bucket, pose it, and redraw the rope between heli and bucket ---
    // "Submerged" is read from the World water plane under the bucket's XZ (using
    // last frame's position — one-frame lag is imperceptible), and is consistent
    // with the flight floor and every other height query.
    const fillRatio = this.water / this.capacity;
    const wl = this.world.waterLevelAt(this.bucketSim.position.x, this.bucketSim.position.z);
    const dipping = wl !== null && this.bucketSim.position.y <= wl + BUCKET3D.dipThreshold;
    // Collision surface under the bucket (terrain raised to any treetop it'd catch on).
    const obstacleY = this.obstacles.heightAt(this.bucketSim.position.x, this.bucketSim.position.z);
    this.bucketSim.update(
      dtMs,
      this.heliSim.position,
      this.heliSim.velX,
      this.heliSim.velZ,
      fillRatio,
      dipping,
      obstacleY,
    );
    const bp = this.bucketSim.position;
    this.slung.position.copy(bp); // bucket (water) or crew basket (crew) on the same line
    if (this.payloadMode === 'water') this.bucket.setFill(fillRatio);
    const tip = this.bucketSim.tip;
    // --- Pendulum swing: the bucket HANGS ALONG the longline instead of staying bolt-
    // upright, so the lateral lag the sim already produces also reads as the body
    // swinging out. Align its local up-axis toward the heli (the rope direction),
    // partially by swingTilt so it leans into the swing rather than dragging sideways,
    // then layer the scoop tip on as an extra forward pitch about local X. ---
    _ropeDir
      .set(
        this.heliSim.position.x - bp.x,
        this.heliSim.position.y - bp.y,
        this.heliSim.position.z - bp.z,
      )
      .normalize();
    _swingQuat.setFromUnitVectors(_UP, _ropeDir); // full hang-along-the-rope tilt
    _bucketQuat.identity().slerp(_swingQuat, BUCKET3D.swingTilt); // partial lean
    _bucketQuat.multiply(_tipQuat.setFromAxisAngle(_X, tip)); // + scoop tip (local X)
    this.slung.quaternion.copy(_bucketQuat);

    // Attach the longline to the bucket's SWIVEL HEAD — but the swivel now rides wherever
    // the swing puts it, so derive its WORLD position from the bucket transform (local
    // (0, topAnchorY, 0) → world) instead of assuming it sits straight above the body.
    // Then draw the rope as a sagging catenary: walk N points from the heli anchor down
    // to the swivel and dip the interior by a mid-span sag that EASES with load — a light
    // bucket lets the line bow soft and flexible, a full one pulls it taut and straight.
    _swivel.set(0, this.slungAnchorY, 0).applyQuaternion(_bucketQuat).add(bp);
    const sx = this.heliSim.position.x;
    const sy = this.heliSim.position.y;
    const sz = this.heliSim.position.z;
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

    // --- Scoop is physical: fill while the bucket is dipped into a lake (water payload only) ---
    let scooping = false;
    if (!frozen && this.payloadMode === 'water' && dipping && this.water < this.capacity) {
      this.water = Math.min(this.capacity, this.water + this.fillRate * (dtMs / 1000));
      scooping = true;
    }

    // --- Scrape: the bucket is dragging on terrain/treetops (the sim clamps + drags
    // it). Drag fast enough and a loaded bucket slops water out the top — the cost of
    // flying too low. The spill rides the same spray as a drop (and ripples on water). ---
    let scraping = false;
    if (this.bucketSim.contact && this.bucketSim.dragSpeed > BUCKET3D.spillDragMin) {
      scraping = true;
      if (this.water > 0) {
        const spill = BUCKET3D.spillPerDrag * this.bucketSim.dragSpeed * (dtMs / 1000);
        this.water = Math.max(0, this.water - spill);
      }
    }

    const overWater = this.world.isOverWater(bp.x, bp.z);
    const dropping = this.updateDrop(c, dtMs);

    // --- Crew sling transport (delivery/evac missions): work zones low + slow; pose the
    // basket occupancy and recolor the landing-zone markers (active / inactive / done). ---
    if (this.crew) {
      if (!frozen) {
        this.crew.update(dt, this.heliSim.position.x, this.heliSim.position.z, this.heliSim.agl, this.heliSim.speed);
      }
      this.crewBasket?.setOccupied(this.crew.carrying);
      const views = this.crew.views;
      for (let i = 0; i < this.lzMeshes.length; i++) {
        const v = views[i];
        this.lzMeshes[i].setState(v.done ? 'done' : v.active ? 'active' : 'inactive');
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
    // --- Airframe health / damage: drain from fire-heat (a LOW pass over a blaze), bucket scrape,
    // overspeed, and hard landings; repair grounded/slow at the depot. Zero health → crash (instant
    // fail, any mission). Fire-heat is gated on flying low over the column — attack it from up high. ---
    if (!frozen) {
      let fireHeat = 0;
      if (this.heliSim.agl < HEALTH.fireAgl) {
        for (let i = 0; i < activeFires.length; i++) {
          const f = activeFires[i];
          const fall = 1 - Math.hypot(f.x - washX, f.z - washZ) / HEALTH.fireRadius;
          if (fall > 0) fireHeat += (f.intensity / FIRE3D.maxIntensity) * fall;
        }
      }
      const maxSp = this.heliSim.effectiveMaxSpeed;
      this.healthSim.update(dt, {
        fireHeat,
        scrapeSpeed: this.bucketSim.contact ? this.bucketSim.dragSpeed : 0,
        overspeed: maxSp > 0 ? Math.max(0, (this.heliSim.speed - maxSp) / maxSp) : 0,
        impact: this.heliSim.landingImpact,
        repairing: this.canRefuel(),
      });
      if (this.healthSim.dead && !this.won && !this.lost) this.crashLoss();
    }
    // Sync the structure meshes: char + collapse with damage, ember while burning.
    const sList = this.structures.list;
    for (let i = 0; i < this.structureMeshes.length; i++) {
      const s = sList[i];
      const m = this.structureMeshes[i];
      m.setDamage(1 - s.health);
      m.setBurning(s.burning);
    }
    // B3: point the fixed pool of hero fire-lights at the nearest hottest fires. Pass HEAT
    // (intensity × size) so a big blaze throws more, reachier light than a small spot.
    this.heroFire.update(
      activeFires.map((f) => ({ x: f.x, y: f.y, z: f.z, intensity: fireHeat(f) })),
      this.heliSim.position,
      this.elapsed,
    );

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
    }
    this.embers.update(dt, this.wind.vx, this.wind.vz, this.elapsed);

    // --- Sun shadow follows the aircraft; camera trails it; HUD reflects state ---
    const hp = this.heliSim.position;
    // Low golden-hour sun (~18° elevation): a long, warm raking light that throws long shadows
    // and sits the sun halo near the horizon — the reference "fire at dusk" look. The god-ray
    // pass reads this direction (via frame.uSunDir) so the shafts emanate from the low sun.
    this.sun.position.set(hp.x + 150, hp.y + 58, hp.z + 95);
    this.sun.target.position.set(hp.x, hp.y, hp.z);
    this.chase.update(dt, this.heliSim.position, this.heliSim.yaw, this.input.look);
    this.skyDome.position.copy(this.chase.camera.position); // keep the sky centered on the eye
    // Ambient amber motes drift in the air around the eye and thicken near a blaze (atmosphere).
    const cam = this.chase.camera.position;
    this.ambientEmbers.update(dt, cam.x, cam.y, cam.z, this.wind.vx, this.wind.vz, this.elapsed, activeFires, FIRE3D.maxIntensity);
    // Forest LOD: only keep the tree chunks near the camera (frustum culling drops the
    // rest); centered on the eye so chunks ahead/behind toggle correctly.
    this.forest.cull(this.chase.camera.position.x, this.chase.camera.position.z);
    this.groves.cull(this.chase.camera.position.x, this.chase.camera.position.z);
    this.snags.cull(this.chase.camera.position.x, this.chase.camera.position.z);
    // C5: trees the fire field reaches ignite, char, and collapse into black snags.
    const fireHeatAt = (x: number, z: number): number => this.fireSystem.heatAt(x, z);
    this.forest.updateFire(dt, fireHeatAt);
    this.groves.updateFire(dt, fireHeatAt);
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
        this.ripples.spawn(bp.x, bp.z, WATER.dropStrength);
        this.rippleTimer = 0.1;
      } else if (scooping) {
        this.ripples.spawn(bp.x, bp.z, WATER.dipStrength);
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
      this.spray.emit(bp.x, bp.y, bp.z, this.heliSim.velX, this.heliSim.velZ);
    }
    this.spray.update(dt, (x, z) => this.surfaceAt(x, z), (x, z) => {
      if (this.world.isOverWater(x, z) && Math.random() < 0.15) this.ripples.spawn(x, z, WATER.dipStrength);
    });

    this.frame.update(dt, this.wind.vx, this.wind.vz, this.sun.position, this.sun.target.position);

    const firesLeft = this.fireSystem.activeCount;
    // Crew missions guide to the next zone; water missions warn on scrape, else guide the scoop.
    const hint = this.crew
      ? this.crew.hint()
      : scraping
        ? this.water > 0
          ? 'Bucket dragging — climb! (spilling water)'
          : 'Bucket dragging — climb!'
        : this.scoopHint(overWater, scooping);
    this.hud.update({
      water: this.water,
      waterMax: this.capacity,
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
      fires: activeFires.map((f) => ({ x: f.x, z: f.z })),
      lakes: this.lakes.map((l) => ({ x: l.x, z: l.z, r: l.r })),
      worldSize: WORLD3D.size,
      // C3 stakes: structures to defend, the threat gauge, lose state + final score.
      structures: sList.map((s) => ({ x: s.x, z: s.z, kind: s.kind, health: s.health, burning: s.burning })),
      threat: this.structures.threat,
      lost: this.lost,
      score: this.finalScore,
      // Campaign layer: live objective checklist, fuel gauge, crew landing-zone radar blips.
      objectives: this.runtime.tracker,
      fuel: this.fuelSim ? this.fuelSim.fuel : undefined,
      fuelLow: this.fuelSim ? this.fuelSim.low : undefined,
      zones: this.crew ? this.crew.views.map((v) => ({ x: v.x, z: v.z, active: v.active, done: v.done })) : undefined,
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
            }
          : undefined,
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
      igniteFromPlacement(this.world, this.fireSystem, a.place, { vx: this.wind.intendedVx, vz: this.wind.intendedVz }, this.fireBound);
    } else if (a.do === 'wind') {
      this.wind.shiftTo(a.angle, a.strengthScale, a.ease);
    }
  }

  /** Build the per-frame snapshot the mission evaluator reads (Game already tracks all of it). */
  private missionSignals(): MissionSignals {
    return {
      firesActive: this.fireSystem.activeCount,
      firesInitial: this.firesInitial,
      firesDoused: this.fireSystem.doused,
      structuresAlive: this.structures.aliveCount,
      structuresTotal: this.structures.total,
      crewsDelivered: this.crew?.delivered ?? 0,
      crewsTotal: this.crew?.total ?? 0,
      elapsed: this.missionElapsed,
      fuel: this.fuelSim?.fuel ?? 1,
      starved: this.fuelSim?.starved ?? false,
      threat: this.structures.threat,
      windAngle: this.wind.angle,
    };
  }

  /** Latch the mission outcome from the runtime once (freezes the sim, persists a win). */
  private latchOutcome(): void {
    if (this.won || this.lost) return;
    this.won = this.runtime.state === 'won';
    this.lost = this.runtime.state === 'lost';
    this.finalScore = this.runtime.score;
    if (this.won) {
      recordWin(this.mission.id, this.finalScore, this.runtime.completion());
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
    }
  }

  /**
   * Airframe destroyed (health hit zero): force a mission loss this instant, on ANY mission. Sets the
   * same fields latchOutcome() sets for a loss; `frozen` (which includes `lost`) then freezes the sim
   * and the HUD shows the loss banner next frame. A WARNING comms line + alert squelch sell the mayday.
   * Kept Game-level (not a MissionRuntime fail) so it's universal and the campaign verifier is untouched.
   */
  private crashLoss(): void {
    if (this.won || this.lost) return;
    this.crashed = true;
    this.lost = true;
    this.finalScore = this.runtime.score;
    this.hud.pushComms('warning', 'Mayday — airframe down!', 'alert');
    this.audio.playSquelch('alert');
  }

  /** Fuel missions: grounded + slow within the depot radius → refuelling this frame. */
  private canRefuel(): boolean {
    if (!this.depotXZ) return false;
    const d = Math.hypot(this.heliSim.position.x - this.depotXZ.x, this.heliSim.position.z - this.depotXZ.z);
    return d <= MISSIONS.refuelRadius && this.heliSim.agl <= MISSIONS.refuelAgl && this.heliSim.speed <= MISSIONS.refuelSpeed;
  }

  /** Top surface at (x, z): the lake water level over a lake, else the ground. */
  private surfaceAt(x: number, z: number): number {
    const wl = this.world.waterLevelAt(x, z);
    return wl !== null ? wl : this.world.groundHeightAt(x, z);
  }

  /**
   * Lay the base's jetty out over its lake. Finds the base community's nearest lake, marches
   * from the base toward that lake's centre to the shoreline, and places the dock there yawed
   * so its deck (local +X) runs out over the water at the lake's flat surface. No-op if the
   * map didn't grow a base or any lake (the dock is pure decoration — never gated by it).
   */
  private addBaseDock(): void {
    const base = this.world.getCommunity('base');
    if (!base || this.world.lakes.length === 0) return;
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

  /** Status line: guide the player to dip, or show the fill in progress. */
  private scoopHint(overWater: boolean, scooping: boolean): string | null {
    if (this.water >= this.capacity) return null;
    if (scooping) return 'Scooping…';
    if (overWater) return 'Descend (J) to fill the bucket';
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
      this.dumping = false;
      return false;
    }

    if (this.payloadMode === 'crew') return false; // no water in crew payload mode

    let rate: number;
    if (this.bucketType === 'bambi') {
      if (c.dropPressed) this.dumping = true; // one tap → commit to a full dump
      if (!this.dumping) return false;
      rate = BUCKET3D.dumpRate;
    } else {
      if (!c.drop) return false; // valve: hold to pour, release to pause
      rate = BUCKET3D.dropRate;
    }

    const released = Math.min(this.water, rate * (dtMs / 1000));
    this.water -= released;
    if (this.water <= 0) {
      this.water = 0;
      this.dumping = false;
    }

    // Water leaves the BUCKET's world position, not the heli's — a swung bucket
    // misses. Douse is by volume delivered, so a fast dump and a slow pour knock a
    // fire down by the same amount per litre landing in radius. The same drop also
    // soaks the ground into a wet firebreak (C3 — handled inside FireSystem.douse).
    const bx = this.bucketSim.position.x;
    const bz = this.bucketSim.position.z;
    this.fireSystem.douse(bx, bz, BUCKET3D.dropRadius, released);
    return released > 0;
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
