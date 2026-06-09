/**
 * The FRONT DOOR controller — the light entry point `index.html` boots instead of the heavy game.
 *
 * It REUSES the in-game home's built component system (one visual language, no reinvention):
 *   - `injectHomeStyles()` gives the real glass-cockpit components — `.card`/`.cut`, the dossier
 *     `.helmet`+`.sheen`, the `.shopbanner` specular swipe, squared `.badge`/`.rank`, `.btn ember`.
 *   - the rich SURFACES are the same builders the game uses: the full live-fire tracker with its layer
 *     toggles + smoke scrubber + detail sheet (`openLiveFires`), the F1 leaderboard (`openBoard`), the
 *     settings panel (`openSettings`), and the Open Skies / Solo / Shop modes (`navigateRail`).
 * The front door composes those into the marketing bento (positioning hero, live national-data grid,
 * OPEN SKIES, Map, Wear the fight, Prepare) and adds the sitemap nav. Pure DOM, Three-free: the ~1 MB
 * game bundle downloads ONLY when a play link (?ffa / ?province / …) is followed.
 */
import { injectFonts } from './three/ui/fonts';
import { injectKitStyles } from './three/ui/components/base';
import { injectHomeStyles, spawnEmbers } from './three/ui/home/styles';
import { navigateRail, openSettings, openBoard, openLiveFires, setMenuCatalog } from './three/ui/home/menus';
import { DEFS, FLAME, HELMET, ic } from './three/ui/home/icons';
import { loadProfile } from './three/ui/profile';
import { careerScore, rankFor, nextRankProgress } from './three/missions/rank';
import { injectShellStyles, tabbarMarkup, buildFooter } from './site/shell';
import { mountBlogCarousel } from './site/blogCarousel';
import { SPLASH_CSS, SPINNER_MARKUP, SPLASH_ATTRS } from './three/ui/spinner';
import { fetchSummary, fetchReportedFires } from './three/livefire/client';
import { filterReportedCountry } from './three/livefire/normalize';
import { fmtInt, fmtHa, publishedWhen, LIVEFIRE_SOURCES } from './three/livefire/strings';
import type { NationalSummary, ReportedFeed } from './three/livefire/types';

const params = new URLSearchParams(location.search);

// Any of these params means "the visitor wants the GAME / a dev tool, not the front door" — hand the
// page straight to the existing 3D entry so every deep link AND the headless QA harness (?autostart /
// ?qa, the verify:render gate) boot exactly as before. A bare URL = the front door.
const GAME_PARAMS = ['m', 'autostart', 'qa', 'ffa', 'province', 'daily', 'editor', 'dev', 'heliview', 'kit', 'tune'];
const wantsGame = GAME_PARAMS.some((p) => params.has(p));

if (wantsGame) {
  queueMicrotask(enterGame);
} else {
  buildFrontDoor();
}

// ── Game handoff ──────────────────────────────────────────────────────────────────────────────────

let entering = false;
function enterGame(): void {
  if (entering) return;
  entering = true;
  document.body.classList.add('bmf-playing');
  const game = document.getElementById('game');
  if (game) game.innerHTML = '';
  document.getElementById('fd-boot')?.remove();
  if (!params.has('qa') && !params.has('autostart')) showGameSplash();
  void import('./three/main');
}

function showGameSplash(): void {
  if (document.getElementById('bmf-splash')) return;
  if (!document.getElementById('bmf-splash-css')) {
    const css = document.createElement('style');
    css.id = 'bmf-splash-css';
    css.textContent = SPLASH_CSS;
    document.head.appendChild(css);
  }
  const splash = document.createElement('div');
  for (const [k, v] of Object.entries(SPLASH_ATTRS)) splash.setAttribute(k, v);
  splash.innerHTML = SPINNER_MARKUP;
  document.body.appendChild(splash);
  const MIN_MS = 1100;
  const t0 = performance.now();
  let done = false;
  let pending = 0;
  const hide = (): void => {
    if (done) return;
    done = true;
    if (pending) clearTimeout(pending);
    splash.classList.add('bmf-hide');
    setTimeout(() => splash.remove(), 550);
  };
  const request = (): void => {
    if (done || pending) return;
    const left = MIN_MS - (performance.now() - t0);
    if (left <= 0) hide();
    else pending = window.setTimeout(hide, left);
  };
  window.addEventListener('bmf:ready', request);
  setTimeout(hide, 12000);
}

