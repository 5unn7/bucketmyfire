import * as THREE from 'three';
import { World } from './World';
import { FAUNA, FIRE3D, WORLD3D } from './config';
import { createFauna } from './meshes/fauna';
import { loadAnimalPack, AnimalKind, AnimalPrototypes } from './meshes/animalPack';
import { detectTier } from './render/QualityTier';

/**
 * Wildlife manager — scatters and gently animates the map's fauna (Track B6 / world life).
 * Land animals are clones of the loaded CC-BY model pack (moose/deer + a few bear/fox/
 * wolf/rabbit), seeded by biome; **loons are procedural** (no bird in the pack) and float
 * on the lakes. The pack loads async, so the land herd pops in a moment after start; if it
 * fails, moose/deer fall back to the procedural models.
 *
 * Each critter idles with a soft vertical bob and slowly wanders/grazes (ground) or paddles
 * within its lake (loon). Off-screen + distant animals are hidden (`cullDist`) so a big map
 * of a few dozen individuals stays cheap — Three frustum-culls each by its own bound too.
 */
interface Critter {
  group: THREE.Object3D;
  x: number;
  z: number;
  baseY: number; // ground (or water) height under it
  phase: number; // bob phase
  bob: number; // bob amplitude
  water: boolean; // loon paddles its lake vs ground animal wanders
  heading: number; // facing / travel direction (rad)
  speed: number; // current travel speed (0 = grazing)
  timer: number; // seconds until the next graze/walk toggle
  cx: number; // home lake center (loons) — keeps them on the water
  cz: number;
  cr: number;
}

// Land-animal mix: deer + moose dominate (the iconic ungulates); predators/small fauna
// are rare accents. Weights are relative.
const LAND_MIX: { kind: AnimalKind; w: number }[] = [
  { kind: 'deer', w: 40 },
  { kind: 'moose', w: 30 },
  { kind: 'rabbit', w: 10 },
  { kind: 'fox', w: 8 },
  { kind: 'wolf', w: 7 },
  { kind: 'bear', w: 5 },
];
const LAND_TOTAL_W = LAND_MIX.reduce((s, a) => s + a.w, 0);

export class Fauna {
  private readonly critters: Critter[] = [];
  private disposed = false; // set by dispose(): blocks the async pack load from populating a dead scene
  // Own seeded stream, so scattering wildlife doesn't perturb the world/tree/fire RNG.
  private readonly rng = mulberry32(WORLD3D.seed ^ 0x1f2e3d4c);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {
    this.placeLoons();
    // Tier-gate the ~4.4 MB animal GLB (audit PERF-3): a low-end device skips the download + GLTF parse
    // and gets the procedural land herd instead (placeLand already falls back when a prototype is
    // missing), saving the heaviest single asset on exactly the hardware that can least afford it.
    const highDetail = detectTier() !== 'low';
    void loadAnimalPack(highDetail).then((protos) => this.placeLand(protos));
  }

  /** Stop the (fire-and-forget) animal-pack load from populating the scene after an in-place mission
   *  switch — the placeLand guard checks this. The critters themselves go with the disposed scene. */
  dispose(): void {
    this.disposed = true;
  }

  /** Loons floating on each lake (procedural — the pack has no waterfowl). */
  private placeLoons(): void {
    for (const lake of this.world.lakes) {
      for (let i = 0; i < FAUNA.loonsPerLake; i++) {
        const ang = this.rng() * Math.PI * 2;
        const rad = lake.r * 0.6 * Math.sqrt(this.rng());
        const x = lake.x + Math.cos(ang) * rad;
        const z = lake.z + Math.sin(ang) * rad;
        const m = createFauna('loon');
        m.group.position.set(x, lake.waterLevel, z);
        m.group.rotation.y = this.rng() * Math.PI * 2;
        this.scene.add(m.group);
        this.critters.push({
          group: m.group,
          x,
          z,
          baseY: lake.waterLevel,
          phase: this.rng() * Math.PI * 2,
          bob: FAUNA.bob * 0.5,
          water: true,
          heading: this.rng() * Math.PI * 2,
          speed: FAUNA.loonDrift,
          timer: 0,
          cx: lake.x,
          cz: lake.z,
          cr: lake.r,
        });
      }
    }
  }

  /** Scatter the ground herd over flammable/open land, seeded + deterministic. */
  private placeLand(protos: AnimalPrototypes): void {
    if (this.disposed) return; // the pack resolved after an in-place switch — don't touch the dead scene
    const area = (this.world.sizeX / 1000) * (this.world.sizeZ / 1000);
    const count = Math.max(6, Math.round(FAUNA.ungulatePer1000 * area));
    const boundX = this.world.sizeX / 2 - 60;
    const boundZ = this.world.sizeZ / 2 - 60;

    for (let n = 0; n < count; n++) {
      // Find a valid spot: on land, gentle slope, off the spawn, where animals would live.
      let x = 0;
      let z = 0;
      let ok = false;
      for (let g = 0; g < 40 && !ok; g++) {
        x = (this.rng() * 2 - 1) * boundX;
        z = (this.rng() * 2 - 1) * boundZ;
        if (Math.hypot(x, z) < FAUNA.minFromOrigin) continue;
        if (this.world.isOverWater(x, z)) continue;
        if (this.world.slopeAt(x, z) > 0.4) continue; // not on cliffs
        if (this.world.biomes.sample(x, z).treeDensity < 0.05) continue; // not bare rock
        ok = true;
      }
      if (!ok) continue;

      const kind = this.pickKind();
      const proto = protos[kind];
      const group = proto ? proto.clone() : createFauna(kind === 'moose' ? 'moose' : 'deer').group;
      const baseY = this.world.groundHeightAt(x, z);
      group.position.set(x, baseY, z);
      const heading = this.rng() * Math.PI * 2;
      group.rotation.y = heading;
      this.scene.add(group);
      this.critters.push({
        group,
        x,
        z,
        baseY,
        phase: this.rng() * Math.PI * 2,
        bob: FAUNA.bob,
        water: false,
        heading,
        speed: 0,
        timer: this.rng() * 3,
        cx: 0,
        cz: 0,
        cr: 0,
      });
    }
  }

