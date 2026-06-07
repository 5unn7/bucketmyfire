/**
 * In-app loading overlay — the ember-rise brand loader, for heavy transitions that happen WITHOUT a
 * page reload. A mission RETRY/NEXT rebuilds the whole `World` in the `Game` constructor (terrain +
 * forest generation), which blocks the frame for a few seconds; the cold-start splash in `index.html`
 * only covers the initial page-load boot, so an in-place switch would otherwise freeze on the old
 * frame. This shows the same ember-rise loader over those switches.
 *
 * The loader visual (markup + CSS) is the ONE shared source in `./spinner` — the SAME module the
 * `bmf-splash` Vite plugin injects into index.html's cold-start splash, so the two can't drift. This
 * file only owns the in-app WRAPPER (`#bmf-loader`: full-screen, fade in/out) around that shared inner.
 *
 * The synchronous `Game` constructor freezes CSS animation while it runs (single-threaded), exactly
 * like the cold-start splash does on boot — the point is to show a branded screen instead of a stale
 * frame, not to animate through the stall.
 */
import { SPINNER_MARKUP, SPINNER_CSS, LOADER_BG } from './spinner';

const STYLE_ID = 'bmf-loader-style';
let overlay: HTMLDivElement | null = null;
let removeTimer = 0;

// Just the in-app wrapper; the inner loader (`.bmf-spin` + its keyframes, reduced-motion included)
// rides in from the shared SPINNER_CSS so it stays identical to the cold-start splash.
const CSS = `
#bmf-loader {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${LOADER_BG};
  opacity: 0;
  transition: opacity 0.28s ease;
  pointer-events: none;
}
#bmf-loader.bmf-loader-in { opacity: 1; pointer-events: auto; }
${SPINNER_CSS}
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
    overlay.innerHTML = SPINNER_MARKUP;
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
