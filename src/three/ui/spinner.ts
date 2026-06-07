/**
 * The flame-mark ember loader — the ONE source of truth for the brand spinner, shared by BOTH:
 *   1. the cold-start splash (`#bmf-splash` in index.html), injected by the `bmf-splash` Vite plugin
 *      in `vite.config.ts` at serve+build time, and
 *   2. the in-app `LoadingOverlay` (`#bmf-loader`), which imports it at runtime for in-place mission
 *      switches (RETRY / NEXT).
 *
 * Why a shared module instead of two hand-kept copies: the two used to be "kept in sync by hand", which
 * drifted. More importantly, the splash's old keyframes were named `bmf-rise` / `bmf-glow` — and the
 * Home hub's stylesheet (`ui/home/styles.ts`) ALSO defines a global `@keyframes bmf-rise` (its entrance
 * fade-up). CSS keyframes are document-global, so once the hub stylesheet loaded it HIJACKED the
 * splash's ember rise → the embers froze in place ("ember can't go up", only on the home route). The
 * keyframes here are uniquely namespaced (`bmf-spin-*`) so nothing can clobber them.
 *
 * PURE STRINGS, ZERO IMPORTS — this is imported by `vite.config.ts` (Node) as well as the browser
 * bundle, and it must paint before any tokens/JS exist, so it can't read `theme.ts`. Keep it literal.
 */

// The dark ember-glow backdrop behind the mark — shared by both loader wrappers (splash + in-app).
export const LOADER_BG =
  'radial-gradient(130% 100% at 50% 78%, #2a120b 0%, #150a07 46%, #090605 100%)';

// Per-ember inline styles: --dx horizontal drift, --by start-height nudge, plus position/size/timing.
// Ten cinders on staggered clocks so the plume reads as continuous, not a pulse.
const SPARKS = [
  '--dx:-4px;--by:-2px;left:38%;width:5px;height:5px;animation-delay:0s;animation-duration:1.9s',
  '--dx:5px;--by:3px;left:44%;width:3px;height:3px;animation-delay:0.3s;animation-duration:2.3s',
  '--dx:-7px;--by:5px;left:48%;width:6px;height:6px;animation-delay:0.6s;animation-duration:1.7s',
  '--dx:4px;--by:1px;left:52%;width:4px;height:4px;animation-delay:0.9s;animation-duration:2.05s',
  '--dx:-5px;--by:-3px;left:56%;width:5px;height:5px;animation-delay:1.15s;animation-duration:1.8s',
  '--dx:8px;--by:4px;left:62%;width:3px;height:3px;animation-delay:0.45s;animation-duration:2.4s',
  '--dx:-2px;--by:0px;left:41%;width:4px;height:4px;animation-delay:1.4s;animation-duration:2.15s',
  '--dx:6px;--by:-4px;left:59%;width:6px;height:6px;animation-delay:0.75s;animation-duration:1.6s',
  '--dx:1px;--by:2px;left:50%;width:7px;height:7px;animation-delay:1.55s;animation-duration:1.95s',
  '--dx:-6px;--by:6px;left:46%;width:4px;height:4px;animation-delay:1.25s;animation-duration:2.1s',
];

/**
 * The inner loader markup: the rising sparks + the flickering brand flame mark (two flame tongues over
 * a steady chevron ember bed). Class-scoped (`.bmf-spin`) so it drops inside ANY wrapper — the
 * full-screen `#bmf-splash` or the in-app `#bmf-loader`. Inline SVG geometry → zero asset requests, so
 * it paints on the very first frame before the game bundle parses.
 */
export const SPINNER_MARKUP = `<div class="bmf-spin" aria-hidden="true">
  ${SPARKS.map((s) => `<span class="spark" style="${s}"></span>`).join('\n  ')}
  <svg class="mark" viewBox="0 0 149.7 184.72">
    <path class="f1" d="M73.06,58.25c-18.59,21.04-34.35,33.63-22.6,64.65-21.97-11.26-29.05-37.71-17.05-59.08C46.45,40.59,68.12,28.39,69.08,0c16.8,18.38,20.62,39.42,3.98,58.25Z"/>
    <path class="f2" d="M78.83,107.06c-5.97,5.58-8.3,13.06-8.78,21.51-10.73-8.26-13.63-23.66-5.17-35.08,13.99-18.88,30.5-27.51,32.95-51.73,22.16,26.58,26.3,62.23-2.1,82.13,1.38-11.22,2.02-20.02-3.9-28.97l-12.99,12.14Z"/>
    <polygon class="chev" points="149.7 134.09 74.92 184.72 0 134.31 .57 108.82 74.83 158.71 148.67 108.67 149.7 134.09"/>
  </svg>
</div>`;