  private pickKind(): AnimalKind {
    let r = this.rng() * LAND_TOTAL_W;
    for (const a of LAND_MIX) {
      r -= a.w;
      if (r <= 0) return a.kind;
    }
    return 'deer';
  }

  /** Bob + wander/paddle every critter, then distance-cull from the camera. `heatAt` lets
   *  ground animals SENSE the fire field and flee it (panic). */
  update(dt: number, elapsed: number, cam: THREE.Vector3, heatAt?: (x: number, z: number) => number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const cull2 = FAUNA.cullDist * FAUNA.cullDist;

    for (const c of this.critters) {
      if (c.water) this.paddle(c, dt);
      else if (!(heatAt && this.flee(c, dt, heatAt))) this.wander(c, dt);

      c.group.position.set(c.x, c.baseY + Math.sin(elapsed * 1.8 + c.phase) * c.bob, c.z);
      c.group.rotation.y = c.heading;

      const dx = cam.x - c.x;
      const dz = cam.z - c.z;
      c.group.visible = dx * dx + dz * dz <= cull2;
    }
  }

  /**
   * PANIC: if fire is sensed within `faunaFleeRadius`, bolt away from it at panic speed and
   * return true (so normal wandering is skipped this frame). Flee direction is the DOWNHILL
   * of the heat field — away from the hottest probe — so animals run ahead of the front.
   */
  private flee(c: Critter, dt: number, heatAt: (x: number, z: number) => number): boolean {
    const R = FIRE3D.faunaFleeRadius;
    const e1 = heatAt(c.x + R, c.z);
    const e0 = heatAt(c.x - R, c.z);
    const n1 = heatAt(c.x, c.z + R);
    const n0 = heatAt(c.x, c.z - R);
    const danger = Math.max(heatAt(c.x, c.z), e1, e0, n1, n0);
    if (danger <= FIRE3D.faunaFleeHeat) return false;

    // Flee opposite the heat gradient (toward cooler ground); if it's uniform, keep running.
    const gx = e1 - e0;
    const gz = n1 - n0;
    const fleeAng = gx * gx + gz * gz > 1e-6 ? Math.atan2(-gz, -gx) : c.heading;
    c.heading += wrapPi(fleeAng - c.heading) * Math.min(1, 9 * dt); // snap toward escape (fast)
    c.speed = FIRE3D.faunaPanicSpeed;

    // Run — but don't bolt into a lake or off a cliff; veer hard and retry next frame.
    const nx = c.x + Math.cos(c.heading) * c.speed * dt;
    const nz = c.z + Math.sin(c.heading) * c.speed * dt;
    if (this.world.isOverWater(nx, nz) || this.world.slopeAt(nx, nz) > 0.5) {
      c.heading += 1.2;
      return true;
    }
    c.x = nx;
    c.z = nz;
    c.baseY = this.world.groundHeightAt(nx, nz);
    return true;
  }

  /** Ground animal: alternate grazing (still) and short ambles, turning at water/cliffs. */
  private wander(c: Critter, dt: number): void {
    c.timer -= dt;
    if (c.timer <= 0) {
      if (c.speed > 0) {
        c.speed = 0; // settle to graze
        c.timer = 2 + Math.random() * 4;
      } else {
        c.speed = FAUNA.wanderSpeed; // amble off
        c.heading += (Math.random() - 0.5) * 1.6;
        c.timer = 2 + Math.random() * 3;
      }
    }
    if (c.speed <= 0) return;
    c.heading += (Math.random() - 0.5) * FAUNA.turnRate * dt;
    const nx = c.x + Math.cos(c.heading) * c.speed * dt;
    const nz = c.z + Math.sin(c.heading) * c.speed * dt;
    if (this.world.isOverWater(nx, nz) || this.world.slopeAt(nx, nz) > 0.45) {
      c.heading += Math.PI; // turn back from water / steep ground
      return;
    }
    c.x = nx;
    c.z = nz;
    c.baseY = this.world.groundHeightAt(nx, nz);
  }

  /** Loon: drift slowly, staying within its lake. */
  private paddle(c: Critter, dt: number): void {
    c.heading += (Math.random() - 0.5) * 0.4 * dt;
    const nx = c.x + Math.cos(c.heading) * c.speed * dt;
    const nz = c.z + Math.sin(c.heading) * c.speed * dt;
    if (Math.hypot(nx - c.cx, nz - c.cz) > c.cr * 0.7) {
      c.heading += Math.PI; // turn back toward the lake center
      return;
    }
    c.x = nx;
    c.z = nz;
  }
}

/** Wrap an angle to (-π, π] — shortest-turn helper for panic steering. */
function wrapPi(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

/** mulberry32 — tiny seeded PRNG (matches World's), so wildlife is deterministic. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
