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
 * OPEN SKIES, Map, Wear the fight, Hall of Fame) and adds the sitemap nav. Pure DOM, Three-free: the
 * ~1 MB game bundle downloads ONLY when a play link (?ffa / ?province / …) is followed.
 */
import { injectFonts } from './three/ui/fonts';
import { injectKitStyles } from './three/ui/components/base';
import { injectHomeStyles } from './three/ui/home/styles';
import { attachCardGlow } from './three/ui/fx/cardGlow';
import { navigateRail, openLiveFires, setMenuCatalog } from './three/ui/home/menus';
import { DEFS, ic } from './three/ui/home/icons';
import { loadProfile, availablePoints } from './three/ui/profile';
import { careerScore, rankFor } from './three/missions/rank';
import { provinceSessionId } from './three/province/buildProvince';
import { injectShellStyles, tabbarMarkup, buildFooter } from './site/shell';
import { brandNavHtml, tabbarHtml } from './site/siteNav.mjs';
import { injectFrontShell, frontScene, frontAppbar, spawnFrontEmbers, wireFrontAppbar } from './site/frontShell';
import { SPLASH_CSS, SPINNER_MARKUP, SPLASH_ATTRS } from './three/ui/spinner';
import { fetchSummary, fetchReportedFires, fetchActiveFires } from './three/livefire/client';
import { filterReportedCountry, filterCountry } from './three/livefire/normalize';
import { fmtInt, fmtHa, publishedWhen, LIVEFIRE_SOURCES } from './three/livefire/strings';
import type { NationalSummary, ReportedFeed, LiveFireFeed } from './three/livefire/types';

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
  injectShellStyles(); // shared chrome the home borrows: .fd-foot footer, .fd-tabbar mobile tab bar, the corner-cut .fd-mcard poster cards
  injectFrontShell(); // the SHARED front-door chrome (.bmf-app.front scroll shell + .fhome-bar appbar + scene/embers) — the same module Campaign + Hall of Fame use, so the front pages can't drift
  injectHomeBentoStyles(); // the home-ONLY bento grid + hero/play/ticker/map/merch/hof LAYOUT, scoped .bmf-app.front
  setMenuCatalog([]); // the Board reads this (campaign retired → empty; the board keys off live ids)

  const game = document.getElementById('game');
  if (!game) return;
  const app = document.createElement('div');
  app.className = 'bmf-app front';
  app.innerHTML = DEFS + homeMarkup();
  game.innerHTML = '';
  game.appendChild(app);
  document.getElementById('fd-boot')?.remove();

  spawnFrontEmbers(app, 13); // the ambient ember field (same helper Campaign + Hall of Fame use)
  wireFrontAppbar(app); // trophy → leaderboard, gear → settings (the appbar's two icon buttons)
  mountPilotBanner(app); // returning-pilot identity → the Open Skies card's top overlay banner (the dossier's new home)
  setPilotsLive(-1); // neutral "Open Skies live" until the realtime tally lands (no fabricated number)
  void hydratePilotsLive(); // count pilots flying in today's province RIGHT NOW (silent realtime listener)
  wire(app); // the bento data-act surfaces (Open Skies · Map · Shop)
  attachCardGlow(app); // faint cursor spotlight + floating glazing rim on the glass bento tiles
  void hydrateNational();
  if (params.has('map')) openMap(); // deep link from the nav's "Map" item (works from any page → /?map)
}

/** The returning-pilot identity, slimmed from the old full-width dossier card into the Open Skies card's
 *  top OVERLAY banner: callsign (primary) over a rank chip + spendable points (secondary). A first-run
 *  visitor gets an invite line instead. Populated into the `#fhome-pilot` (`.fpb-id`) slot; the callsign
 *  (the one user value) is set via textContent, never innerHTML. */
function mountPilotBanner(app: HTMLElement): void {
  const host = app.querySelector<HTMLElement>('#fhome-pilot');
  if (!host) return;
  const profile = loadProfile();
  if (!profile?.name) {
    host.classList.add('is-new');
    host.innerHTML = `<span class="fpb-cs">New pilot</span><span class="fpb-meta"><span class="fpb-hint">Fly to earn your rank</span></span>`;
    return;
  }
  const rank = rankFor(careerScore());
  host.innerHTML =
    `<span class="fpb-cs"></span>` +
    `<span class="fpb-meta">` +
    `<span class="rank" style="--rk:${rank.color}"><i></i>${rank.name}</span>` +
    `<span class="fpb-pts pts-ic mono">${ic('spark')}<b>${availablePoints().toLocaleString('en-US')}</b> pts</span>` +
    `</span>`;
  const cs = host.querySelector('.fpb-cs');
  if (cs) cs.textContent = profile.name.toUpperCase();
}

