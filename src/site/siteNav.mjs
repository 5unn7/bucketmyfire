/**
 * THE single source of the site-wide navigation chrome — the one place the appbar, the mobile tab bar,
 * and the breadcrumb trail are defined, so every public page wears the SAME nav and it can't drift.
 *
 * It is plain ESM with ZERO imports (no Three, no TS, no DOM at module scope) so BOTH worlds can use it:
 *   - the Vite-bundled TypeScript front door (`src/site/frontShell.ts`, `src/site/shell.ts`, `hub.ts`)
 *     imports `./siteNav.mjs` (types via the sibling `siteNav.d.mts`); and
 *   - the Node-run legal renderer (`scripts/content/legal.mjs`) imports `../../src/site/siteNav.mjs`
 *     at build time and inlines `navCss`.
 *
 * Markup is token-driven (`var(--*)` from theme.ts → mockups/tokens.css), warm "fight" register
 * (DESIGN.md). The brand flame mark renders via `url(#flameGrad)`, so a page that is NOT the in-game
 * front door (which already injects the home `DEFS`) must include `NAV_DEFS` once in its body.
 */

/** The top-level sitemap (real anchors — crawlable, middle-clickable). */
export const NAV = [
  { key: 'home', label: 'Home', href: '/' },
  { key: 'campaign', label: 'Campaign', href: '/campaign/' },
  // "The Fireline" — the tribute timeline (renamed from "Hall of Fame" 2026-06-12; the internal
  // `halloffame` key survives so the FrontPage/ShellPage types + active-tab wiring don't churn).
  { key: 'halloffame', label: 'Fireline', href: '/fireline/' },
  // Live wildfire map — a real anchor so it's reachable from EVERY page (the front door reads `?map` and
  // opens the tracker overlay; from a static sub-page it just loads home + opens it). Instant access.
  { key: 'map', label: 'Map', href: '/?map' },
  // Shop = the same-domain coming-soon page for now (the standalone storefront at shop.bucketmyfire.com
  // isn't resolving yet) — flip this back to the external URL once the shop domain is live.
  { key: 'shop', label: 'Shop', href: '/shop/' },
];

