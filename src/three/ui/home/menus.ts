/**
 * Rail-menu overlays opened from the Home bottom rail. Shop opens the standalone bucketmyfire
 * storefront (shop.bucketmyfire.com) in the same tab (see ../storeLink); this file supplies the rest as focused,
 * branded full-screen panels on the shared `.bmf-app`
 * stylesheet:
 *   - Hangar   — aircraft picker (3 helis, specs, points-unlock gates), saves profile.heliId
 *   - Open Skies — the open-world dispatch shift (openCoop): routes to ?province, the live map you hold
 *   - Settings — sound + reduced-motion toggles, callsign, region, reset progress (off the rail
 *                now; opened from the Home profile card). Board (leaderboard) likewise.
 * Each is a back-to-Home overlay (Home stays mounted underneath). No-scroll / single-viewport.
 */
import type { MissionDef } from '../../missions/types';
import {
  HELIS, MAPS, isHeliUnlocked, missionsCleared, loadProfile, saveProfile,
  availablePoints, heliCost, buyHeli, type Profile, type CatalogItem,
} from '../profile';
import { isConfigured, fetchMissionTop } from '../../leaderboard/client';
import { provinceSessionId } from '../../province/buildProvince';
import { PROVINCE_COPY } from '../../province/strings';
import { getCloudLink } from '../../leaderboard/cloudSave';
import { openCloudSave } from '../CloudSave';
import { openNotifyModal } from '../NotifyModal';
import { resetProgress } from '../../missions/progress';
import { openLeaderboard } from '../Leaderboard';
import { injectHomeStyles, spawnEmbers } from './styles';
import { posterCard } from './posterCard';
import { railNav } from './rail';
import { DEFS, FLAME, ic } from './icons';
import { openStore } from '../storeLink';
import { validateCallsign, MAX_CALLSIGN } from '../callsign';
import { fetchActiveFires, fetchSummary, fetchReportedFires, fetchBurnPerimeters, fetchFwiMeta, fetchFireHistory, fetchFireActivity, fwiForecastTime, getRegionPref, setRegionPref, isLiveFireEnabled, FWI_BANDS } from '../../livefire/client';
import {
  LIVEFIRE_COPY, severityClass, severityLabel, stageClass, stageLabel, relTime,
  STAGE_STEPS, stageStep, stageNarrative,
  freshnessLine, statusDotClass, publishedWhen, LIVEFIRE_SOURCES, NOT_FOR_EMERGENCY, SK_OFFICIAL,
  frameTimeLabel, smokeFreshness, fwiFreshness,
} from '../../livefire/strings';
import { FIELD_GROUPS, REPORTED_FIELD_GROUPS, responseType, type FieldGroup } from '../../livefire/fields';
import { filterReportedRegion, filterRegionHotspots, regionValue, parseRegion, regionOptions, deriveRegionStats, countryLabel, COUNTRIES, smokeForecastFrames, forecastLeadLabel } from '../../livefire/normalize';
import { LIVEFIRE } from '../../config';
import type { Hotspot, ReportedFire, ReportedFeed, FireHistoryPoint, FireActivity, FireStage, NationalSummary, BurnFeed, FeedMeta, LiveFireFeed, CountryFilter, RegionFilter, RegionStats } from '../../livefire/types';
import type { LiveMapView, FireLayer } from '../../livefire/view';
import { rankThreats, type ThreatRow } from '../../livefire/triage';
import { esc } from '../../../site/siteNav.mjs';

const MUTE_KEY = 'bmf.audio.muted.v1';

function currentProfile(): Profile {
  return loadProfile() ?? { name: '', mapId: 'saskatchewan', heliId: HELIS[0].id };
}

// — Rail context + router —————————————————————————————————————————————————————
// The bottom rail now rides ON every menu overlay (not just the hub), so it must stay visible the
// whole time you're "in the menus". The hub seeds the catalog (Board needs it) and tracks the one
// open overlay so tapping another rail tab swaps panels in place instead of stacking them.
let menuCatalog: MissionDef[] = [];
let activeOverlay: { key: string; close: () => void } | null = null;

/** HomeScreen seeds the catalog the Board reads. The 8-mission campaign retired (the province is the
 *  game now), so this is empty today — kept as the seam the Board + any future map content read. */
export function setMenuCatalog(catalog: MissionDef[]): void {
  menuCatalog = catalog;
}

/** Route a rail tap: close the current panel (if any), then open the target. `home` just falls back
 *  to the hub mounted underneath. Shop opens the standalone storefront in the same tab. */
export function navigateRail(key: string): void {
  if (activeOverlay && activeOverlay.key === key) return; // tapping the active tab is a no-op
  const prev = activeOverlay;
  prev?.close();
  switch (key) {
    case 'home':
      return; // hub is underneath
    case 'hangar':
      return openHangar();
    case 'coop':
      return openCoop();
    case 'solo':
      return openSolo();
    case 'shop':
      openStore('home-rail'); // navigates to the standalone bucketmyfire storefront in the same tab
      return;
  }
}

/** Board (leaderboard) — off the rail now; opened from the Home profile card. */
export function openBoard(): void {
  activeOverlay?.close();
  openLeaderboard(menuCatalog);
}

/** Build a focused full-screen overlay WITH a persistent bottom nav. `key` is the overlay's identity
 *  (the active-overlay guard / no-op-on-same-tab check); `railActive` is which rail TAB lights up,
 *  defaulting to `key`. Sub-screens that aren't themselves a rail destination (the live-fire tracker,
 *  Settings) pass a real rail key — `home` — so the rail still shows an active tab like every sibling
 *  overlay, instead of rendering with nothing lit.
 *
 *  `navMarkup` swaps the WHOLE bottom nav: a surface reached from the FRONT DOOR (e.g. the live-fire
 *  tracker opened off the home bento) passes the front-door tabbar so it wears the SAME nav as the rest
 *  of the front-door site (Home / Campaign / Prepare / Shop), not the in-game mode rail. The root then
 *  gets `.front-nav` so the tabbar styling adapts (visible on desktop too, since the overlay has no top
 *  appbar). Navigation is the nav's job (no back button); Esc / the Home tab return to the hub. */
function overlay(
  key: string,
  title: string,
  body: string,
  onClose?: () => void,
  railActive: string = key,
  navMarkup?: string,
): { root: HTMLDivElement; close: () => void } {
  injectHomeStyles();
  const root = document.createElement('div');
  root.className = navMarkup ? 'bmf-app front-nav' : 'bmf-app';
  root.style.zIndex = '60';
  root.innerHTML =
    DEFS +
    `<div class="scene"></div><div class="embers"></div>` +
    `<div class="pad"><div class="appbar"><div class="ttl">${title}</div></div>${body}</div>` +
    (navMarkup ?? railNav(railActive));
  document.body.appendChild(root);
  const embers = root.querySelector<HTMLElement>('.embers');
  if (embers) spawnEmbers(embers, 10);
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    onClose?.(); // lifecycle teardown on EVERY close path (Esc / rail / programmatic) — e.g. dispose a map
    root.remove();
    if (activeOverlay && activeOverlay.close === close) activeOverlay = null;
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  window.addEventListener('keydown', onKey);
  root.querySelectorAll<HTMLElement>('.rail [data-rail]').forEach((b) =>
    b.addEventListener('click', () => navigateRail(b.dataset.rail || 'home')),
  );
  activeOverlay = { key, close };
  return { root, close };
}