// ── Front door (the glass-cockpit home, on the real in-game components) ─────────────────────────────

function buildFrontDoor(): void {
  injectFonts();
  injectKitStyles();
  injectHomeStyles(); // the REAL component vocabulary (.card/.cut/.helmet/.sheen/.shopbanner/.badge/.btn)
  injectShellStyles(); // shared chrome the home borrows: .fd-foot footer, .fd-tabbar, the .fd-mcard notes cards
  injectFrontStyles(); // the front-door LAYOUT only (bento grid + nav + national grid), scoped .bmf-app.front
  setMenuCatalog([]); // the Board reads this (campaign retired → empty; the board keys off live ids)

  const game = document.getElementById('game');
  if (!game) return;
  const app = document.createElement('div');
  app.className = 'bmf-app front';
  app.innerHTML = DEFS + homeMarkup();
  game.innerHTML = '';
  game.appendChild(app);
  document.getElementById('fd-boot')?.remove();

  const embers = app.querySelector<HTMLElement>('.embers');
  if (embers) spawnEmbers(embers, 13);

  wire(app);
  void hydrateNational();
  void mountCarousel(app);
}

/** The returning-pilot dossier card — REUSED verbatim from HomeScreen (helmet + sheen + rank + career +
 *  advance bar). A first-run visitor gets an invite line instead. */
function dossierMarkup(): string {
  const profile = loadProfile();
  if (!profile?.name) {
    return (
      `<header class="card warm cut fhome-dossier">` +
      `<div class="row" style="gap:13px;align-items:center;">` +
      `<div class="brand">${FLAME}</div>` +
      `<div class="grow"><div class="h-screen" style="font-size:var(--fs-title)">New pilot</div>` +
      `<div class="mono" style="font-size:var(--fs-meta);color:var(--dim);margin-top:4px;">Fly once and you'll get a callsign, a rank, and a place on the board.</div></div>` +
      `</div></header>`
    );
  }
  const name = profile.name.toUpperCase();
  const pts = careerScore();
  const rank = rankFor(pts);
  const np = nextRankProgress(pts);
  const xpLine = np.next ? `${np.next.name} in ${np.remaining.toLocaleString('en-US')}` : 'Top rank';
  return (
    `<header class="card warm cut fhome-dossier">` +
    `<div class="row rise" style="gap:13px;">` +
    `<div class="helmet"><div class="clip">${HELMET}<span class="sheen"></span></div></div>` +
    `<div class="grow">` +
    `<div class="row wrap" style="gap:9px;"><span class="h-screen">${name}</span><span class="rank" style="--rk:${rank.color}"><i></i>${rank.name}</span></div>` +
    `<div class="row mono" style="gap:8px;margin-top:7px;font-size:var(--fs-meta);color:var(--dim);"><span><b style="color:var(--menu);font-weight:var(--fw-bold)">${pts.toLocaleString('en-US')}</b> pts</span><span>·</span><span>Career</span></div>` +
    `</div></div>` +
    `<div style="margin-top:14px;"><div class="barrow"><span class="l">Rank advance</span><span class="r">${xpLine}</span></div>` +
    `<div class="bar"><i style="width:${Math.round(np.frac * 100)}%"></i></div></div>` +
    `</header>`
  );
}