/** Paint the "N Pilots Live" presence chip on the Open Skies card. A real count (>=1) shows the number;
 *  0 / unknown / source-down falls back to a neutral "Open Skies live" (the mode is always live — the
 *  fires never stop) rather than a deflating "0" or a fabricated number (the honest-window rule applies
 *  to presence too). The live dot stays lit either way. Wired to the realtime channel by hydratePilotsLive(). */
function setPilotsLive(n: number): void {
  const el = document.getElementById('fhome-pilots-live');
  if (!el) return;
  const num = el.querySelector('b');
  const label = el.querySelector<HTMLElement>('span');
  if (n >= 1) {
    if (num) num.textContent = n.toLocaleString('en-US');
    if (label) label.textContent = n === 1 ? 'Pilot live' : 'Pilots live';
  } else {
    if (num) num.textContent = '';
    if (label) label.textContent = 'Open Skies live';
  }
}

/** A pilot counts as "live" if its pose arrived in the last 6s (poses broadcast at ~12 Hz); re-tally the
 *  chip every 4s so it tracks pilots joining + leaving. */
const LIVE_STALE_MS = 6000;
const LIVE_REFRESH_MS = 4000;

/** Live "N Pilots Live" presence on the Open Skies card. Opens the SAME realtime channel the game joins
 *  for today's Living Province (`os:prov-<region>-<ymd>`) as a SILENT LISTENER — we never broadcast a
 *  pose, so we never appear as a ghost; we just tally the pilots who do. `@supabase/realtime-js` is
 *  lazy-loaded here (after first paint) so the initial front-door JS stays light; the session id is
 *  already bundled (menus.ts uses it). Best-effort: an unconfigured Supabase or any failure leaves the
 *  neutral "Open Skies live" chip. */
async function hydratePilotsLive(): Promise<void> {
  let mod: typeof import('./three/net/openSkies');
  try {
    mod = await import('./three/net/openSkies');
  } catch {
    return; // realtime chunk failed to load → keep the neutral chip
  }
  if (!mod.openSkiesConfigured()) return; // no Supabase → no live presence (neutral chip stays)
  const net = mod.connectOpenSkies(provinceSessionId(new Date()), { id: 'fd-listener', name: '', heli: '' }, LIVE_STALE_MS);
  if (!net) return;
  const tick = (): void => setPilotsLive(net.remotes().length); // remotes() prunes stale, then we count
  const first = window.setTimeout(tick, 1400); // let peers broadcast a first pose before the first tally
  const iv = window.setInterval(tick, LIVE_REFRESH_MS);
  window.addEventListener(
    'pagehide',
    () => {
      window.clearTimeout(first);
      window.clearInterval(iv);
      net.close();
    },
    { once: true },
  );
}