// — Hero carousel (shared by Maps + Hangar) ——————————————————————————————————
// One full-bleed, center-snap, one-card-at-a-time strip with chevrons + dots. Both pickers render
// their items as poster `.cslide`s and wire this same controller so the two screens read
// identically. Tapping an off-centre slide brings it to centre; the active slide's own CTA selects.
function carousel(slides: string[]): string {
  const n = slides.length;
  return (
    `<div class="carousel">` +
    (n > 1 ? `<button class="cnav prev hide" data-cnav="-1" aria-label="Previous">${ic('back')}</button>` : '') +
    `<div class="ctrack" data-ctrack>${slides.join('')}</div>` +
    (n > 1 ? `<button class="cnav next" data-cnav="1" aria-label="Next">${ic('chevron-right')}</button>` : '') +
    `</div>` +
    (n > 1 ? `<div class="dots" data-cdots>${slides.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : '')
  );
}

/** Wire the carousel in `root`: scroll → active slide (scale-up + dots + chevron fade),
 *  chevrons + off-centre taps re-centre. `onActive(i)` fires on each settle. Returns a `center(i)`. */
function wireCarousel(root: HTMLElement, initial: number, onActive?: (i: number) => void): (i: number) => void {
  const track = root.querySelector<HTMLElement>('[data-ctrack]');
  if (!track) return () => {};
  const slides = Array.from(track.querySelectorAll<HTMLElement>('.cslide'));
  const dots = root.querySelector<HTMLElement>('[data-cdots]');
  const prev = root.querySelector<HTMLElement>('.cnav.prev');
  const next = root.querySelector<HTMLElement>('.cnav.next');
  let active = -1;

  const center = (i: number): void => {
    const s = slides[i];
    if (!s) return;
    track.scrollTo({ left: s.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: 'smooth' });
  };
  const setActive = (i: number): void => {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === active) return;
    active = i;
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
    dots && Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === i));
    prev?.classList.toggle('hide', i === 0);
    next?.classList.toggle('hide', i === slides.length - 1);
    onActive?.(i);
  };
  const nearest = (): number => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bd = Infinity;
    slides.forEach((s, k) => {
      const d = Math.abs(s.offsetLeft + s.clientWidth / 2 - mid);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    return best;
  };

  let raf = 0;
  track.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setActive(nearest());
      });
    },
    { passive: true },
  );
  prev?.addEventListener('click', () => center(active - 1));
  next?.addEventListener('click', () => center(active + 1));
  // Tap an off-centre slide → bring it to centre (active slide keeps its own CTA clickable).
  slides.forEach((s, k) =>
    s.addEventListener('click', () => {
      if (k !== active) center(k);
    }),
  );

  // Jump to the initial pick without animation, then latch state.
  const start = slides[initial] ? initial : 0;
  track.scrollLeft = slides[start].offsetLeft - (track.clientWidth - slides[start].clientWidth) / 2;
  setActive(start);
  return center;
}

// The 8-mission CAMPAIGN region→mission pickers (openCampaign / openMissions) were removed in the
// Living Province cutover — the province is the front door now (the home hero + the Open Skies lobby),
// and the campaign mission DATA is gone (maps/saskatchewan has no `missions`). The Hangar + Open Skies
// lobby below are unchanged.

// ============================ HANGAR ============================
export function openHangar(): void {
  const cleared = missionsCleared();
  const slides = HELIS.map((h) => heliSlide(h, cleared));
  const body = carousel(slides);

  const initial = Math.max(0, HELIS.findIndex((h) => h.id === currentProfile().heliId));
  const { root } = overlay('hangar', 'Hangar', body);

  // Spendable-balance chip in the appbar (right of the title) — the wallet you unlock aircraft from.
  // Repainted after every purchase so the player sees the points drain immediately.
  const bal = document.createElement('div');
  bal.className = 'pts-bal';
  const paintBalance = (): void => {
    bal.innerHTML = `${ic('spark')}<b>${availablePoints().toLocaleString()}</b><span>pts</span>`;
  };
  paintBalance();
  root.querySelector('.appbar')?.appendChild(bal);

  const refresh = (): void => {
    const sel = currentProfile().heliId;
    root.querySelectorAll<HTMLElement>('[data-heli]').forEach((el) => {
      const id = el.dataset.heli!;
      const h = HELIS.find((x) => x.id === id)!;
      const unlocked = isHeliUnlocked(h, cleared);
      const foot = el.querySelector('.heli-foot')!;
      if (!unlocked) {
        // Locked: with the campaign retired, aircraft unlock by POINTS only — show the buy path: an
        // affordable button (Unlock · N pts) or a dimmed shortfall (Need N pts). (The trainer is free.)
        const cost = heliCost(h);
        const afford = availablePoints() >= cost;
        foot.innerHTML = cost > 0
          ? afford
            ? `<button class="btn primary block" data-buy="${id}">${ic('spark')}Unlock · ${cost.toLocaleString()} pts</button>`
            : `<button class="btn ghost block is-disabled">${ic('spark')}Need ${cost.toLocaleString()} pts</button>`
          : `<button class="btn ghost block is-disabled">${ic('lock')}Locked</button>`;
      } else if (id === sel) {
        foot.innerHTML = `<button class="btn ghost block is-disabled">${ic('check')}Equipped</button>`;
      } else {
        foot.innerHTML = `<button class="btn primary block" data-pick="${id}">${ic('play')}Fly this</button>`;
      }
    });
    root.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        saveProfile({ ...currentProfile(), heliId: b.dataset.pick! });
        refresh();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const h = HELIS.find((x) => x.id === b.dataset.buy);
        if (!h || !buyHeli(h).ok) return; // buyHeli enforces affordability; a blocked buy is a no-op
        saveProfile({ ...currentProfile(), heliId: h.id }); // bought it → equip it (it's now flyable)
        paintBalance(); // the spend just drained the wallet
        refresh();
      }),
    );
  };
  refresh();
  wireCarousel(root, initial);
}

function heliSlide(h: CatalogItem, cleared: number): string {
  const unlocked = isHeliUnlocked(h, cleared);
  const specs = (h.specs ?? [])
    .map((s) => `<div class="spec"><span class="name">${s.label}</span><span class="track"><i style="width:${Math.round(s.value * 100)}%"></i></span></div>`)
    .join('');
  const badge = unlocked ? `<span class="badge ok">Flyable</span>` : `<span class="badge locked">Locked</span>`;
  // Key-art render of the airframe over a boreal wildfire (profile.imageUrl) full-bleed behind the
  // scrim; falls back to the procedural "hangar bay" art when a heli has no render yet.
  const backdrop = h.imageUrl
    ? `<img class="img" src="${h.imageUrl}" alt="">`
    : `<div class="heli-art"><span class="grid"></span><span class="ring"></span><span class="mark">${ic('heli')}</span><span class="livery" aria-hidden="true">${FLAME}</span></div>`;
  return posterCard({
    locked: !unlocked,
    cardClass: 'heli',
    cardAttrs: `data-heli="${h.id}" style="--accent:${h.accent};"`,
    backdrop,
    tagline: h.tagline,
    badge,
    title: h.name,
    body: `<div class="specgrid">${specs}</div>`,
    footer: `<div class="heli-foot"></div>`,
  });
}

// ===================== OPEN SKIES (the open-world dispatch shift) =====================
/** Open Skies — the open-world shift: everyone flies the same daily-seeded province, dispatch calls as
 *  fires break out over a climbing fire-weather curve, and you hold the towns. Routes to `?province`
 *  (a reload boot owned by main.ts), mirroring the Daily Burn nav. (The flat `?ffa` free-for-all is
 *  superseded by this and stays reachable only by URL.) */
export function openCoop(): void {
  // You fly the airframes you've UNLOCKED (the trainer is free; the heavier ships cost points — the
  // same gate as the Hangar). Default the pick to the pilot's saved heli (loadProfile already clamps a
  // locked save back to the trainer), falling back to the first unlocked airframe so a ?heli= override
  // or stale pick can never seed a locked selection.
  const cleared = missionsCleared();
  const unlocked = (h: CatalogItem): boolean => isHeliUnlocked(h, cleared);
  let picked = currentProfile().heliId || HELIS[0].id;
  if (!unlocked(HELIS.find((h) => h.id === picked) ?? HELIS[0])) picked = (HELIS.find(unlocked) ?? HELIS[0]).id;
  // Each airframe is a compact card in a 3-up horizontal grid. An AFFORDABLE locked ship carries a real
  // ember "Unlock" buy button (spend points right here, no trip to the Hangar); an unaffordable one
  // renders dimmed with its price + a lock corner. Both carry data-locked so the SELECT handler skips
  // them — only the inner Unlock button acts.
  const heliCard = (h: (typeof HELIS)[number]): string => {
    const ok = unlocked(h);
    const sel = ok && h.id === picked;
    const cost = heliCost(h);
    const afford = !ok && cost > 0 && availablePoints() >= cost;
    // Key-art render fills the tile when present; else the procedural ring + heli mark.
    const art = h.imageUrl
      ? `<img class="img" src="${h.imageUrl}" alt="">`
      : `<span class="hc-ring"></span><span class="hc-mark">${ic('heli')}</span>`;
    // Locked-but-affordable: a div (a buy <button> can't nest in a card-button), inert for SELECTION
    // (data-locked) so only the Unlock button acts. The price stays as the caption; the button is the
    // action. Bought → repaint flips it to the selected card.
    if (afford) {
      return `<div class="helicard buyable" style="--accent:${h.accent};" data-heli="${h.id}" data-locked>
        <span class="hc-art">${art}</span>
        <span class="hc-name">${h.name}</span>
        <span class="hc-sub">${cost.toLocaleString()} pts</span>
        <button class="btn ember sm block hc-buy" data-buy="${h.id}">${ic('spark')}Unlock</button>
      </div>`;
    }
    // Selectable, or locked + unaffordable: the card-button. Locked shows its price + a lock corner.
    const sub = ok ? h.tagline : `${cost.toLocaleString()} pts`;
    const flag = sel ? `<span class="hc-flag">${ic('check')}</span>` : ok ? '' : `<span class="hc-flag">${ic('lock')}</span>`;
    return `<button class="helicard${sel ? ' sel' : ''}${ok ? '' : ' locked'}" style="--accent:${h.accent};" data-heli="${h.id}"${ok ? '' : ' data-locked'}>
      <span class="hc-art">${art}</span>
      <span class="hc-name">${h.name}</span>
      <span class="hc-sub">${sub}</span>${flag}
    </button>`;
  };
  // Open Skies lobby. Two blocks: the PITCH (title · subtitle · what-it-is) and the PICK (aircraft +
  // Join). On the phone they stack in a single no-scroll column (the aircraft grid is the flexible
  // hero); on desktop styles.ts lays them out side-by-side as a 2-column lobby. The body owns the
  // title + subtitle hero, so the overlay appbar is hidden for this screen (styles.ts).
  const body = `<div class="osky">
    <div class="osky-pitch">
      <div class="ctx-row">
        <span class="chip">${ic('fire')}${PROVINCE_COPY.chip}</span>
        <span class="chip ghost osky-live-chip" data-osky-live><span class="osky-live-dot"></span>LIVE</span>
      </div>
      <h2 class="h-big osky-title">${PROVINCE_COPY.headline}</h2>
      <p class="osky-sub">${PROVINCE_COPY.sub}</p>
      <p class="osky-desc">${PROVINCE_COPY.what}</p>
      <div class="osky-feats">
        <div class="osky-feat">${ic('target')}<span>${PROVINCE_COPY.feat}</span></div>
      </div>
    </div>
    <div class="osky-pick">
      <div class="sec"><span class="tag">Your aircraft</span><span class="line"></span><span class="pts-bal">${ic('spark')}<b>${availablePoints().toLocaleString()}</b><span>pts</span></span></div>
      <div class="heligrid">${HELIS.map(heliCard).join('')}</div>
      <div class="osky-cta">
        <button class="btn ember block" data-fly>${ic('play')}${PROVINCE_COPY.cta}</button>
      </div>
    </div>
  </div>`;
  const { root } = overlay('coop', 'Open Skies', body);
  // Aircraft selection: one delegated handler repaints the grid so the chosen card lights up and the
  // rest reset. Locked airframes are inert — you can't fly what you haven't earned, so they're skipped.
  const grid = root.querySelector<HTMLElement>('.heligrid')!;
  const bal = root.querySelector<HTMLElement>('.pts-bal');
  const repaint = (): void => {
    if (bal) bal.innerHTML = `${ic('spark')}<b>${availablePoints().toLocaleString()}</b><span>pts</span>`;
    grid.innerHTML = HELIS.map(heliCard).join('');
  };
  grid.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    // Spend points to unlock the ship right here in the lobby (buyHeli enforces affordability — a
    // blocked buy is a no-op). Bought → equip it, drain the wallet chip, and repaint so the card flips
    // to selected. Checked BEFORE the select branch because the Unlock button lives inside an inert
    // (data-locked) card.
    const buy = target.closest<HTMLElement>('[data-buy]');
    if (buy) {
      const h = HELIS.find((x) => x.id === buy.dataset.buy);
      if (h && buyHeli(h).ok) {
        picked = h.id;
        repaint();
      }
      return;
    }
    const card = target.closest<HTMLElement>('.helicard');
    if (!card || card.hasAttribute('data-locked')) return;
    picked = card.dataset.heli || picked;
    repaint();
  });
  root.querySelector('[data-fly]')?.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('m');
    url.searchParams.delete('daily');
    url.searchParams.delete('ffa');
    url.searchParams.delete('solo'); // the live world is shared — never a solo round
    url.searchParams.delete('region'); // everyone flies the same canonical map (no per-user region)
    url.searchParams.set('province', '1');
    url.searchParams.set('heli', picked); // fly the chosen airframe (main.ts honours ?heli=)
    location.assign(url.toString());
  });
  // Best-effort: fetch today's province pilot count from the board and surface it as a chip.
  // fetchMissionTop returns {total:0} when unconfigured, so the badge only appears when real.
  fetchMissionTop(provinceSessionId(new Date()), 1).then((board) => {
    if (board.total < 1) return;
    const chip = root.querySelector<HTMLElement>('[data-osky-live]');
    if (!chip) return;
    const dot = chip.querySelector('.osky-live-dot');
    chip.textContent = `${board.total} LIVE`;
    if (dot) chip.prepend(dot);
  }).catch(() => { /* best-effort */ });
}

// ============================ SOLO (pick a map, fly alone) ============================
/** Solo — the manual "pick a map, fly alone" path. A map carousel; the chosen map boots a PRIVATE
 *  province round (`?province&region=&solo=1`): the SAME live dispatch + generated category missions +
 *  points, but no ghost pilots and off the shared board (your own pace). Future maps appear here as they
 *  ship — today only Saskatchewan is flyable, the rest are "coming soon" teasers. (The live, shared,
 *  rotating world is the Open Skies tab; this is the solo counterpart.) */
export function openSolo(): void {
  const pro = currentProfile();
  const slides = MAPS.map((m) => {
    const selected = m.id === pro.mapId && m.available;
    const backdrop = m.imageUrl
      ? `<img class="img" src="${m.imageUrl}" alt="">`
      : `<div class="fallback"><b>${m.name.slice(0, 2).toUpperCase()}</b></div>`;
    const badge = m.available
      ? `<span class="badge ${selected ? 'ok' : ''}">${selected ? 'Selected' : 'Live'}</span>`
      : `<span class="badge">Soon</span>`;
    const body = m.available && m.stats
      ? `<div class="ctx-row"><span class="ctx">${ic('map')}${m.stats.area}</span><span class="ctx">${ic('droplet')}${m.stats.lakes}</span></div>`
      : '';
    const footer = !m.available
      ? `<button class="btn secondary block" data-notify-map="${m.id}" data-notify-name="${esc(m.name)}">${ic('bell')}Notify me</button>`
      : `<button class="btn ember block" data-solo-map="${m.id}">${ic('play')}Fly solo</button>`;
    return posterCard({ locked: !m.available, cardClass: 'map', backdrop, tagline: m.tagline, badge, title: m.name, body, footer });
  });

  const initial = Math.max(0, MAPS.findIndex((m) => m.id === pro.mapId && m.available));
  const { root } = overlay('solo', 'Solo', carousel(slides));
  wireCarousel(root, initial);
  root.querySelectorAll<HTMLElement>('[data-solo-map]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let the slide's re-centre handler swallow the pick
      const id = b.dataset.soloMap!;
      saveProfile({ ...currentProfile(), mapId: id }); // remember the picked map
      const url = new URL(location.href);
      url.searchParams.delete('m');
      url.searchParams.delete('daily');
      url.searchParams.delete('ffa');
      url.searchParams.set('province', '1');
      url.searchParams.set('region', id); // fly the chosen map
      url.searchParams.set('solo', '1'); // private round — no ghosts, off the shared board
      url.searchParams.set('heli', currentProfile().heliId); // fly the saved airframe (loadProfile clamps locked → trainer)
      location.assign(url.toString());
    }),
  );
  // Upcoming maps carry a "Notify me" CTA instead of a play button — capture an email for the launch
  // (the lead is tied to the pilot's callsign, generating one if they never named themselves).
  root.querySelectorAll<HTMLElement>('[data-notify-map]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let the slide's re-centre handler swallow the tap
      openNotifyModal(b.dataset.notifyMap!, b.dataset.notifyName || 'This map');
    }),
  );
}

// ============================ LIVE WILDFIRES (the real-fire tracker) ============================
// Server-provided strings (agency/fuel/ecozone) are escaped with the shared `esc` (siteNav.mjs)
// before they reach innerHTML — the local copy here had drifted (it didn't escape single quotes).

/** Render grouped detail fields from a record's property bag (empty fields dropped). Shared by the
 *  hotspot + reported-fire detail panels — same row markup, different field groups. */
function fieldGroupsHtml(groups: FieldGroup[], props: Record<string, unknown>): string {
  return groups
    .map((g) => {
      const rows = g.fields
        .filter((f) => {
          const v = props[f.key];
          return v !== undefined && v !== null && v !== '';
        })
        .map((f) => `<div class="frow"><span class="fk">${f.label}</span><span class="fv">${esc(f.fmt(props[f.key]))}</span></div>`)
        .join('');
      return rows ? `<div class="fgroup"><div class="fgh">${g.group}</div>${rows}</div>` : '';
    })
    .join('');
}

/** Quick-glance fact chips for a fire detail header — kind · jurisdiction · freshness. Ghost pills that
 *  surface the at-a-glance metadata in one scannable row, leaving the stage/severity badge to own colour
 *  and the grouped rows below to carry the full record. Blank cells (unknown time, no agency) are dropped. */
function metaChipsHtml(cells: Array<{ icon: string; label: string }>): string {
  const chips = cells
    .filter((c) => c.label && c.label !== '—')
    .map((c) => `<span class="chip ghost mchip">${ic(c.icon)}${esc(c.label)}</span>`)
    .join('');
  return chips ? `<div class="chiprow">${chips}</div>` : '';
}

/** Jurisdiction chip text — agency code + country (e.g. "SK · Canada"), the bare country when the agency
 *  is unknown. `country` is the already-classified `Country` (a subset of `CountryFilter`). */
function jurisLabel(agency: string, country: CountryFilter): string {
  const a = (agency || '').toUpperCase();
  const c = countryLabel(country);
  return a ? `${a} · ${c}` : c;
}

/** A small column tile for the summary panel — a big mono value over a quiet label. */
function fstat(value: string, label: string): string {
  return `<div class="fstat"><span class="fsv">${esc(value)}</span><span class="fsl">${esc(label)}</span></div>`;
}

/** A tapped satellite hotspot opens with its INTENSITY read — head-fire intensity + radiative power, the
 *  numbers a person actually cares about, promoted above the 24-row analyst record. Every value is the real
 *  CWFIS field, just lifted to a headline; the precise coordinates stay as the title reference. '' when the
 *  detection carries no behaviour numbers (the field list still renders below). */
function hotspotSummaryHtml(h: Hotspot): string {
  const facts: string[] = [];
  if (h.hfi > 0) facts.push(fstat(Math.round(h.hfi).toLocaleString(), 'Head-fire intensity · kW/m'));
  const frp = Number(h.props.frp);
  if (Number.isFinite(frp) && frp > 0) facts.push(fstat(frp.toLocaleString(undefined, { maximumFractionDigits: 1 }), 'Radiative power · MW'));
  if (!facts.length) return '';
  return `<div class="fsum">
      <div class="fsum-def">${esc(severityLabel(h.severity))}-intensity satellite heat detection.</div>
      <div class="fsum-facts">${facts.join('')}</div>
    </div>`;
}

/** The control SCALE — where a fire sits on the Out-of-control↔Out spectrum RIGHT NOW. Deliberately NOT a
 *  progress bar: stage of control is a revisable agency call that can move either way (a held fire can
 *  return to out-of-control), so only the CURRENT stage lights, in its own danger-ramp colour — the others
 *  are equal, unfilled positions, not "done" steps. '' for an unmapped/unknown stage. */
function controlScaleHtml(stage: FireStage): string {
  if (stageStep(stage) < 0) return '';
  // Ticks only — no per-segment labels (they truncated on a phone): the lit colour + the header badge name
  // the stage; this just places it on the worst→out spectrum.
  return `<div class="fscale" role="img" aria-label="Stage of control: ${esc(stageLabel(stage))}">` +
    STAGE_STEPS.map((s) => `<i class="fseg${s.stage === stage ? ` cur ${s.stage.toLowerCase()}` : ''}"></i>`).join('') +
    '</div>';
}

/** The on-brand STATUS panel a tapped reported fire opens with (a corner-cut cockpit panel, not a rounded
 *  web card). It REPLACES the old "Status" field group rather than duplicating it: the control scale + what
 *  the current stage means (the honest answer to "when is it held / under control"), then the headline
 *  numbers — size · contained · response. Synchronous from the fire; the timeline below adds change-over-time. */
function fireSummaryHtml(f: ReportedFire): string {
  const containedN = parseFloat(pickProp(f.props, CONTAINED_KEYS));
  const response = f.source
    ? pickProp(f.props, PROV_RESPONSE_KEYS)
    : responseType(f.props['field_response_type']);
  const facts: string[] = [];
  if (f.sizeHa >= 0) facts.push(fstat(LIVEFIRE_COPY.fireSize(f.sizeHa), 'Size'));
  // Bounded 0 < n ≤ 100. Excluding 0 is deliberate: several ArcGIS feeds ship the column present-but-never-
  // populated, which defaults to 0 — promoting that to a bold headline "0% Contained" would state a
  // containment fact the agency never reported. The upper bound rejects a 0–1 FRACTION (0.5 → "0%") and any
  // out-of-range junk, so a real percentage is the only thing that reaches the panel.
  if (Number.isFinite(containedN) && containedN > 0 && containedN <= 100) facts.push(fstat(`${Math.round(containedN)}%`, 'Contained'));
  if (response && response !== '—') facts.push(fstat(response, 'Response'));
  return `<div class="fsum">
      ${controlScaleHtml(f.stage)}
      <div class="fsum-def">${esc(stageNarrative(f.stage))}</div>
      ${facts.length ? `<div class="fsum-facts">${facts.join('')}</div>` : ''}
    </div>`;
}

/** The full CWFIS record for one tapped satellite HOTSPOT — every meaningful field, grouped +
 *  unit-formatted (detection · behaviour · the FWI System codes · weather · site). */
function fireDetailHtml(h: Hotspot): string {
  const chips = metaChipsHtml([
    { icon: 'fire', label: 'Satellite hotspot' },
    { icon: 'pin', label: jurisLabel(h.agency, h.country) },
    { icon: 'clock', label: relTime(h.at) },
  ]);
  return `<div class="fsheet-head">
      <div class="grow" style="min-width:0;">
        <div class="fsheet-ttl">${LIVEFIRE_COPY.coords(h.lat, h.lon)}</div>
        <div class="s">Thermal detection</div>
      </div>
      <span class="${severityClass(h.severity)}">${severityLabel(h.severity)}</span>
      <button class="iconbtn" data-lf-close aria-label="Close detail">${ic('close')}</button>
    </div>
    ${chips}
    ${hotspotSummaryHtml(h)}
    <div>${fieldGroupsHtml(FIELD_GROUPS, h.props)}</div>`;
}

// Provincial feeds carry richer fields than CIFFC but under per-source names — a multi-key lookup pulls
// the universally-useful ones (cause, response, type, district) across all 9 sources for the detail panel.
// The two key lists the SUMMARY panel also reads are named consts, not `PROV_FIELDS[i]`: addressing them
// positionally meant reordering this array silently relabelled the summary's headline stat (a wrong-value
// bug with no type error, since the row-suppression below matches on `label`). One name, both call sites.
const PROV_RESPONSE_KEYS = ['RESPONSE_TYPE_DESC', 'ResponseType', 'RESPONSE_OBJECTIVE', 'responsecategory'];
const PROV_CONTAINED_KEYS = ['PercentContained', 'percent_contained'];
/** Every key the "Contained" headline stat may arrive under — CIFFC's plus the provincial spellings. */
const CONTAINED_KEYS = ['field_percent_contained', ...PROV_CONTAINED_KEYS];
const PROV_FIELDS: { label: string; keys: string[] }[] = [
  { label: 'Cause', keys: ['FIRE_CAUSE', 'GENERAL_CAUSE', 'Cause', 'cause', 'CAUSE'] },
  { label: 'Response', keys: PROV_RESPONSE_KEYS },
  { label: 'Type', keys: ['FIRE_TYPE', 'FireType', 'fire_type'] },
  { label: 'Contained', keys: PROV_CONTAINED_KEYS },
  { label: 'District', keys: ['DISTRICT_NAME', 'FIRE_DISTRICT_NAME', 'REGION', 'region', 'FIRE_CENTRE'] },
];
/** Labels the summary panel already shows as headline facts — skipped in the detail rows below. */
const PROV_FIELDS_IN_SUMMARY = new Set(['Response', 'Contained']);
/** First present, non-blank value among `keys`, as a trimmed string. */
function pickProp(props: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = props[k];
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}
/** Curated detail group for a PROVINCIAL fire (its props use source-specific field names, not CIFFC's). */
function provDetailHtml(f: ReportedFire): string {
  const rows = [`<div class="frow"><span class="fk">Source</span><span class="fv">${esc((f.agency || '').toUpperCase())} provincial agency</span></div>`];
  if (f.fireId) rows.push(`<div class="frow"><span class="fk">Fire ID</span><span class="fv">${esc(f.fireId)}</span></div>`);
  // Size / Contained / Response are now the summary panel's headline facts — don't repeat them here.
  for (const d of PROV_FIELDS) {
    if (PROV_FIELDS_IN_SUMMARY.has(d.label)) continue;
    const v = pickProp(f.props, d.keys);
    if (v) rows.push(`<div class="frow"><span class="fk">${d.label}</span><span class="fv">${esc(v)}</span></div>`);
  }
  return `<div class="fgroup"><div class="fgh">Fire details</div>${rows.join('')}</div>`;
}

/** One tapped AUTHORITATIVE reported fire. CIFFC fires render the full CIFFC record; PROVINCIAL fires
 *  (f.source set) render the curated provincial group. Closes on the standing honesty line — this is a
 *  window onto real agency data, not an emergency tool. */
function reportedDetailHtml(f: ReportedFire): string {
  const title = f.name ? esc(f.name) : f.fireId ? esc(f.fireId) : LIVEFIRE_COPY.coords(f.lat, f.lon);
  // Skip the "Status" group (REPORTED_FIELD_GROUPS[0]) — its stage/size/contained/response now lead in the
  // summary panel above; rendering it again was the triple-repeat that read as rookie UX.
  const body = f.source ? provDetailHtml(f) : `<div>${fieldGroupsHtml(REPORTED_FIELD_GROUPS.slice(1), f.props)}</div>`;
  // Provincial feeds may name the fire type explicitly; CIFFC fires are wildfires by definition.
  const ftype = f.source ? pickProp(f.props, ['FIRE_TYPE', 'FireType', 'fire_type']) : '';
  const chips = metaChipsHtml([
    { icon: 'fire', label: ftype || 'Wildfire' },
    { icon: 'pin', label: jurisLabel(f.agency, f.country) },
    { icon: 'clock', label: relTime(f.at) },
  ]);
  return `<div class="fsheet-head">
      <div class="grow" style="min-width:0;">
        <div class="fsheet-ttl">${title}</div>
        <div class="fsheet-stage"><span class="${stageClass(f.stage)}">${esc(stageLabel(f.stage))}</span></div>
      </div>
      <button class="iconbtn" data-lf-close aria-label="Close detail">${ic('close')}</button>
    </div>
    ${chips}
    ${fireSummaryHtml(f)}
    <div data-lf-hist></div>
    ${body}
    <p class="alertnote">${esc(NOT_FOR_EMERGENCY)}</p>`;
}

/** Short absolute day for the fire timeline — "Jun 9". UTC, NOT the viewer's zone: the activity bars
 *  bucket by UTC day, so a local-zone label drifts a day off the data west of Greenwich (a Jun 2 00:00Z
 *  bucket read "Jun 1" in Saskatchewan while the row beside it said "Jun 2"). */
function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The FIRE-TIMELINE block for a reported fire — two honest sources on ONE time axis:
 *   • bars  — satellite heat detections per day from the whole-season CWFIS archive (fetchFireActivity),
 *             the fire's real activity curve back to its FIRST in-season detection (usually days/weeks
 *             before we ever tracked it — the agency feeds carry no discovery date at all);
 *   • line  — the agency's reported size over the window OUR snapshot backend has tracked it
 *             (fetchFireHistory), drawn STEP-AFTER: an estimate HOLDS until the next sitrep revises it
 *             (a slope would fabricate continuous growth — the BORDER-fire "grew 1,810 ha over 26 h" lesson).
 * The change row is anchored "since <first sitrep date>" (never an implied growth RATE) and the satellite
 * row is "since at least" by construction — a capped fetch is surfaced as a hatched leading column, a
 * "before <day>" axis label, and a clause in the footnote. Either source may be null (unavailable) — the
 * block renders what it has and returns '' only when both are empty.
 */
function fireHistoryHtml(points: FireHistoryPoint[] | null, activity: FireActivity | null, f: ReportedFire): string {
  // Time axis = the SOURCE's report time (sitrep date), NOT our poll time. `observedAt` is just when
  // the ingest cron happened to run (every 10 min), so using it reported "grew X over 31 min" on EVERY
  // fire at once — that 31 min was the gap between two cron runs, not the fire's real growth interval.
  // Fall back to `observedAt` only for a snapshot with no source date; sorting by sitrep time keeps the
  // step chart monotonic even when a later poll carries a backward-revised sitrep date.
  const tOf = (p: FireHistoryPoint): number => p.reportedAt || p.observedAt;
  const sized = (points ?? []).filter((p) => p.sizeHa >= 0).sort((a, b) => tOf(a) - tOf(b));
  const stages: string[] = [];
  for (const p of points ?? []) if (!stages.length || stages[stages.length - 1] !== p.stage) stages.push(p.stage);
  // ONE sized snapshot is enough to anchor the reported-change row (it compares that first tracked size
  // against the fire's CURRENT reported size). Whether the size LANE itself draws is a separate call —
  // see `showSize` below, which also forces it whenever the activity curve is clipped or missing.
  const haveSpark = sized.length >= 1 && sized.some((p) => p.sizeHa > 0);
  const haveStagePath = stages.length >= 2;
  if (!points?.length && !activity) return ''; // nothing from either source → stay silent

  // One shared domain: first in-season satellite detection → freshest report, whichever sides exist.
  const DAY = 86_400_000;
  const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`);
  let t0 = haveSpark ? tOf(sized[0]) : Infinity;
  let t1 = haveSpark ? tOf(sized[sized.length - 1]) : -Infinity;
  if (activity) {
    t0 = Math.min(t0, dayStart(activity.days[0].day));
    t1 = Math.max(t1, dayStart(activity.days[activity.days.length - 1].day) + DAY);
  }
  const haveChart = Number.isFinite(t0) && t1 > t0;
  const hasFrp = !!activity && activity.days.some((d) => d.frp > 0);

  // The fire's LIFE story is the satellite-activity curve (it spans the whole burn, May→now), NOT the
  // reported size (our snapshot backend only catches the last stretch, often at one flat figure). So the
  // PRIMARY chart is "Fire activity" — daily satellite columns whose height shows the fire ramp up, peak,
  // and die down. Reported size is a SECONDARY lane, normally shown only when it actually changed (≥2
  // distinct figures) since a flat block adds nothing (the current size already leads in the summary above).
  // EXCEPTION: when the activity lane is missing or CLIPPED by the fetch cap, that flat block is the only
  // AGENCY-reported series on the panel — draw it, so a truncated satellite curve is never the sole chart.
  const sizedDistinct = new Set(sized.map((p) => p.sizeHa)).size;
  const activityIsWhole = !!activity && !activity.clipped;
  const showSize = haveSpark && (sizedDistinct >= 2 || !activityIsWhole);
  let spark = '';
  let changeRow = '';
  if (haveChart) {
    const W = 252, padX = 2;
    const span = Math.max(1, t1 - t0);
    const xOf = (t: number): number => padX + ((t - t0) / span) * (W - 2 * padX);

    // ── Lane 1 (PRIMARY): FIRE ACTIVITY — one column per UTC day. Two DIFFERENT signals on two channels,
    // each mapped to the thing it actually measures:
    //   HEIGHT  = detection COUNT that day — how MUCH was burning hot enough to see (the extent signal,
    //             and the one the ramp-up/peak/die-down envelope below is a story about).
    //   WARMTH  = that day's PEAK FRP — how INTENSE it got at its hottest pixel.
    // Do NOT drive height from FRP: peak FRP is one pixel's radiative power and carries no extent
    // information, so it inverts the envelope — on ON_THU_FIRE_036 (301,240 ha) Jul 15 had 1,693
    // detections vs Jul 16's 1,299, yet peak-FRP height drew Jul 15 at 48% of Jul 16. Height stays
    // count-based; FRP only tints. ──
    let actLane = '';
    if (activity) {
      const AH = 42, aPad = 4;
      const maxFrp = Math.max(...activity.days.map((d) => d.frp), 0);
      const maxCount = Math.max(...activity.days.map((d) => d.count), 1);
      const cols = activity.days.map((d, i) => {
        const x = xOf(dayStart(d.day));
        const w = Math.max(0.8, xOf(dayStart(d.day) + DAY) - x);
        const extent = d.count / maxCount;                       // height: how much burned
        const heat = maxFrp > 0 ? d.frp / maxFrp : extent;       // warmth: how hot it got
        const h = Math.max(1.4, extent * (AH - 2 * aPad));
        // The OLDEST column is a partial day when the fetch hit its row cap mid-stream (see `clipped`):
        // it is a fetch boundary, not the fire waking up. Hatch it so it never reads as a real ramp-up.
        const partial = activity.clipped && i === 0;
        const fill = partial ? 'url(#fclip)' : 'var(--ember)';
        return `<rect x="${x.toFixed(1)}" y="${(AH - aPad - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" fill-opacity="${(0.42 + 0.58 * heat).toFixed(2)}"/>`;
      }).join('');
      // Hatch pattern for the clipped leading column — declared only when it's actually used.
      const clipDef = activity.clipped
        ? `<defs><pattern id="fclip" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
          `<rect width="3" height="3" fill="var(--ember)" fill-opacity="0.35"/>` +
          `<line x1="0" y1="0" x2="0" y2="3" stroke="var(--ember)" stroke-width="1.4"/></pattern></defs>`
        : '';
      const baseY = (AH - aPad).toFixed(1);
      actLane =
        `<div class="flane-h">Fire activity${hasFrp ? ' · satellite heat' : ''}</div>` +
        `<svg class="flane-svg" viewBox="0 0 ${W} ${AH}" preserveAspectRatio="none" role="img" aria-label="Satellite-detected fire activity per day over the fire's life: column height is detections that day, warmth is peak intensity">` +
        clipDef +
        `<line x1="${padX}" y1="${baseY}" x2="${W - padX}" y2="${baseY}" stroke="var(--hair)" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
        cols + `</svg>`;
    }

    // ── Lane 2 (only when size actually changed): REPORTED SIZE, step-after (a size HOLDS until the next
    // sitrep revises it — a sloped line would fabricate continuous measured growth). ──
    let sizeLane = '';
    if (showSize) {
      const SH = 38, sPad = 5;
      const maxHa = Math.max(...sized.map((p) => p.sizeHa), 1);
      const yOf = (ha: number): string => (SH - sPad - (ha / maxHa) * (SH - 2 * sPad)).toFixed(1);
      const pts: string[] = [];
      let prevY = '';
      for (const p of sized) {
        const x = xOf(tOf(p)).toFixed(1), y = yOf(p.sizeHa);
        if (prevY) pts.push(`${x},${prevY}`);
        pts.push(`${x},${y}`);
        prevY = y;
      }
      pts.push(`${(W - padX).toFixed(1)},${prevY}`);
      const line = pts.join(' ');
      const baseY = (SH - sPad).toFixed(1);
      const area = `${xOf(tOf(sized[0])).toFixed(1)},${baseY} ${line} ${(W - padX).toFixed(1)},${baseY}`;
      sizeLane =
        `<div class="flane-h">Reported size</div>` +
        `<svg class="flane-svg" viewBox="0 0 ${W} ${SH}" preserveAspectRatio="none" role="img" aria-label="Reported fire size over time">` +
        `<line x1="${padX}" y1="${baseY}" x2="${W - padX}" y2="${baseY}" stroke="var(--hair)" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
        `<polygon points="${area}" fill="var(--ember-12)" stroke="none"/>` +
        `<polyline points="${line}" fill="none" stroke="var(--ember-hi)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
        `</svg>`;
    }

    // Left-edge label: when the activity fetch hit its row cap, t0 is where OUR RECORD starts, not where
    // the fire did — say "before <day>" so the axis can't be read as the fire's beginning.
    const leftClipped = !!activity && activity.clipped && dayStart(activity.days[0].day) <= t0;
    const d0 = `${leftClipped ? 'before ' : ''}${fmtDay(t0)}`, d1 = fmtDay(t1 - 1);
    spark = (actLane || sizeLane)
      ? `<div class="fchart">${actLane}${sizeLane}<div class="fcap"><span>${esc(d0 === d1 ? '' : d0)}</span><span>${esc(d1)}</span></div></div>`
      : '';
  }
  // Gated on having ANY sized snapshot, not on the size LANE being drawn: the comparison is
  // first-tracked-size → the fire's CURRENT reported size (f.sizeHa), which needs only one stored point.
  if (haveSpark) {
    const last = f.sizeHa >= 0 ? f.sizeHa : sized[sized.length - 1].sizeHa;
    const delta = last - sized[0].sizeHa;
    const arrow = delta > 1 ? '▲' : delta < -1 ? '▼' : '•';
    const verb = delta > 1 ? 'grew' : delta < -1 ? 'shrank' : 'held';
    const mag = Math.abs(delta) >= 1 ? ` ${esc(LIVEFIRE_COPY.fireSize(Math.abs(delta)))}` : '';
    // Anchored to the first sitrep DATE, never phrased as a rate — the reported-size change since we
    // began tracking, which is all this is.
    changeRow = `<div class="frow"><span class="fk">Reported change</span><span class="fv">${arrow} ${verb}${mag} since ${esc(fmtDay(tOf(sized[0])))}</span></div>`;
  }

  // The honest AGE anchor: the first satellite detection — NOT "First tracked" (our snapshot backend's
  // ingest start, which made a months-old fire look days young). "since at least" by construction (a smoulder
  // can predate the first pass; a capped fetch can miss the true start), so it's "~"/"before", never exact.
  const detectedRow = activity
    ? `<div class="frow"><span class="fk">First detected</span><span class="fv">${esc(`${activity.clipped ? 'before ' : '~'}${fmtDay(activity.firstAt)} · ${activity.total.toLocaleString()} detections`)}</span></div>`
    : '';
  const stageRow = haveStagePath
    ? `<div class="frow"><span class="fk">Stage path</span><span class="fv">${esc(stages.map((s) => stageLabel(s as ReportedFire['stage'])).join(' → '))}</span></div>`
    : '';
  // Nothing charted, no stage history: say so plainly rather than dropping the block — the fire IS tracked,
  // it just hasn't moved. A fire crews have already won (held / under control / out) says THAT, not "quiet".
  const quietRow = !spark && !haveStagePath
    ? `<div class="frow"><span class="fk">Reported change</span><span class="fv" style="color:var(--faint)">${esc(
        // "Holding" is the specific label for BH (Being held) — stageStep(…) >= 1 also matched UC and
        // told an under-control fire it was "Holding". Each stage says its own thing now.
        f.stage === 'OUT' ? 'Reported out — no further change'
          : f.stage === 'UC' ? 'Under control — no size change recorded yet'
            : f.stage === 'BH' ? 'Holding — no size change recorded yet'
              : 'No changes recorded yet',
      )}</span></div>`
    : '';
  const note = `<p class="alertnote" style="margin-top:6px;">${
    activity
      ? `Fire activity = satellite thermal detections within ~10 km, per day (taller = more detections${hasFrp ? ', warmer = more intense' : ''}); nearby fires can overlap. ${
          activity.clipped ? 'The hatched first column is where our record begins, not the fire — the archive fetch hit its row limit. ' : ''
        }`
      : ''
  }Sizes are agency estimates, revised at each report${activity ? '' : '; the fire may have been burning before tracking began'}.</p>`;

  return `<div class="fgroup"><div class="fgh">Fire timeline</div>${spark}${detectedRow}${changeRow}${stageRow}${quietRow}${note}</div>`;
}

/**
 * The console STATUS READOUT — the tracker's headline, and the thing the old design got most wrong.
 *
 * "890 active fires" is the most arresting fact on the site and it used to render as 14px of grey
 * ticker text wedged beside a refresh icon. Here it's an instrument: one huge live number, the plain
 * sentence that says what it counts, and a segmented threat bar carrying the OC/BH/UC split at a
 * glance — so the proportion still burning out of control is legible without reading a single digit.
 *
 * Still rendered from the honest `RegionStats` POJO (all the "is this number real for this region"
 * logic lives in `deriveRegionStats`), so a region with no source reads as unavailable rather than
 * quietly borrowing Canada's number.
 */
function consoleReadoutHtml(s: RegionStats): string {
  const C = LIVEFIRE_COPY.console;
  const S = LIVEFIRE_COPY.strip;
  if (s.scope === 'down') return `<div class="fread down">${ic('shield', 'fread-ic')}<span>${esc(S.down)}</span></div>`;
  const num = (n: number): string => n.toLocaleString();

  // The headline number. US/MX have no official reported roll, so satellite detections are the only
  // honest headline there — and it gets its own label rather than being passed off as "active fires".
  const foreign = s.scope === 'foreign';
  const headline = foreign ? s.hotspots : s.active;
  const headCap = foreign ? esc(S.detectionsLabel) : esc(C.burningLabel(headline ?? 0));

  const main = headline == null
    ? `<div class="fread-main"><span class="fread-na">${esc(S.na)}</span><span class="fread-cap">${headCap} ${esc(C.burningIn(s.label))}</span></div>`
    : `<div class="fread-main">
        <b class="fread-num">${esc(num(headline))}</b>
        <span class="fread-cap"><span class="fread-what">${headCap}</span><span class="fread-where">${esc(C.burningIn(s.label))}</span></span>
      </div>`;

  // The threat bar: proportion out of control / being held / under control. Segments are flex-weighted
  // by count, so the bar IS the ratio — no legend arithmetic. A zero-count stage collapses out of it.
  let threat = '';
  if (s.byStage) {
    const b = s.byStage;
    const total = b.OC + b.BH + b.UC;
    if (total > 0) {
      const seg = (k: 'OC' | 'BH' | 'UC'): string =>
        b[k] > 0 ? `<i class="${k.toLowerCase()}" style="flex:${b[k]}" title="${esc(C.stage[k])}"></i>` : '';
      const key = (k: 'OC' | 'BH' | 'UC'): string =>
        `<span class="tkey ${k.toLowerCase()}"><i></i><b>${esc(num(b[k]))}</b>${esc(C.stage[k])}</span>`;
      threat = `<div class="fread-threat">
        <div class="tbar">${seg('OC')}${seg('BH')}${seg('UC')}</div>
        <div class="tkeys">${key('OC')}${key('BH')}${key('UC')}</div>
      </div>`;
    }
  }

  // Supporting instruments — each collapses to nothing rather than printing a borrowed number.
  const stat = (value: string | null, label: string): string =>
    value == null ? '' : `<span class="fread-stat"><b>${esc(value)}</b><i>${esc(label)}</i></span>`;
  const side = [
    stat(s.reportedToday != null ? num(s.reportedToday) : null, C.todayLabel),
    stat(s.areaBurnedHa != null ? LIVEFIRE_COPY.fireSize(s.areaBurnedHa) : null, C.areaLabel),
    stat(s.prepLevel != null ? `L${s.prepLevel}` : null, C.prepLabel),
  ].join('');
  const stamp = s.asOfMs ? `<span class="fread-stamp">${esc(publishedWhen(s.asOfMs))}</span>` : '';

  return `<div class="fread">
    <div class="fread-lead"><span class="fread-live"><i></i>${esc(C.liveTag)}</span>${main}</div>
    ${threat}
    <div class="fread-side">${side}${stamp}</div>
  </div>`;
}

/**
 * The TRIAGE RAIL — "what should I actually look at?"
 *
 * A live map of ~900 fires is honest and useless to a member of the public: every mark looks equally
 * important. This is the civilian version of the judgement a dispatcher applies — the handful of fires
 * worth a look, each showing the INPUTS that put it there (size, stage, nearest town + distance) so
 * the ordering is inspectable rather than an oracle. Rank numbers match the animated halos on the map,
 * so a row and a mark are visibly the same fire. Tapping a row flies the map to it and opens its record.
 *
 * The rail never shows a score, and closes with the honesty note: this is our reading of public data,
 * not an agency assessment (see `livefire/triage.ts`).
 */
function threatRailHtml(rows: ThreatRow[]): string {
  const C = LIVEFIRE_COPY.console;
  const head = `<div class="frail-head">
      <div class="grow" style="min-width:0;">
        <div class="frail-ttl">${esc(C.railTitle)}</div>
        <div class="frail-sub">${esc(C.railSub)}</div>
      </div>
      <button class="iconbtn frail-x" data-lf-railclose aria-label="Close">${ic('close')}</button>
    </div>`;
  if (!rows.length) return `${head}<div class="frail-empty">${esc(C.railEmpty)}</div>`;

  const list = rows
    .map((r, i) => {
      const f = r.fire;
      const size = f.sizeHa > 0 ? LIVEFIRE_COPY.fireSize(f.sizeHa) : C.sizeUnknown;
      const near = r.near ? esc(C.near(r.near.km, r.near.name)) : '';
      // `name` is REMOTE feed text — escaped, like every other user/remote string in this file.
      const label = f.name ? esc(f.name) : esc(f.fireId || C.unnamed);
      return `<button class="frow" type="button" data-lf-focus="${i}">
        <span class="frow-rank">${i + 1}</span>
        <span class="frow-body">
          <span class="frow-top"><b class="frow-size${f.sizeHa > 0 ? '' : ' unk'}">${esc(size)}</b><span class="${stageClass(f.stage)}">${esc(stageLabel(f.stage))}</span></span>
          <span class="frow-near">${near}</span>
          <span class="frow-id">${label}</span>
        </span>
        ${ic('chevron-right', 'frow-go')}
      </button>`;
    })
    .join('');
  return `${head}<div class="frail-list">${list}</div><div class="frail-note">${esc(C.railNote)}</div>`;
}

/**
 * Live fire map — the tracker. A full-bleed Leaflet map (dark tiles, pinch-zoom) plots EVERY live CWFIS
 * satellite hotspot across the continent (last 24h); tapping a dot slides up the full CWFIS record for
 * that fire. Best-effort: a warm cache paints instantly; offline/empty get honest states. Leaflet is
 * dynamically imported so it only loads when the map is opened (keeps the home bundle lean). Opened from
 * the Home banner (like Board/Settings — not a rail tab); the map owns its own pan/zoom (page never scrolls).
 */
/** The live wildfire tracker. `navMarkup` (optional) overrides the bottom nav: the FRONT DOOR passes its
 *  own tabbar (`tabbarMarkup('map')`) so the tracker reads as a front-door page; called bare (from the
 *  in-game home) it falls back to the mode rail with Home lit. `topNav` (optional) is the brand+nav
 *  fragment (`brandNavHtml('map')`) the front door slips into the LEFT of the control bar — so the map
 *  wears the logo + wordmark + sitemap nav like every other front-door page (one merged bar, no 2nd row;
 *  `.fhome-nav` is desktop-only, mobile leans on the tab bar). */
export function openLiveFires(navMarkup?: string, topNav?: string): void {
  activeOverlay?.close(); // opened directly (not via the rail) — clear any panel that was up
  const options = COUNTRIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  const C = LIVEFIRE_COPY;
  // The FWI raster draws a near-term FORECAST day (the continuous full-coverage grid); this is the day the
  // ledger names it for ("Forecast · Jun 10"). Computed once so the tile layer + the label always agree.
  const fwiDayLabel = new Date(`${fwiForecastTime()}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // The console STATUS READOUT (data-lf-ticker), repainted by `paintStats` from a pure
  // `deriveRegionStats(region,…)` so it is HONEST to the chosen region (country OR Canadian province):
  // any metric with no per-region source collapses rather than showing a Canada number under another
  // label. One huge live number + the stage-split threat bar + supporting instruments. See
  // `consoleReadoutHtml`.
  const statStrip = `<div class="fstat-ticker" data-lf-ticker><span class="fstat-load">${esc(C.bannerLoading)}</span></div>`;

  // The six map layers, grouped into two tiers (Fires / Weather) and surfaced inside the summoned LAYERS
  // sheet — not a crammed permanent chip row. Each carries the legend swatch its mark draws with.
  // Default-on = active fires + hotspots + burn area only; the rest are opt-in.
  type LayerRow = { id: FireLayer; tier: 'fires' | 'weather'; label: string; hint: string; swatch: string };
  const ALL_LAYERS: LayerRow[] = [
    { id: 'reported', tier: 'fires', label: C.layers.reported, hint: C.layerHint.reported, swatch: 'oc' },
    { id: 'hotspots', tier: 'fires', label: C.layers.hotspots, hint: C.layerHint.hotspots, swatch: 'ramp' },
    { id: 'perimeters', tier: 'fires', label: C.layers.perimeters, hint: C.layerHint.perimeters, swatch: 'scar' },
    { id: 'out', tier: 'fires', label: C.layers.out, hint: C.layerHint.out, swatch: 'neutral' },
    { id: 'fwi', tier: 'weather', label: C.layers.fwi, hint: C.layerHint.fwi, swatch: 'fwiramp' },
    { id: 'smoke', tier: 'weather', label: C.layers.smoke, hint: C.layerHint.smoke, swatch: 'smoke' },
  ];
  // FWI + smoke are live WMS feeds, so the kill-switch drops them entirely (never hit CWFIS when disabled).
  const LIVE_WMS = new Set<FireLayer>(['fwi', 'smoke']);
  // Visible-layer mirror (matches FireMap's own default `visible`); mutated as toggles flip in the sheet.
  const layerOn: Record<FireLayer, boolean> = { reported: true, out: false, hotspots: true, perimeters: true, fwi: false, smoke: false };

  // The header is now TWO slim rows, not three: a control bar (region filter + refresh + the Layers /
  // Sources sheet buttons) and the compact status block above — so the map keeps far more height.
  // The map keeps a slim two-item control bar (region filter + refresh); the Layers + Sources sheet
  // openers FLOAT as icon buttons over the map's top-right corner (Leaflet's zoom is top-left, so the
  // corner is clear). On a phone that's the only place they fit — in the bar they overflowed off-screen.
  const body = `<div class="firewrap">
    <div class="firebar">
      ${topNav ?? ''}
      <select class="firesel" data-lf-region aria-label="Region filter">${options}</select>
      <span class="grow"></span>
      <button class="iconbtn" data-lf-refresh aria-label="Refresh">${ic('refresh')}</button>
    </div>
    <div class="firestats" data-lf-stats>${statStrip}</div>
    <div class="firemapwrap">
      <div class="firemap" data-lf-map></div>
      <!-- Honest "feeds down" banner: shown ONLY when BOTH authoritative sources (CIFFC reported + national
           summary) are unreachable, so a blank basemap never reads as "no fires". Toggled after each load. -->
      <div class="firedown" data-lf-down hidden role="status">
        <b>${esc(C.offlineTitle)}</b>
        <span>${esc(C.offlineBody)}</span>
        <a href="${LIVEFIRE_SOURCES.summary.url}" target="_blank" rel="noopener">Official sources ↗</a>
      </div>
      <!-- The triage rail. On a wide screen it DOCKS to the left of the map (it's the reason to be on
           this page, not an afterthought behind a button); on a phone there's no room for a permanent
           dock, so it collapses and is summoned by the ⚑ float button as a bottom sheet. Same markup
           either way — one builder, two placements, driven entirely by CSS. -->
      <aside class="firerail" data-lf-rail></aside>
      <div class="firefloat">
        <button class="fmbtn rail" data-lf-threats aria-label="${esc(C.console.railBtn)}" title="${esc(C.console.railBtn)}">${ic('alert')}</button>
        <button class="fmbtn" data-lf-layers aria-label="${esc(C.layersBtn)}" title="${esc(C.layersBtn)}">${ic('layers')}<span class="fmn" data-lf-layern></span></button>
        <button class="fmbtn" data-lf-firewx aria-pressed="false" aria-label="${esc(C.fireWxBtn)}" title="${esc(C.fireWxBtn)}">${ic('fire')}</button>
        <!-- Daylight: the dark console is the default, but a dark map genuinely loses its marks
             outdoors in glare — the sun-readable light basemap stays one tap away. -->
        <button class="fmbtn" data-lf-day aria-pressed="false" aria-label="${esc(C.console.daylightBtn)}" title="${esc(C.console.daylightBtn)}">${ic('sun')}</button>
      </div>
      <div class="firebottom">
        <div class="firelegend" data-lf-legend hidden aria-hidden="true">
          <div class="fl-scale">${FWI_BANDS.map((b) => `<i class="fl-sw" style="background:${b.color}" title="${b.label}"></i>`).join('')}</div>
          <div class="fl-labels">${FWI_BANDS.map((b) => `<span class="fl-lb">${b.label}</span>`).join('')}</div>
        </div>
      <div class="firescrub" data-lf-scrub hidden>
        <button class="iconbtn" data-lf-play aria-label="Play forecast">${ic('play')}</button>
        <div class="scrubtrack" data-lf-scrubtrack>
          <input type="range" class="scrubrange" data-lf-range min="0" max="0" value="0" step="1" aria-label="Forecast time" />
          <div class="scrubrail"><span data-lf-rail-a>Now</span><span data-lf-rail-b>+${LIVEFIRE.smokeForecastHours} h</span></div>
        </div>
        <div class="scrublabel"><span class="scrubwhen"><b data-lf-scrub-time>—</b><i data-lf-scrub-lead>Now</i></span><span class="scrubtag">Forecast</span></div>
        </div>
      </div>
      <div class="firesheet" data-lf-sheet hidden></div>
    </div>
  </div>`;
  // The map view lives in a lazy chunk, so it's built asynchronously below. `closed` guards every
  // async continuation: if the overlay is dismissed (Esc / rail / another panel) before the chunk
  // resolves, the onClose hook flips it and we never build/operate a map on a detached container.
  let map: LiveMapView | null = null;
  let closed = false;
  let smokeTimer: number | null = null; // the smoke-forecast playback interval (MUST be cleared on close)
  const { root } = overlay('fires', C.overlayTitle, body, () => {
    closed = true; // (railActive 'home' below — the tracker is a Home sub-screen, so the rail still lights a tab)
    delete (window as unknown as { __fireQA?: unknown }).__fireQA; // release the QA hook + its retained DOM
    if (smokeTimer !== null) { clearInterval(smokeTimer); smokeTimer = null; } // no orphaned interval (leak guard)
    map?.dispose();
    map = null;
  }, 'home', navMarkup);

  const tickerEl = root.querySelector<HTMLElement>('[data-lf-ticker]')!;
  const mapEl = root.querySelector<HTMLElement>('[data-lf-map]')!;
  const downEl = root.querySelector<HTMLElement>('[data-lf-down]')!;
  const sheetEl = root.querySelector<HTMLElement>('[data-lf-sheet]')!;
  const refreshBtn = root.querySelector<HTMLButtonElement>('[data-lf-refresh]')!;
  const layersBtn = root.querySelector<HTMLButtonElement>('[data-lf-layers]')!;
  const fireWxBtn = root.querySelector<HTMLButtonElement>('[data-lf-firewx]')!;
  const railEl = root.querySelector<HTMLElement>('[data-lf-rail]')!;
  const threatsBtn = root.querySelector<HTMLButtonElement>('[data-lf-threats]')!;
  const dayBtn = root.querySelector<HTMLButtonElement>('[data-lf-day]')!;
  const layerCountEl = root.querySelector<HTMLElement>('[data-lf-layern]')!;
  const regionEl = root.querySelector<HTMLSelectElement>('[data-lf-region]')!;
  const scrubEl = root.querySelector<HTMLElement>('[data-lf-scrub]')!;
  const legendEl = root.querySelector<HTMLElement>('[data-lf-legend]')!;
  const scrubTrackEl = root.querySelector<HTMLElement>('[data-lf-scrubtrack]')!;
  const playBtn = root.querySelector<HTMLButtonElement>('[data-lf-play]')!;
  const rangeEl = root.querySelector<HTMLInputElement>('[data-lf-range]')!;
  const scrubTimeEl = root.querySelector<HTMLElement>('[data-lf-scrub-time]')!;
  const scrubLeadEl = root.querySelector<HTMLElement>('[data-lf-scrub-lead]')!;
  const railAEl = root.querySelector<HTMLElement>('[data-lf-rail-a]')!;
  const railBEl = root.querySelector<HTMLElement>('[data-lf-rail-b]')!;

  const offline: FeedMeta = { status: 'unavailable', fromCache: false, publishedAt: 0, fetchedAt: 0 };
  let hsFeed: LiveFireFeed = { hotspots: [], fireCount: 0, totalDetections: 0, meta: offline };
  let reportedFeed: ReportedFeed = { fires: [], out: [], byStage: { OC: 0, BH: 0, UC: 0, OUT: 0, UNK: 0 }, meta: offline };
  let summary: NationalSummary | null = null;
  let burnFeed: BurnFeed = { polys: [], meta: offline };
  let fwiMeta: FeedMeta = offline;
  let biggest: ReportedFire | null = null; // tracked for the ?qa detail-panel hook below
  let hottest: Hotspot | null = null;
  // The two FORECAST rasters share ONE bottom scrubber. `forecastMode` says which one it currently drives
  // (the layer you turned on last); the other holds its frame. Smoke = HOURLY (+48h); fire weather = DAILY
  // model grids (today … +N), labeled forecasts — today is the default instant, never presented as observed.
  const smokeMeta: FeedMeta = { status: isLiveFireEnabled() ? 'live' : 'disabled', fromCache: false, publishedAt: 0, fetchedAt: 0 };
  const smokeFrames = smokeForecastFrames(Date.now(), LIVEFIRE.smokeForecastHours);
  let smokeIdx = 0;
  // Continuous model fire-weather, TODAY first (the default instant) then the outlook forward (today … +N-1,
  // UTC days); span + pace are config tokens. Frame 0 = today so the layer always loads on a slice with data.
  const fwiFrames = Array.from({ length: LIVEFIRE.fwiForecastDays }, (_, i) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10));
  let fwiIdx = 0;
  let fwiPreloaded = false; // warm all day-images once, the first time FWI takes the scrubber (Play = instant)
  let forecastMode: 'none' | 'smoke' | 'fwi' = 'none';
  let forecastPlaying = false;
  let region: RegionFilter = getRegionPref(); // country + optional Canadian province; defaults to Canada
  regionEl.value = regionValue(region);
  // Rebuild the region <select> from the live feed (Canada + only the provinces that HAVE fires), keeping
  // the current pick if still valid. Called after each load once `reportedFeed` is populated; skipped while
  // the native dropdown is focused-open so we never collapse it under the user.
  let regionOptKey = ''; // the option-set signature last rendered (rebuild only when it changes)
  const rebuildRegionOptions = (): void => {
    if (document.activeElement === regionEl) return; // don't yank an open dropdown
    const opts = regionOptions(reportedFeed);
    const key = opts.map((o) => o.value).join(',');
    if (key === regionOptKey) return;
    regionOptKey = key;
    let html = '';
    let group = '';
    for (const o of opts) {
      if (o.group !== group) { if (group) html += '</optgroup>'; html += `<optgroup label="${esc(o.group)}">`; group = o.group; }
      html += `<option value="${esc(o.value)}">${esc(o.label)}</option>`;
    }
    if (group) html += '</optgroup>';
    regionEl.innerHTML = html;
    if (!opts.some((o) => o.value === regionValue(region))) region = { country: 'CA' }; // saved province vanished
    regionEl.value = regionValue(region);
  };

  const wireClose = (): void => {
    sheetEl.querySelector('[data-lf-close]')?.addEventListener('click', () => {
      sheetEl.hidden = true;
    });
  };
  let detailToken = 0; // bumped per open, so a slow history fetch can't paint into a newer selection
  const showReported = (f: ReportedFire): void => {
    sheetEl.classList.add('bottom'); // a fire detail opens from the BOTTOM (full width for the name + chips)
    sheetEl.innerHTML = reportedDetailHtml(f);
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
    // Enrich with the fire's timeline — BOTH sources in parallel, one paint: the tracked size/stage
    // history from our ingestion backend (null = backend unavailable) and the season's satellite
    // activity near the fire from the CWFIS archive (null = unavailable or nothing in-season, and the
    // only public record that predates our tracking). Best-effort: whatever answered gets rendered.
    const token = ++detailToken;
    void Promise.all([
      f.fireId ? fetchFireHistory(f.fireId, f.source) : Promise.resolve(null),
      fetchFireActivity(f.lat, f.lon),
    ]).then(([points, activity]) => {
      if (closed || token !== detailToken || (points === null && activity === null)) return;
      const host = sheetEl.querySelector<HTMLElement>('[data-lf-hist]');
      if (host) host.innerHTML = fireHistoryHtml(points, activity, f);
    });
  };
  const showHotspot = (h: Hotspot): void => {
    sheetEl.classList.add('bottom'); // detail = bottom sheet (the Layers / Sources sheets stay on the right)
    sheetEl.innerHTML = fireDetailHtml(h);
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
  };
  // QA hook (mirrors main.ts's gated `window.__game`): the dots render to CANVAS, so a headless run
  // can't click a specific fire — this opens the detail sheet by (partial) fire id instead. DEV/?qa only.
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('qa')) {
    (window as unknown as Record<string, unknown>).__lfShow = (idPart: string): string | null => {
      const q = idPart.toUpperCase();
      const f = [...reportedFeed.fires, ...reportedFeed.out].find((r) => r.fireId.toUpperCase().includes(q));
      if (f) showReported(f);
      return f ? f.fireId : null;
    };
  }
  // The SOURCE LEDGER — the trust hero. Every layer, its live/cached/down status, its SOURCE publish time,
  // and a link to the authoritative origin, plus the "not an emergency tool" line. This is what lets the
  // honest window show fragile data honestly: a dead feed reads "unavailable", never a silent blank.
  const ledgerHtml = (): string => {
    const rows: { key: keyof typeof LIVEFIRE_SOURCES; meta: FeedMeta }[] = [
      { key: 'reported', meta: reportedFeed.meta },
      { key: 'hotspots', meta: hsFeed.meta },
      { key: 'perimeters', meta: burnFeed.meta },
      { key: 'fwi', meta: fwiMeta },
      { key: 'smoke', meta: smokeMeta },
      { key: 'summary', meta: summary?.meta ?? offline },
    ];
    const rowHtml = rows
      .map(({ key, meta }) => {
        const info = LIVEFIRE_SOURCES[key];
        // Per-source freshness, honestly: smoke + FWI are FORECASTS (name them so + the day in view, never
        // "updated X ago"); the rest use their real source publish time.
        const fresh =
          key === 'smoke' && meta.status === 'live'
            ? smokeFreshness(currentSmokeFrame())
            : key === 'fwi'
              ? fwiFreshness(meta, fwiDayLabel)
              : freshnessLine(meta);
        return `<a class="lrow" href="${info.url}" target="_blank" rel="noopener">
          <i class="sdot ${statusDotClass(meta)}"></i>
          <span class="grow" style="min-width:0;"><span class="lname">${esc(info.label)}</span><span class="lwhat">${esc(info.what)}</span></span>
          <span class="lfresh">${esc(fresh)}</span>
        </a>`;
      })
      .join('');
    return `<div class="fsheet-head">
        <div class="grow" style="min-width:0;"><div class="fsheet-ttl">Data sources</div><div class="s">Where this comes from &amp; how fresh it is</div></div>
        <button class="iconbtn" data-lf-close aria-label="Close">${ic('close')}</button>
      </div>
      <div class="ledger">${rowHtml}
        <a class="lrow link" href="${SK_OFFICIAL.url}" target="_blank" rel="noopener"><i class="sdot link"></i><span class="grow" style="min-width:0;"><span class="lname">${esc(SK_OFFICIAL.label)}</span><span class="lwhat">Saskatchewan's official viewer, opens in a new tab</span></span><span class="lfresh">official ↗</span></a>
        <div class="lnote">${esc(NOT_FOR_EMERGENCY)}</div>
      </div>`;
  };
  const showLedger = (): void => {
    sheetEl.classList.remove('bottom'); // the Sources ledger is a right-drawer sheet (reached from Layers)
    sheetEl.innerHTML = ledgerHtml();
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
  };

  // ── Forecast playback — ONE scrubber for both rasters (smoke = hourly, fire weather = daily), honestly
  //    labeled a FORECAST. `forecastMode` selects which raster the strip drives; the other holds its frame. ──
  const currentSmokeFrame = (): string | null => smokeFrames[smokeIdx] ?? null; // still used by the ledger
  const fcFrames = (): string[] => (forecastMode === 'fwi' ? fwiFrames : smokeFrames);
  const fcIdx = (): number => (forecastMode === 'fwi' ? fwiIdx : smokeIdx);
  const fcSetIdx = (i: number): void => { if (forecastMode === 'fwi') fwiIdx = i; else smokeIdx = i; };

  const applyForecastFrame = (): void => {
    if (forecastMode === 'none') return;
    const fs = fcFrames();
    const i = Math.min(fs.length - 1, Math.max(0, fcIdx()));
    const f = fs[i];
    if (!f) return;
    if (forecastMode === 'fwi') {
      map?.setFwiTime(f);
      // Render in UTC so the day matches the UTC forecast date `f` + the "+N d" chip (a local-TZ render of
      // UTC-midnight skews a day in negative-offset zones).
      scrubTimeEl.textContent = new Date(`${f}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      scrubLeadEl.textContent = i === 0 ? 'Today' : `+${i} d`; // fwiFrames start at today, so frame 0 = today, frame i = "+i days"
    } else {
      map?.setSmokeTime(f);
      scrubTimeEl.textContent = frameTimeLabel(f); // absolute: "Mon 6 PM"
      scrubLeadEl.textContent = forecastLeadLabel(i); // lead chip: "Now" / "+6 h" (frames are hourly)
    }
    if (rangeEl.value !== String(i)) rangeEl.value = String(i);
  };
  const stopForecast = (): void => {
    forecastPlaying = false;
    if (smokeTimer !== null) { clearInterval(smokeTimer); smokeTimer = null; }
    playBtn.innerHTML = ic('play');
    playBtn.setAttribute('aria-label', 'Play forecast');
  };
  const playForecast = (): void => {
    if (forecastMode === 'none' || fcFrames().length < 2 || closed) return;
    // Warm the whole forecast week NOW — first Play only, and only for FWI (smoke is WMS tiles). Deferred off
    // the toggle path so turning Fire Weather ON stays a fast single-frame "today" load; by the time the first
    // day-step fires (after fwiFrameMs) the next frames are warming, so Play still morphs without a hard stall.
    if (forecastMode === 'fwi' && !fwiPreloaded) { fwiPreloaded = true; map?.preloadFwi?.(fwiFrames); }
    if (smokeTimer !== null) clearInterval(smokeTimer); // idempotent: never stack intervals (double-tap guard)
    forecastPlaying = true;
    playBtn.innerHTML = ic('pause');
    playBtn.setAttribute('aria-label', 'Pause forecast');
    const stepMs = forecastMode === 'fwi' ? LIVEFIRE.fwiFrameMs : LIVEFIRE.smokeFrameMs;
    smokeTimer = window.setInterval(() => {
      if (closed) return stopForecast();
      fcSetIdx((fcIdx() + 1) % fcFrames().length);
      applyForecastFrame();
    }, stepMs);
  };
  // Reveal + configure the scrubber for a mode (or hide on 'none'); seeds the range max + rail end labels.
  const setForecastMode = (mode: 'none' | 'smoke' | 'fwi'): void => {
    stopForecast();
    forecastMode = mode;
    if (mode === 'none') { scrubEl.hidden = true; return; }
    // NB: we do NOT warm the whole forecast week here. Toggling Fire Weather ON must load just TODAY's single
    // instant (one frame, fast) — preloading 7 days × 2 sources up front raced ~MBs of week-ahead rasters
    // against that one frame on mobile, which read as "the map doesn't load". The week is warmed on first Play.
    const fs = fcFrames();
    rangeEl.max = String(Math.max(0, fs.length - 1));
    railAEl.textContent = mode === 'fwi' ? 'Today' : 'Now';
    railBEl.textContent = mode === 'fwi' ? `+${fs.length - 1} d` : `+${LIVEFIRE.smokeForecastHours} h`;
    scrubEl.hidden = false;
    applyForecastFrame();
  };

  // ── Layers sheet — tiered toggles (Fires / Weather · Canada / Local · Saskatchewan) + the live legend.
  //    Summoned from the Layers button so the permanent control row stays short and the map keeps height. ──
  const updateLayerCount = (): void => {
    const n = (Object.keys(layerOn) as FireLayer[]).filter((k) => layerOn[k]).length;
    layerCountEl.textContent = n ? String(n) : ''; // corner badge on the floating Layers button
  };
  updateLayerCount();

  // The floating Fire-weather button is a one-tap toggle for the FWI raster; it reads its pressed/filled
  // state straight from `layerOn.fwi` so it agrees with the Layers-sheet toggle (one funnel, two surfaces).
  const syncFireWx = (): void => {
    fireWxBtn.classList.toggle('on', layerOn.fwi);
    fireWxBtn.setAttribute('aria-pressed', String(layerOn.fwi));
    legendEl.hidden = !layerOn.fwi; // the danger-ramp key rides with the layer it explains
    legendEl.setAttribute('aria-hidden', String(!layerOn.fwi));
  };
  // Fire weather is a CWFIS/GWIS forecast, gated to Canada coverage (mirrors the sheet's Weather tier) and
  // dropped entirely by the live-data kill-switch — grey the button out (un-tappable) where it has no data.
  const syncFireWxAvail = (): void => {
    const avail = region.country !== 'US' && region.country !== 'MX' && isLiveFireEnabled();
    fireWxBtn.classList.toggle('disabled', !avail);
    fireWxBtn.setAttribute('aria-disabled', String(!avail));
  };

  // Flip one layer on/off: mirror state → drive the map → keep the count fresh → (forecast rasters) hand
  // off the shared scrubber. The single funnel used by both the sheet toggles and country-gating.
  const setLayerState = (id: FireLayer, on: boolean): void => {
    layerOn[id] = on;
    map?.setLayer(id, on);
    // Smoke + fire weather are the two FORECAST rasters sharing one scrubber. Turning one on hands it the
    // scrubber; turning off the owner falls back to the other forecast layer (if still on) or hides it.
    if (id === 'smoke' || id === 'fwi') {
      if (on) setForecastMode(id);
      else if (forecastMode === id) setForecastMode(layerOn[id === 'smoke' ? 'fwi' : 'smoke'] ? (id === 'smoke' ? 'fwi' : 'smoke') : 'none');
    }
    if (id === 'fwi') syncFireWx();
    updateLayerCount();
  };

  // A tier is AVAILABLE only where its data lives: Weather's CWFIS/GWIS forecast greys out (with a reason)
  // when the filter leaves Canada. Fires is continent-wide.
  const tierAvailable = (tier: LayerRow['tier']): boolean =>
    tier === 'fires' ? true : region.country !== 'US' && region.country !== 'MX';

  const layersHtml = (): string => {
    const tierBlock = (tier: LayerRow['tier']): string => {
      const avail = tierAvailable(tier);
      const rows = ALL_LAYERS.filter((l) => l.tier === tier)
        .filter((l) => !LIVE_WMS.has(l.id) || isLiveFireEnabled()) // kill-switch drops FWI + smoke entirely
        .map((l) => {
          const on = layerOn[l.id];
          const control = avail
            ? `<div class="toggle${on ? ' on' : ''}" data-lf-layer="${l.id}" role="switch" aria-checked="${on}" aria-label="${esc(l.label)}" tabindex="0"><span class="knob"></span></div>`
            : `<span class="badge neutral">${esc(C.disabledReason[tier] ?? '')}</span>`;
          return `<div class="srow${avail ? '' : ' off'}"><div class="ic"><i class="lgsw ${l.swatch}"></i></div>` +
            `<div class="grow" style="min-width:0;"><div class="t">${esc(l.label)}</div><div class="s">${esc(l.hint)}</div></div>${control}</div>`;
        })
        .join('');
      if (!rows) return '';
      const scope = C.tierScope[tier];
      return `<div class="fgroup"><div class="fgh lgcap">${esc(C.tiers[tier])}${scope ? `<span class="sc">${esc(scope)}</span>` : ''}</div>${rows}</div>`;
    };
    return `<div class="fsheet-head">
        <div class="grow" style="min-width:0;"><div class="fsheet-ttl">${esc(C.layersTitle)}</div><div class="s">${esc(C.layersSub)}</div></div>
        <button class="iconbtn" data-lf-close aria-label="Close">${ic('close')}</button>
      </div>
      ${tierBlock('fires')}${tierBlock('weather')}
      <button class="fsheet-link" data-lf-sources type="button" aria-label="${esc(C.sourcesBtn)}">${ic('shield')}<span class="grow">${esc(C.sourcesBtn)}</span>${ic('chevron-right')}</button>`;
  };

  // Open the layers sheet + wire its toggles. Re-rendered each open so it reflects live availability. Each
  // layer row already carries its own swatch + label + hint, so the toggles ARE the legend — no separate
  // legend block. The footer link drops into the source ledger (the honest-window provenance, kept reachable).
  const showLayers = (): void => {
    sheetEl.classList.remove('bottom'); // Layers stays the right drawer (only the fire detail opens bottom)
    sheetEl.innerHTML = layersHtml();
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
    sheetEl.querySelector('[data-lf-sources]')?.addEventListener('click', () => showLedger());
    sheetEl.querySelectorAll<HTMLElement>('[data-lf-layer]').forEach((tog) => {
      const flip = (): void => {
        const id = tog.dataset.lfLayer as FireLayer;
        const on = !tog.classList.contains('on');
        tog.classList.toggle('on', on);
        tog.setAttribute('aria-checked', String(on));
        setLayerState(id, on);
      };
      tog.addEventListener('click', flip);
      tog.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });
    });
  };

  // Repaint the console status readout. ALL honesty lives in the pure `deriveRegionStats` — this just
  // renders the POJO it returns, so the readout is always accurate to the chosen region (country/province)
  // and collapses (never borrows a Canada number) wherever no per-region source exists.
  const paintStats = (): void => {
    tickerEl.innerHTML = consoleReadoutHtml(deriveRegionStats(region, reportedFeed, hsFeed, summary, Date.now()));
  };

  // ── The triage rail ──────────────────────────────────────────────────────────────────────────────
  // `threats` is the ranked slice the rail lists AND the map halos; both read this one array, so a rail
  // row and a numbered halo are always the same fire. Repainted with the map on every region change or
  // load, so the ranking is scoped to what's actually in view.
  let threats: ThreatRow[] = [];
  let railOpen = false; // phone only — on a wide screen the rail is docked and this is ignored
  const syncRail = (): void => {
    railEl.classList.toggle('open', railOpen);
    threatsBtn.classList.toggle('on', railOpen);
    threatsBtn.setAttribute('aria-pressed', String(railOpen));
  };
  const paintRail = (): void => {
    railEl.innerHTML = threatRailHtml(threats);
    railEl.querySelector('[data-lf-railclose]')?.addEventListener('click', () => { railOpen = false; syncRail(); });
    railEl.querySelectorAll<HTMLElement>('[data-lf-focus]').forEach((row) => {
      row.addEventListener('click', () => {
        const t = threats[Number(row.dataset.lfFocus)];
        if (!t) return;
        map?.focusFire(t.fire); // fly + ring the mark…
        showReported(t.fire); //  …and open its full record
        railOpen = false; // on a phone the rail is a sheet over the map — get out of the way of the flight
        syncRail();
      });
    });
  };
  syncRail();

  // Paint the map for the SELECTED region (country OR Canadian province): filter each layer → re-plot →
  // refit, so the map and the ticker always agree on what's in view. The ticker (paintStats) owns the
  // headline numbers — paint() just plots + frames.
  const paint = (refit: boolean): void => {
    const reported = filterReportedRegion(reportedFeed.fires, region);
    const out = filterReportedRegion(reportedFeed.out, region);
    const hs = filterRegionHotspots(hsFeed.hotspots, region);
    biggest = reported.reduce<ReportedFire | null>((a, b) => (!a || b.sizeHa > a.sizeHa ? b : a), null);
    hottest = hs.reduce<Hotspot | null>((a, b) => (!a || b.hfi > a.hfi ? b : a), null);

    const canada = region.country !== 'US' && region.country !== 'MX';

    // Hotspots BEFORE reported: on the flat map, canvas tap-dispatch is topmost-wins by marker add
    // order — the authoritative reported dots must repaint LAST so a stacked tap opens the official
    // fire (the shared tap-priority rule in view.ts; the globe's picker enforces the same order).
    map?.setOutFires(out);
    map?.setHotspots(hs);
    map?.setReportedFires(reported);
    // The M3 burn perimeters are Canada-only (CWFIS), so drop them when the map is scoped to US/Mexico —
    // mirrors the ticker. Shown for Canada + All North America (where Canada is part of the frame).
    map?.setBurnPolygons(canada ? burnFeed.polys : []);

    // Rank what's in view, then hand the SAME slice to both surfaces: the rail lists it, the map halos
    // it with matching numbers. Scoped to the region filter, so switching to one province re-ranks
    // within that province rather than pointing at a fire two time zones away.
    threats = rankThreats(reported, LIVEFIRE.threatRailCount);
    paintRail();
    map?.setPriority(threats.map((t) => t.fire));

    // Reframe ONLY on first load + a real country change (refit). NEVER on a silent refresh — that would
    // yank the user out of a zoom/pan they set by hand (the fitTo-on-every-paint regression).
    if (refit) {
      const frame = (reported.length ? reported : hs).map((p) => [p.lat, p.lon] as [number, number]);
      map?.fitTo(frame);
    }
    map?.invalidate();
  };

  // QA hook (gated like __game): lets the headless harness open a detail panel deterministically.
  // `selectPrimary` = the authoritative biggest reported fire (the headline datum); `selectHottest` is
  // genuinely hotspot-first (matches its name). Torn down by the overlay's onClose hook above.
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('qa')) {
    (window as unknown as { __fireQA?: unknown }).__fireQA = {
      selectPrimary: () => (biggest ? showReported(biggest) : hottest ? showHotspot(hottest) : undefined),
      selectHottest: () => (hottest ? showHotspot(hottest) : biggest ? showReported(biggest) : undefined),
      selectReported: () => biggest && showReported(biggest),
    };
  }

  const load = (force: boolean): void => {
    if (closed) return;
    refreshBtn.disabled = true;
    sheetEl.hidden = true; // a (re)load re-plots every marker — drop any stale detail sheet over the old set
    Promise.allSettled([
      fetchSummary({ force }),
      fetchReportedFires({ force }),
      fetchActiveFires({ force }),
      fetchBurnPerimeters({ force }),
      fetchFwiMeta({ force }),
    ])
      .then(([sum, rep, hot, per, fwi]) => {
        if (closed) return; // overlay dismissed mid-flight — don't paint into a removed DOM
        if (sum.status === 'fulfilled') summary = sum.value;
        if (rep.status === 'fulfilled') reportedFeed = rep.value;
        if (hot.status === 'fulfilled') hsFeed = hot.value;
        if (per.status === 'fulfilled') burnFeed = per.value;
        if (fwi.status === 'fulfilled') fwiMeta = fwi.value;
        rebuildRegionOptions(); // the feed just told us which provinces actually have fires
        paintStats();
        paint(!force); // first load (force=false) frames the data; a refresh (force=true) keeps the view
        // EVERY source unreachable → advertise it ON the map so a blank basemap never reads as "no fires".
        // (All three down = a real connectivity/source failure, region-agnostic — US/MX still have hotspots.)
        const allDown = reportedFeed.meta.status !== 'live' && hsFeed.meta.status !== 'live' && (!summary || summary.meta.status !== 'live');
        downEl.hidden = !allDown;
      })
      .finally(() => {
        if (!closed) refreshBtn.disabled = false;
      });
  };
  refreshBtn.addEventListener('click', () => load(true));
  // The floating Fire-weather button: a one-tap toggle for the FWI raster (it hands itself the forecast
  // scrubber via setLayerState). No-op while greyed out (off-Canada / kill-switched).
  fireWxBtn.addEventListener('click', () => {
    if (fireWxBtn.classList.contains('disabled')) return;
    setLayerState('fwi', !layerOn.fwi);
  });
  layersBtn.addEventListener('click', () => showLayers());
  // Phone only (the rail is permanently docked on a wide screen — see .firerail in styles.ts).
  threatsBtn.addEventListener('click', () => { railOpen = !railOpen; syncRail(); });
  // Daylight ⇄ console basemap. The dark console is the default look, but a dark map genuinely loses
  // its marks outdoors in glare, so the sun-readable light tiles stay one tap away (the button's glyph
  // shows what you'd SWITCH TO, which is why it starts as a sun).
  let daylight = false;
  dayBtn.addEventListener('click', () => {
    daylight = !daylight;
    map?.setDaylight(daylight);
    dayBtn.classList.toggle('on', daylight);
    dayBtn.setAttribute('aria-pressed', String(daylight));
    dayBtn.innerHTML = ic(daylight ? 'moon' : 'sun');
    const lbl = daylight ? C.console.consoleBtn : C.console.daylightBtn;
    dayBtn.setAttribute('aria-label', lbl);
    dayBtn.title = lbl;
  });
  syncFireWxAvail(); // initial enabled/greyed state for the default region (Canada)
  regionEl.addEventListener('change', () => {
    region = parseRegion(regionEl.value);
    setRegionPref(region);
    sheetEl.hidden = true; // a region switch clears any open sheet (the set / availability just changed)
    // The Weather forecast layers hold no US/MX data — turn off any that were on so a Canadian raster
    // doesn't linger over a US view and the active-layer count stays honest.
    if (region.country === 'US' || region.country === 'MX') {
      (['fwi', 'smoke'] as FireLayer[]).forEach((id) => { if (layerOn[id]) setLayerState(id, false); });
    }
    syncFireWxAvail(); // grey/un-grey the floating Fire-weather button for the new region's coverage
    paintStats(); // honest to the chosen region — derived per province / "Data not available" off-Canada
    paint(true); // a real region change DOES reframe (map + ticker agree)
  });

  // Forecast scrubber: play/pause toggles the active animation (smoke hourly / fire-weather daily);
  // dragging the timeline scrubs (and pauses).
  playBtn.addEventListener('click', () => (forecastPlaying ? stopForecast() : playForecast()));
  rangeEl.addEventListener('input', () => {
    stopForecast(); // dragging the timeline pauses playback
    fcSetIdx(Math.min(fcFrames().length - 1, Math.max(0, parseInt(rangeEl.value, 10) || 0)));
    applyForecastFrame();
  });

  // Build the map view once the overlay is painted + sized. The tracker is the flat Leaflet slippy map
  // (a lazy chunk, loaded only when the map opens) — the 3D globe was retired (nice look, but more
  // complex + cluttered than productive). If the overlay was dismissed before the chunk resolved, bail.
  requestAnimationFrame(() => {
    if (closed) return;
    const handlers = {
      onSelectHotspot: showHotspot,
      onSelectReported: showReported,
      // While a forecast frame is in flight, mark the scrubber buffering (a soft pulse) so a slow
      // step reads as loading, not stuck.
      onSmokeLoad: (loading: boolean) => scrubTrackEl.classList.toggle('buffering', loading),
      // Tap on empty map cleared a fire selection → close the detail sheet (only when it's showing a
      // detail; a Layers/Sources sheet has no selection behind it, so the view never fires this then).
      onDeselect: () => { if (!sheetEl.querySelector('[data-lf-layer]') && !sheetEl.querySelector('[data-lf-sources]')) sheetEl.hidden = true; },
    };
    import('../../livefire/FireMap')
      .then((m) => new m.FireMap(mapEl, handlers) as LiveMapView)
      .then((view) => {
        if (closed) {
          view.dispose(); // resolved after dismissal — tear straight back down
          return;
        }
        map = view;
        map.invalidate();
        load(false);
      })
      .catch(() => {
        if (closed) return;
        tickerEl.innerHTML = `<span class="fstat-load">${esc(C.offlineTitle)}</span>`;
      });
  });
}