/** Escape a string for safe interpolation into HTML — the ONE escaper of record for both worlds
 *  (the TS front door imports it here; the Node-run blog/legal renderers get it via this module).
 *  Don't re-implement it per file: the copies had already drifted (one dropped `'` escaping). */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Brand flame mark (fills via url(#flameGrad)) — mirrors src/three/ui/home/icons.ts FLAME. */
export const FLAME = `<svg class="flame" viewBox="0 0 149.7 184.72"><polygon points="149.7 134.09 74.92 184.72 0 134.31 .57 108.82 74.83 158.71 148.67 108.67 149.7 134.09"/><path d="M73.06,58.25c-18.59,21.04-34.35,33.63-22.6,64.65-21.97-11.26-29.05-37.71-17.05-59.08C46.45,40.59,68.12,28.39,69.08,0c16.8,18.38,20.62,39.42,3.98,58.25Z"/><path d="M78.83,107.06c-5.97,5.58-8.3,13.06-8.78,21.51-10.73-8.26-13.63-23.66-5.17-35.08,13.99-18.88,30.5-27.51,32.95-51.73,22.16,26.58,26.3,62.23-2.1,82.13,1.38-11.22,2.02-20.02-3.9-28.97l-12.99,12.14Z"/></svg>`;

/** The flame gradient <defs> — include ONCE in the body of a static page (blog/legal) so the appbar's
 *  FLAME resolves its `url(#flameGrad)` fill. The in-game front door already injects the home DEFS. */
export const NAV_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="flameGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc24a"/><stop offset="1" stop-color="#ff6a2c"/></linearGradient></defs></svg>`;

// Mobile tab-bar glyphs — Lucide (MIT) stroke icons, so the bar speaks the SAME icon language as the
// appbar actions + the in-game HUD/menus (src/three/ui/home/icons.ts). Rendered stroked (not filled)
// by `.fd-tab svg` in navCss. home/shop reuse the exact paths from icons.ts (no drift); map is the
// brand flame (FLAME_ONLY), filled.
const TAB = {
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`,
  // Campaign = the mission ladder → a planted-objective flag (Lucide `flag`).
  campaign: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V4"/></svg>`,
  // Hall of Fame = the honour-roll medal (Lucide `award`).
  halloffame: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>`,
  // Map = the brand flame, chevron dropped (mirrors icons.ts FLAME_ONLY). Filled (not stroked)
  // via `.fd-tab .flame` in navCss; viewBox cropped to frame the flames in the 22px tab box.
  map: `<svg class="flame" viewBox="-0.3 -7.7 144 144" aria-hidden="true"><path d="M73.06,58.25c-18.59,21.04-34.35,33.63-22.6,64.65-21.97-11.26-29.05-37.71-17.05-59.08C46.45,40.59,68.12,28.39,69.08,0c16.8,18.38,20.62,39.42,3.98,58.25Z"/><path d="M78.83,107.06c-5.97,5.58-8.3,13.06-8.78,21.51-10.73-8.26-13.63-23.66-5.17-35.08,13.99-18.88,30.5-27.51,32.95-51.73,22.16,26.58,26.3,62.23-2.1,82.13,1.38-11.22,2.02-20.02-3.9-28.97l-12.99,12.14Z"/></svg>`,
  // Shop = the storefront bag (Lucide `shopping-bag`).
  shop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
};

// Appbar action glyphs (stroke, 24px) — mirror the home icons.ts `ic('trophy'|'settings')`.
const ic = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const TROPHY = ic('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>');
const SETTINGS = ic('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>');

/**
 * The sticky top appbar — brand mark + sitemap nav + a right-hand action slot. `active` marks the
 * current top-level item. `actions`:
 *   - 'app'  → the front door's leaderboard + settings icon buttons (wired by wireFrontAppbar; needs the
 *              game's home styles for `.iconbtn`). Use ONLY where the game bundle is present.
 *   - 'play' → a single "Fight the fire" CTA. Use on static pages (blog, legal) with no game bundle.
 */
/** Just the brand mark + sitemap nav (no `<header>` wrapper, no right-hand actions) — the reusable left
 *  half of the appbar. The live-fire map's merged top bar drops this in front of its own map controls so
 *  it wears the SAME logo+wordmark+nav as every page (`.fhome-nav` is desktop-only; mobile uses the tab
 *  bar). Needs the flame `<defs>` in scope (NAV_DEFS on a static page; the front door injects it). */
export function brandNavHtml(active = '') {
  const nav = NAV.filter((n) => n.key !== 'shop').map((n) => {
    const cur = n.key === active ? ' aria-current="page"' : '';
    return `<a class="fhome-nav-a" href="${n.href}"${cur}>${n.label}</a>`;
  }).join('');
  return (
    `<a class="fhome-brand" href="/" aria-label="Bucket My Fire — home"><span class="bmk">${FLAME}</span><b>Bucket My Fire</b></a>` +
    `<nav class="fhome-nav" aria-label="Primary">${nav}</nav>`
  );
}

export function appbarHtml({ active = '', actions = 'app' } = {}) {
  const shopItem = NAV.find((n) => n.key === 'shop');
  const shopCur = active === 'shop' ? ' aria-current="page"' : '';
  const shopLink = shopItem ? `<a class="fhome-shop" href="${shopItem.href}"${shopCur}>Shop</a>` : '';
  const right =
    actions === 'app'
      ? `<button class="iconbtn" data-front="board" type="button" aria-label="Leaderboard">${TROPHY}</button>` +
        `<button class="iconbtn" data-front="settings" type="button" aria-label="Settings">${SETTINGS}</button>`
      : actions === 'play'
        ? `<a class="fhome-cta" href="/?province=1">Fight the fire</a>`
        : ''; // 'none' → brand + nav only (editorial content pages that don't nudge readers into the game)
  return `<header class="fhome-bar">` + brandNavHtml(active) + `<span class="fhome-grow"></span>` + shopLink + right + `</header>`;
}

/** The mobile bottom tab bar (same four top-level destinations, icon + label, active marked). */
export function tabbarHtml(active = '') {
  const shop = NAV.find((n) => n.key === 'shop');
  const items = [
    { key: 'home', label: 'Home', href: '/', icon: TAB.home },
    { key: 'campaign', label: 'Campaign', href: '/campaign/', icon: TAB.campaign },
    { key: 'map', label: 'Map', href: '/?map', icon: TAB.map },
    // The mobile tab wears the short word (the 12-char "Hall of Fame" wraps in a 5-col bar on small
    // phones); the desktop nav + the page itself carry the full "Hall of Fame" name.
    { key: 'halloffame', label: 'Fireline', href: '/fireline/', icon: TAB.halloffame },
    { key: 'shop', label: 'Shop', href: shop ? shop.href : '/', icon: TAB.shop },
  ];
  return (
    `<nav class="fd-tabbar" aria-label="Primary">` +
    items
      .map((it) => {
        const cur = it.key === active ? ' aria-current="page"' : '';
        return `<a class="fd-tab" href="${it.href}"${cur}>${it.icon}<span>${it.label}</span></a>`;
      })
      .join('') +
    `</nav>`
  );
}

/** A compact icon + wordmark lockup for the footer — the same flame mark + "Bucket My Fire" wordmark
 *  as the appbar, sized down. The whole lockup links home. Needs the flame `<defs>` in scope (the front
 *  door injects the home DEFS; static blog/legal pages include NAV_DEFS). Styled by `.site-foot-brand`
 *  in navCss, so it reads identically in the front-door `.fd-foot` and the static `.fn-foot`. */
export function footerBrandHtml() {
  return (
    `<a class="site-foot-brand" href="/" aria-label="Bucket My Fire — home">` +
    `<span class="site-foot-mark">${FLAME}</span><b>Bucket My Fire</b></a>`
  );
}

/** A breadcrumb trail. Each crumb is `{label, href?}`; a crumb with no `href` is the current page. */
export function breadcrumbHtml(trail) {
  const parts = trail
    .map((c) => (c.href ? `<a href="${c.href}">${esc(c.label)}</a>` : `<span aria-current="page">${esc(c.label)}</span>`))
    .join('<span class="site-crumb-sep" aria-hidden="true">/</span>');
  return `<nav class="site-crumbs" aria-label="Breadcrumb">${parts}</nav>`;
}

/** Inject the shared nav stylesheet ONCE (client only; idempotent). Call after the kit/token vars are
 *  in scope. The legal renderer inlines `navCss` directly instead of calling this. */
export function injectNavStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('site-nav-css')) return;
  const s = document.createElement('style');
  s.id = 'site-nav-css';
  s.textContent = navCss;
  document.head.appendChild(s);
}

/** The appbar + mobile tab bar + breadcrumb CSS (token-driven, de-scoped so it works on the front-door
 *  app shell AND the static legal pages). The front door injects it (injectNavStyles); the legal
 *  renderer inlines it. One definition → no drift. */
export const navCss = `
/* ── Sticky top appbar ───────────────────────────────────────────────────────── */
.fhome-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 10px; min-height: 56px;
  max-width: 1080px; margin: 0 auto; padding: 10px max(14px, env(safe-area-inset-left));
  background: linear-gradient(180deg, rgba(7,10,13,0.92), rgba(7,10,13,0.4)); backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%); border-bottom: 1px solid var(--hair); }
