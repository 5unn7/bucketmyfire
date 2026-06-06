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
 * GATED by entry point: overrides only TAKE EFFECT in a dev build or on a prod `?qa`/`?tune`
 * session (the same gate that mounts the panel). On a normal prod load `applyConfigOverrides()`
 * wipes any stale overrides a one-off `?qa` visit left behind and no-ops — so a tweaked
 * `dropRadius`/`winBonus` can never reach a scored run / the global leaderboard. Tweaks are also
 * origin-scoped (localStorage), so `localhost` / LAN-dev edits live only on that origin.
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
 * Are the tuning-panel overrides allowed to take effect on THIS load? Always in a dev build;
 * in a prod build ONLY when the QA/tune entry point is explicitly opted into via `?qa` / `?tune`
 * on the URL — the same gate that mounts the panel itself (`main.ts`).
 *
 * SECURITY (leaderboard integrity): the panel can mutate any gameplay block (SCORE/FIRE3D/FLIGHT…)
 * and the diff persists to localStorage. Without this gate a single `?qa` visit would leave those
 * overrides active on every *later* plain-URL load, letting a tweaked `dropRadius`/`winBonus` feed
 * the auto-submitted global score. Gating apply (and wiping stale overrides when not gated, below)
 * keeps a normal scored run on the pristine source-code defaults.
 */
function overridesAllowed(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    return q.has('qa') || q.has('tune');
  } catch {
    return false;
  }
}

/**
 * Apply saved overrides onto the live config objects (mutating them in place, so every
 * module that imported a reference picks up the change). Called once at the bottom of
 * `config.ts`. No-op in Node and when nothing is stored.
 *
 * In a prod build outside the `?qa` / `?tune` entry point, any overrides left over from a prior
 * QA session are WIPED (not applied) so they can never bleed into a scored run.
 */
export function applyConfigOverrides(registry: Record<string, Dict>): void {
  if (!browser()) return;
  if (!overridesAllowed()) {
    // Prod, no QA opt-in: a normal player. Discard any stale overrides a one-off ?qa visit left
    // behind so the scored run uses the source-code defaults, then no-op.
    if (countOverrides() > 0) clearAllOverrides();
    return;
  }
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
