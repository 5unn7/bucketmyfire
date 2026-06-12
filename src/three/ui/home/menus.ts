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
import { fetchActiveFires, fetchSummary, fetchReportedFires, fetchBurnPerimeters, fetchFwiMeta, fetchFireHistory, fwiForecastTime, getRegionPref, setRegionPref, isLiveFireEnabled } from '../../livefire/client';
import {
  LIVEFIRE_COPY, severityClass, severityLabel, stageClass, stageLabel, relTime,
  freshnessLine, statusDotClass, publishedWhen, LIVEFIRE_SOURCES, NOT_FOR_EMERGENCY, SK_OFFICIAL,
  frameTimeLabel, smokeFreshness, fwiFreshness,
} from '../../livefire/strings';
import { FIELD_GROUPS, REPORTED_FIELD_GROUPS, type FieldGroup } from '../../livefire/fields';
import { filterReportedRegion, filterRegionHotspots, regionValue, parseRegion, regionOptions, deriveRegionStats, countryLabel, COUNTRIES, smokeForecastFrames, forecastLeadLabel } from '../../livefire/normalize';
import { LIVEFIRE } from '../../config';
import type { Hotspot, ReportedFire, ReportedFeed, FireHistoryPoint, NationalSummary, BurnFeed, FeedMeta, LiveFireFeed, CountryFilter, RegionFilter, RegionStats } from '../../livefire/types';
import type { LiveMapView, FireLayer } from '../../livefire/view';
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
    <div>${fieldGroupsHtml(FIELD_GROUPS, h.props)}</div>`;
}

// Provincial feeds carry richer fields than CIFFC but under per-source names — a multi-key lookup pulls
// the universally-useful ones (cause, response, type, district) across all 9 sources for the detail panel.
const PROV_FIELDS: { label: string; keys: string[] }[] = [
  { label: 'Cause', keys: ['FIRE_CAUSE', 'GENERAL_CAUSE', 'Cause', 'cause', 'CAUSE'] },
  { label: 'Response', keys: ['RESPONSE_TYPE_DESC', 'ResponseType', 'RESPONSE_OBJECTIVE', 'responsecategory'] },
  { label: 'Type', keys: ['FIRE_TYPE', 'FireType', 'fire_type'] },
  { label: 'Contained', keys: ['PercentContained', 'percent_contained'] },
  { label: 'District', keys: ['DISTRICT_NAME', 'FIRE_DISTRICT_NAME', 'REGION', 'region', 'FIRE_CENTRE'] },
];
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
  if (f.sizeHa >= 0) rows.push(`<div class="frow"><span class="fk">Size</span><span class="fv">${esc(LIVEFIRE_COPY.fireSize(f.sizeHa))}</span></div>`);
  for (const d of PROV_FIELDS) {
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
  const body = f.source ? provDetailHtml(f) : `<div>${fieldGroupsHtml(REPORTED_FIELD_GROUPS, f.props)}</div>`;
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
    <div data-lf-hist></div>
    ${body}
    <p class="alertnote">${esc(NOT_FOR_EMERGENCY)}</p>`;
}

/** Stage-of-control → the CSS token var the sparkline's end dot is coloured by (mirrors FireMap's
 *  STAGE_COLOR; consumes the injected `.bmf-app` tokens, never a literal hex). */
const STAGE_VAR: Record<string, string> = {
  OC: 'var(--warn)', BH: 'var(--caution)', UC: 'var(--ok)', OUT: 'var(--faint)', UNK: 'var(--caution)',
};

/** Human duration for a millisecond span (history x-axis label) — minutes → hours → days. */
function fmtSpan(ms: number): string {
  const min = ms / 60000;
  if (min < 90) return `${Math.max(1, Math.round(min))} min`;
  const hr = min / 60;
  if (hr < 36) return `${Math.round(hr)} h`;
  return `${Math.round(hr / 24)} days`;
}

/**
 * The TRACKED-HISTORY block for a reported fire — the thing the browser-only feed could never show:
 * the same fire's size + stage observed over time, served by the ingestion backend (fetchFireHistory).
 * Renders an inline size-over-time sparkline + a "grew/shrank by X over N days" line + the stage path.
 * Returns '' when there's nothing worth charting (<2 sized points AND no stage change) so the panel is
 * unchanged for fires we've only seen once. Pure + token-only (reuses .fgroup/.frow + injected vars).
 */