// ============================ CREDITS (data + licences) ============================
/** Credits page — the one home for third-party attribution (the live fire map carries none on-map).
 *  Opened from Settings. Lists the fire data, basemap, map engine, and icon set, each linked to source. */
function openCredits(host: HTMLElement): void {
  const { card, close } = bmfModal(host, {
    title: 'Credits & data',
    sub: 'The live fire map is built on open data + tools',
    glyph: ic('shield'),
    body:
      `<div class="credits">` +
      `<p class="mtext"><b>Active fire data</b><br><a href="https://ciffc.net" target="_blank" rel="noopener">CIFFC</a>: Canadian Interagency Forest Fire Centre · CWFIS: <a href="https://cwfis.cfs.nrcan.gc.ca" target="_blank" rel="noopener">Canadian Wildland Fire Information System</a>, Natural Resources Canada</p>` +
      `<p class="mtext"><b>Globe outlines</b><br><a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain), drawn procedurally, no basemap imagery</p>` +
      `<p class="mtext"><b>Map engines</b><br><a href="https://threejs.org" target="_blank" rel="noopener">Three.js</a> (globe) · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a> (flat view)</p>` +
      `<p class="mtext"><b>Basemap tiles</b> (globe close-up &amp; flat view)<br>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a></p>` +
      `<p class="mtext"><b>Icons</b><br>Lucide (MIT)</p>` +
      `</div>` +
      `<div class="modal-actions"><button class="btn primary" data-credits-ok>${ic('check')}Got it</button></div>`,
  });
  card.querySelector('[data-credits-ok]')?.addEventListener('click', close);
}

