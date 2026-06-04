import { World, CommunitySite } from '../World';
import type { FireSystem } from '../sim/FireSystem';
import type { CrewZone } from '../sim/CrewTransport';
import type { MissionDef, ZonePlacement, SizeClass, FirePlacement, CommunityRef } from './types';
import { WORLD3D } from '../config';

/**
 * Mission scenario resolution — the pure (number-only, no Three.js) bridge from a `MissionDef`'s
 * placement specs to concrete world-space sites against a seeded `World`. Extracted so BOTH the
 * live `Game` AND the headless campaign verifier resolve fires / structures / crew zones through
 * the SAME code — the verifier can't pass against logic the game doesn't actually run.
 */

/** Fire size class → ignition disc radius (cells) + starting heat (0..1). */
export const SIZE_CLASS: Record<SizeClass, { radius: number; heat: number }> = {
  spot: { radius: 1, heat: 0.2 },
  small: { radius: 2, heat: 0.4 },
  medium: { radius: 3, heat: 0.6 },
  large: { radius: 4, heat: 0.85 },
  mega: { radius: 6, heat: 1.0 },
};

/** Tiny deterministic string→number — turns an anchor id into a stable fan-angle phase. */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Resolve a community reference (town index, `'base'`, or anchor id) to a world point (fallback: a fuel site off spawn). */
export function communityPoint(world: World, which: CommunityRef): { x: number; z: number } {
  const c = world.getCommunity(which);
  if (c) return { x: c.x, z: c.z };
  const site = world.placement.fireSite(world.rng, WORLD3D.size / 2 - 60, 150);
  return site ?? { x: 0, z: 0 };
}

/** The lake whose centre is closest to (x,z) — anchors a `cluster` fire beside open water. */
function nearestLake(world: World, x: number, z: number): { x: number; z: number; r: number } | null {
  let best: { x: number; z: number; r: number } | null = null;
  let bestD = Infinity;
  for (const l of world.lakes) {
    const d = (l.x - x) * (l.x - x) + (l.z - z) * (l.z - z);
    if (d < bestD) {
      bestD = d;
      best = { x: l.x, z: l.z, r: l.r };
    }
  }
  return best;
}

/** Nearest flammable, dry point to (x,z) within a small search — so a seeded fire catches. */
export function fuelPointNear(world: World, x: number, z: number): { x: number; z: number } {
  if (!world.isOverWater(x, z) && world.placement.fuelAt(x, z) >= 0.3) return { x, z };
  for (let r = 12; r <= 90; r += 12) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (!world.isOverWater(px, pz) && world.placement.fuelAt(px, pz) >= 0.3) return { x: px, z: pz };
    }
  }
  return { x, z };
}

/** Build the explicit Structures plan from the mission spec (or a depot-only default). */
export function structurePlan(
  world: World,
  mission: MissionDef,
): { depot: boolean; groups: { community: CommunitySite; cabins?: number }[]; extraCabins: number } {
  const spec = mission.structures ?? { depot: true };
  const groups: { community: CommunitySite; cabins?: number }[] = [];
  for (const g of spec.groups ?? []) {
    const site = world.getCommunity(g.community);
    if (site) groups.push({ community: site, cabins: g.cabins });
  }
  return { depot: spec.depot ?? true, groups, extraCabins: spec.extraCabins ?? 0 };
}

/** Resolve a crew zone placement to a world point. */
function zonePoint(world: World, z: ZonePlacement): { x: number; z: number } {
  if (z.at === 'point') return { x: z.x ?? 0, z: z.z ?? 0 };
  if (z.at === 'depot') return communityPoint(world, 'base');
  return communityPoint(world, z.community ?? 0);
}

/** Resolve ONE crew/cargo endpoint to a world-space `CrewZone`. Shared by the opening `crewZones`
 *  resolution AND the `addZone` beat, so a mid-mission pop-up rescue lands with the same vocabulary. */
export function resolveCrewZone(world: World, z: ZonePlacement): CrewZone {
  const pt = zonePoint(world, z);
  return { x: pt.x, z: pt.z, role: z.role, single: z.single, label: z.label ?? z.role };
}

/** Resolve the mission's crew/cargo endpoints to world-space `CrewZone`s. */
export function crewZones(world: World, mission: MissionDef): CrewZone[] {
  return (mission.zones ?? []).map((z) => resolveCrewZone(world, z));
}

/** Seed every fire in the mission def at its resolved site + size class onto `fire`. */
export function seedFires(
  world: World,
  fire: FireSystem,
  mission: MissionDef,
  wind: { vx: number; vz: number },
  fireBound: number,
): void {
  for (const f of mission.fires) {
    igniteFromPlacement(world, fire, f, wind, fireBound);
  }
}

/**
 * Resolve + ignite ONE FirePlacement. Shared by `seedFires` (the opening blaze) AND the
 * `MissionDirector`'s flare-up / spot-fire / re-spread beats, so a scripted mid-mission ignition
 * lands with the exact same vocabulary and fuel-snapping as the authored opening fires.
 */
