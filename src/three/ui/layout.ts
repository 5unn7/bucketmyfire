/**
 * Responsive layout controller — the single source of viewport truth for the UI.
 *
 * The in-game HUD and the touch controls used to hardcode pixel positions and a
 * single landscape assumption. This module replaces that with:
 *   - **Breakpoints** — phonePortrait / phoneLandscape / tablet / desktop,
 *     resolved from the viewport (orientation + size).
 *   - **Sets** — one tuned `LayoutSet` bundle of layout tokens per breakpoint
 *     (insets, gauge/tape/radar sizes, control sizes). Tune the look in `SETS`.
 *   - **Safe-area CSS vars** — `--bmf-safe-*` (from `env(safe-area-inset-*)`)
 *     plus the active set's `--bmf-edge` / `--bmf-gap`, which `theme.ts`'s
 *     `anchor()` reads so everything stays clear of notches and reflows for free.
 *
 * All work is event-driven (a single rAF-debounced resize/orientation listener) —
 * never per frame — so it respects the project's mobile-60fps invariants. `Game`
 * is untouched: `HUD` and `Input` each `onLayout(...)` themselves.
 */

export type Orientation = 'portrait' | 'landscape';
export type Breakpoint = 'phonePortrait' | 'phoneLandscape' | 'tablet' | 'desktop';

/** One bundle of layout tokens — final px values for a breakpoint (a "set"). */
export interface LayoutSet {
  edge: number; // base inset from the screen edge, added on top of the safe-area inset
  gap: number; // stack gap for anchored columns
  podSize: number; // instrument-strip cell scale (icon + number px derive from it)
  tapeGap: number; // px from screen center to each flight tape's inner edge
  tapeScale: number; // CSS scale applied to the flight tapes (backing store stays crisp)
  radarBase: number; // collapsed radar side
  radarMaxFrac: number; // expanded radar side capped to this fraction of the short viewport side
  stickRadius: number; // virtual-joystick base radius
  clusterBtn: number; // climb / descend button size
  dropSize: number; // DROP hero size
  helpSize: number; // "?" help button size
}

export interface LayoutState {
  w: number;
  h: number;
  orientation: Orientation;
  breakpoint: Breakpoint;
  set: LayoutSet;
  compact: boolean; // very small screen (short side < 360) → consumers shave sizes a touch
}

/**
 * The preset table. Each entry is final px for that breakpoint — edit here to
 * retune any screen class. Desktop deliberately keeps the on-screen touch pad
 * small/calm (desktop flies on keyboard) while giving the instruments room.
 */
export const SETS: Record<Breakpoint, LayoutSet> = {
  phonePortrait: {
    edge: 12, gap: 7, podSize: 30, tapeGap: 52, tapeScale: 0.8,
    radarBase: 110, radarMaxFrac: 0.82, stickRadius: 60, clusterBtn: 70, dropSize: 92, helpSize: 44,
  },
  phoneLandscape: {
    edge: 14, gap: 6, podSize: 30, tapeGap: 58, tapeScale: 0.84,
    radarBase: 112, radarMaxFrac: 0.8, stickRadius: 56, clusterBtn: 66, dropSize: 90, helpSize: 42,
  },
  tablet: {
    edge: 18, gap: 8, podSize: 34, tapeGap: 70, tapeScale: 1.0,
    radarBase: 128, radarMaxFrac: 0.66, stickRadius: 66, clusterBtn: 76, dropSize: 100, helpSize: 44,
  },
  desktop: {
    edge: 22, gap: 9, podSize: 38, tapeGap: 84, tapeScale: 1.0,
    radarBase: 140, radarMaxFrac: 0.5, stickRadius: 60, clusterBtn: 70, dropSize: 92, helpSize: 40,
  },
};

type Listener = (s: LayoutState) => void;

const listeners = new Set<Listener>();
let current: LayoutState | null = null;
let injected = false;
let rafPending = 0;

/** Inject the static safe-area + default edge/gap CSS vars (once). */
function ensureInjected(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'bmf-layout-vars';
  style.textContent = `:root{
    --bmf-safe-t: env(safe-area-inset-top, 0px);
    --bmf-safe-r: env(safe-area-inset-right, 0px);
    --bmf-safe-b: env(safe-area-inset-bottom, 0px);
    --bmf-safe-l: env(safe-area-inset-left, 0px);
    --bmf-edge: ${SETS.tablet.edge}px;
    --bmf-gap: ${SETS.tablet.gap}px;
  }`;
  document.head.appendChild(style);
}

/** Resolve the breakpoint from the live viewport. */
function resolve(w: number, h: number): { orientation: Orientation; breakpoint: Breakpoint } {
  const orientation: Orientation = w >= h ? 'landscape' : 'portrait';
  let breakpoint: Breakpoint;
  if (orientation === 'portrait') {
    breakpoint = w < 480 ? 'phonePortrait' : w < 900 ? 'tablet' : 'desktop';
  } else {
    breakpoint = h < 480 ? 'phoneLandscape' : w >= 1200 || h >= 820 ? 'desktop' : 'tablet';
  }
  return { orientation, breakpoint };
}

function compute(): LayoutState {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const { orientation, breakpoint } = resolve(w, h);
  return { w, h, orientation, breakpoint, set: SETS[breakpoint], compact: Math.min(w, h) < 360 };
}

/** Recompute state, push the active set's edge/gap into CSS vars, and notify. */
function recompute(): void {
  ensureInjected();
  const next = compute();
  current = next;
  const root = document.documentElement.style;
  root.setProperty('--bmf-edge', `${next.set.edge}px`);
  root.setProperty('--bmf-gap', `${next.set.gap}px`);
  for (const cb of listeners) cb(next);
}

function onViewportChange(): void {
  if (rafPending) return;
  rafPending = requestAnimationFrame(() => {
    rafPending = 0;
    recompute();
  });
}

let wired = false;
function ensureWired(): void {
  if (wired) return;
  wired = true;
  ensureInjected();
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
}

/** Current layout state (computed on first call). */
export function getLayout(): LayoutState {
  if (!current) {
    ensureInjected();
    current = compute();
    document.documentElement.style.setProperty('--bmf-edge', `${current.set.edge}px`);
    document.documentElement.style.setProperty('--bmf-gap', `${current.set.gap}px`);
  }
  return current;
}

/**
 * Subscribe to layout changes. Fires immediately with the current state, then on
 * every (debounced) resize / orientationchange. Returns an unsubscribe function.
 */
export function onLayout(cb: Listener): () => void {
  ensureWired();
  listeners.add(cb);
  cb(getLayout());
  return () => listeners.delete(cb);
}
