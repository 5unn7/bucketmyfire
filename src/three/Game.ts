import * as THREE from 'three';
import { createTerrain } from './meshes/terrain';
import { createTreeField } from './meshes/trees';
import { createHelicopter, HelicopterMesh } from './meshes/helicopter';
import { createBucket, BucketMesh } from './meshes/bucket';
import { HelicopterSim } from './sim/HelicopterSim';
import { BucketSim } from './sim/BucketSim';
import { Wind } from './sim/Wind';
import { Fire } from './Fire';
import { Lake } from './Lake';
import { World } from './World';
import { ChaseCamera } from './ChaseCamera';
import { Obstacles } from './Obstacles';
import { Input, ControlState } from './Input';
import { HUD } from './HUD';
import { FrameContext } from './render/FrameContext';
import { QualityTier } from './render/QualityTier';
import { Ripples } from './water/Ripples';
import { createWaterMaterial } from './water/WaterMaterial';
import { WaterSpray } from './vfx/WaterSpray';
import { HeliAudio } from './audio/HeliAudio';
import { WORLD3D, FLIGHT, BUCKET3D, FIRE3D, WATER, SPRAY } from './config';

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
  private readonly input: Input;
  private readonly hud: HUD;

  private readonly heliSim = new HelicopterSim(0, 0);
  private readonly heli: HelicopterMesh;
  private readonly bucketSim: BucketSim;
  private readonly bucket: BucketMesh;
  private readonly rope: THREE.Line;
  private readonly ropeGeom: THREE.BufferGeometry;

  private readonly wind = new Wind();
  private readonly world = new World();
  private readonly obstacles: Obstacles; // bucket collision height field (ground + tree canopy)
  private readonly frame = new FrameContext(); // shared time/wind/sun uniform bus (B0)
  private readonly ripples = new Ripples(); // 8-slot water ripple pool (B1)
  private readonly spray = new WaterSpray(); // pooled water-drop spray (B4/C2)
  private readonly audio = new HeliAudio(); // procedural rotor drone + scoop/drop/win SFX
  private readonly lakes: Lake[] = [];
  private fires: Fire[] = [];

  private water = 0;
  private dumping = false; // 'bambi' bucket: a one-tap dump is in progress (drains to empty)
  private won = false;
  private elapsed = 0; // total seconds, drives fire flicker
  private spreadAccumMs = 0;
  private rippleTimer = 0; // throttles ripple-ring spawns while scooping/dropping
  private sprayAccum = 0; // throttles drop-spray emission to SPRAY.emitInterval

  constructor(container: HTMLElement, tier: QualityTier) {
    const aspect = container.clientWidth / container.clientHeight;

    // Sky + distance fog (same hue) for aerial depth.
    const sky = new THREE.Color(0x9fc6e0);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 140, 420);

    // Soft sky/ground ambient + a warm sun that casts shadows.
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a5a36, 0.85));
    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
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

    // Terrain (vertices displaced from the World heightfield, basins carved in) +
    // lake discs (each sits at the World's flat water level, inside its bowl) + forest.
    const terrain = createTerrain(this.world);
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

    // Forest scattered by BIOME (A2): each candidate is accepted with the biome's
    // tree density (dense in moist forest, sparse in meadow, ~none on rock/water) and
    // tinted by biome. Seeded off the World rng so the same seed grows the same forest.
    const forest = createTreeField({
      candidates: 3600,
      size: WORLD3D.size,
      heightAt: (x, z) => this.world.groundHeightAt(x, z),
      sample: (x, z) => this.world.biomes.sample(x, z),
      rng: this.world.rng,
    });
    this.scene.add(forest.object);
    // Bucket collision height field: World ground raised to the forest canopy. The
    // bucket scrapes terrain and snags treetops against this (see bucketSim below).
    this.obstacles = new Obstacles(this.world, forest.colliders);

    this.spawnFires(FIRE3D.count);

    // Helicopter + the bucket slung beneath it on a rope.
    this.heli = createHelicopter();
    this.scene.add(this.heli.group);
    const p = this.heliSim.position;
    this.bucketSim = new BucketSim(p.x, p.y, p.z);
    this.bucket = createBucket();
    this.scene.add(this.bucket.group);
    this.ropeGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.rope = new THREE.Line(this.ropeGeom, new THREE.LineBasicMaterial({ color: 0x2a2118 }));
    // The geometry's bounding sphere is computed once from the initial (0,0,0)
    // endpoints (radius 0 at the origin); we move the endpoints every frame but
    // never recompute it, so once the heli flies away from the origin the line
    // gets frustum-culled and vanishes. It's only two points — skip culling.
    this.rope.frustumCulled = false;
    this.scene.add(this.rope);
    this.scene.add(this.spray.points); // pooled drop-spray particle cloud

    this.chase = new ChaseCamera(aspect, this.world);
    this.input = new Input(container);
    this.hud = new HUD(container);
  }

  get camera(): THREE.PerspectiveCamera {
    return this.chase.camera;
  }

  /** Read-only state for QA/debug autopilot (see the window hook in main.ts). */
  get debug() {
    return {
      x: this.heliSim.position.x,
      y: this.heliSim.position.y,
      z: this.heliSim.position.z,
      agl: this.heliSim.agl,
      floor: this.world.flightFloorAt(this.heliSim.position.x, this.heliSim.position.z),
      bucketY: this.bucketSim.position.y,
      bucketContact: this.bucketSim.contact,
      bucketDragSpeed: this.bucketSim.dragSpeed,
      water: this.water,
      firesLeft: this.fires.filter((f) => !f.isExtinguished).length,
      lakes: this.lakes.map((l) => ({ x: l.x, z: l.z, r: l.r })),
      fires: this.fires.filter((f) => !f.isExtinguished).map((f) => ({ x: f.x, z: f.z })),
    };
  }

  resize(aspect: number): void {
    this.chase.setAspect(aspect);
  }

  update(dt: number): void {
    const dtMs = dt * 1000;
    this.elapsed += dt;
    const c = this.input.read();

    if (!this.won) {
      this.wind.update(dtMs);
      // AGL flight: the altitude band rides the World floor under the heli, and a
      // full bucket flies heavy (weight coupling).
      const floorY = this.world.flightFloorAt(this.heliSim.position.x, this.heliSim.position.z);
      const payloadRatio = this.water / BUCKET3D.capacity;
      this.heliSim.update(dt, { turn: c.turn, throttle: c.throttle, lift: c.lift }, floorY, payloadRatio);
    }

    // --- Pose the airframe from the sim (YZX: yaw about +Y, pitch +Z, roll +X) ---
    const g = this.heli.group;
    g.position.copy(this.heliSim.position);
    g.rotation.set(this.heliSim.bank, this.heliSim.yaw, this.heliSim.pitch, 'YZX');
    this.heli.rotor.rotation.y += FLIGHT.rotorSpin * dt;
    this.heli.tailRotor.rotation.x += FLIGHT.tailRotorSpin * dt;

    // --- Swing the bucket, pose it, and redraw the rope between heli and bucket ---
    // "Submerged" is read from the World water plane under the bucket's XZ (using
    // last frame's position — one-frame lag is imperceptible), and is consistent
    // with the flight floor and every other height query.
    const fillRatio = this.water / BUCKET3D.capacity;
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
    this.bucket.group.position.copy(bp);
    this.bucket.setFill(fillRatio);
    const tip = this.bucketSim.tip;
    this.bucket.group.rotation.x = tip; // physical scoop tip from the sim
    // Attach the longline to the bucket's SWIVEL HEAD (above the body), tracking the
    // scoop tip (rotation about local X) so the rope meets the straps, not the belly.
    const ah = this.bucket.topAnchorY;
    const rp = this.ropeGeom.attributes.position as THREE.BufferAttribute;
    rp.setXYZ(0, this.heliSim.position.x, this.heliSim.position.y, this.heliSim.position.z);
    rp.setXYZ(1, bp.x, bp.y + ah * Math.cos(tip), bp.z + ah * Math.sin(tip));
    rp.needsUpdate = true;

    // --- Scoop is physical: fill while the bucket is dipped into a lake ---
    let scooping = false;
    if (!this.won && dipping && this.water < BUCKET3D.capacity) {
      this.water = Math.min(BUCKET3D.capacity, this.water + BUCKET3D.refillRate * (dtMs / 1000));
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

    if (!this.won) {
      this.fires.forEach((f) => f.grow(dtMs));

      // Fires creep on a wind-biased timer, with a hard active cap.
      this.spreadAccumMs += dtMs;
      if (this.spreadAccumMs >= FIRE3D.spreadIntervalMs) {
        this.spreadAccumMs -= FIRE3D.spreadIntervalMs;
        this.spreadFires();
      }

      if (this.fires.every((f) => f.isExtinguished)) this.won = true;
    }
    this.fires.forEach((f) => f.flicker(this.elapsed));

    // --- Sun shadow follows the aircraft; camera trails it; HUD reflects state ---
    const hp = this.heliSim.position;
    this.sun.position.set(hp.x + 80, hp.y + 140, hp.z + 50);
    this.sun.target.position.set(hp.x, hp.y, hp.z);
    this.chase.update(dt, this.heliSim.position, this.heliSim.yaw, this.input.look);

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

    const firesLeft = this.fires.filter((f) => !f.isExtinguished).length;
    // A scrape warning trumps the scoop guidance — tell the pilot to climb out.
    const hint = scraping
      ? this.water > 0
        ? 'Bucket dragging — climb! (spilling water)'
        : 'Bucket dragging — climb!'
      : this.scoopHint(overWater, scooping);
    this.hud.update(this.water, BUCKET3D.capacity, firesLeft, hint, this.won);

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
    });
  }

  /** Top surface at (x, z): the lake water level over a lake, else the ground. */
  private surfaceAt(x: number, z: number): number {
    const wl = this.world.waterLevelAt(x, z);
    return wl !== null ? wl : this.world.groundHeightAt(x, z);
  }

  /** Status line: guide the player to dip, or show the fill in progress. */
  private scoopHint(overWater: boolean, scooping: boolean): string | null {
    if (this.water >= BUCKET3D.capacity) return null;
    if (scooping) return 'Scooping…';
    if (overWater) return 'Descend (▼ / Shift) to dip the bucket';
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
    if (this.won || this.water <= 0) {
      this.dumping = false;
      return false;
    }

    let rate: number;
    if (BUCKET3D.type === 'bambi') {
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
    // fire down by the same amount per litre landing in radius.
    const bx = this.bucketSim.position.x;
    const bz = this.bucketSim.position.z;
    for (const fire of this.fires) {
      if (fire.isExtinguished) continue;
      if (Math.hypot(bx - fire.x, bz - fire.z) <= BUCKET3D.dropRadius) {
        fire.douse(released);
      }
    }
    return released > 0;
  }

  private spreadFires(): void {
    const active = this.fires.filter((f) => !f.isExtinguished);
    let liveCount = active.length;
    const bound = WORLD3D.size / 2 - 20;
    for (const fire of active) {
      if (liveCount >= FIRE3D.maxActive) break;
      if (Math.random() > FIRE3D.spreadChance) continue;
      // Wind biases the creep direction, so fires advance on a downwind front.
      const angle = this.wind.biasAngle(Math.random() * Math.PI * 2);
      const x = clamp(fire.x + Math.cos(angle) * FIRE3D.spreadDistance, -bound, bound);
      const z = clamp(fire.z + Math.sin(angle) * FIRE3D.spreadDistance, -bound, bound);
      if (this.world.isOverWater(x, z)) continue; // fire can't cross water
      // A3: fire creeps through fuel — bias the spread to flammable forest, so it
      // stalls at rock/open ground and runs through the trees.
      if (Math.random() > this.world.placement.fuelAt(x, z)) continue;
      this.fires.push(new Fire(this.scene, x, this.world.groundHeightAt(x, z), z));
      liveCount++;
    }
  }

  private spawnFires(count: number): void {
    const bound = WORLD3D.size / 2 - 40;
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 500) {
      // A3: start fires in dry forest (fuel-biased), off the player's spawn.
      const site = this.world.placement.fireSite(this.world.rng, bound, 70);
      if (!site) continue;
      this.fires.push(new Fire(this.scene, site.x, this.world.groundHeightAt(site.x, site.z), site.z));
      placed++;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
