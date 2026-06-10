/**
 * HomeScreen — the branded main-menu HUB. A warm "fight"-register dispatch board: the pilot dossier
 * (callsign · rank · career · global rank · XP) + the PROVINCE Mission card (the game's open-world front
 * door), with the gear promo below and a fixed bottom RAIL (Home · Open Skies · Solo · Hangar · Shop).
 * Single-viewport / no-scroll per CLAUDE.md.
 *
 * Pure DOM over the shared `.bmf-app` stylesheet (styles.ts) — no Three. The Mission card + rail tabs open
 * the branded panels (menus.ts): Open Skies is the live shared lobby, Solo picks a map to fly alone, Shop
 * is its own screen; Board + Settings live on the dossier card. main.ts stays the routing authority.
 */
import type { MissionDef } from '../../missions/types';
import { loadProfile, availablePoints, MAPS } from '../profile';
import { PROVINCE_COPY } from '../../province/strings';
import { careerScore, rankFor, nextRankProgress } from '../../missions/rank';
import { isConfigured, fetchCareerStanding } from '../../leaderboard/client';
import { setMenuCatalog, navigateRail, openSettings, openBoard, openLiveFires } from './menus';
import { railNav } from './rail';
import { injectHomeStyles, spawnEmbers } from './styles';
import { DEFS, FLAME, FLAME_ONLY, HELMET, ic } from './icons';
import { fetchActiveFires, fetchSummary, getCountryPref } from '../../livefire/client';
import { filterCountry, countFires, countryLabel } from '../../livefire/normalize';
import { LIVEFIRE_COPY } from '../../livefire/strings';

export class HomeScreen {
  private root: HTMLDivElement;
  private disposed = false;

  constructor(parent: HTMLElement, catalog: MissionDef[]) {
    injectHomeStyles();
    // Seed the rail router: the catalog the Board reads (now empty — the campaign retired; the board
    // keys off the live province/daily ids). No mission-fly hook anymore (no campaign cards to fly).
    setMenuCatalog(catalog);
    this.root = document.createElement('div');
    this.root.className = 'bmf-app home';
    this.root.innerHTML = DEFS + this.markup();
    parent.appendChild(this.root);
    const embers = this.root.querySelector<HTMLElement>('.embers');
    if (embers) spawnEmbers(embers, 13);
    this.wire();
    this.loadGlobalRank();
    this.loadLiveFires();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
  }

  // ---- markup ----------------------------------------------------------------
  private markup(): string {
    const profile = loadProfile();
    const name = (profile?.name || 'Pilot').toUpperCase();

    const pts = careerScore();
    const wallet = availablePoints(); // the spendable points balance (career minus what's been spent on aircraft)
    const rank = rankFor(pts);
    const np = nextRankProgress(pts);
    const xpLine = np.next ? `${np.next.name} in ${np.remaining.toLocaleString('en-US')}` : 'Top rank';

    // The home hero is the PROVINCE front door now (the campaign retired — the province IS the game).
    // Backdrop = the region's map-card art; the copy is the locked creative-director slate (strings.ts).
    const regionName = MAPS[0].name;
    const provinceImg = MAPS[0].imageUrl;

    // A neutral loading skeleton, never a "#–" stub (which reads as broken for the async beat). loadGlobalRank()
    // settles it to a real "#N Global" or drops the badge when there's no standing yet.
    const grank = isConfigured() ? `<div class="badge grank loading" aria-hidden="true"><span class="sk"></span></div>` : '';

    return `
<div class="scene"></div><div class="embers"></div>
<div class="pad">

  <!-- profile -->
  <header class="card warm cut rise d1">
    <div class="row between">
      <div class="brand">${FLAME}</div>
      <div class="row" style="gap:8px;">
        ${grank}
        <button class="iconbtn" data-act="board" aria-label="Leaderboard">${ic('trophy')}</button>
        <button class="iconbtn" data-act="settings" aria-label="Settings">${ic('settings')}</button>
      </div>
    </div>
    <div class="row rise" style="gap:13px;margin-top:12px;">
      <div class="helmet"><div class="clip">${HELMET}<span class="sheen"></span></div></div>
      <div class="grow">
        <div class="row wrap" style="gap:9px;"><span class="h-screen">${name}</span><span class="rank" style="--rk:${rank.color}"><i></i>${rank.name}</span></div>
        <div class="row mono" style="gap:8px;margin-top:7px;font-size:var(--fs-meta);color:var(--dim);"><span class="pts-ic">${ic('spark')}<b>${wallet.toLocaleString('en-US')}</b> pts</span><span>·</span><span>${pts.toLocaleString('en-US')} Career</span></div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <div class="barrow"><span class="l">Rank advance</span><span class="r">${xpLine}</span></div>
      <div class="bar"><i style="width:${Math.round(np.frac * 100)}%"></i></div>
    </div>
  </header>

  <div class="zone z-fires">
  <!-- LIVE wildfire tracker — today's REAL Saskatchewan fires (CWFIS). Rides high (under the dossier,
       above the Dispatch hero) so "what's burning now" motivates the FLY below. The count settles in
       via loadLiveFires(); the banner opens the full tracker overlay (openLiveFires). The firebanner
       class keeps it visible on cramped windows (it must NOT inherit the shop banner's short-win hide). -->
  <button class="shopbanner firebanner card warm cut rise d2" data-act="fires" aria-label="Live wildfire tracker">
    <span class="sb-ic">${ic('fire')}</span>
    <span class="sb-copy">
      <span class="sb-title">${LIVEFIRE_COPY.title}</span>
      <span class="sb-sub" data-lf-count>${LIVEFIRE_COPY.bannerLoading}</span>
    </span>
    <span class="sb-go">${ic('chevron-right')}</span>
  </button>
  </div>

  <div class="zone z-cont">
  <!-- the province MISSION CARD — the game's open-world front door (pick aircraft → fly the shift) -->
  <div class="sec rise d2"><span class="tag">Dispatch</span><span class="line"></span><span class="stamp">${regionName}</span></div>
  <article class="artcard rise d2" data-act="province">
    ${provinceImg ? `<img class="img" src="${provinceImg}" alt="">` : `<div class="fallback"><b>SK</b></div>`}
    <div class="scrim"></div>
    <div class="brackets"><i></i><i></i><i></i></div>
    <div class="inner">
      <div class="row" style="gap:7px;"><span class="chip">${FLAME_ONLY}${PROVINCE_COPY.chip}</span><span class="chip ghost reg">${ic('pin')}${regionName}</span></div>
      <div class="grow" style="min-height:8px;"></div>
      <h2 class="h-big">${PROVINCE_COPY.headline}</h2>
      <p class="clamp2" style="margin-top:8px;font-size:var(--fs-body);line-height:1.42;color:var(--text-subtle);max-width:32ch;text-shadow:0 1px 6px rgba(0,0,0,0.75);">${PROVINCE_COPY.sub}</p>
      <button class="btn ember block" style="margin-top:14px;" data-act="province">${ic('play')}${PROVINCE_COPY.cta}</button>
    </div>
  </article>
  </div>

  <div class="zone z-shop">
  <!-- gear promo — opens the standalone bucketmyfire storefront. Desktop shows the section label; the
       banner shows on phone/tablet too and drops only on the shortest viewports (styles.ts). -->
  <div class="sec shop-sec rise d3"><span class="tag">BMF Gear</span><span class="line"></span><span class="stamp">Coming soon</span></div>
  <button class="shopbanner card warm cut rise d3" data-act="shop" aria-label="Open the BMF Gear store">
    <span class="sb-ic">${ic('shop')}</span>
    <span class="sb-copy">
      <span class="sb-title">Wear the fight.</span>
      <span class="sb-sub">Crew-grade gear, printed on demand.</span>
    </span>
    <span class="sb-go">${ic('chevron-right')}</span>
  </button>
  </div>

</div>

${railNav('home')}`;
  }

