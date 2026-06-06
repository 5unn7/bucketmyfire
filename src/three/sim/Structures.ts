import { STRUCTURES, COMMUNITIES, FIRE3D } from '../config';
import type { FireState } from './FireSystem';

/**
 * Structures to defend (Track C3 — the stakes). Engine-agnostic: owns the buildings'
 * state as plain numbers (position, health, burning) — no Three.js, no DOM — so it
 * honors the sim boundary. `Game.ts` reads `list` each frame to pose a fixed pool of
 * cabin/depot meshes, and reads `lost` / `threat` for the HUD + end condition.
 *
 * A fire within `threatRadius` damages a structure in proportion to its intensity and
 * proximity; dousing the fire (FireSystem) is how you save the building. You LOSE when
 * every structure is destroyed — which is what gives the fire dynamics (spread, burn-out,
 * firebreaks) their weight: an ignored front eventually reaches your cabins.
 *
 * World fields arrive as injected callbacks (`groundHeightAt`, `isOverWater`, `pickSite`,
 * the lake list) so this module never imports `World`.
 */

export type StructureKind = 'cabin' | 'depot';

/** A single structure's state — numbers only. */
export interface StructureState {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly y: number; // ground surface height (mesh sits here)
  readonly kind: StructureKind;
  readonly name?: string; // the community this belongs to (for the HUD threat label); undefined for lone bush cabins
  health: number; // 1 (pristine) → 0 (destroyed)
  burning: boolean; // a fire is currently within threatRadius
  destroyed: boolean;
}

/** Minimal community shape Structures needs (kept local so this never imports World). */
export interface CommunityInput {
  x: number;
  z: number;
  kind: 'base' | 'town' | 'city'; // 'city' sites are never built as Structures (decoration only) — ignored here
  radius: number;
  buildings: number;
  name?: string; // display (pinned) place name — used to label the threatened structure on the HUD
}

export interface StructureDeps {
  groundHeightAt(x: number, z: number): number;
  isOverWater(x: number, z: number): boolean;
  /** Seeded fire-start picker (world.placement.fireSite) — cabins sit where fire goes (forest). */
  pickSite(minFromOrigin: number): { x: number; z: number } | null;
  /** Lake list, for siting the depot on a shore (fallback when there's no base community). */
  lakes: { x: number; z: number; r: number }[];
  /** Seeded rng (shared world stream) for clustering cabins within a hamlet. */
  rng(): number;
  /** Named community sites (World A5): one lakeside base + forest hamlets to populate. */
  communities: CommunityInput[];
  /**
   * Mission placement plan (campaign layer). When present, Structures places EXACTLY this —
   * the base/depot, the named hamlets to defend (with optional cabin-count override), and a
   * few lone bush cabins — instead of the sandbox auto-generation over every community. The
   * `community` entries are already-resolved sites from `World.getCommunity`. Omit for the
   * open sandbox (legacy auto path).
   */
  plan?: {
    depot: boolean;
    groups: { community: CommunityInput; cabins?: number }[];
    extraCabins: number;
  };
}

export class Structures {
  private readonly items: StructureState[] = [];
  private nextId = 0;

  constructor(private readonly deps: StructureDeps) {
    if (deps.plan) this.buildFromPlan(deps.plan);
    else this.buildAuto();
  }

  /** Sandbox auto-generation: depot + every town hamlet + a few lone bush cabins. */
  private buildAuto(): void {
    // Depot: at the lakeside BASE community if World seeded one, else fall back to the
    // old ray-march off the first lake (so the depot still appears on a bare-lake map).
    const base = this.deps.communities.find((c) => c.kind === 'base');
    if (STRUCTURES.depot) {
      if (base) this.add('depot', base.x, base.z, base.name);
      else this.placeDepot();
    }
    // Forest hamlets: a tight cluster of cabins around each town center.
    for (const town of this.deps.communities) {
      if (town.kind === 'town') this.placeCluster(town);
    }
    // A few lone trapper cabins out in the bush — spread bait away from the towns.
    this.placeCabins(COMMUNITIES.remoteCabins);
  }

  /** Mission placement: exactly the depot + named hamlets + lone cabins the mission asked for. */
  private buildFromPlan(plan: NonNullable<StructureDeps['plan']>): void {
    if (plan.depot) {
      const base = this.deps.communities.find((c) => c.kind === 'base');
      if (base) this.add('depot', base.x, base.z, base.name);
      else this.placeDepot();
    }
    for (const g of plan.groups) {
      this.placeCluster({ ...g.community, buildings: g.cabins ?? g.community.buildings });
    }
    if (plan.extraCabins > 0) this.placeCabins(plan.extraCabins);
  }

  get list(): readonly StructureState[] {
    return this.items;
  }

  get total(): number {
    return this.items.length;
  }

