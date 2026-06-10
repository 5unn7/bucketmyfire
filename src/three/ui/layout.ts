/**
 * Responsive layout SIGNAL — the single source of viewport truth for the UI.
 *
 * The in-game HUD + touch controls are sized by CSS now (the `.bmf-hud` stylesheet's `clamp()` vars +
 * real `@media` breakpoints — `hud/styles.ts`), so this module no longer carries a per-breakpoint pixel
 * table (`SETS`/`LayoutSet` are gone). It now does three small things:
 *   - **Breakpoints** — phonePortrait / phoneLandscape / tablet / desktop, resolved from the viewport,
 *     exposed as `LayoutState.breakpoint` and mirrored to a `data-bp` attribute on `<html>`.
 *   - **Safe-area + edge/gap CSS vars** — `--bmf-safe-*` (from `env(safe-area-inset-*)`) plus the FLUID
 *     `--bmf-edge` / `--bmf-gap` clamps that `theme.ts`'s `anchor()` + the HUD grid read, so everything
 *     clears notches and reflows for free.
 *   - **`onLayout` notifications** — the ONE remaining JS consumer is the radar canvas (a canvas needs
 *     real backing-store pixels + its pinch/zoom math reads them); see `HUD.applyLayout` / `radarSize`.
 *
 * All work is event-driven (a single rAF-debounced resize/orientation listener) — never per frame.
 */

export type Orientation = 'portrait' | 'landscape';
export type Breakpoint = 'phonePortrait' | 'phoneLandscape' | 'tablet' | 'desktop';

export interface LayoutState {
  w: number;
  h: number;
  orientation: Orientation;
  breakpoint: Breakpoint;
}

type Listener = (s: LayoutState) => void;

const listeners = new Set<Listener>();
let current: LayoutState | null = null;
let injected = false;
let rafPending = 0;

/** Inject the safe-area insets + the FLUID edge/gap CSS vars (once). edge/gap are `clamp()` curves now
 *  (12→22px / 6→9px across phone→desktop, the old per-breakpoint range), so `anchor()` + the HUD grid
 *  reflow for free and there's nothing per-breakpoint to push on resize. */
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
    --bmf-edge: clamp(12px, 2.6vw, 22px);
    --bmf-gap: clamp(6px, 1.4vw, 9px);
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
  return { w, h, orientation, breakpoint };
}

/** Recompute state, mirror the breakpoint to `<html data-bp>`, and notify. The sizing vars are fluid CSS
 *  now, so there's nothing per-breakpoint to push here. */
function recompute(): void {
  ensureInjected();
  const next = compute();
  current = next;
  document.documentElement.dataset.bp = next.breakpoint;
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
    document.documentElement.dataset.bp = current.breakpoint;
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
