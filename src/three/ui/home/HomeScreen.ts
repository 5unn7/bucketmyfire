/**
 * HomeScreen — the branded main-menu HUB (replaces the title→wizard landing). A warm "fight"-register
 * dispatch board: pilot dossier (callsign · rank · career · global rank · XP), the Daily Burn, and the
 * PROVINCE front door (the game's one open-world mode — the campaign retired), with Board + Settings
 * on the dossier card and a fixed bottom RAIL (Home · Open Skies · Hangar · Shop). Single-viewport /
 * no-scroll per CLAUDE.md.
 *
 * Pure DOM over the shared `.bmf-app` stylesheet (styles.ts) — no Three. Rail tabs open the existing
 * branded panels (menus.ts): Open Skies is the province lobby, Shop is its own screen; Board + Settings
 * moved OFF the rail onto the dossier card. Navigation that reloads (Daily → ?daily, the province's Fly)
 * comes in via the `HomeNav` callbacks / the rail so main.ts stays the routing authority.
 */
import type { MissionDef } from '../../missions/types';
import { loadProfile, MAPS } from '../profile';
import { buildDailyMission, dailyDateLabel } from '../../missions/daily';
import { dailyStreak } from '../../missions/streak';
import { hasCompletedDaily, dailyResetCountdown } from '../../missions/dailyPlay';
import { PROVINCE_COPY } from '../../province/strings';
import { careerScore, rankFor, nextRankProgress } from '../../missions/rank';
import { isConfigured, fetchCareerStanding } from '../../leaderboard/client';
import { setMenuCatalog, navigateRail, openSettings, openBoard } from './menus';
import { railNav } from './rail';
import { injectHomeStyles, spawnEmbers } from './styles';
import { DEFS, FLAME, FLAME_ONLY, HELMET, ic } from './icons';

export interface HomeNav {
  onDaily: () => void; // boot today's Daily Burn (?daily)
}

export class HomeScreen {
  private root: HTMLDivElement;
  private disposed = false;

  constructor(parent: HTMLElement, catalog: MissionDef[], private nav: HomeNav) {
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
    const rank = rankFor(pts);
    const np = nextRankProgress(pts);
    const xpLine = np.next ? `${np.next.name} in ${np.remaining.toLocaleString('en-US')}` : 'Top rank';

    // The home hero is the PROVINCE front door now (the campaign retired — the province IS the game).
    // Backdrop = the region's map-card art; the copy is the locked creative-director slate (strings.ts).
    const regionName = MAPS[0].name;
    const provinceImg = MAPS[0].imageUrl;

    const daily = buildDailyMission(new Date());
    const streak = dailyStreak(new Date());
    // Retry until cleared, then locked: while today's burn is unbeaten the card stays actionable ("Fly
    // today" — retry as many times as it takes). Once CLEARED it locks to a "resets in Xh" / "Cleared"
    // state; the brief stays readable, it just can't be re-flown until midnight.
    const dailyCleared = hasCompletedDaily();

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
        <div class="row mono" style="gap:8px;margin-top:7px;font-size:var(--fs-meta);color:var(--dim);"><span><b style="color:var(--menu);font-weight:var(--fw-bold)">${pts.toLocaleString('en-US')}</b> pts</span><span>·</span><span>Career</span></div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <div class="barrow"><span class="l">Rank advance</span><span class="r">${xpLine}</span></div>
      <div class="bar"><i style="width:${Math.round(np.frac * 100)}%"></i></div>
    </div>
  </header>

  <div class="zone z-daily">
  <!-- daily burn — compact dispatch slip: leads with the brand mark (same logo as the dossier),
       no ignition pill; clearing today's burn flips it to a "Cleared · resets in Xh" locked state. -->
  <div class="sec rise d2"><span class="tag">Daily Burn</span><span class="line"></span></div>
  <section class="card warm cut crt daily rise d2"><span class="crt-streak"></span>
    <div class="drow">
      <div class="glyph flicker">${FLAME}</div>
      <div class="grow">
        <div class="row between" style="gap:8px;">
          <div class="mono" style="font-size:var(--fs-lg);font-weight:var(--fw-bold);letter-spacing:.06em;color:var(--text);">${dailyDateLabel(new Date()).toUpperCase()}</div>
          ${dailyCleared ? `<span class="badge ok">${ic('check')}Cleared</span>` : `<span class="badge fire">${FLAME_ONLY}${streak}-day</span>`}
        </div>
        <p class="dbrief">${daily.brief}</p>
        <div class="row between" style="margin-top:11px;gap:10px;">
          <span class="ctx">${ic('clock')}${dailyCleared ? `Resets in ${dailyResetCountdown()}` : 'Resets midnight'}</span>
          ${dailyCleared
            ? `<button class="btn ember sm locked" disabled>${ic('lock')}Cleared today</button>`
            : `<button class="btn ember sm" data-act="daily">${ic('play')}Fly today</button>`}
        </div>
      </div>
    </div>
  </section>
  <!-- shop banner — DESKTOP-ONLY promo, pinned to the BOTTOM of the Today's Burn column so its base
       lines up with the Continue mission card. The whole card opens the /shop.html merch site; hidden
       on phone/tablet, where the single-viewport stack has no spare room. -->
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

  <div class="zone z-cont">
  <!-- the province front door — the game's one open-world mode (pick aircraft → fly the shift) -->
  <div class="sec rise d3"><span class="tag">Dispatch</span><span class="line"></span><span class="stamp">${regionName}</span></div>
  <article class="artcard rise d3" data-act="province">
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
      case 'daily':
        return this.nav.onDaily();
      case 'shop':
        return navigateRail('shop'); // opens the standalone bucketmyfire storefront in a new tab
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
}