function fireHistoryHtml(points: FireHistoryPoint[], f: ReportedFire): string {
  const sized = points.filter((p) => p.sizeHa >= 0);
  const stages: string[] = [];
  for (const p of points) if (!stages.length || stages[stages.length - 1] !== p.stage) stages.push(p.stage);
  const haveSpark = sized.length >= 2 && sized.some((p) => p.sizeHa > 0);
  const haveStagePath = stages.length >= 2;
  if (!points.length) return ''; // backend answered but no snapshot for this fire yet → stay silent

  let spark = '';
  let changeRow = '';
  if (haveSpark) {
    const W = 252, H = 46, padX = 2, padY = 4;
    // Time axis = the SOURCE's report time (sitrep date), NOT our poll time. `observedAt` is just when
    // the ingest cron happened to run (every 10 min), so using it reported "grew X over 31 min" on EVERY
    // fire at once — that 31 min was the gap between two cron runs, not the fire's real growth interval.
    // Fall back to `observedAt` only for a snapshot with no source date; min/max is robust to a backward
    // sitrep revision (a later poll carrying an earlier reported date).
    const tOf = (p: FireHistoryPoint): number => p.reportedAt || p.observedAt;
    const ts = sized.map(tOf);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    const span = Math.max(1, t1 - t0);
    const maxHa = Math.max(...sized.map((p) => p.sizeHa), 1);
    const coords = sized.map((p) => {
      const x = padX + ((tOf(p) - t0) / span) * (W - 2 * padX);
      const y = H - padY - (p.sizeHa / maxHa) * (H - 2 * padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = coords.join(' ');
    const [lastX, lastY] = coords[coords.length - 1].split(',');
    const baseY = (H - padY).toFixed(1);
    const area = `${padX.toFixed(1)},${baseY} ${line} ${lastX},${baseY}`;
    spark =
      `<svg viewBox="0 0 ${W} ${H}" width="100%" height="46" preserveAspectRatio="none" role="img" ` +
      `aria-label="Fire size over time" style="display:block;margin-top:8px;overflow:visible;">` +
      `<polygon points="${area}" fill="var(--ember-12)" stroke="none"/>` +
      `<polyline points="${line}" fill="none" stroke="var(--ember)" stroke-width="1.6" ` +
      `stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `<circle cx="${lastX}" cy="${lastY}" r="2.6" fill="${STAGE_VAR[f.stage] ?? 'var(--ember)'}"/></svg>`;
    const delta = f.sizeHa - sized[0].sizeHa;
    const arrow = delta > 1 ? '▲' : delta < -1 ? '▼' : '•';
    const verb = delta > 1 ? 'grew' : delta < -1 ? 'shrank' : 'held';
    const mag = Math.abs(delta) >= 1 ? `${esc(LIVEFIRE_COPY.fireSize(Math.abs(delta)))} ` : '';
    // Only name the interval when the source actually reported one (>2 min of real sitrep span). Two
    // snapshots sharing a sitrep date give a ~0 span — say "grew X" without inventing a tiny window.
    const over = span > 120_000 ? ` over ${esc(fmtSpan(span))}` : '';
    changeRow = `<div class="frow"><span class="fk">Change</span><span class="fv">${arrow} ${verb} ${mag}${over}</span></div>`;
  }

  const firstSeen = points.length ? points[0].observedAt : 0;
  const seenRow = firstSeen ? `<div class="frow"><span class="fk">First tracked</span><span class="fv">${esc(relTime(firstSeen))}</span></div>` : '';
  const stageRow = haveStagePath
    ? `<div class="frow"><span class="fk">Stage path</span><span class="fv">${esc(stages.map((s) => stageLabel(s as ReportedFire['stage'])).join(' → '))}</span></div>`
    : '';
  // Nothing to chart yet (a single observation, or steady since first seen): say so plainly instead of
  // dropping the whole block — the fire IS being tracked, it just hasn't moved. Reads "young", not "broken".
  const quietRow = !haveSpark && !haveStagePath
    ? `<div class="frow"><span class="fk">Change</span><span class="fv" style="color:var(--faint)">No changes recorded yet</span></div>`
    : '';

  return `<div class="fgroup"><div class="fgh">Tracked history</div>${spark}${changeRow}${stageRow}${quietRow}${seenRow}</div>`;
}

/** The region firestats ticker — ONE compact line rendered from the honest `RegionStats` POJO. Lead =
 *  region + live active count (or, for US/MX where no official reported feed exists, satellite detections);
 *  supporting chips = the OC/BH/UC stage split, reported-today, area-burned, prep level — each rendering
 *  "Data not available" (faint) where the region has no source. No honesty logic here (that's all in
 *  `deriveRegionStats`); this only paints. Tokens only → AA-safe; icons are Lucide via `ic()`. */
function regionTickerHtml(s: RegionStats): string {
  const C = LIVEFIRE_COPY.strip;
  if (s.scope === 'down') return `<span class="fstat-load">${esc(C.down)}</span>`;
  const num = (n: number): string => n.toLocaleString();
  const na = `<span class="fstat-na">${esc(C.na)}</span>`;
  const fresh = s.asOfMs ? `<span class="fstat-fresh">${esc(publishedWhen(s.asOfMs))}</span>` : '';
  const loc = `${ic('fire', 'fstat-ic')}<b class="fstat-loc">${esc(s.label)}</b><span class="fstat-sep">·</span>`;

  // US / MX — no official reported feed; satellite detections are the only honest number. Make the
  // satellite provenance explicit AND mark the official "active fires" count itself as unavailable.
  if (s.scope === 'foreign') {
    const det = s.hotspots != null
      ? `<b class="fstat-big">${num(s.hotspots)}</b><span class="fstat-lbl">${esc(C.detectionsLabel)} · sat</span>`
      : na;
    return `<div class="fstat-row"><span class="fstat-lead">${loc}${det}</span>`
      + `<span class="fstat-rest"><span class="fstat-chip na">${ic('pin', 'fstat-ic')}<span class="fstat-lbl">${esc(C.activeLabel)}</span> ${na}</span>${fresh}</span></div>`;
  }

  // Canada — national (authoritative summary) or one province (derived from the agency-filtered feed).
  const lead = s.active != null
    ? `${loc}<b class="fstat-big">${num(s.active)}</b><span class="fstat-lbl">${esc(C.activeLabel)}</span>`
    : `${loc}${na}`;

  let pips = '';
  if (s.byStage) {
    const b = s.byStage;
    const pip = (k: 'OC' | 'BH' | 'UC', cls: string): string =>
      `<span class="fstat-pip ${cls}" title="${esc(stageLabel(k))}"><i></i>${num(b[k])}</span>`;
    pips = `<span class="fstat-pips">${pip('OC', 'oc')}${pip('BH', 'bh')}${pip('UC', 'uc')}</span>`;
  }

  const chip = (icon: string, label: string, value: number | null, fmt: (n: number) => string): string =>
    `<span class="fstat-chip${value == null ? ' na' : ''}">${ic(icon, 'fstat-ic')}` +
    `${value == null ? `<span class="fstat-lbl">${esc(label)}</span> ${na}` : `<b>${esc(fmt(value))}</b><span class="fstat-lbl">${esc(label)}</span>`}</span>`;

  const today = chip('clock', C.todayLabel, s.reportedToday, num);
  const area = chip('droplet', C.areaLabel, s.areaBurnedHa, (n) => LIVEFIRE_COPY.fireSize(n));
  const prep = chip('shield', C.prepLabel, s.prepLevel, (n) => `L${n}`);

  return `<div class="fstat-row"><span class="fstat-lead">${lead}</span>${pips}<span class="fstat-rest">${today}${area}${prep}${fresh}</span></div>`;
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

  // Region firestats — ONE compact icon ticker (data-lf-ticker), repainted by `paintStats` from a pure
  // `deriveRegionStats(region,…)` so it is HONEST to the chosen region (country OR Canadian province):
  // it shows "Data not available" for any metric with no per-region source, never a Canada number under
  // another label. The lead carries the region + live active count; supporting chips (stage split / today
  // / area / prep / satellite detections) + a freshness stamp ride the same line. See `regionTickerHtml`.
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
      <div class="firefloat">
        <button class="fmbtn" data-lf-layers aria-label="${esc(C.layersBtn)}" title="${esc(C.layersBtn)}">${ic('layers')}<span class="fmn" data-lf-layern></span></button>
        <button class="fmbtn" data-lf-firewx aria-pressed="false" aria-label="${esc(C.fireWxBtn)}" title="${esc(C.fireWxBtn)}">${ic('fire')}</button>
      </div>
      <div class="firescrub" data-lf-scrub hidden>
        <button class="iconbtn" data-lf-play aria-label="Play forecast">${ic('play')}</button>
        <div class="scrubtrack" data-lf-scrubtrack>
          <input type="range" class="scrubrange" data-lf-range min="0" max="0" value="0" step="1" aria-label="Forecast time" />
          <div class="scrubrail"><span data-lf-rail-a>Now</span><span data-lf-rail-b>+${LIVEFIRE.smokeForecastHours} h</span></div>
        </div>
        <div class="scrublabel"><span class="scrubwhen"><b data-lf-scrub-time>—</b><i data-lf-scrub-lead>Now</i></span><span class="scrubtag">Forecast</span></div>
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
  const sheetEl = root.querySelector<HTMLElement>('[data-lf-sheet]')!;
  const refreshBtn = root.querySelector<HTMLButtonElement>('[data-lf-refresh]')!;
  const layersBtn = root.querySelector<HTMLButtonElement>('[data-lf-layers]')!;
  const fireWxBtn = root.querySelector<HTMLButtonElement>('[data-lf-firewx]')!;
  const layerCountEl = root.querySelector<HTMLElement>('[data-lf-layern]')!;
  const regionEl = root.querySelector<HTMLSelectElement>('[data-lf-region]')!;
  const scrubEl = root.querySelector<HTMLElement>('[data-lf-scrub]')!;
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
  // model grids (today+1 … +N), labeled forecasts — never presented as observed.
  const smokeMeta: FeedMeta = { status: isLiveFireEnabled() ? 'live' : 'disabled', fromCache: false, publishedAt: 0, fetchedAt: 0 };
  const smokeFrames = smokeForecastFrames(Date.now(), LIVEFIRE.smokeForecastHours);
  let smokeIdx = 0;
  // A week of continuous model fire-weather forecast (today+1 … +N, UTC days); span + pace are config tokens.
  const fwiFrames = Array.from({ length: LIVEFIRE.fwiForecastDays }, (_, i) => new Date(Date.now() + (i + 1) * 86_400_000).toISOString().slice(0, 10));
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
    // Enrich with the fire's tracked history from the ingestion backend. Best-effort + async. `source`
    // routes provincial fires to their own snapshot table. A NULL result = backend unavailable → leave the
    // panel untouched (unchanged offline); an answered result (even a "no changes yet" block) is painted.
    const token = ++detailToken;
    if (f.fireId) {
      void fetchFireHistory(f.fireId, f.source).then((points) => {
        if (closed || token !== detailToken || points === null) return;
        const host = sheetEl.querySelector<HTMLElement>('[data-lf-hist]');
        if (host) host.innerHTML = fireHistoryHtml(points, f);
      });
    }
  };
  const showHotspot = (h: Hotspot): void => {
    sheetEl.classList.add('bottom'); // detail = bottom sheet (the Layers / Sources sheets stay on the right)
    sheetEl.innerHTML = fireDetailHtml(h);
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
  };
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
        <a class="lrow link" href="${SK_OFFICIAL.url}" target="_blank" rel="noopener"><i class="sdot link"></i><span class="grow" style="min-width:0;"><span class="lname">${esc(SK_OFFICIAL.label)}</span><span class="lwhat">Saskatchewan's official viewer — opens in a new tab</span></span><span class="lfresh">official ↗</span></a>
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
      scrubLeadEl.textContent = `+${i + 1} d`; // fwiFrames start at today+1, so frame i is "+ (i+1) days"
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
    // FWI just took the scrubber → warm all day-frames once so the morph + Play never stall on a per-day fetch.
    if (mode === 'fwi' && !fwiPreloaded) { fwiPreloaded = true; map?.preloadFwi?.(fwiFrames); }
    const fs = fcFrames();
    rangeEl.max = String(Math.max(0, fs.length - 1));
    railAEl.textContent = mode === 'fwi' ? '+1 d' : 'Now';
    railBEl.textContent = mode === 'fwi' ? `+${fs.length} d` : `+${LIVEFIRE.smokeForecastHours} h`;
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

  // Repaint the region firestats ticker. ALL honesty lives in the pure `deriveRegionStats` — this just
  // renders the POJO it returns, so the strip is always accurate to the chosen region (country/province)
  // and shows "Data not available" wherever no per-region source exists.
  const paintStats = (): void => {
    tickerEl.innerHTML = regionTickerHtml(deriveRegionStats(region, reportedFeed, hsFeed, summary, Date.now()));
  };

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
      `<p class="mtext"><b>Active fire data</b><br><a href="https://ciffc.net" target="_blank" rel="noopener">CIFFC</a> — Canadian Interagency Forest Fire Centre · CWFIS — <a href="https://cwfis.cfs.nrcan.gc.ca" target="_blank" rel="noopener">Canadian Wildland Fire Information System</a>, Natural Resources Canada</p>` +
      `<p class="mtext"><b>Globe outlines</b><br><a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain) — drawn procedurally, no basemap imagery</p>` +
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
