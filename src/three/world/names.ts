/**
 * Boreal place-name registry (Track A5). The world is a northern boreal wilderness, so its
 * lakes, communities, and highways carry evocative (fictional) boreal names instead of
 * "Lake 3" — chosen to suit the rolling Shield-and-hills terrain rather than any real map.
 * Pure data + a deterministic drawer: a seeded Fisher–Yates shuffle of each pool, popped
 * in order so the same world seed always names the same feature, with no repeats until the
 * pool is exhausted (then it falls back to a numbered name so generation never starves).
 *
 * This is a thin, swappable naming layer — World assigns names at generation time; nothing
 * downstream depends on the specific strings. Add or reorder names here freely.
 */

// Fictional boreal lakes — Shield-and-hills water country.
const LAKE_NAMES = [
  'Blackpine Lake',
  'Cinder Lake',
  'Ravenmoor Lake',
  'Frostwater Lake',
  'Elkhorn Lake',
  'Birchfall Lake',
  'Greywolf Lake',
  'Mistmere',
  'Loon Hollow Lake',
  'Stillwater Lake',
  'Coldspring Lake',
  'Tamarack Lake',
  'Ironwood Lake',
  'Moosehead Lake',
  'Granite Lake',
  'Otterstone Lake',
  'Pinewatch Lake',
  'Emberlake',
  'Northwind Lake',
  'Snowshoe Lake',
  'Driftwood Lake',
  'Whitepine Lake',
  'Echo Lake',
  'Aspenglow Lake',
  'Foxfire Lake',
  'Caribou Lake',
  'Wolfden Lake',
  'Marshlight Lake',
  'Hollowreed Lake',
  'Slatewater Lake',
];

// Fictional boreal communities — small hamlets and outposts of the north.
const COMMUNITY_NAMES = [
  'Kettle Lake',
  'Pine Hollow',
  'Cedar Crossing',
  'Elkridge',
  'Bracken Falls',
  'Stoneferry',
  'Frostpine',
  'Mooseford',
  'Birchbark',
  'Greywater',
  'Larchwood',
  'Hollowmere',
  'Ashfall',
  'Coldridge',
  'Thornhaven',
  'Spruceton',
  'Caribou Crossing',
  'Lantern Bay',
  'Wolfsbridge',
  'Tamarack Bend',
  'Mistport',
  'Ironpine',
  'Snowgate',
  'Driftpine',
];

// Fictional bush routes (the long gravel highways linking the outposts).
const HIGHWAY_NAMES = [
  'Route 4',
  'Route 7',
  'Route 9',
  'Route 11',
  'Route 12',
  'Route 17',
  'Route 21',
  'Route 28',
  'Route 33',
  'Route 38',
  'Route 40',
  'Route 55',
  'Route 60',
  'Route 72',
];

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
 * Build a deterministic name source from a seed. Each pool gets its own seeded drawer
 * (offset seeds so lakes/communities/highways don't shuffle in lockstep).
 */
export function createNameSource(seed: number): NameSource {
  const lakes = new NameDrawer(LAKE_NAMES, mulberry32(seed ^ 0x1a2b3c4d), 'Lake');
  const towns = new NameDrawer(COMMUNITY_NAMES, mulberry32(seed ^ 0x5e6f7a8b), 'Settlement');
  const hwys = new NameDrawer(HIGHWAY_NAMES, mulberry32(seed ^ 0x9c0d1e2f), 'Route');
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