function homeMarkup(): string {
  const navLinks =
    `<a class="fhome-nav-a" href="/" aria-current="page">Home</a>` +
    `<a class="fhome-nav-a" href="/campaign/">Campaign</a>` +
    `<a class="fhome-nav-a" href="/prepare/">Prepare</a>` +
    `<a class="fhome-nav-a shop" href="https://shop.bucketmyfire.com/?utm_source=bucketmyfire&utm_medium=frontdoor&utm_campaign=nav">Shop</a>`;

  return `
<div class="scene"></div><div class="embers"></div>
<header class="fhome-bar">
  <a class="brand fhome-brand" href="/" aria-label="Bucket My Fire — home"><span class="bmk">${FLAME}</span><b>BUCKET MY FIRE</b></a>
  <nav class="fhome-nav" aria-label="Primary">${navLinks}</nav>
  <span class="grow"></span>
  <button class="iconbtn" data-act="board" aria-label="Leaderboard">${ic('trophy')}</button>
  <button class="iconbtn" data-act="settings" aria-label="Settings">${ic('settings')}</button>
</header>

<div class="pad fhome">
  ${dossierMarkup()}

  <div class="fhome-grid">
    <!-- Hero — the brand claim over the dawn key-art; copy left over a right-to-left fade. -->
    <section class="card warm cut fhome-hero">
      <div class="fhome-art"><img src="/images/missions/saskatchewan/FirstLight.webp" alt="A helicopter with a slung water bucket over a dawn boreal lake, wildfire smoke beyond" /></div>
      <div class="fhome-art-fade"></div>
      <div class="fhome-tx">
        <p class="fhome-eyebrow">Free · in your browser</p>
        <h1 class="fhome-head">Fight the fire.</h1>
        <p class="fhome-sub">Experience the thrill of real-3D helicopter firefighting.</p>
      </div>
    </section>

    <!-- National-data TICKER — slim live CIFFC strip (scrolls horizontally on a phone). -->
    <section class="card metal fhome-ticker" aria-label="Live national wildfire data">
      <span class="badge ok" id="fd-live">Live</span>
      <span class="fhome-tk"><b id="ro-active">—</b> active</span>
      <span class="fhome-tk hot"><b id="ro-oc">—</b> out of control</span>
      <span class="fhome-tk"><b id="ro-area">—</b> burned this yr</span>
      <span class="fhome-tk"><b id="ro-prep">—</b> prep level</span>
      <span class="fhome-tk dim" id="fd-fresh">CIFFC + CWFIS</span>
    </section>

    <!-- OPEN SKIES — the play CTA over the live-fire key-art; copy left over a right-to-left fade. -->
    <button class="card warm cut fhome-play" data-act="coop" aria-label="Play Open Skies">
      <div class="fhome-art"><img src="/images/missions/saskatchewan/Backburn.webp" alt="A helicopter dropping water on a burning forest at dusk" /></div>
      <div class="fhome-art-fade"></div>
      <div class="fhome-tx fhome-play-tx">
        <span class="fhome-play-ey">Fly · live fire</span>
        <span class="h-big fhome-play-h">Open Skies</span>
        <span class="fhome-play-sub">Take the controls over live fire. The fires never stop.</span>
        <span class="btn primary fhome-play-go">${ic('play')}Fly now</span>
      </div>
    </button>

    <!-- Map — opens the full live wildfire tracker (layer toggles + smoke scrubber + detail sheet). -->
    <button class="card fhome-map" data-act="fires" aria-label="Open the live wildfire map">
      <span class="fhome-map-ic">${ic('map')}</span>
      <span class="fhome-map-tx"><b>Live fire map</b><span>Reported fires, hotspots, fire weather &amp; smoke</span></span>
      <span class="fhome-map-go">${ic('chevron-right')}</span>
    </button>

    <!-- Wear the fight — the shopbanner (specular swipe). -->
    <button class="shopbanner card warm cut fhome-merch" data-act="shop" aria-label="Open the BMF Gear store">
      <span class="sb-ic">${ic('shop')}</span>
      <span class="sb-copy"><span class="sb-title">Wear the fight.</span><span class="sb-sub">Tees &amp; hoodies, printed on demand.</span></span>
      <span class="sb-go">${ic('chevron-right')}</span>
    </button>

    <!-- Prepare row — the 15-min checklist promo + the Field Notes rail. -->
    <a class="card warm cut fhome-prep" href="/prepare/#checklist">
      <p class="fhome-eyebrow">Prepare</p>
      <span class="h-big" style="font-size:var(--fs-hero)">15 minutes to ready</span>
      <span class="fhome-prep-b">An interactive wildfire-readiness checklist. Six concrete actions that lower your wildfire risk.</span>
      <span class="fhome-prep-go">Start the checklist →</span>
    </a>
    <section class="card fhome-notes">
      <div class="sec"><span class="tag">Field Notes</span><span class="line"></span></div>
      <div class="fd-rail" id="fd-notes-rail"></div>
    </section>
  </div>

  ${buildFooter()}
</div>
${tabbarMarkup('home')}`;
}