// ============================ SETTINGS (minimal) ============================
export function openSettings(): void {
  const pro = currentProfile();
  const muted = localStorage.getItem(MUTE_KEY) === '1';
  const body = `<div class="card" style="margin-top:8px;">
    <div class="srow"><div class="ic">${ic('volume')}</div><div class="grow"><div class="t">Sound</div><div class="s">Rotor loop &amp; SFX</div></div>
      <div class="toggle ${muted ? '' : 'on'}" data-sound role="switch" tabindex="0"><span class="knob"></span></div></div>
    <div class="srow"><div class="ic">${ic('accessibility')}</div><div class="grow"><div class="t">Reduced motion</div><div class="s">Calm the menus</div></div>
      <div class="toggle" data-rm role="switch" tabindex="0"><span class="knob"></span></div></div>
  </div>
  <div class="card" style="margin-top:12px;">
    <div class="srow"><div class="ic">${ic('user')}</div><div class="grow"><div class="t">Pilot</div><div class="s" id="callsign">${pro.name || 'Unnamed'}</div></div>
      <button class="btn ghost sm" data-edit>${ic('edit')}Edit</button></div>
    <div class="srow"><div class="ic">${ic('cloud')}</div><div class="grow" style="min-width:0;"><div class="t">Cloud save</div><div class="s" id="cloudsub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">…</div></div>
      <button class="btn ghost sm" data-cloud id="cloudbtn" style="display:none;"></button></div>
    <div class="srow"><div class="ic">${ic('shield')}</div><div class="grow"><div class="t">Credits &amp; data</div><div class="s">Map, fire data &amp; licences</div></div>
      <button class="btn ghost sm" data-credits aria-label="Open credits">${ic('chevron-right')}</button></div>
  </div>
  <div class="card" style="margin-top:12px;">
    <div class="srow danger"><div class="ic">${ic('trash')}</div><div class="grow"><div class="t">Reset progress</div><div class="s">Wipe ranks, stars &amp; unlocks</div></div>
      <button class="btn danger" data-reset>Reset…</button></div>
  </div>`;

  const { root, close } = overlay('settings', 'Settings', body, undefined, 'home');

  // Settings is opened off the rail (from the Home profile card), so give it an explicit exit:
  // a close button beside the title (Esc / the Home rail tab still work too).
  const closeBtn = document.createElement('button');
  closeBtn.className = 'iconbtn';
  closeBtn.style.marginLeft = 'auto';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.innerHTML = ic('close');
  closeBtn.addEventListener('click', close);
  root.querySelector('.appbar')?.appendChild(closeBtn);

  // Cloud-save row: show the email this device is LINKED to (the lookup key the pilot saved under) and
  // open Cloud Save to manage it. Email goes in via textContent — never interpolated into innerHTML —
  // so a tampered local link can't inject markup. Cloud save needs Supabase, so the action hides when
  // unconfigured. Re-runs after the modal closes (save / unlink) so the row never goes stale.
  const renderCloud = (): void => {
    const link = getCloudLink();
    const online = isConfigured();
    const sub = root.querySelector<HTMLElement>('#cloudsub');
    const btn = root.querySelector<HTMLButtonElement>('#cloudbtn');
    if (sub) {
      sub.textContent = link ? link.email : online ? 'Not saved yet' : 'Offline';
      sub.classList.toggle('ok', !!link);
      if (link) sub.title = link.email;
      else sub.removeAttribute('title');
    }
    if (btn) {
      btn.style.display = online ? '' : 'none';
      btn.innerHTML = `${ic(link ? 'edit' : 'cloud')}${link ? 'Manage' : 'Save'}`;
    }
  };
  renderCloud();
  root.querySelector('[data-cloud]')?.addEventListener('click', () => openCloudSave(renderCloud));
  root.querySelector('[data-credits]')?.addEventListener('click', () => openCredits(root));

  root.querySelector('[data-sound]')?.addEventListener('click', (e) => {
    const t = e.currentTarget as HTMLElement;
    const on = t.classList.toggle('on');
    localStorage.setItem(MUTE_KEY, on ? '0' : '1'); // toggle ON = sound on = not muted
  });
  root.querySelector('[data-rm]')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).classList.toggle('on');
  });
  root.querySelector('[data-edit]')?.addEventListener('click', () => {
    editCallsign(root, currentProfile().name || '', (name) => {
      saveProfile({ ...currentProfile(), name });
      const el = root.querySelector('#callsign');
      if (el) el.textContent = name;
    });
  });
  root.querySelector('[data-reset]')?.addEventListener('click', () => {
    confirmReset(root, () => {
      resetProgress();
      location.reload();
    });
  });
}