  // ---- wiring ----------------------------------------------------------------
  private wire(): void {
    // Content actions (boot a mission / open the wizard) route through the HomeNav callbacks.
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.act(el.dataset.act || '');
      });
    });
    // Rail tabs route through the shared menu router so the rail stays live across every panel.
    this.root.querySelectorAll<HTMLElement>('.rail [data-rail]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateRail(el.dataset.rail || 'home');
      });
    });
  }

  private act(name: string): void {
    switch (name) {
      case 'province':
        return navigateRail('coop'); // open the province lobby (pick aircraft → Fly)
      case 'shop':
        return navigateRail('shop'); // navigates to the standalone bucketmyfire storefront in the same tab
      case 'fires':
        return openLiveFires(); // the live wildfire tracker overlay
      case 'board':
        return openBoard();
      case 'settings':
        return openSettings();
    }
  }

  private loadGlobalRank(): void {
    const el = this.root.querySelector<HTMLElement>('.grank');
    if (!el) return; // unconfigured → no badge was rendered
    // Settle the loading skeleton to a real standing, or drop the badge when there's none yet — the dossier
    // never carries a "#–" / perpetually-spinning placeholder.
    const settle = (rank: number | null): void => {
      if (this.disposed) return;
      if (rank == null) {
        el.remove();
        return;
      }
      el.classList.remove('loading');
      el.removeAttribute('aria-hidden');
      el.innerHTML = `<b>#${rank}</b><span>Global</span>`;
    };
    const p = loadProfile();
    if (!p?.name) {
      settle(null);
      return;
    }
    fetchCareerStanding(p.name)
      .then((s) => settle(s ? s.rank : null))
      .catch(() => settle(null));
  }

  /** Settle the home banner's count line from the live feed (best-effort, like loadGlobalRank). Prefers
   *  the AUTHORITATIVE CIFFC national summary ("95 active fires · 148k ha burned this year"); if that's
   *  unreachable it falls back to the satellite clustered count. The banner stays tappable in every state
   *  (it's the entry point to the full tracker overlay) — a quiet/offline result just softens the line. */
  private loadLiveFires(): void {
    const el = this.root.querySelector<HTMLElement>('[data-lf-count]');
    if (!el) return;
    fetchSummary()
      .then((s) => {
        if (this.disposed) return;
        if (s.meta.status === 'live' && (s.activeFires > 0 || s.areaBurnedHa > 0)) {
          el.textContent = LIVEFIRE_COPY.bannerSummary(s);
        } else {
          this.fallbackLiveFireCount(el); // summary down/empty → the satellite count
        }
      })
      .catch(() => {
        if (!this.disposed) this.fallbackLiveFireCount(el);
      });
  }

  /** Fallback banner line: the clustered satellite hotspot count for the saved country. */
  private fallbackLiveFireCount(el: HTMLElement): void {
    const country = getCountryPref(); // defaults to Canada
    const label = countryLabel(country);
    fetchActiveFires()
      .then((feed) => {
        if (this.disposed) return;
        if (feed.meta.status !== 'live') {
          el.textContent = LIVEFIRE_COPY.bannerOffline;
          return;
        }
        const n = countFires(filterCountry(feed.hotspots, country));
        el.textContent = n > 0 ? LIVEFIRE_COPY.bannerSub(n, label) : LIVEFIRE_COPY.bannerQuiet(label);
      })
      .catch(() => {
        if (!this.disposed) el.textContent = LIVEFIRE_COPY.bannerOffline;
      });
  }
}