/** Wire the data-act surfaces (all REUSE the built in-game builders) + the sitemap nav. */
function wire(app: HTMLElement): void {
  app.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      switch (el.dataset.act) {
        case 'coop':
          return navigateRail('coop'); // Open Skies — the live shared shift (pick aircraft → Fly)
        case 'fires':
          return openLiveFires(); // the full live-fire tracker (layers + smoke scrubber + detail)
        case 'shop':
          return navigateRail('shop'); // the standalone storefront (same tab)
        case 'board':
          return openBoard(); // the F1 timing-tower leaderboard
        case 'settings':
          return openSettings(); // sound / reduced-motion / callsign / cloud / reset
      }
    });
  });
}

async function mountCarousel(app: HTMLElement): Promise<void> {
  const rail = app.querySelector<HTMLElement>('#fd-notes-rail');
  if (rail) await mountBlogCarousel(rail);
}

// ── Live national-data grid ─────────────────────────────────────────────────────────────────────────

async function hydrateNational(): Promise<void> {
  const [summary, feed] = await Promise.all([
    fetchSummary().catch(() => null),
    fetchReportedFires().catch(() => null),
  ]);
  paintNational(summary, feed);
}

function resolveNational(summary: NationalSummary | null, feed: ReportedFeed | null): { n: number; pub: number } {
  if (feed && feed.meta.status === 'live') return { n: filterReportedCountry(feed.fires, 'CA').length, pub: feed.meta.publishedAt };
  if (summary && summary.meta.status === 'live') return { n: summary.activeFires, pub: summary.meta.publishedAt };
  return { n: -1, pub: 0 };
}

/** Out-of-control fires reported in Canada (stage OC) — the "how bad" national number. -1 unavailable. */
function ocActive(feed: ReportedFeed | null): number {
  if (!feed || feed.meta.status !== 'live') return -1;
  return filterReportedCountry(feed.fires, 'CA').filter((f) => f.stage === 'OC').length;
}

function paintNational(summary: NationalSummary | null, feed: ReportedFeed | null): void {
  const set = (id: string, text: string): void => {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  };
  const fresh = document.getElementById('fd-fresh');
  const summaryOk = !!summary && summary.meta.status === 'live';
  const feedOk = !!feed && feed.meta.status === 'live';

  if (!summaryOk && !feedOk) {
    set('ro-active', '—');
    set('ro-oc', '—');
    set('ro-area', '—');
    set('ro-prep', '—');
    if (fresh) fresh.innerHTML = `Live data unavailable · <a href="${LIVEFIRE_SOURCES.summary.url}" target="_blank" rel="noopener">official sources →</a>`;
    return;
  }

  const { n: national, pub } = resolveNational(summary, feed);
  const oc = ocActive(feed);
  set('ro-active', national >= 0 ? fmtInt(national) : '—');
  set('ro-oc', oc >= 0 ? fmtInt(oc) : '—');
  set('ro-area', summaryOk && summary!.areaBurnedHa > 0 ? fmtHa(summary!.areaBurnedHa) : '—');
  set('ro-prep', summaryOk && summary!.prepLevel > 0 ? `L${summary!.prepLevel}` : '—');

  if (fresh) fresh.textContent = `${publishedWhen(pub)} · CIFFC`;
}