// ============================ THEMED MODALS (confirm / prompt) ============================
// The home hub uses NO native window.prompt/confirm — those render off-brand OS chrome, vary across
// mobile browsers, are blocked in some embeds, and break the no-scroll single-viewport feel. This is
// a tiny token-pure dialog built from the SAME `.bmf-app` classes the rest of the menus use, mounted
// INSIDE the active overlay surface so it inherits the stylesheet. Dismissible: backdrop tap, Esc,
// or the returned close(). `danger` tints it on the --warn (destructive) register.
function bmfModal(
  host: HTMLElement,
  opts: { title: string; sub?: string; glyph?: string; danger?: boolean; body: string },
): { card: HTMLElement; close: () => void } {
  const node = document.createElement('div');
  node.className = `modal${opts.danger ? ' danger' : ''}`;
  node.innerHTML =
    `<div class="modal-card" role="dialog" aria-modal="true" aria-label="${opts.title}">` +
    `<div class="modal-head">${opts.glyph ? `<span class="mglyph">${opts.glyph}</span>` : ''}` +
    `<div class="grow"><div class="mtitle">${opts.title}</div>${opts.sub ? `<div class="msub">${opts.sub}</div>` : ''}</div>` +
    `<button class="mclose" data-mx aria-label="Close">${ic('close')}</button></div>` +
    `<div class="modal-body">${opts.body}</div></div>`;
  host.appendChild(node);
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    node.remove();
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation(); // swallow Esc so it dismisses the modal, not the parent overlay
      close();
    }
  }
  // Capture-phase so the modal's Esc wins over the overlay's own keydown listener.
  window.addEventListener('keydown', onKey, true);
  node.addEventListener('pointerdown', (e) => {
    if (e.target === node) close(); // backdrop tap only (not a click inside the card)
  });
  node.querySelector('[data-mx]')?.addEventListener('click', close);
  return { card: node.querySelector('.modal-card') as HTMLElement, close };
}

