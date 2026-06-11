/**
 * Shared FRONT-DOOR chrome for the public pages (`/`, `/prepare/`, `/campaign/`). The home front door
 * (src/hub.ts) rebuilt itself onto the REAL in-game glass-cockpit components (injectHomeStyles → the
 * `.card`/`.cut`, `.scene`/`.embers`, `.sec`/`.tag`/`.line`, `.h-big`, `.eyebrow`, `.iconbtn`, `.brand`
 * vocabulary). This module lifts the bits the front door wraps AROUND those components — the scrolling
 * `.bmf-app.front` shell, the sticky `.fhome-bar` appbar, the ambient `.scene` + `.embers`, and the
 * centred `.pad.fhome` content column — into ONE place so every front page wears the same brand chrome
 * instead of the older flatter `.fd-*` shell.
 *
 * The appbar's trophy + gear open the SAME leaderboard + settings panels the home uses (menus.ts),
 * self-mounting overlays, so a sub-page is one tap from the board or settings just like the home.
 *
 * NOTE (single source of truth): hub.ts still carries its own copy of this chrome inline
 * (`injectFrontStyles` + its appbar markup) plus the home-only bento grid. Once the home settles, hub
 * should import `injectFrontShell` + `frontAppbar` from here and keep only its `.fhome-grid` bento, so
 * the two front pages can never drift. Until then the values below mirror hub's verbatim.
 */
import { spawnEmbers } from '../three/ui/home/styles';
import { openBoard, openSettings } from '../three/ui/home/menus';
import { appbarHtml, injectNavStyles } from './siteNav.mjs';

// 'open-skies' is a real front-door PAGE but NOT a top-level nav item, so passing it marks no nav tab
// active (no NAV key matches) — exactly right for a page that lives off the Home flow, not in the bar.
export type FrontPage = 'home' | 'campaign' | 'prepare' | 'open-skies';

/** The ambient backdrop + ember field (positioned `fixed` by injectFrontShell). Spawn the motes with
 *  `spawnFrontEmbers` after the markup is in the DOM. */
export function frontScene(): string {
  return `<div class="scene"></div><div class="embers"></div>`;
}

/** Light the ember field (idempotent-safe: only spawns if the host is empty). */
export function spawnFrontEmbers(root: HTMLElement, count = 13): void {
  const embers = root.querySelector<HTMLElement>('.embers');
  if (embers && !embers.childElementCount) spawnEmbers(embers, count);
}

/** The sticky front-door appbar — the shared appbar (siteNav), with the front door's leaderboard +
 *  settings icon buttons (wired by wireFrontAppbar). Same chrome the blog + legal pages wear. */
export function frontAppbar(active: FrontPage): string {
  return appbarHtml({ active, actions: 'app' });
}

/** Wire the appbar's leaderboard + settings buttons to the same self-mounting overlays the home uses. */
export function wireFrontAppbar(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-front]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (el.dataset.front === 'board') openBoard();
      else if (el.dataset.front === 'settings') openSettings();
    });
  });
}

/** Inject the shared front-door chrome stylesheet ONCE (the `.bmf-app.front` scroll shell + appbar +
 *  content column). The COMPONENTS come from injectHomeStyles; this is only the wrapper. Idempotent. */
export function injectFrontShell(): void {
  injectNavStyles(); // the shared appbar + tab bar + breadcrumb chrome (siteNav) — one source for every page
  if (document.getElementById('fd-frontshell-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-frontshell-css';
  s.textContent = FRONT_CSS;
  document.head.appendChild(s);
}

// The appbar/nav chrome now lives in siteNav.mjs (navCss, injected by injectNavStyles above) — ONE source
// for the front door, the blog, and the legal pages. This module keeps only the front-door SCROLL SHELL.
const FRONT_CSS = `
/* Override the in-game hub's fixed full-viewport shell: a front page is a SCROLLING content page. */
.bmf-app.front { position: relative; inset: auto; height: auto; min-height: 100dvh; overflow: visible; display: block; z-index: 0; }
.bmf-app.front .scene { position: fixed; }
.bmf-app.front .embers { position: fixed; }

/* The pad becomes a normal centred content column (not the 452px mobile hub). Widened to 1280px so the
   front door uses more horizontal space on large/laptop screens (the bento, nav bar, and footer all
   stretch wider) while staying centred + readable; it fluidly fills narrower viewports below the cap. */
.bmf-app.front .pad.fhome { position: relative; z-index: 2; flex: none; width: 100%; max-width: 1280px; margin: 0 auto; overflow: visible;
  display: flex; flex-direction: column; gap: 12px; padding: 14px max(14px, env(safe-area-inset-left)) calc(96px + env(safe-area-inset-bottom)); }
@media (min-width: 760px) { .bmf-app.front .pad.fhome { padding-bottom: 40px; } }
/* Keep the sticky appbar's content edge aligned with the widened column (siteNav defaults it to 1080;
   the front door stretches to match the bento). */
.bmf-app.front .fhome-bar { max-width: 1280px; }
.bmf-app.front .fhome-eyebrow { margin: 0 0 11px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fhome-eyebrow.cool { color: var(--accent); }
/* The shared first-card "hero" standard (.fd-hero*) now lives in siteNav.mjs navCss (de-scoped), so the
   front-door first cards AND the blog + legal page titles share ONE definition. */
`;