/**
 * The inner-loader CSS — `.bmf-spin` scoped, keyframes uniquely namespaced `bmf-spin-*` so a
 * globally-injected stylesheet (e.g. the Home hub's `@keyframes bmf-rise`) can never clobber the ember
 * rise. Patch albedo of the flames via fill; the chevron holds as a steady ember bed; cinders fade in,
 * twinkle, sway on the plume, and cool to a mote as they climb off the chevron edge.
 *
 * The reduced-motion block keeps a GENTLE, non-flashing version alive (a loading indicator's motion is
 * functional "still working" feedback) and out-specifies the global `*` reduced-motion kill in
 * index.html — `.bmf-spin .mark` (0,2,0) beats `*` (0,0,0), both `!important`.
 */
export const SPINNER_CSS = `
.bmf-spin { position: relative; width: 96px; height: 122px; display: grid; place-items: center; }
.bmf-spin .mark { width: 58px; fill: #ff7a2f; z-index: 1; animation: bmf-spin-glow 0.5s ease-in-out infinite alternate, bmf-spin-flicker 0.13s steps(2, end) infinite; }
.bmf-spin .mark path, .bmf-spin .mark polygon { transform-box: fill-box; }
.bmf-spin .f1 { transform-origin: center bottom; animation: bmf-spin-flick1 0.52s ease-in-out infinite alternate; }
.bmf-spin .f2 { fill: #ffd27a; transform-origin: center bottom; animation: bmf-spin-flick2 0.71s ease-in-out infinite alternate; }
.bmf-spin .chev { transform-origin: center; animation: bmf-spin-bed 1.5s ease-in-out infinite; }
.bmf-spin .spark {
  position: absolute; bottom: calc(44px + var(--by, 0px)); left: 50%; z-index: 2;
  width: 5px; height: 5px; border-radius: 50%;
  /* A glowing cinder, not a dot — white-hot core fading to a soft transparent ember edge. */
  background: radial-gradient(circle, #fff4da 0%, #ffce6a 38%, rgba(255, 140, 55, 0.55) 68%, rgba(255, 110, 40, 0) 100%);
  box-shadow: 0 0 6px 1px rgba(255, 145, 55, 0.5);
  filter: blur(0.4px); opacity: 0; will-change: transform, opacity;
  animation: bmf-spin-rise 1.9s ease-out infinite;
}
@keyframes bmf-spin-flick1 { from { transform: scaleY(0.9) skewX(3deg); opacity: 0.75; } to { transform: scaleY(1.07) skewX(-4deg); opacity: 1; } }
@keyframes bmf-spin-flick2 { from { transform: scaleY(1.06) skewX(-3deg); opacity: 1; } to { transform: scaleY(0.9) skewX(4deg); opacity: 0.72; } }
@keyframes bmf-spin-bed { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
@keyframes bmf-spin-glow { from { filter: drop-shadow(0 0 10px rgba(255, 120, 40, 0.55)) brightness(0.98); } to { filter: drop-shadow(0 0 22px rgba(255, 170, 75, 0.82)) brightness(1.08); } }
@keyframes bmf-spin-flicker { 0% { opacity: 1; } 50% { opacity: 0.93; } 100% { opacity: 1; } }
/* Rising cinder: fades in, TWINKLES, SWAYS on the heat plume, and COOLS/shrinks to a mote. */
@keyframes bmf-spin-rise {
  0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
  10% { opacity: 1; transform: translate(calc(var(--dx, 0px) * 0.15 - 1px), -8px) scale(1); }
  28% { opacity: 0.5; transform: translate(calc(var(--dx, 0px) * 0.4 + 3px), -24px) scale(0.92); }
  48% { opacity: 1; transform: translate(calc(var(--dx, 0px) * 0.6 - 3px), -42px) scale(0.78); }
  70% { opacity: 0.45; transform: translate(calc(var(--dx, 0px) * 0.85 + 2px), -60px) scale(0.55); }
  100% { opacity: 0; transform: translate(var(--dx, 0px), -82px) scale(0.18); }
}
@media (prefers-reduced-motion: reduce) {
  .bmf-spin .mark { animation: bmf-spin-glow 2.6s ease-in-out infinite alternate !important; }
  .bmf-spin .spark { display: block; animation-duration: 3.2s !important; animation-iteration-count: infinite !important; }
}`;

/** Attributes for the cold-start splash wrapper (`#bmf-splash`) — the id the index.html teardown
 *  script keys off (`getElementById('bmf-splash')`). Consumed by the `bmf-splash` Vite plugin. */
export const SPLASH_ATTRS: Record<string, string> = {
  id: 'bmf-splash',
  role: 'status',
  'aria-label': 'Loading Bucket My Fire',
};

/** Full cold-start splash CSS = the full-screen `#bmf-splash` wrapper + the shared inner loader. The
 *  `bmf-splash` Vite plugin injects this verbatim into index.html's <head> (see vite.config.ts), so the
 *  branded ember loader paints on the first frame before ~1 MB of game JS parses. The `.bmf-hide` fade
 *  is driven by the inline teardown script in index.html once the game signals its first real frame. */
export const SPLASH_CSS = `#bmf-splash {
  position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px;
  background: ${LOADER_BG};
  color: #f4ead9; transition: opacity 0.5s ease;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased;
}
#bmf-splash.bmf-hide { opacity: 0; pointer-events: none; }
${SPINNER_CSS}`;