/** Destructive-progress-wipe confirm — reads clearly as danger (warn register + explicit actions). */
function confirmReset(host: HTMLElement, onConfirm: () => void): void {
  const { card, close } = bmfModal(host, {
    title: 'Reset progress?',
    sub: 'This cannot be undone',
    glyph: ic('trash'),
    danger: true,
    body:
      `<p class="mtext">Wipes your rank, best scores and aircraft unlocks. You'll start over from Recruit.</p>` +
      `<div class="modal-actions"><button class="btn ghost" data-cancel>Keep my progress</button>` +
      `<button class="btn danger" data-confirm>Reset everything</button></div>`,
  });
  card.querySelector('[data-cancel]')?.addEventListener('click', close);
  card.querySelector('[data-confirm]')?.addEventListener('click', () => {
    close();
    onConfirm();
  });
}

/** Themed callsign editor — reuses the `.field` input + the shared validateCallsign gate (same as
 *  NewPilot), so reserved/profane/too-short names are rejected inline instead of silently saved. */
function editCallsign(host: HTMLElement, current: string, onSave: (name: string) => void): void {
  const { card, close } = bmfModal(host, {
    title: 'Pilot callsign',
    sub: 'The name your runs fly under',
    glyph: ic('user'),
    body:
      `<label class="field"><span class="pfx">${ic('user')}</span>` +
      `<input id="cs-edit" type="text" maxlength="${MAX_CALLSIGN}" placeholder="Enter your callsign" ` +
      `autocomplete="off" spellcheck="false" enterkeyhint="done" aria-label="Callsign" /></label>` +
      `<div id="cs-msg" class="fmsg"></div>` +
      `<div class="modal-actions"><button class="btn ghost" data-cancel>Cancel</button>` +
      `<button class="btn primary" data-save>${ic('check')}Save</button></div>`,
  });
  const input = card.querySelector<HTMLInputElement>('#cs-edit')!;
  const msg = card.querySelector<HTMLElement>('#cs-msg')!;
  input.value = current;
  const commit = (): void => {
    const res = validateCallsign(input.value);
    if (!res.ok) {
      msg.textContent = res.reason ?? 'Pick a different callsign.';
      msg.className = 'fmsg bad';
      return;
    }
    close();
    onSave(res.value);
  };
  input.addEventListener('input', () => {
    msg.textContent = '';
    msg.className = 'fmsg';
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep typing out of any game/overlay key handlers
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });
  card.querySelector('[data-cancel]')?.addEventListener('click', close);
  card.querySelector('[data-save]')?.addEventListener('click', commit);
  // Desktop only — autofocusing on touch pops the keyboard over the layout.
  if (!('ontouchstart' in window)) requestAnimationFrame(() => input.focus());
}
