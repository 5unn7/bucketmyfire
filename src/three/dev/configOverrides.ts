/**
 * Dev-only persistence for live config tweaks — the backing store for the slider panel
 * (`dev/ConfigPanel.ts`). It lets you nudge any value in `config.ts` at runtime and have
 * the change SURVIVE A RELOAD, which is what makes load-time knobs (terrain, world-gen,
 * quality presets) tunable too: `config.ts` calls `applyConfigOverrides()` at module load,
 * deep-merging whatever the panel saved back into the live config objects BEFORE any
 * consumer reads them.
 *
 * Storage is a single localStorage blob of ONLY the changed leaves (a sparse diff against
 * the source-code defaults), keyed by block name → nested path. Resetting a value deletes
 * its leaf and prunes empty parents, so a "reset all" leaves nothing behind.
 *
 * SAFETY: every browser API touch is guarded by `browser()`, so this module is import-safe
 * in the headless Node bundle (`scripts/verify-campaign.ts` pulls in `config.ts` → here).
 * In Node, `applyConfigOverrides()` is a no-op and the game runs on the pristine defaults.
 *
 * Origin-scoped by nature: a normal player on the prod origin never opens the panel, so no
 * overrides exist for them and `applyConfigOverrides()` no-ops. Tweaks made on `localhost`
 * (or a LAN dev IP, for phone testing) live only on that origin.
 */

const KEY = 'bmf.config.overrides.v1';

type Dict = Record<string, unknown>;

function browser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

let cache: Dict | null = null;

/** The current override blob (sparse diff vs defaults). Cached after first read. */
export function loadOverrides(): Dict {
  if (cache) return cache;
  if (!browser()) return (cache = {});
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Dict) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(o: Dict): void {
  if (!browser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* private mode / quota — tweaks just won't survive reload */
  }
}

/** Record one override at `registry[block]` + nested `path`, then persist. */
export function setOverride(block: string, path: string[], value: unknown): void {
  const o = loadOverrides();
  let node = (o[block] as Dict | undefined) ?? (o[block] = {} as Dict);
  for (let i = 0; i < path.length - 1; i++) {
    const next = node[path[i]] as Dict | undefined;
    node = next ?? (node[path[i]] = {} as Dict);
  }
  node[path[path.length - 1]] = value;
  persist(o);
}

function deleteDeep(obj: Dict, keys: string[]): void {
  if (keys.length === 0) return;
  const [head, ...rest] = keys;
  if (rest.length === 0) {
    delete obj[head];
    return;
  }
  const child = obj[head];
  if (child && typeof child === 'object') {
    deleteDeep(child as Dict, rest);
    if (Object.keys(child as Dict).length === 0) delete obj[head];
  }
}

/** Drop one override leaf (value is back to its default) and prune now-empty parents. */
export function clearOverride(block: string, path: string[]): void {
  const o = loadOverrides();
  deleteDeep(o, [block, ...path]);
  persist(o);
}

/** Wipe every override (the panel's "Reset all"). The caller usually reloads after. */
export function clearAllOverrides(): void {
  cache = {};
  if (browser()) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Pretty-printed override blob for the "Copy overrides" button. */
export function overridesJson(): string {
  return JSON.stringify(loadOverrides(), null, 2);
}

function countLeaves(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(node as Dict)) {
    n += v && typeof v === 'object' ? countLeaves(v) : 1;
  }
  return n;
}

/** How many individual values currently differ from the source defaults. */
export function countOverrides(): number {
  return countLeaves(loadOverrides());
}

/** Deep-merge `src` into `target` in place (arrays handled via numeric-string keys). */
function deepAssign(target: Dict, src: Dict): void {
  for (const k of Object.keys(src)) {
    const sv = src[k];
    const tv = target[k];
    if (sv && typeof sv === 'object' && tv && typeof tv === 'object') {
      deepAssign(tv as Dict, sv as Dict);
    } else {
      target[k] = sv;
    }
  }
}

/**
 * Apply saved overrides onto the live config objects (mutating them in place, so every
 * module that imported a reference picks up the change). Called once at the bottom of
 * `config.ts`. No-op in Node and when nothing is stored.
 */
export function applyConfigOverrides(registry: Record<string, Dict>): void {
  if (!browser()) return;
  const o = loadOverrides();
  const blocks = Object.keys(o);
  if (blocks.length === 0) return;
  for (const block of blocks) {
    const target = registry[block];
    const src = o[block];
    if (target && typeof target === 'object' && src && typeof src === 'object') {
      deepAssign(target, src as Dict);
    }
  }
  try {
    // eslint-disable-next-line no-console
    console.info(`[bmf] applied ${countOverrides()} config override(s) from the tuning panel — press \` to open it`);
  } catch {
    /* ignore */
  }
}
