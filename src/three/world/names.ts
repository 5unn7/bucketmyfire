/**
 * Place-name drawer (Track A5). A thin, deterministic naming MECHANISM: it takes a region's
 * name pools (see `world/regions.ts`, where the per-map lists live) and draws from them with a
 * seeded Fisher–Yates shuffle popped in order, so the same world seed always names the same
 * feature, with no repeats until a pool is exhausted (then a numbered fallback keeps generation
 * from starving).
 *
 * The DATA (which names belong to which map) lives in `regions.ts`; this file is just the
 * shuffle-and-pop. World assigns names at generation time and nothing downstream depends on the
 * specific strings — so a mission can also PIN authored names over the top (see World pins).
 */

import type { RegionNames } from './regions';

/** A no-repeat name drawer over one pool: a seeded shuffle, popped in order. */
class NameDrawer {
  private readonly order: string[];
  private i = 0;

  constructor(
    pool: readonly string[],
    rng: () => number,
    private readonly fallback: string,
  ) {
    this.order = shuffle(pool.slice(), rng);
  }

  next(): string {
    if (this.i < this.order.length) return this.order[this.i++];
    return `${this.fallback} ${++this.i - this.order.length}`; // pool exhausted — numbered fallback
  }
}

export interface NameSource {
  lake(): string;
  community(): string;
  highway(): string;
}

/**
 * Build a deterministic name source from a seed + a region's name pools. Each pool gets its own
 * seeded drawer (offset seeds so lakes/communities/highways don't shuffle in lockstep).
 */
export function createNameSource(seed: number, names: RegionNames): NameSource {
  const lakes = new NameDrawer(names.lakes, mulberry32(seed ^ 0x1a2b3c4d), 'Lake');
  const towns = new NameDrawer(names.communities, mulberry32(seed ^ 0x5e6f7a8b), 'Settlement');
  const hwys = new NameDrawer(names.highways, mulberry32(seed ^ 0x9c0d1e2f), 'Route');
  return {
    lake: () => lakes.next(),
    community: () => towns.next(),
    highway: () => hwys.next(),
  };
}

/** In-place Fisher–Yates with a seeded rng. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** mulberry32 — tiny seeded PRNG (same one World uses), kept local so names self-seed. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