export function igniteFromPlacement(
  world: World,
  fire: FireSystem,
  f: FirePlacement,
  wind: { vx: number; vz: number },
  fireBound: number,
): void {
  {
    const cls = SIZE_CLASS[f.size];
    if (f.at === 'point') {
      fire.igniteAt(f.x, f.z, cls.radius, cls.heat);
    } else if (f.at === 'nearCommunity') {
      const base = communityPoint(world, f.community);
      const count = f.count ?? 1;
      // A numeric phase that's consistent whether `community` is an index or 'base' (vs the old
      // `toString().length`, where 'base' (4) fanned the ring quite differently from index 0/1).
      const phase = f.community === 'base' ? -1 : typeof f.community === 'number' ? f.community : hashStr(f.community);
      for (let i = 0; i < count; i++) {
        // Fan multiple fires around the community at the offset radius (deterministic angles).
        const ang = (i / count) * Math.PI * 2 + phase;
        const off = f.offset ?? 60;
        const target = fuelPointNear(world, base.x + Math.cos(ang) * off, base.z + Math.sin(ang) * off);
        fire.igniteAt(target.x, target.z, cls.radius, cls.heat);
      }
    } else if (f.at === 'line') {
      // A continuous fire FRONT. Default axis is ⟂ to the wind, so the line's head spreads
      // downwind toward the player like a real ridge-line fire (and feeds one cohesive column).
      const wl = Math.hypot(wind.vx, wind.vz) || 1;
      const wux = wind.vx / wl; // unit downwind
      const wuz = wind.vz / wl;
      let cx: number;
      let cz: number;
      if (f.community !== undefined) {
        const base = communityPoint(world, f.community);
        const off = f.offset ?? 90;
        cx = base.x - wux * off; // `offset` units UPWIND of the community so the head runs onto it
        cz = base.z - wuz * off;
      } else {
        cx = f.x ?? 0;
        cz = f.z ?? 0;
      }
      const c = fuelPointNear(world, cx, cz); // snap to dry fuel so the front catches
      let dirX: number;
      let dirZ: number;
      if (f.angle !== undefined) {
        dirX = Math.cos(f.angle);
        dirZ = Math.sin(f.angle);
      } else {
        dirX = -wuz; // perpendicular to the downwind vector → front faces downwind
        dirZ = wux;
        if (Math.hypot(dirX, dirZ) < 1e-3) {
          dirX = 1;
          dirZ = 0;
        }
      }
      fire.igniteLine(c.x, c.z, dirX, dirZ, f.length ?? 90, cls.radius, cls.heat);
    } else if (f.at === 'cluster') {
      // An AUTHORED fire complex: a deterministic centre with `count` heads fanned within `spread`,
      // so it reads as ONE growing blaze (not scattered dots). Centre = anchor + bearing·distance.
      const bearing = f.bearing ?? 0;
      const distance = f.distance ?? 0;
      let cx: number;
      let cz: number;
      if (f.anchor === 'origin') {
        cx = Math.cos(bearing) * distance;
        cz = Math.sin(bearing) * distance;
      } else if (f.anchor === 'lake') {
        // Intended centre off the origin, then snap into the bush just past the nearest lake's rim
        // (toward that centre) so the blaze sits on land WITH open water right beside it to scoop.
        const ix = Math.cos(bearing) * distance;
        const iz = Math.sin(bearing) * distance;
        const lake = nearestLake(world, ix, iz);
        if (lake) {
          let dx = ix - lake.x;
          let dz = iz - lake.z;
          const dl = Math.hypot(dx, dz) || 1;
          dx /= dl;
          dz /= dl;
          cx = lake.x + dx * (lake.r + 35);
          cz = lake.z + dz * (lake.r + 35);
        } else {
          cx = ix;
          cz = iz;
        }
      } else {
        const base = communityPoint(world, f.anchor.community);
        cx = base.x + Math.cos(bearing) * distance;
        cz = base.z + Math.sin(bearing) * distance;
      }
      const count = f.count ?? 1;
      const spread = f.spread ?? 45;
      for (let i = 0; i < count; i++) {
        // Deterministic fan (mirrors `nearCommunity`); `bearing` phases it so specs differ.
        const ang = (i / count) * Math.PI * 2 + bearing;
        const off = count > 1 ? spread : 0;
        const target = fuelPointNear(world, cx + Math.cos(ang) * off, cz + Math.sin(ang) * off);
        fire.igniteAt(target.x, target.z, cls.radius, cls.heat);
      }
    } else {
      // random: fuel-biased sites, off the player's spawn.
      const min = f.minFromOrigin ?? 120;
      for (let i = 0; i < f.count; i++) {
        const site = world.placement.fireSite(world.rng, fireBound, min);
        if (site) fire.igniteAt(site.x, site.z, cls.radius, cls.heat);
      }
    }
  }
}