// ── Front-door LAYOUT only (the components come from injectHomeStyles; this is the bento + nav + grid,
//    scoped `.bmf-app.front` so it never touches the in-game home's fixed-viewport hub layout). ──

function injectFrontStyles(): void {
  if (document.getElementById('fd-front-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-front-css';
  s.textContent = `
/* Override the in-game hub's fixed full-viewport shell: the front door is a SCROLLING content page. */
.bmf-app.front { position: relative; inset: auto; height: auto; min-height: 100dvh; overflow: visible; display: block; }
.bmf-app.front .scene { position: fixed; }
.bmf-app.front .embers { position: fixed; }

/* Sitemap appbar (sticky). */
.bmf-app.front .fhome-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 10px; min-height: 56px;
  max-width: 1080px; margin: 0 auto; padding: 10px max(14px, env(safe-area-inset-left));
  background: linear-gradient(180deg, rgba(7,10,13,0.92), rgba(7,10,13,0.4)); backdrop-filter: blur(10px) saturate(120%); -webkit-backdrop-filter: blur(10px) saturate(120%); border-bottom: 1px solid var(--hair); }
.bmf-app.front .fhome-brand { gap: 10px; }
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
.bmf-app.front .fhome-dossier { margin: 0; }

/* Bento grid. */
.bmf-app.front .fhome-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 880px) {
  .bmf-app.front .fhome-grid { grid-template-columns: 1.05fr 1fr; grid-template-areas: "hero play" "ticker ticker" "map merch" "prep notes"; align-items: stretch; }
  .bmf-app.front .fhome-hero { grid-area: hero; }
  .bmf-app.front .fhome-play { grid-area: play; }
  .bmf-app.front .fhome-ticker { grid-area: ticker; }
  .bmf-app.front .fhome-map { grid-area: map; }
  .bmf-app.front .fhome-merch { grid-area: merch; }
  .bmf-app.front .fhome-prep { grid-area: prep; }
  .bmf-app.front .fhome-notes { grid-area: notes; }
}
.bmf-app.front .fhome-eyebrow { margin: 0 0 11px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fhome-eyebrow.cool { color: var(--accent); }

/* Shared key-art backdrop (hero + play): image with a RIGHT-TO-LEFT fade so the LEFT copy reads. */
.bmf-app.front .fhome-art { position: absolute; inset: 0; z-index: 0; }
.bmf-app.front .fhome-art img { width: 100%; height: 100%; object-fit: cover; object-position: 64% center; display: block; }
.bmf-app.front .fhome-art-fade { position: absolute; inset: 0; z-index: 1; background:
  linear-gradient(90deg, rgba(7,10,13,0.95) 0%, rgba(7,10,13,0.82) 26%, rgba(7,10,13,0.45) 62%, rgba(7,10,13,0.1) 100%),
  linear-gradient(0deg, rgba(7,10,13,0.45) 0%, transparent 36%); }
.bmf-app.front .fhome-tx { position: relative; z-index: 2; }

/* Hero — big, copy stacked at the base over the fade. */
.bmf-app.front .fhome-hero { position: relative; overflow: hidden; min-height: 360px; display: flex; flex-direction: column; justify-content: flex-end; padding: 24px; }
.bmf-app.front .fhome-head { font-size: clamp(30px, 4.2vw, 52px); line-height: 1.02; color: #fff; max-width: 16ch; text-wrap: balance; text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-sub { margin-top: 13px; font-size: clamp(14px, 1.5vw, 17px); line-height: 1.5; color: var(--text-subtle); max-width: 40ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }

/* OPEN SKIES play tile — key-art backdrop + the same fade, copy at the base. */
.bmf-app.front .fhome-play { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; cursor: pointer; min-height: 360px; padding: 24px; text-align: left; }
.bmf-app.front .fhome-play:hover { transform: translateY(-2px); }
.bmf-app.front .fhome-play-tx { display: flex; flex-direction: column; align-items: flex-start; }
.bmf-app.front .fhome-play-ey { font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fhome-play-h { margin-top: 10px; font-size: clamp(30px, 4.2vw, 50px); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-play-sub { margin-top: 11px; font-size: 14px; line-height: 1.45; color: var(--text-subtle); max-width: 24ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }
.bmf-app.front .fhome-play-go { margin-top: 18px; pointer-events: none; }

/* National-data TICKER — slim live strip, horizontal scroll on a phone. */
.bmf-app.front .fhome-ticker { display: flex; align-items: center; gap: 0; padding: 0 6px; min-height: 48px; overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
.bmf-app.front .fhome-ticker::-webkit-scrollbar { display: none; }
.bmf-app.front .fhome-ticker .badge { flex: 0 0 auto; margin: 0 10px; }
.bmf-app.front .fhome-tk { flex: 0 0 auto; padding: 0 14px; font-family: var(--mono); font-size: var(--fs-meta); color: var(--dim); border-left: 1px solid var(--hair); }
.bmf-app.front .fhome-ticker .badge + .fhome-tk { border-left: 0; }
.bmf-app.front .fhome-tk b { color: var(--text); font-weight: var(--fw-bold); font-size: var(--fs-md); }
.bmf-app.front .fhome-tk.hot b { color: var(--warn); }
.bmf-app.front .fhome-tk.dim { color: var(--faint); }
.bmf-app.front .fhome-tk a { color: var(--ember-hi); text-decoration: none; }

/* Map entry. */
.bmf-app.front .fhome-map { display: flex; align-items: center; gap: 13px; cursor: pointer; text-align: left; width: 100%; padding: 16px 17px; }
.bmf-app.front .fhome-map:hover { transform: translateY(-2px); border-color: var(--accent); }
.bmf-app.front .fhome-map-ic { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border-radius: var(--r-sm); border: 1px solid var(--hair); background: rgba(103,232,255,0.08); color: var(--accent); }
.bmf-app.front .fhome-map-ic svg { width: 20px; height: 20px; }
.bmf-app.front .fhome-map-tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bmf-app.front .fhome-map-tx b { font-size: 14px; font-weight: var(--fw-heavy); color: #fff; }
.bmf-app.front .fhome-map-tx span { font-size: 12.5px; color: var(--dim); }
.bmf-app.front .fhome-map-go { margin-left: auto; color: var(--accent); }
.bmf-app.front .fhome-map-go svg { width: 18px; height: 18px; }

/* Prepare promo + notes rail. */
.bmf-app.front .fhome-merch { margin-top: 0; }
.bmf-app.front .fhome-prep { display: flex; flex-direction: column; text-decoration: none; color: var(--text); padding: 18px 19px; }
.bmf-app.front .fhome-prep-b { margin-top: 9px; font-size: 13px; line-height: 1.5; color: var(--text-subtle); flex: 1; }
.bmf-app.front .fhome-prep-go { margin-top: 14px; color: var(--ember-hi); font-weight: var(--fw-bold); font-size: 13.5px; }
.bmf-app.front .fhome-prep:hover .fhome-prep-go { color: var(--menu); }
.bmf-app.front .fhome-notes { display: flex; flex-direction: column; }
.bmf-app.front .fhome-notes .fd-rail { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 4px; scrollbar-width: none; }
.bmf-app.front .fhome-notes .fd-rail::-webkit-scrollbar { display: none; }
.bmf-app.front .fhome-notes .fd-mcard { scroll-snap-align: start; flex: 0 0 78%; max-width: 320px; }
@media (min-width: 760px) { .bmf-app.front .fhome-notes .fd-mcard { flex-basis: 46%; } }

/* The footer reads on the dark page (shell's .fd-foot, just ensure spacing in this column). */
.bmf-app.front .fd-foot { margin-top: 6px; }
`;
  document.head.appendChild(s);
}