.fhome-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); }
.fhome-brand .bmk { width: 30px; height: 30px; flex: 0 0 auto; display: grid; place-items: center; }
.fhome-brand .bmk .flame { width: auto; height: 28px; fill: url(#flameGrad); }
.fhome-brand b { font-family: var(--mono); font-weight: var(--fw-heavy); font-size: 13px; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; }
/* Keep the wordmark next to the mark at every width (the icon + wordmark IS the logo lockup); just
   tighten it on the narrowest phones so it never crowds the right-hand actions. */
@media (max-width: 400px) { .fhome-brand b { font-size: 11.5px; letter-spacing: .1em; } }
.fhome-grow { flex: 1; }
.fhome-nav { display: none; align-items: center; gap: 2px; }
@media (min-width: 760px) { .fhome-nav { display: inline-flex; } }
.fhome-nav-a { text-decoration: none; color: var(--dim); font-family: var(--mono); font-size: 11px; letter-spacing: .12em;
  text-transform: uppercase; font-weight: var(--fw-bold); padding: 10px 11px; min-height: 44px; display: inline-flex; align-items: center; }
.fhome-nav-a:hover { color: var(--ember-hi); }
.fhome-nav-a[aria-current="page"] { color: var(--text); }
/* Shop pill — right side of the desktop appbar, beside the action buttons. */
.fhome-shop { display: none; align-items: center; min-height: 36px; padding: 0 14px; border-radius: var(--r-lg);
  text-decoration: none; font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  font-weight: var(--fw-bold); color: var(--ember-hi); border: 1px solid color-mix(in srgb, var(--ember-hi) 35%, transparent); }
@media (min-width: 760px) { .fhome-shop { display: inline-flex; } }
.fhome-shop:hover { color: #fff; background: color-mix(in srgb, var(--ember-hi) 18%, transparent); }
/* "Fight the fire" CTA (static pages with no game bundle). */
.fhome-cta { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border-radius: var(--r-lg);
  text-decoration: none; font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  font-weight: var(--fw-heavy); color: var(--cta-ink); background: var(--cta); box-shadow: 0 1px 0 rgba(255,255,255,0.4) inset, 0 8px 20px var(--cta-glow); }
.fhome-cta:hover { color: var(--cta-ink); filter: brightness(1.05); }

/* ── Footer brand lockup (mini icon + wordmark) — shared by the front-door .fd-foot and the static
   .fn-foot, so every footer wears the same logo lockup as the appbar. Each footer is a wrapping flex
   row; the lockup is the last item (order 3), pushed to the right with margin-left:auto and sitting on
   the same bottom line as the policy links (align-self bottom; the front door re-centres it). ─────── */
.site-foot-brand { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; color: var(--text-subtle); margin: 0 0 0 auto; order: 3; align-self: end; }
.site-foot-mark { width: 20px; height: 22px; flex: 0 0 auto; display: grid; place-items: center; }
.site-foot-mark .flame { width: auto; height: 20px; fill: url(#flameGrad); }
.site-foot-brand b { font-family: var(--mono); font-weight: var(--fw-heavy); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
.site-foot-brand:hover b { color: var(--ember-hi); }

/* ── Breadcrumb trail (below the appbar on pages with a hierarchy) ─────────────── */
.site-crumbs { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .06em; color: var(--dim); margin: 0 0 18px; }
.site-crumbs a { color: var(--dim); text-decoration: none; }
.site-crumbs a:hover { color: var(--ember-hi); }
.site-crumbs span[aria-current="page"] { color: var(--text-subtle); }
.site-crumb-sep { opacity: .5; margin: 0 6px; }

/* ── Mobile bottom tab bar ────────────────────────────────────────────────────── */
.fd-tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: grid; grid-template-columns: repeat(5, 1fr);
  background: linear-gradient(180deg, rgba(7,10,13,0.86), rgba(7,10,13,0.98)); backdrop-filter: blur(12px) saturate(120%);
  -webkit-backdrop-filter: blur(12px) saturate(120%); border-top: 1px solid var(--hair); padding-bottom: env(safe-area-inset-bottom); }
@media (min-width: 760px) { .fd-tabbar { display: none; } }
.fd-tab { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 9px 4px 8px;
  text-decoration: none; color: var(--dim); min-height: 56px; }
.fd-tab svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
/* The Map glyph is the brand flame (a fill shape, not a Lucide stroke icon) — fill it instead of stroking. */
.fd-tab .flame { fill: currentColor; stroke: none; transform-box: fill-box; transform-origin: 50% 100%;
  animation: fd-flame-flicker 1.7s ease-in-out infinite; will-change: transform, opacity; }
/* A live flame: flicker from the base — gentle squash/lean/glow, transform+opacity only (no layout). */
@keyframes fd-flame-flicker {
  0%, 100% { transform: scale(1) skewX(0deg); opacity: 1; }
  20%      { transform: scale(1.05, 1.1) skewX(-2deg); opacity: 0.9; }
  45%      { transform: scale(0.97, 1.04) skewX(1.5deg); opacity: 1; }
  70%      { transform: scale(1.04, 1.07) skewX(-1deg); opacity: 0.94; }
}
@media (prefers-reduced-motion: reduce) { .fd-tab .flame { animation: none; } }
.fd-tab span { font-family: var(--mono); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.fd-tab[aria-current="page"] { color: var(--ember-hi); }
/* Clear the fixed tab bar on static pages (blog/legal use body.fn). The front door pads its own column. */
@media (max-width: 759px) { body.fn { padding-bottom: calc(72px + env(safe-area-inset-bottom)); } }

/* ── Page title card "hero" — the ONE first-card / page-title standard, shared by the front-door first
   cards (Home dossier, Campaign intro, Prepare checklist head) AND the blog + legal page titles. Every
   one leads with the same anatomy: an eyebrow, a headline, and a sub, with an optional lead slot
   (brand glyph / helmet / progress ring) and an optional trailing slot (rank pill / chevron). ─── */
.fd-hero { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; }
.fd-hero-lead { flex: 0 0 auto; display: grid; place-items: center; }
.fd-hero-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.fd-hero-eyebrow { margin: 0; font-family: var(--mono); font-size: var(--fs-label); letter-spacing: .28em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.fd-hero-head { margin: 0; font-size: clamp(24px, 3.6vw, 36px); font-weight: var(--fw-black); line-height: 1.08; letter-spacing: .01em; color: #fff; text-wrap: balance; }
.fd-hero-sub { margin: 0; font-size: clamp(13.5px, 1.5vw, 15.5px); line-height: 1.5; color: var(--text-subtle); max-width: 56ch; text-wrap: pretty; }
.fd-hero-sub b { color: var(--menu); font-weight: var(--fw-bold); }
.fd-hero-trail { flex: 0 0 auto; margin-left: auto; align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; }
`;