function homeMarkup(): string {
  return `
${frontScene()}
<div class="fhome-bg" aria-hidden="true"><img src="/images/missions/saskatchewan/ThreeTown.webp" alt="" /></div>
${frontAppbar('home')}

<div class="pad fhome">
  <div class="fhome-grid">
    <!-- HERO — the live fire, right now. The data IS the hero (no CTA), written BARE (no card) directly over
         the full-page ThreeTown key-art. When both authoritative feeds are unreachable the live figure
         hides and an honest fallback takes its place (paintNational). Open Skies + the Map card carry nav. -->
    <section class="fhome-hero" aria-label="Wildfire across Canada, right now">
      <div class="fhome-tx">
        <div class="fhome-hero-top">
          <span class="badge ok" id="fd-live">Live</span>
          <span class="fhome-fresh" id="fd-fresh">CIFFC + CWFIS</span>
        </div>
        <h1 class="fhome-eyebrow fhome-hero-kick">Wildfires across Canada<br>Right now</h1>
        <!-- The live figure — hydrated by paintNational(). -->
        <div id="fhome-live">
          <div class="fhome-fig"><b id="ro-active">—</b><span>active fires</span></div>
          <div class="fhome-stats">
            <span class="fhome-stat hot"><b id="ro-oc">—</b><span>out of control</span></span>
            <span class="fhome-stat"><b id="ro-hot">—</b><span>satellite hotspots</span></span>
            <span class="fhome-stat"><b id="ro-area">—</b><span>burned this year</span></span>
            <span class="fhome-stat"><b id="ro-prep">—</b><span>prep level</span></span>
          </div>
        </div>
        <!-- Honest fallback when both feeds are down (not "no fires") — shown by paintNational. -->
        <p class="fhome-sub" id="fhome-fallback" hidden>Live totals are offline. Check official sources for the current picture.</p>
      </div>
    </section>

    <!-- Map — opens the full live wildfire tracker (layer toggles + smoke scrubber + detail sheet). The
         faint cyan cartographic grid (.fhome-map-grid) makes it read as a tactical map readout.
         DOM-ordered BEFORE the play tile so the MOBILE single-column stack reads hero → map → gameplay
         (the live data leads into the live map, then the game). Desktop is unaffected: every tile has an
         explicit grid-area, so the bento layout ignores source order. -->
    <button class="card fhome-map" data-act="fires" aria-label="Open the live wildfire map">
      <span class="fd-glasstex" aria-hidden="true"></span>
      <span class="fhome-map-grid" aria-hidden="true"></span>
      <span class="fhome-map-ic">${ic('map')}</span>
      <span class="fhome-map-tx"><b>Live fire map</b><span>Reported fires, hotspots, fire weather &amp; smoke</span></span>
      <span class="fhome-map-go">${ic('chevron-right')}</span>
    </button>

    <!-- OPEN SKIES — the play CTA over the live-fire key-art. A top OVERLAY banner carries the slimmed
         dossier (the pilot's identity: callsign + rank + points) on the left and the live presence
         ("N Pilots Live") on the right; the Open Skies copy + Fly CTA stay at the base. The banner's
         profile slot is populated by mountPilotBanner() (an invite line when first-run); the live count
         by hydratePilotsLive(). -->
    <button class="card warm cut fhome-play" data-act="coop" aria-label="Play Open Skies">
      <div class="fhome-art"><img src="/images/ui/homescreen-bg.webp" alt="A Bell helicopter with a slung Bambi bucket dropping water on a wildfire over boreal lake country" /></div>
      <div class="fhome-art-fade"></div>
      <div class="fhome-play-banner">
        <div class="fpb-id" id="fhome-pilot"></div>
        <span class="fpb-live" id="fhome-pilots-live" aria-live="polite"><i class="fpb-dot"></i><b>—</b><span>Pilots Live</span></span>
      </div>
      <div class="fhome-tx fhome-play-tx">
        <span class="h-big fhome-play-h">Open Skies</span>
        <span class="fhome-play-sub">Fly helicopters and fight the fire.</span>
        <span class="btn primary fhome-play-go">${ic('play')}Fly now</span>
      </div>
    </button>

    <!-- Wear the fight — the BIG shop feature card. The real merch poster (Wearthefight.png) is the art,
         cropped to the heli + firefighter so the poster's own baked "WEAR THE FIGHT" type sits below the
         frame and never clashes with our overlaid copy + Shop CTA. -->
    <button class="card warm cut fhome-merch" data-act="shop" aria-label="Open the BMF Gear store">
      <div class="fhome-merch-art"><img src="/images/shop/helidesigns/Wearthefight.png" alt="Wear the fight — a wildland firefighter and a Bell helicopter slinging a Bambi bucket over a forest fire" /></div>
      <div class="fhome-merch-fade"></div>
      <div class="fhome-tx fhome-merch-tx">
        <span class="fhome-merch-ey">${ic('shop')}BMF Gear</span>
        <span class="h-big fhome-merch-h">Wear the fight.</span>
        <span class="fhome-merch-sub">Tees &amp; hoodies, printed on demand.</span>
        <span class="btn primary fhome-merch-go">Shop the collection</span>
      </div>
    </button>

    <!-- Hall of Fame — a compact call-out to the tribute page: ten documented moments from Canada's
         wildfire history and the crews behind them. The full visual journey lives on /hall-of-fame/;
         this is the sharp hand-off, so the home stays the marketing surface. -->
    <a class="card warm cut fhome-hof" href="/hall-of-fame/">
      <div class="fhome-hof-tx">
        <span class="fhome-hof-ey">Hall of Fame</span>
        <span class="fhome-hof-h">The unsung warriors.</span>
        <span class="fhome-hof-sub">Ten moments that forged Canada's wildfire fight — and the crews who held the line.</span>
      </div>
      <span class="btn ghost fhome-hof-go">Enter the Hall →</span>
    </a>
  </div>

  ${buildFooter()}
</div>
${tabbarMarkup('home')}`;
}