  get aliveCount(): number {
    let n = 0;
    for (const s of this.items) if (!s.destroyed) n++;
    return n;
  }

  /** Lose condition: every structure destroyed (and there was at least one to lose). */
  get lost(): boolean {
    return this.items.length > 0 && this.items.every((s) => s.destroyed);
  }

  /**
   * Endangerment of the most-threatened surviving structure, 0..1 — drives the HUD
   * gauge. A burning structure reads high; a merely scarred one reads as residual damage.
   */
  get threat(): number {
    let t = 0;
    for (const s of this.items) {
      if (s.destroyed) continue;
      const dmg = 1 - s.health;
      const d = s.burning ? Math.max(0.45, dmg) : dmg * 0.5;
      if (d > t) t = d;
    }
    return t;
  }

  /** Community NAME of the most-threatened surviving structure — lets the HUD read "Denare Beach 70%"
   *  instead of a bare number. Mirrors `threat`'s selection; undefined when nothing's named/threatened. */
  get threatName(): string | undefined {
    let t = -1;
    let name: string | undefined;
    for (const s of this.items) {
      if (s.destroyed) continue;
      const dmg = 1 - s.health;
      const d = s.burning ? Math.max(0.45, dmg) : dmg * 0.5;
      if (d > t) {
        t = d;
        name = s.name;
      }
    }
    return name;
  }

  /** Apply this frame's fire damage: nearest fire within range drains health by intensity×proximity. */
  update(dtMs: number, fires: readonly FireState[]): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = dtMs / 1000;
    const R = STRUCTURES.threatRadius;
    for (const s of this.items) {
      if (s.destroyed) continue;
      let worst = 0; // strongest (intensity×proximity) fire hitting this structure
      for (const f of fires) {
        const d = Math.hypot(f.x - s.x, f.z - s.z);
        if (d > R) continue;
        const prox = 1 - d / R; // 1 at the structure, 0 at the threat ring
        const hit = (f.intensity / FIRE3D.maxIntensity) * prox;
        if (hit > worst) worst = hit;
      }
      s.burning = worst > 0;
      if (worst > 0) {
        s.health -= STRUCTURES.damagePerSec * worst * dt;
        if (s.health <= 0) {
          s.health = 0;
          s.burning = false;
          s.destroyed = true;
        }
      }
    }
  }

  // --- Placement (deterministic — draws from the same seeded streams as the world) ---

  /** Depot on a lake shore: from the first lake's center, the nearest dry land beyond it. */
  private placeDepot(): void {
    const lake = this.deps.lakes[0];
    if (!lake) return;
    let best: { x: number; z: number } | null = null;
    let bestMarch = Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (let march = lake.r; march < lake.r + 40; march += 3) {
        const x = lake.x + dx * march;
        const z = lake.z + dz * march;
        if (this.deps.isOverWater(x, z)) continue;
        if (march < bestMarch) {
          bestMarch = march;
          best = { x, z };
        }
        break; // first dry point along this ray
      }
    }
    const p = best ?? { x: lake.x + lake.r + 14, z: lake.z };
    this.add('depot', p.x, p.z);
  }

  /** A forest hamlet: scatter its cabins in a tight cluster around the town center. */
  private placeCluster(town: CommunityInput): void {
    let guard = 0;
    let placed = 0;
    while (placed < town.buildings && guard++ < 80) {
      const a = this.deps.rng() * Math.PI * 2;
      const rad = Math.sqrt(this.deps.rng()) * town.radius; // sqrt → even areal spread, not center-heavy
      const x = town.x + Math.cos(a) * rad;
      const z = town.z + Math.sin(a) * rad;
      if (this.deps.isOverWater(x, z)) continue;
      if (this.tooClose(x, z, COMMUNITIES.cabinSpacing)) continue; // tight village spacing
      this.add('cabin', x, z, town.name);
      placed++;
    }
  }

  /** Lone cabins in flammable forest (so the fire threatens them), spaced apart, off spawn. */
  private placeCabins(count: number): void {
    let guard = 0;
    let placed = 0;
    while (placed < count && guard++ < 400) {
      const site = this.deps.pickSite(STRUCTURES.minFromOrigin);
      if (!site) continue;
      if (this.deps.isOverWater(site.x, site.z)) continue;
      if (this.tooClose(site.x, site.z, STRUCTURES.cabinSpacing)) continue;
      this.add('cabin', site.x, site.z);
      placed++;
    }
  }

  private tooClose(x: number, z: number, min: number): boolean {
    for (const s of this.items) {
      if (Math.hypot(s.x - x, s.z - z) < min) return true;
    }
    return false;
  }

  private add(kind: StructureKind, x: number, z: number, name?: string): void {
    this.items.push({
      id: this.nextId++,
      x,
      z,
      y: this.deps.groundHeightAt(x, z),
      kind,
      name,
      health: 1,
      burning: false,
      destroyed: false,
    });
  }
}
