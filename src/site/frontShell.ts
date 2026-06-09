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
import { FLAME, ic } from '../three/ui/home/icons';
import { spawnEmbers } from '../three/ui/home/styles';
import { openBoard, openSettings } from '../three/ui/home/menus';

export type FrontPage = 'home' | 'campaign' | 'prepare';

/** The four-item sitemap (real anchors — crawlable, middle-clickable). */
const NAV: { key: FrontPage | 'shop'; label: string; href: string }[] = [
  { key: 'home', label: 'Home', href: '/' },
  { key: 'campaign', label: 'Campaign', href: '/campaign/' },
  { key: 'prepare', label: 'Prepare', href: '/prepare/' },
  { key: 'shop', label: 'Shop', href: 'https://shop.bucketmyfire.com/?utm_source=bucketmyfire&utm_medium=frontdoor&utm_campaign=nav' },
];

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

/** The sticky front-door appbar — brand glyph + sitemap nav + leaderboard/settings, matching the home. */
export function frontAppbar(active: FrontPage): string {
  const navLinks = NAV.map((n) => {
    const cur = n.key === active ? ' aria-current="page"' : '';
    const shop = n.key === 'shop' ? ' shop' : '';
    return `<a class="fhome-nav-a${shop}" href="${n.href}"${cur}>${n.label}</a>`;
  }).join('');
  return (
    `<header class="fhome-bar">` +
    `<a class="brand fhome-brand" href="/" aria-label="Bucket My Fire — home"><span class="bmk">${FLAME}</span><b>BUCKET MY FIRE</b></a>` +
    `<nav class="fhome-nav" aria-label="Primary">${navLinks}</nav>` +
    `<span class="grow"></span>` +
    `<button class="iconbtn" data-front="board" aria-label="Leaderboard">${ic('trophy')}</button>` +
    `<button class="iconbtn" data-front="settings" aria-label="Settings">${ic('settings')}</button>` +
    `</header>`
  );
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
  if (document.getElementById('fd-frontshell-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-frontshell-css';
  s.textContent = FRONT_CSS;
  document.head.appendChild(s);
}

// Mirrors the shared portion of hub.ts `injectFrontStyles` verbatim (see the single-source note above).
const FRONT_CSS = `
/* Override the in-game hub's fixed full-viewport shell: a front page is a SCROLLING content page. */
.bmf-app.front { position: relative; inset: auto; height: auto; min-height: 100dvh; overflow: visible; display: block; z-index: 0; }
.bmf-app.front .scene { position: fixed; }
.bmf-app.front .embers { position: fixed; }

/* Sitemap appbar (sticky). */
.bmf-app.front .fhome-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 10px; min-height: 56px;
  max-width: 1080px; margin: 0 auto; padding: 10px max(14px, env(safe-area-inset-left));
  background: linear-gradient(180deg, rgba(7,10,13,0.92), rgba(7,10,13,0.4)); backdrop-filter: blur(10px) saturate(120%); -webkit-backdrop-filter: blur(10px) saturate(120%); border-bottom: 1px solid var(--hair); }
.bmf-app.front .fhome-brand { gap: 10px; text-decoration: none; color: var(--text); }
.bmf-app.front .fhome-brand .bmk { width: 30px; height: 30px; display: grid; place-items: center; border-radius: var(--r-md); border: 1px solid var(--warm-stroke); background: radial-gradient(circle at 40% 30%, var(--warm-38), rgba(10,12,14,0.9)); box-shadow: inset 0 0 10px var(--ember-35), 0 0 14px var(--ember-12); }
.bmf-app.front .fhome-brand .bmk svg { width: 15px; height: 15px; filter: drop-shadow(0 0 4px var(--glow-80)); }
.bmf-app.front .fhome-brand b { font-family: var(--mono); font-weight: var(--fw-heavy); font-size: 13px; letter-spacing: .16em; }
@media (max-width: 560px) { .bmf-app.front .fhome-brand b { display: none; } }
.bmf-app.front .fhome-nav { display: none; align-items: center; gap: 2px; }
@media (min-width: 760px) { .bmf-app.front .fhome-nav { display: inline-flex; } }
.bmf-app.front .fhome-nav-a { text-decoration: none; color: var(--dim); font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: var(--fw-bold); padding: 10px 11px; min-height: 44px; display: inline-flex; align-items: center; }
.bmf-app.front .fhome-nav-a:hover { color: var(--ember-hi); }
.bmf-app.front .fhome-nav-a[aria-current="page"] { color: var(--text); }
.bmf-app.front .fhome-nav-a.shop { color: var(--ember-hi); }

/* The pad becomes a normal centred content column (not the 452px mobile hub). */
.bmf-app.front .pad.fhome { position: relative; z-index: 2; flex: none; width: 100%; max-width: 1080px; margin: 0 auto; overflow: visible;
  display: flex; flex-direction: column; gap: 12px; padding: 14px max(14px, env(safe-area-inset-left)) calc(96px + env(safe-area-inset-bottom)); }
@media (min-width: 760px) { .bmf-app.front .pad.fhome { padding-bottom: 40px; } }
.bmf-app.front .fhome-eyebrow { margin: 0 0 11px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fhome-eyebrow.cool { color: var(--accent); }

/* The shared footer reads on the dark page; just give it breathing room in this column. */
.bmf-app.front .fd-foot { margin-top: 6px; }
`;
