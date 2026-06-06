/**
 * In-app loading overlay — the ember-rise brand loader, for heavy transitions that happen WITHOUT a
 * page reload. A mission RETRY/NEXT rebuilds the whole `World` in the `Game` constructor (terrain +
 * forest generation), which blocks the frame for a few seconds; the cold-start splash in `index.html`
 * only covers the initial page-load boot, so an in-place switch would otherwise freeze on the old
 * frame. This shows the same ember-rise loader over those switches.
 *
 * Self-contained DOM + CSS on purpose: the cold-start splash markup lives in static HTML so it can
 * paint before ~1 MB of game JS parses, and can't be imported here — so this re-states the same visual
 * (kept in sync by hand; both are the brand icon mark). Toned to the FIGHT register (warm ember) to
 * match the splash. Honours `prefers-reduced-motion` via the global rule in `index.html`.
 *
 * The synchronous `Game` constructor freezes CSS animation while it runs (single-threaded), exactly
 * like the cold-start splash does on boot — the point is to show a branded screen instead of a stale
 * frame, not to animate through the stall.
 */

const STYLE_ID = 'bmf-loader-style';
let overlay: HTMLDivElement | null = null;
let removeTimer = 0;

const CSS = `
#bmf-loader {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(130% 100% at 50% 78%, #2a120b 0%, #150a07 46%, #090605 100%);
  opacity: 0;
  transition: opacity 0.28s ease;
  pointer-events: none;
}
#bmf-loader.bmf-loader-in { opacity: 1; pointer-events: auto; }
#bmf-loader .spin { position: relative; width: 96px; height: 122px; display: grid; place-items: center; }
#bmf-loader .mark { width: 58px; fill: #ff7a2f; z-index: 1; animation: bmf-ldr-glow 0.5s ease-in-out infinite alternate, bmf-ldr-flicker 0.13s steps(2, end) infinite; }
#bmf-loader .mark path, #bmf-loader .mark polygon { transform-box: fill-box; }
#bmf-loader .f1 { transform-origin: center bottom; animation: bmf-ldr-flick1 0.52s ease-in-out infinite alternate; }
#bmf-loader .f2 { fill: #ffd27a; transform-origin: center bottom; animation: bmf-ldr-flick2 0.71s ease-in-out infinite alternate; }
#bmf-loader .chev { transform-origin: center; animation: bmf-ldr-bed 1.5s ease-in-out infinite; }
#bmf-loader .spark {
  position: absolute; bottom: calc(44px + var(--by, 0px)); left: 50%; z-index: 2;
  width: 5px; height: 5px; border-radius: 50%;
  /* A glowing cinder, not a dot — white-hot core fading to a soft transparent ember edge. */
  background: radial-gradient(circle, #fff4da 0%, #ffce6a 38%, rgba(255, 140, 55, 0.55) 68%, rgba(255, 110, 40, 0) 100%);
  box-shadow: 0 0 6px 1px rgba(255, 145, 55, 0.5);
  filter: blur(0.4px); opacity: 0; will-change: transform, opacity;
  animation: bmf-ldr-rise 1.9s ease-out infinite;
}
@keyframes bmf-ldr-flick1 { from { transform: scaleY(0.9) skewX(3deg); opacity: 0.75; } to { transform: scaleY(1.07) skewX(-4deg); opacity: 1; } }
@keyframes bmf-ldr-flick2 { from { transform: scaleY(1.06) skewX(-3deg); opacity: 1; } to { transform: scaleY(0.9) skewX(4deg); opacity: 0.72; } }
@keyframes bmf-ldr-bed { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
@keyframes bmf-ldr-glow { from { filter: drop-shadow(0 0 10px rgba(255, 120, 40, 0.55)) brightness(0.98); } to { filter: drop-shadow(0 0 22px rgba(255, 170, 75, 0.82)) brightness(1.08); } }
@keyframes bmf-ldr-flicker { 0% { opacity: 1; } 50% { opacity: 0.93; } 100% { opacity: 1; } }
/* Rising cinder: fades in, TWINKLES, SWAYS on the heat plume, and COOLS/shrinks to a mote. */
@keyframes bmf-ldr-rise {
  0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
  10% { opacity: 1; transform: translate(calc(var(--dx, 0px) * 0.15 - 1px), -8px) scale(1); }
  28% { opacity: 0.5; transform: translate(calc(var(--dx, 0px) * 0.4 + 3px), -24px) scale(0.92); }
  48% { opacity: 1; transform: translate(calc(var(--dx, 0px) * 0.6 - 3px), -42px) scale(0.78); }
  70% { opacity: 0.45; transform: translate(calc(var(--dx, 0px) * 0.85 + 2px), -60px) scale(0.55); }
  100% { opacity: 0; transform: translate(var(--dx, 0px), -82px) scale(0.18); }
}
/* Reduced motion: the cold-start splash (and the game's global rule) zero every animation duration,
   which would freeze this loader into a dead icon. Keep a GENTLE, non-flashing version alive — a slow
   glow breath + slow embers, no fast flame flicker. id+class out-specifies the global star-selector kill. */
@media (prefers-reduced-motion: reduce) {
  #bmf-loader .mark { animation: bmf-ldr-glow 2.6s ease-in-out infinite alternate !important; }
  #bmf-loader .spark { display: block; animation-duration: 3.2s !important; animation-iteration-count: infinite !important; }
}
`;

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

const SPINNER_HTML = `
  <div class="spin" aria-hidden="true">
    ${SPARKS.map((s) => `<span class="spark" style="${s}"></span>`).join('')}
    <svg class="mark" viewBox="0 0 149.7 184.72">
      <path class="f1" d="M73.06,58.25c-18.59,21.04-34.35,33.63-22.6,64.65-21.97-11.26-29.05-37.71-17.05-59.08C46.45,40.59,68.12,28.39,69.08,0c16.8,18.38,20.62,39.42,3.98,58.25Z"/>
      <path class="f2" d="M78.83,107.06c-5.97,5.58-8.3,13.06-8.78,21.51-10.73-8.26-13.63-23.66-5.17-35.08,13.99-18.88,30.5-27.51,32.95-51.73,22.16,26.58,26.3,62.23-2.1,82.13,1.38-11.22,2.02-20.02-3.9-28.97l-12.99,12.14Z"/>
      <polygon class="chev" points="149.7 134.09 74.92 184.72 0 134.31 .57 108.82 74.83 158.71 148.67 108.67 149.7 134.09"/>
    </svg>
  </div>
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Mount + fade in the ember-rise loader over the whole viewport. Idempotent. */
export function showLoading(): void {
  ensureStyle();
  if (removeTimer) {
    clearTimeout(removeTimer);
    removeTimer = 0;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bmf-loader';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-label', 'Loading');
    overlay.innerHTML = SPINNER_HTML;
    document.body.appendChild(overlay);
  }
  // next frame so the freshly-mounted element transitions in rather than snapping to opacity 1
  requestAnimationFrame(() => overlay?.classList.add('bmf-loader-in'));
}

/** Fade out + detach the loader. Safe to call when nothing is showing. */
export function hideLoading(): void {
  if (!overlay) return;
  const node = overlay;
  node.classList.remove('bmf-loader-in');
  removeTimer = window.setTimeout(() => {
    node.remove();
    if (overlay === node) overlay = null;
    removeTimer = 0;
  }, 320);
}
