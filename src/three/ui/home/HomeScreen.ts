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
import { loadProfile } from '../profile';
import { getProgress, bestScore, bestStars, isUnlocked } from '../../missions/progress';
import { buildDailyMission, dailyDateLabel } from '../../missions/daily';
import { dailyStreak } from '../../missions/streak';
import { hasPlayedDaily, dailyResetCountdown } from '../../missions/dailyPlay';
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
    const poster = missionPoster(next.id);
    const stars = bestStars(next.id);
    const best = bestScore(next.id);
    const campFrac = total > 0 ? Math.round((cleared / total) * 100) : 0;

    const daily = buildDailyMission(new Date());
    const streak = dailyStreak(new Date());
    const ignitions = daily.fires?.length ?? 0;
    // One play per day: once today's burn is flown the card locks to a "resets in Xh" state and
    // auto-collapses (nothing actionable left), but the pilot can still expand it to re-read the brief.
    const played = hasPlayedDaily();

    const grank = isConfigured() ? `<div class="grank"><b>#–</b><span>Global</span></div>` : '';

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
  <!-- daily burn -->
  <div class="sec rise d2"><span class="tag">Daily Burn</span><span class="line"></span><span class="stamp">Shared fire</span></div>
  <section class="card warm cut crt rise d2${played ? ' collapsed' : ''}"><span class="crt-streak"></span>
    <button class="daily-head row between" data-act="daily-toggle" aria-label="Toggle Daily Burn details">
      <div class="row" style="gap:12px;">
        <div class="glyph flicker">${FLAME_ONLY}</div>
        <div><div style="font-size:var(--fs-title);font-weight:var(--fw-black);">Today's Burn</div>
        <div class="mono" style="font-size:var(--fs-tag);letter-spacing:.14em;color:var(--dim);margin-top:3px;">${dailyDateLabel(new Date()).toUpperCase()}</div></div>
      </div>
      <div class="row" style="gap:8px;">
        ${played ? `<span class="done-badge">${ic('check')}Flown</span>` : `<span class="streak">${FLAME_ONLY}${streak}-day</span>`}
        <span class="chev">${ic('chevron-down')}</span>
      </div>
    </button>
    <div class="daily-body">
    <p style="margin-top:13px;font-size:var(--fs-body);line-height:1.45;color:rgba(255,255,255,0.86);padding-left:12px;border-left:3px solid var(--fire);">${daily.brief}</p>
    <div class="ctx-row" style="margin-top:12px;">
      <span class="ctx">${ic('map')}Saskatchewan</span>
      <span class="ctx hot">${ic('fire')}${ignitions} ignitions</span>
      <span class="ctx">${ic('clock')}${played ? `Resets in ${dailyResetCountdown()}` : 'Resets midnight'}</span>
    </div>
    <div class="row between" style="margin-top:15px;">
      <span class="mono" style="font-size:var(--fs-micro);letter-spacing:.16em;text-transform:uppercase;color:var(--faint);font-weight:var(--fw-bold);">Same fire worldwide</span>
      ${played
        ? `<button class="btn ember sm locked" disabled>${ic('lock')}Played today</button>`
        : `<button class="btn ember sm" data-act="daily">${ic('play')}Fly today</button>`}
    </div>
    </div>
  </section>
  </div>

  <div class="zone z-cont">
  <!-- continue mission -->
  <div class="sec rise d3"><span class="tag">Continue</span><span class="line"></span><span class="stamp link" data-act="campaign">Campaign ›</span></div>
  <article class="artcard rise d3" data-act="continue">
    ${poster ? `<img class="img" src="${poster}" alt="">` : `<div class="fallback"><b>${num}</b></div>`}
    <div class="scrim"></div>
    <div class="brackets"><i></i><i></i><i></i></div>
    <div class="inner" style="min-height:244px;">
      <div class="row" style="gap:8px;"><span class="chip">Mission ${num}</span><span class="chip ghost">Campaign</span></div>
      <div class="grow" style="min-height:8px;"></div>
      <h2 class="h-big">${next.name}</h2>
      <p class="clamp2" style="margin-top:8px;font-size:var(--fs-body);line-height:1.42;color:rgba(255,255,255,0.84);max-width:32ch;text-shadow:0 1px 6px rgba(0,0,0,0.75);">${next.tagline ?? next.brief}</p>
      <div class="row" style="gap:12px;margin-top:12px;">
        <span class="stars">${STAR(stars >= 1)}${STAR(stars >= 2)}${STAR(stars >= 3)}</span>
        <span class="mono" style="font-size:var(--fs-meta);color:rgba(255,255,255,0.78);">${best != null ? `Best <b style="color:var(--menu);font-weight:var(--fw-bold)">${best.toLocaleString('en-US')}</b>` : 'Not flown yet'}</span>
      </div>
      <div style="margin-top:12px;">
        <div class="barrow"><span class="l">Campaign</span><span class="r">${cleared} / ${total} cleared</span></div>
        <div class="bar"><i style="width:${campFrac}%"></i></div>
      </div>
      <button class="btn primary block" style="margin-top:16px;" data-act="continue">${ic('play')}${best != null ? 'Replay mission' : 'Fly mission'}</button>
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
      case 'daily-toggle': {
        // Collapse/expand the Daily Burn card (the whole header is the toggle).
        this.root.querySelector('.z-daily .card.crt')?.classList.toggle('collapsed');
        return;
      }
      case 'campaign':
        return navigateRail('campaign'); // region → mission drilldown (the rail's Campaign tab)
      case 'board':
        return openBoard();
      case 'settings':
        return openSettings();
    }
  }

  private loadGlobalRank(): void {
    const p = loadProfile();
    if (!isConfigured() || !p?.name) return;
    fetchCareerStanding(p.name)
      .then((s) => {
        if (this.disposed || !s) return;
        const el = this.root.querySelector('.grank');
        if (el) el.innerHTML = `<b>#${s.rank}</b><span>Global</span>`;
      })
      .catch(() => {});
  }
}
