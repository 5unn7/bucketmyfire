/**
 * HomeScreen — the branded main-menu HUB (replaces the title→wizard landing). A warm "fight"-register
 * dispatch board: pilot dossier (callsign · rank · career · global rank · XP), the Daily Burn, the
 * Continue-mission card (with Board + Settings buttons on the dossier card itself), and a fixed
 * bottom RAIL (Home · Campaign · Co-op · Hangar · Shop). Single-viewport / no-scroll per CLAUDE.md.
 *
 * Pure DOM over the shared `.bmf-app` stylesheet (styles.ts) — no Three. Rail tabs open the existing
 * branded panels (menus.ts): Campaign drills region → mission, Shop is its own screen; Board +
 * Settings moved OFF the rail onto the dossier card. Navigation that reloads (Continue → ?m=, Daily
 * → ?daily, a mission's Fly) comes in via the `HomeNav` callbacks so main.ts stays the routing authority.
 */
import type { MissionDef } from '../../missions/types';
import { loadProfile, MAPS } from '../profile';
import { getProgress, bestScore, bestStars, isUnlocked } from '../../missions/progress';
import { buildDailyMission, dailyDateLabel } from '../../missions/daily';
import { dailyStreak } from '../../missions/streak';
import { hasCompletedDaily, dailyResetCountdown } from '../../missions/dailyPlay';
import { missionPoster } from '../missionArt';
import { careerScore, rankFor, nextRankProgress } from '../../missions/rank';
import { isConfigured, fetchCareerStanding } from '../../leaderboard/client';
import { setMenuCatalog, navigateRail, openSettings, openBoard } from './menus';
import { railNav } from './rail';
import { injectHomeStyles, spawnEmbers } from './styles';
import { DEFS, FLAME, FLAME_ONLY, HELMET, ic } from './icons';

export interface HomeNav {
  onContinue: (missionId: string) => void; // boot a campaign mission (?m=)
  onDaily: () => void; // boot today's Daily Burn (?daily)
}

const STAR = (on: boolean): string =>
  `<svg class="${on ? 'on' : 'off'}" viewBox="0 0 24 24"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 7.1-1.01z"/></svg>`;

export class HomeScreen {
  private root: HTMLDivElement;
  private disposed = false;
  private nextId = '';

  constructor(parent: HTMLElement, private catalog: MissionDef[], private nav: HomeNav) {
    injectHomeStyles();
    // Seed the rail router: the catalog (Campaign/Board read it) + the boot hook the mission cards
    // call to fly a mission (onContinue → ?m= page-reload nav, owned by main.ts).
    setMenuCatalog(catalog, nav.onContinue);
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
    const prog = getProgress();
    const cleared = prog.completed.length;

    const pts = careerScore();
    const rank = rankFor(pts);
    const np = nextRankProgress(pts);
    const xpLine = np.next ? `${np.next.name} in ${np.remaining.toLocaleString('en-US')}` : 'Top rank';

    // Saskatchewan is the only map with missions today; treat the catalog as the campaign.
    const campaign = this.catalog;
    const next = campaign.find((m) => isUnlocked(m, campaign) && !prog.completed.includes(m.id)) ?? campaign[campaign.length - 1];
    this.nextId = next.id;
    const total = campaign.length;
    const num = String(next.index + 1).padStart(2, '0');
    // Region the mission is set in (shares ids with the MAPS picker; omitted `map` → default SK) — shown
    // as a pin pill on the card so "Mission 04" carries WHERE it is, not just its number.
    const region = MAPS.find((mm) => mm.id === (next.map ?? MAPS[0].id))?.name ?? MAPS[0].name;
    const poster = missionPoster(next.id);
    const stars = bestStars(next.id);
    const best = bestScore(next.id);
    const campFrac = total > 0 ? Math.round((cleared / total) * 100) : 0;

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
  <!-- continue mission -->
  <div class="sec rise d3"><span class="tag">Continue</span><span class="line"></span><span class="stamp link" data-act="campaign">Campaign ›</span></div>
  <article class="artcard rise d3" data-act="continue">
    ${poster ? `<img class="img" src="${poster}" alt="">` : `<div class="fallback"><b>${num}</b></div>`}
    <div class="scrim"></div>
    <div class="brackets"><i></i><i></i><i></i></div>
    <div class="inner">
      <div class="row" style="gap:7px;"><span class="chip">Mission ${num}</span><span class="chip ghost reg">${ic('pin')}${region}</span></div>
      <div class="grow" style="min-height:8px;"></div>
      <h2 class="h-big">${next.name}</h2>
      <p class="clamp2 contbrief" style="margin-top:8px;font-size:var(--fs-body);line-height:1.42;color:var(--text-subtle);max-width:32ch;text-shadow:0 1px 6px rgba(0,0,0,0.75);">${next.tagline ?? next.brief}</p>
      <div class="row" style="gap:12px;margin-top:11px;">
        <span class="stars">${STAR(stars >= 1)}${STAR(stars >= 2)}${STAR(stars >= 3)}</span>
        <span class="mono" style="font-size:var(--fs-meta);color:var(--text-subtle);">${best != null ? `Best <b style="color:var(--menu);font-weight:var(--fw-bold)">${best.toLocaleString('en-US')}</b>` : 'Not flown yet'}</span>
      </div>
      <div class="contprog" style="margin-top:11px;">
        <div class="barrow"><span class="l">Campaign</span><span class="r">${cleared} / ${total} cleared</span></div>
        <div class="bar"><i style="width:${campFrac}%"></i></div>
      </div>
      <button class="btn primary block" style="margin-top:14px;" data-act="continue">${ic('play')}${best != null ? 'Replay mission' : 'Fly mission'}</button>
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
      case 'continue':
        return this.nav.onContinue(this.nextId);
      case 'daily':
        return this.nav.onDaily();
      case 'campaign':
        return navigateRail('campaign'); // region → mission drilldown (the rail's Campaign tab)
      case 'shop':
        return navigateRail('shop'); // leaves the game for the standalone /shop.html merch site
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