/** Wire the bento data-act surfaces (all REUSE the built in-game builders). The appbar's board/settings
 *  buttons are wired separately by `wireFrontAppbar` (shared with Campaign + Hall of Fame). */
function wire(app: HTMLElement): void {
  app.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      switch (el.dataset.act) {
        case 'coop':
          // Open Skies is its own front-door PAGE now (open-skies/index.html → src/openskies/main.ts), built
          // in the same .fd-card system as Campaign — not an in-game overlay bolted under site chrome.
          location.assign('/open-skies/');
          return;
        case 'fires':
          return openMap(); // the full live-fire tracker, as a front-door page (brand bar + nav, Map active)
        case 'shop':
          return navigateRail('shop'); // the standalone storefront (same tab)
      }
    });
  });
}

/** Open the live-fire tracker as a FRONT-DOOR page: the merged top bar carries the logo + wordmark +
 *  sitemap nav (Map active), and the bottom tab bar marks Map too — so it reads like Home/Campaign,
 *  reachable from the nav on every page. Shared by the home 'Map' bento card AND the `/?map` deep link. */
function openMap(): void {
  openLiveFires(tabbarHtml('map'), brandNavHtml('map'));
}

// ── Live national-data grid ─────────────────────────────────────────────────────────────────────────

async function hydrateNational(): Promise<void> {
  const [summary, feed, hotspots] = await Promise.all([
    fetchSummary().catch(() => null),
    fetchReportedFires().catch(() => null),
    fetchActiveFires().catch(() => null),
  ]);
  paintNational(summary, feed, hotspots);
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

function paintNational(summary: NationalSummary | null, feed: ReportedFeed | null, hotspots: LiveFireFeed | null): void {
  const set = (id: string, text: string): void => {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  };
  const fresh = document.getElementById('fd-fresh');
  const live = document.getElementById('fhome-live');
  const fallback = document.getElementById('fhome-fallback');
  const badge = document.getElementById('fd-live');
  const summaryOk = !!summary && summary.meta.status === 'live';
  const feedOk = !!feed && feed.meta.status === 'live';

  // Both authoritative feeds down → the live figure is replaced by the honest fallback (NOT "no fires"),
  // and the freshness line points at the official sources. (The hotspot feed alone can't anchor the hero.)
  if (!summaryOk && !feedOk) {
    if (live) live.hidden = true;
    if (fallback) fallback.hidden = false;
    if (badge) badge.hidden = true;
    if (fresh) fresh.innerHTML = `Live data unavailable · <a href="${LIVEFIRE_SOURCES.summary.url}" target="_blank" rel="noopener">official sources →</a>`;
    return;
  }

  if (live) live.hidden = false;
  if (fallback) fallback.hidden = true;
  if (badge) badge.hidden = false;

  const { n: national, pub } = resolveNational(summary, feed);
  const oc = ocActive(feed);
  // Raw satellite heat detections (CWFIS) for Canada — the "hotspots" number, distinct from reported fires.
  const hot = hotspots && hotspots.meta.status === 'live' ? filterCountry(hotspots.hotspots, 'CA').length : -1;
  set('ro-active', national >= 0 ? fmtInt(national) : '—');
  set('ro-oc', oc >= 0 ? fmtInt(oc) : '—');
  set('ro-hot', hot >= 0 ? fmtInt(hot) : '—');
  set('ro-area', summaryOk && summary!.areaBurnedHa > 0 ? fmtHa(summary!.areaBurnedHa) : '—');
  set('ro-prep', summaryOk && summary!.prepLevel > 0 ? `L${summary!.prepLevel}` : '—');

  if (fresh) fresh.textContent = `${publishedWhen(pub)} · CIFFC + CWFIS`;
}

// ── Home-ONLY bento LAYOUT (the shared front-door chrome — scroll shell + appbar + scene/embers + the
//    `.pad.fhome` column + `.fhome-eyebrow` — now comes from injectFrontShell, the same module Campaign
//    and Hall of Fame use. This is just the home's bento grid + its data-hero/play/map/merch/hof tiles,
//    scoped `.bmf-app.front` so it never touches the in-game hub layout). ──

function injectHomeBentoStyles(): void {
  if (document.getElementById('fd-bento-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-bento-css';
  s.textContent = `
/* Bento grid. Grid items default to min-width:auto, so a nowrap child (the ticker line) or a
   horizontal scroller (the notes rail) would force the single 1fr column wider than the phone
   viewport and overflow the page. min-width:0 lets every card shrink to the column, and the
   inner overflow-x:auto scrollers keep their own scroll. (Inert on the desktop 2-col grid.) */
.bmf-app.front .fhome-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
.bmf-app.front .fhome-grid > * { min-width: 0; }
@media (min-width: 880px) {
  /* A balanced two-column bento: the data hero keeps a hair more room than the play tile, the
     map/hof row reads as even halves. Same cards, same tokens, spread to fill the band. */
  /* Row 1 = hero | gameplay (kept ABOVE THE FOLD). Row 2 = map | Hall of Fame. Row 3 = the BIG shop
     feature card across the full width (the poster art breathes at full bleed). */
  .bmf-app.front .fhome-grid { grid-template-columns: 1.04fr 1fr; grid-template-areas: "hero play" "map hof" "merch merch"; align-items: stretch; }
  .bmf-app.front .fhome-hero { grid-area: hero; }
  .bmf-app.front .fhome-play { grid-area: play; }
  .bmf-app.front .fhome-map { grid-area: map; }
  .bmf-app.front .fhome-merch { grid-area: merch; }
  .bmf-app.front .fhome-hof { grid-area: hof; }
  /* NOTE: the desktop VISUAL overrides (play aspect, hero height, headline size, one-row stats) live in a
     media block at the END of this stylesheet — they must come AFTER the base .fhome-play/.fhome-hero
     rules below or those (later, equal-specificity) would clobber them. */
}

/* The ThreeTown aerial key-art fills the WHOLE front door as a fixed cinematic background. Home ONLY — the
   other front pages don't emit .fhome-bg, so the shared frontShell .scene is untouched. It sits above .scene (z-0, painted
   later) and under .embers (z-1) + the content (z-2), so the embers drift over the photo and the bento
   floats above it. The scrim (::after) buys the BARE hero data its contrast now that it sits on the page
   instead of inside a card: it darkens the lower-left where the live figure + cards sit, leaving the
   fire plume + horizon lit. (Photographic scrims are art literals — same rgba(7,10,13) base as the fades.) */
.bmf-app.front .fhome-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
.bmf-app.front .fhome-bg img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 42%; display: block; }
.bmf-app.front .fhome-bg::after { content: ""; position: absolute; inset: 0;
  background:
    linear-gradient(180deg, rgba(7,10,13,0.34) 0%, rgba(7,10,13,0.55) 54%, rgba(7,10,13,0.86) 100%),
    linear-gradient(90deg, rgba(7,10,13,0.78) 0%, rgba(7,10,13,0.32) 52%, transparent 100%); }

/* Key-art backdrop for the Open Skies play tile (the hero now uses the page background instead): a
   RIGHT-TO-LEFT fade — dark down the full-height LEFT edge so BOTH the top banner info (New pilot) and the
   bottom copy (heading/sub/CTA) read — a bottom scrim for the base copy, and an extra bottom-LEFT radial
   pooling the darkest weight under the heading/CTA stack. */
.bmf-app.front .fhome-art { position: absolute; inset: 0; z-index: 0; }
.bmf-app.front .fhome-art img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 26%; display: block; }
.bmf-app.front .fhome-art-fade { position: absolute; inset: 0; z-index: 1; background:
  radial-gradient(125% 95% at 0% 100%, rgba(5,7,9,0.97) 0%, rgba(7,10,13,0.6) 26%, rgba(7,10,13,0.22) 52%, transparent 100%),
  linear-gradient(90deg, rgba(7,10,13,0.95) 0%, rgba(7,10,13,0.82) 26%, rgba(7,10,13,0.45) 62%, rgba(7,10,13,0.1) 100%),
  linear-gradient(0deg, rgba(7,10,13,0.68) 0%, rgba(7,10,13,0.32) 22%, transparent 50%); }
.bmf-app.front .fhome-tx { position: relative; z-index: 2; }

/* HERO — the live-data panel, BARE (no card) over the full-page ThreeTown key-art. The status row
   floats at the top; the live figure + supporting stats stack at the base over the page scrim. */
.bmf-app.front .fhome-hero { position: relative; min-height: 360px; display: flex; flex-direction: column; padding: 24px 18px; }
/* .fhome-tx fills the hero as a flex column so the status row (margin-bottom:auto) floats to the TOP and
   the live figure + stats sink to the BASE — mirroring the Open Skies card's top-banner / base-copy split,
   so the two row-1 tiles align: the Live badge sits level with the presence banner, the figure with the
   headline. (Was inert: .fhome-tx wasn't a flex column, so the whole block dropped to the bottom.) */
.bmf-app.front .fhome-hero .fhome-tx { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.bmf-app.front .fhome-hero-top { display: flex; align-items: center; gap: 10px; }
.bmf-app.front .fhome-hero-top .badge { flex: 0 0 auto; }
.bmf-app.front .fhome-fresh { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .04em; color: var(--faint); }
.bmf-app.front .fhome-fresh a { color: var(--ember-hi); text-decoration: none; }
.bmf-app.front .fhome-hero-kick { margin: 18px 0 0; max-width: 22ch; }
/* The live figure — the hero number leads, its unit label sits beside it on the baseline. */
.bmf-app.front .fhome-fig { display: flex; align-items: flex-end; gap: 12px; margin-top: 10px; }
.bmf-app.front .fhome-fig b { font-family: var(--mono); font-weight: var(--fw-black); font-size: clamp(52px, 9vw, 104px); line-height: .88; color: #fff; letter-spacing: -0.02em; text-shadow: 0 2px 18px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-fig span { font-size: clamp(15px, 1.8vw, 19px); line-height: 1.1; color: var(--text-subtle); max-width: 7ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }
/* Supporting stats — out-of-control (warn), hotspots, area, prep. Equal-width flex cells so they
   distribute evenly and wrap into a tidy 2×2 on a phone — alignment from the layout, no chrome. */
.bmf-app.front .fhome-stats { display: flex; flex-wrap: wrap; gap: 16px 24px; margin-top: 18px; }
.bmf-app.front .fhome-stat { flex: 1 1 0; min-width: 120px; display: flex; flex-direction: column; gap: 4px; }
.bmf-app.front .fhome-stat b { font-family: var(--mono); font-size: var(--fs-xl); font-weight: var(--fw-bold); color: var(--text); line-height: 1; text-shadow: 0 1px 8px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-stat.hot b { color: var(--warn); }
.bmf-app.front .fhome-stat span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
.bmf-app.front .fhome-sub { margin-top: 13px; font-size: clamp(14px, 1.5vw, 17px); line-height: 1.5; color: var(--text-subtle); max-width: 40ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }

/* OPEN SKIES play tile — key-art backdrop + the same fade. The top overlay banner (profile + live
   presence) and the base copy split top/bottom via space-between, both above the art/fade. */
/* Mobile: a content-sized card with a min-height FLOOR (was a hard 16/10 aspect that capped the box below
   its own content height, so overflow:hidden clipped the banner/CTA and buried the art). The card now grows
   to fit the banner + copy + Fly CTA and the key-art reads. Desktop overrides aspect-ratio:auto in the 880px
   band above; grid align-items:stretch sizes it there. */
.bmf-app.front .fhome-play { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; cursor: pointer; min-height: 420px; padding: 20px 17px; text-align: left; }
.bmf-app.front .fhome-play:hover { transform: translateY(-2px); }
/* Top overlay banner: profile cluster (left) + live presence chip (right). */
.bmf-app.front .fhome-play-banner { position: relative; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.bmf-app.front .fpb-id { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.bmf-app.front .fpb-cs { font-family: var(--mono); font-weight: var(--fw-black); font-size: var(--fs-lg); letter-spacing: .04em; color: #fff; line-height: 1;
  text-shadow: 0 1px 8px rgba(0,0,0,0.75); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14ch; }
.bmf-app.front .fpb-meta { display: inline-flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.bmf-app.front .fpb-pts { font-size: var(--fs-meta); color: var(--text-subtle); text-shadow: 0 1px 6px rgba(0,0,0,0.8); }
.bmf-app.front .fpb-hint { font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-subtle); text-shadow: 0 1px 6px rgba(0,0,0,0.8); }
/* Live presence chip — frosted pill so it reads over the bright part of the art; a pulsing "live" dot. */
.bmf-app.front .fpb-live { flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 7px; padding: 6px 10px; border-radius: var(--r-pill);
  background: rgba(7,10,13,0.62); border: 1px solid var(--hair); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .08em; text-transform: uppercase; color: var(--text-subtle); white-space: nowrap; }
.bmf-app.front .fpb-live b { color: #fff; font-weight: var(--fw-bold); font-size: var(--fs-sm); }
.bmf-app.front .fpb-live b:empty { display: none; }
.bmf-app.front .fpb-dot { align-self: center; width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--ok); box-shadow: 0 0 7px var(--ok); animation: fpb-pulse 1.8s ease-in-out infinite; }
@keyframes fpb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .bmf-app.front .fpb-dot { animation: none; } }
.bmf-app.front .fhome-play-tx { display: flex; flex-direction: column; align-items: flex-start; }
.bmf-app.front .fhome-play-ey { font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-Regular); }
.bmf-app.front .fhome-play-h { margin-top: 10px; font-size: clamp(24px, 3.2vw, 36px); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-play-sub { margin-top: 11px; font-size: 14px; line-height: 1.45; color: var(--text-subtle); max-width: 60ch; text-align: left; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }
.bmf-app.front .fhome-play-go { margin-top: 18px; pointer-events: none; }

/* Map entry — a tactical "map readout" tile (cool / instrument register, so it opts OUT of the warm
   cardGlow glaze in cardGlow.ts). A FAINT cyan cartographic grid blooms from behind the map icon and
   fades across the card; the grid + icon brighten on hover to make it pop. Every .card carries the
   corner-cut clip-path, which also clips the grid child to the notch (no overflow needed) — and clips
   any OUTER box-shadow, so the "pop" glow lives on the interior icon, not the card. */
.bmf-app.front .fhome-map { position: relative; isolation: isolate; display: flex; align-items: center; gap: 13px; cursor: pointer; text-align: left; width: 100%; padding: 16px 17px; }
.bmf-app.front .fhome-map > :not(.fhome-map-grid):not(.fd-glasstex) { position: relative; z-index: 1; }
.bmf-app.front .fhome-map-grid { position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background:
    repeating-linear-gradient(90deg, var(--accent-fill) 0 1px, transparent 1px 19px),
    repeating-linear-gradient(0deg, var(--accent-fill) 0 1px, transparent 1px 19px);
  -webkit-mask: radial-gradient(150% 150% at 9% 50%, #000 0%, rgba(0,0,0,0.42) 38%, transparent 78%);
  mask: radial-gradient(150% 150% at 9% 50%, #000 0%, rgba(0,0,0,0.42) 38%, transparent 78%);
  opacity: .8; transition: opacity .26s ease; }
.bmf-app.front .fhome-map:hover { transform: translateY(-2px); border-color: var(--accent); }
.bmf-app.front .fhome-map:hover .fhome-map-grid { opacity: 1; }
.bmf-app.front .fhome-map-ic { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border-radius: var(--r-sm); border: 1px solid var(--hair); background: var(--accent-fill); color: var(--accent); transition: box-shadow .26s ease, border-color .26s ease, color .26s ease; }
.bmf-app.front .fhome-map:hover .fhome-map-ic { border-color: var(--accent-soft); color: var(--accent-hi); box-shadow: var(--glow); }
.bmf-app.front .fhome-map-ic svg { width: 20px; height: 20px; }
.bmf-app.front .fhome-map-tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bmf-app.front .fhome-map-tx b { font-size: 14px; font-weight: var(--fw-heavy); color: #fff; }
.bmf-app.front .fhome-map-tx span { font-size: 12.5px; color: var(--dim); }
.bmf-app.front .fhome-map-go { margin-left: auto; color: var(--accent); }
.bmf-app.front .fhome-map-go svg { width: 18px; height: 18px; }

/* BIG shop feature card — the merch poster as the art, our copy + Shop CTA bottom-left over a fade
   (modelled on the play tile, warm register). A floor min-height on mobile; on desktop it runs the
   full width of the bottom row. The fades are art literals (same rgba(7,10,13) base as the
   other key-art fades in this file). */
.bmf-app.front .fhome-merch { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
  cursor: pointer; min-height: 280px; padding: 24px 22px; text-align: left; margin-top: 0; }
.bmf-app.front .fhome-merch:hover { transform: translateY(-2px); }
.bmf-app.front .fhome-merch-art { position: absolute; inset: 0; z-index: 0; }
.bmf-app.front .fhome-merch-art img { width: 100%; height: 100%; object-fit: cover; object-position: 64% 16%; display: block; }
.bmf-app.front .fhome-merch-fade { position: absolute; inset: 0; z-index: 1; background:
  linear-gradient(90deg, rgba(7,10,13,0.94) 0%, rgba(7,10,13,0.74) 32%, rgba(7,10,13,0.18) 66%, transparent 100%),
  linear-gradient(0deg, rgba(7,10,13,0.9) 0%, rgba(7,10,13,0.34) 38%, transparent 68%); }
.bmf-app.front .fhome-merch-tx { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: flex-start; }
.bmf-app.front .fhome-merch-ey { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 10.5px;
  letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fhome-merch-ey svg { width: 14px; height: 14px; }
.bmf-app.front .fhome-merch-h { margin-top: 9px; font-size: clamp(26px, 3vw, 40px); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-merch-sub { margin-top: 9px; font-size: 14px; line-height: 1.45; color: var(--text-subtle); max-width: 34ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }
.bmf-app.front .fhome-merch-go { margin-top: 16px; pointer-events: none; }
/* Hall of Fame tile — a compact warm call-out (eyebrow + headline + one line + ghost button) that
   hands off to the tribute page at /hall-of-fame/. The page owns the full timeline; this is just
   the sharp hand-off, so the home stays the marketing surface. */
.bmf-app.front .fhome-hof { display: flex; flex-direction: column; justify-content: center; gap: 13px; text-decoration: none; color: var(--text); padding: 18px 17px; }
.bmf-app.front .fhome-hof:hover { transform: translateY(-2px); border-color: var(--warm-stroke); }
.bmf-app.front .fhome-hof-tx { display: flex; flex-direction: column; gap: 5px; }
.bmf-app.front .fhome-hof-ey { font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fhome-hof-h { font-size: var(--fs-lg); font-weight: var(--fw-bold); color: #fff; line-height: 1.12; }
.bmf-app.front .fhome-hof-sub { font-size: 13px; line-height: 1.45; color: var(--text-subtle); max-width: 44ch; }
.bmf-app.front .fhome-hof-go { align-self: flex-start; pointer-events: none; }

/* Home hero (mobile + desktop): more breathing room above it, and the live data pulled DOWN so it sits close to the
   next card (the play tile) instead of floating high over the art with empty space below. */
.bmf-app.front .fhome-grid { padding-top: 22px; }
.bmf-app.front .fhome-hero .fhome-tx { justify-content: flex-end; }
.bmf-app.front .fhome-hero { padding-bottom: 12px; }

/* ── Desktop VISUAL overrides — placed AFTER the base .fhome-play / .fhome-hero rules above so they win
   on source order (media queries add no specificity). Row 1 (hero + gameplay) is one trim band that
   clears the fold: the play tile drops its portrait 4/5 aspect to a LANDSCAPE card sized to the hero. ── */
@media (min-width: 880px) {
  .bmf-app.front .fhome-play { aspect-ratio: auto; padding: 28px 30px; }
  .bmf-app.front .fhome-play-h { font-size: clamp(38px, 4.2vw, 56px); max-width: 9ch; line-height: .96; }
  .bmf-app.front .fhome-play-sub { max-width: 36ch; }
  .bmf-app.front .fhome-hero { min-height: 360px; padding: 24px 26px 14px; }
  /* The 4 supporting stats spread into ONE row across the wider hero (they still wrap 2×2 on a phone). */
  .bmf-app.front .fhome-hero .fhome-stat { min-width: 0; }
}
`;
  document.head.appendChild(s);
}
