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
import { resetProgress } from '../../missions/progress';
import { openLeaderboard } from '../Leaderboard';
import { injectHomeStyles, spawnEmbers } from './styles';
import { posterCard } from './posterCard';
import { railNav } from './rail';
import { DEFS, FLAME, ic } from './icons';
import { openStore } from '../storeLink';
import { validateCallsign, MAX_CALLSIGN } from '../callsign';
import { fetchActiveFires, fetchSummary, fetchReportedFires, fetchBurnPerimeters, fetchFwiMeta, fetchAlerts, fetchBans, fetchFireHistory, getCountryPref, setCountryPref, isLiveFireEnabled } from '../../livefire/client';
import {
  LIVEFIRE_COPY, severityClass, severityLabel, stageClass, stageLabel, relTime,
  freshnessLine, statusDotClass, publishedWhen, LIVEFIRE_SOURCES, NOT_FOR_EMERGENCY, SK_OFFICIAL,
  frameTimeLabel, smokeFreshness, alertLevelClass, alertLevelLabel, banTypeClass, titleCase, banFreshness, alertFreshness,
} from '../../livefire/strings';
import { FIELD_GROUPS, REPORTED_FIELD_GROUPS, type FieldGroup } from '../../livefire/fields';
import { officialFor } from '../../livefire/official';
import { countFires, filterCountry, filterReportedCountry, countryLabel, COUNTRIES, smokeForecastFrames, safeUrl } from '../../livefire/normalize';
import { LIVEFIRE } from '../../config';
import type { Hotspot, ReportedFire, ReportedFeed, FireHistoryPoint, NationalSummary, BurnFeed, AlertFeed, AlertItem, BanFeed, BanArea, FeedMeta, LiveFireFeed, CountryFilter } from '../../livefire/types';
import type { FireMap, FireLayer } from '../../livefire/FireMap';

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

/** Build a focused full-screen overlay WITH the persistent bottom rail (`key` = its active tab).
 *  Navigation is the rail's job (no back button); Esc / the rail's Home tab return to the hub.
 *  Returns the root + a close() helper. */
function overlay(key: string, title: string, body: string, onClose?: () => void): { root: HTMLDivElement; close: () => void } {
  injectHomeStyles();
  const root = document.createElement('div');
  root.className = 'bmf-app';
  root.style.zIndex = '60';
  root.innerHTML =
    DEFS +
    `<div class="scene"></div><div class="embers"></div>` +
    `<div class="pad"><div class="appbar"><div class="ttl">${title}</div></div>${body}</div>` +
    railNav(key);
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
  // Each airframe is a compact card-button in a 3-up horizontal grid. Locked ones render dimmed with
  // their unlock requirement + a lock corner, carry data-locked, and the click handler skips them.
  const heliCard = (h: (typeof HELIS)[number]): string => {
    const ok = unlocked(h);
    const sel = ok && h.id === picked;
    const sub = ok ? h.tagline : `${heliCost(h).toLocaleString()} pts`;
    const flag = sel ? `<span class="hc-flag">${ic('check')}</span>` : ok ? '' : `<span class="hc-flag">${ic('lock')}</span>`;
    // Key-art render fills the tile when present; else the procedural ring + heli mark.
    const art = h.imageUrl
      ? `<img class="img" src="${h.imageUrl}" alt="">`
      : `<span class="hc-ring"></span><span class="hc-mark">${ic('heli')}</span>`;
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
      <div class="sec"><span class="tag">Your aircraft</span><span class="line"></span></div>
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
  grid.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.helicard');
    if (!card || card.hasAttribute('data-locked')) return;
    picked = card.dataset.heli || picked;
    grid.innerHTML = HELIS.map(heliCard).join('');
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
      ? `<button class="btn ghost block is-disabled">${ic('lock')}Coming soon</button>`
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
}

// ============================ LIVE WILDFIRES (the real-fire tracker) ============================
/** Escape API strings before they reach innerHTML (agency/fuel/ecozone are server-provided). */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

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

/** The full CWFIS record for one tapped satellite HOTSPOT — every meaningful field, grouped +
 *  unit-formatted (detection · behaviour · the FWI System codes · weather · site). */
function fireDetailHtml(h: Hotspot): string {
  const when = relTime(h.at);
  return `<div class="fsheet-head">
      <div class="grow" style="min-width:0;">
        <div class="fsheet-ttl">${LIVEFIRE_COPY.coords(h.lat, h.lon)}</div>
        <div class="s">Satellite hotspot · ${esc(h.agency || '—')}${when ? ` · ${when}` : ''}</div>
      </div>
      <span class="${severityClass(h.severity)}">${severityLabel(h.severity)}</span>
      <button class="iconbtn" data-lf-close aria-label="Close detail">${ic('close')}</button>
    </div>
    <div>${fieldGroupsHtml(FIELD_GROUPS, h.props)}</div>`;
}

/** The full CIFFC record for one tapped AUTHORITATIVE reported fire — staged, sized, named. */
function reportedDetailHtml(f: ReportedFire): string {
  const when = relTime(f.at);
  const title = f.fireId ? esc(f.fireId) : LIVEFIRE_COPY.coords(f.lat, f.lon);
  const agency = f.agency ? f.agency.toUpperCase() : '—';
  // Province-aware official source: link to THIS fire's jurisdiction (national CIFFC map as fallback) —
  // never the SK-only SPSA viewer for an out-of-province fire.
  const official = officialFor(f.agency);
  return `<div class="fsheet-head">
      <div class="grow" style="min-width:0;">
        <div class="fsheet-ttl">${title}</div>
        <div class="s">${esc(agency)} · ${esc(LIVEFIRE_COPY.fireSize(f.sizeHa))}${when ? ` · ${when}` : ''}</div>
      </div>
      <span class="${stageClass(f.stage)}">${esc(stageLabel(f.stage))}</span>
      <button class="iconbtn" data-lf-close aria-label="Close detail">${ic('close')}</button>
    </div>
    <div data-lf-hist></div>
    <div>${fieldGroupsHtml(REPORTED_FIELD_GROUPS, f.props)}</div>
    <a class="btn primary block" href="${safeUrl(official.url)}" target="_blank" rel="noopener">${ic('shield')}${esc(official.label)} ↗</a>`;
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
  if (!haveSpark && !haveStagePath) return '';

  let spark = '';
  let changeRow = '';
  if (haveSpark) {
    const W = 252, H = 46, padX = 2, padY = 4;
    const t0 = sized[0].observedAt, t1 = sized[sized.length - 1].observedAt;
    const span = Math.max(1, t1 - t0);
    const maxHa = Math.max(...sized.map((p) => p.sizeHa), 1);
    const coords = sized.map((p) => {
      const x = padX + ((p.observedAt - t0) / span) * (W - 2 * padX);
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
    changeRow = `<div class="frow"><span class="fk">Change</span><span class="fv">${arrow} ${verb} ${mag}over ${esc(fmtSpan(span))}</span></div>`;
  }

  const firstSeen = points.length ? points[0].observedAt : 0;
  const seenRow = firstSeen ? `<div class="frow"><span class="fk">First tracked</span><span class="fv">${esc(relTime(firstSeen))}</span></div>` : '';
  const stageRow = haveStagePath
    ? `<div class="frow"><span class="fk">Stage path</span><span class="fv">${esc(stages.map((s) => stageLabel(s as ReportedFire['stage'])).join(' → '))}</span></div>`
    : '';

  return `<div class="fgroup"><div class="fgh">Tracked history</div>${spark}${changeRow}${stageRow}${seenRow}</div>`;
}

/** A tapped SaskAlert alert — the issuer's OWN words + level badge + a link to the official notice. We
 *  never re-label it; the standing "not an emergency tool" line + the link-out carry the authority. */
function alertDetailHtml(a: AlertItem): string {
  const when = relTime(a.sentAt);
  const sub = [a.author, a.coverage, when].filter(Boolean).map(esc).join(' · ');
  const link = safeUrl(a.url); // feed-controlled URL → only http(s) reaches the href (no javascript: scheme)
  return `<div class="fsheet-head">
      <div class="grow" style="min-width:0;">
        <div class="fsheet-ttl">${a.event ? esc(titleCase(a.event)) : 'Alert'}</div>
        <div class="s">${sub}</div>
      </div>
      <span class="${alertLevelClass(a.level)}">${esc(alertLevelLabel(a.level))}</span>
      <button class="iconbtn" data-lf-close aria-label="Close detail">${ic('close')}</button>
    </div>
    ${a.summary ? `<p class="alertsum">${esc(a.summary)}</p>` : ''}
    ${link ? `<a class="btn primary block" href="${link}" target="_blank" rel="noopener">${ic('shield')}Official notice</a>` : ''}
    <p class="alertnote">${esc(NOT_FOR_EMERGENCY)}</p>`;
}

/** A tapped fire-ban area — type + "in effect since" + the issuer's comment + a link to the SK source. */
function banDetailHtml(b: BanArea): string {
  const since =
    b.startAt > 0
      ? `In effect since ${new Date(b.startAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'In effect';
  return `<div class="fsheet-head">
      <div class="grow" style="min-width:0;">
        <div class="fsheet-ttl">${esc(b.type === 'Other' ? 'Fire restriction' : b.type)}</div>
        <div class="s">${esc(since)}</div>
      </div>
      <span class="${banTypeClass(b.type)}">${esc(b.type)}</span>
      <button class="iconbtn" data-lf-close aria-label="Close detail">${ic('close')}</button>
    </div>
    ${b.comment ? `<p class="alertsum">${esc(b.comment)}</p>` : ''}
    <a class="btn primary block" href="${LIVEFIRE_SOURCES.bans.url}" target="_blank" rel="noopener">${ic('shield')}Saskatchewan fire bans</a>
    <p class="alertnote">${esc(NOT_FOR_EMERGENCY)}</p>`;
}

/**
 * Live fire map — the tracker. A full-bleed Leaflet map (dark tiles, pinch-zoom) plots EVERY live CWFIS
 * satellite hotspot across the continent (last 24h); tapping a dot slides up the full CWFIS record for
 * that fire. Best-effort: a warm cache paints instantly; offline/empty get honest states. Leaflet is
 * dynamically imported so it only loads when the map is opened (keeps the home bundle lean). Opened from
 * the Home banner (like Board/Settings — not a rail tab); the map owns its own pan/zoom (page never scrolls).
 */
export function openLiveFires(): void {
  activeOverlay?.close(); // opened directly (not via the rail) — clear any panel that was up
  const options = COUNTRIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  const C = LIVEFIRE_COPY;

  // National summary stat strip (CIFFC). One compact cell per number; values settle in via paintStats.
  const statCell = (key: string, label: string): string =>
    `<div class="fstat"><b data-lf-stat="${key}">—</b><span>${label}</span></div>`;
  const statStrip =
    statCell('today', C.stat.today) + statCell('active', C.stat.active) + statCell('out', C.stat.out) +
    statCell('total', C.stat.total) + statCell('area', C.stat.area) + statCell('prep', C.stat.prep);

  // Layer toggle chips (the `on` class = currently visible). Reported fires + hotspots + burn area on
  // by default; the Fire Weather raster is opt-in (it would otherwise wash out the dots). The FWI chip
  // is dropped entirely under the kill-switch so it can never hit CWFIS (the JSON feeds gate too).
  const ALL_LAYERS: { id: FireLayer; label: string; hint: string; on: boolean }[] = [
    { id: 'reported', label: C.layers.reported, hint: C.layerHint.reported, on: true },
    { id: 'out', label: C.layers.out, hint: C.layerHint.out, on: false },
    { id: 'hotspots', label: C.layers.hotspots, hint: C.layerHint.hotspots, on: true },
    { id: 'perimeters', label: C.layers.perimeters, hint: C.layerHint.perimeters, on: true },
    { id: 'fwi', label: C.layers.fwi, hint: C.layerHint.fwi, on: false },
    { id: 'smoke', label: C.layers.smoke, hint: C.layerHint.smoke, on: false },
    { id: 'alerts', label: C.layers.alerts, hint: C.layerHint.alerts, on: false },
    { id: 'bans', label: C.layers.bans, hint: C.layerHint.bans, on: false },
  ];
  // The FWI + smoke rasters are live WMS feeds, so the kill-switch drops their chips entirely (the JSON
  // feeds gate in the client; these layers are built directly in FireMap, so they're gated here too).
  const LIVE_WMS = new Set<FireLayer>(['fwi', 'smoke']);
  const LAYERS = ALL_LAYERS.filter((l) => !LIVE_WMS.has(l.id) || isLiveFireEnabled());
  const layerChips = LAYERS.map(
    (l) =>
      `<button class="lchip${l.on ? ' on' : ''}" data-lf-layer="${l.id}" aria-pressed="${l.on}" title="${l.hint}"><i class="ldotc" data-lf-dot="${l.id}"></i>${l.label}</button>`,
  ).join('');
  // Stage-of-control legend (the dots' meaning) — classes map to the same tokens the map dots use.
  const legend = `<span class="flegend">
      <i class="ldot oc"></i>Out of control<i class="ldot bh"></i>Being held<i class="ldot uc"></i>Under control
    </span>`;

  const body = `<div class="firewrap">
    <div class="firebar">
      <div class="grow" style="min-width:0;"><div class="t" data-lf-head>${C.bannerLoading}</div><div class="s" data-lf-sub>${C.hint}</div></div>
      <select class="firesel" data-lf-country aria-label="Country filter">${options}</select>
      <button class="iconbtn" data-lf-ledger aria-label="Data sources & freshness">${ic('shield')}</button>
      <button class="iconbtn" data-lf-refresh aria-label="Refresh">${ic('motion')}</button>
    </div>
    <div class="firestats" data-lf-stats hidden>${statStrip}</div>
    <div class="firetools"><div class="firelayers">${layerChips}</div>${legend}</div>
    <div class="firemap" data-lf-map></div>
    <div class="firescrub" data-lf-scrub hidden>
      <button class="iconbtn" data-lf-play aria-label="Play smoke forecast">${ic('play')}</button>
      <input type="range" class="scrubrange" data-lf-range min="0" max="0" value="0" step="1" aria-label="Smoke forecast time" />
      <div class="scrublabel"><span data-lf-scrub-time>—</span><span class="scrubtag">Forecast</span></div>
    </div>
    <div class="firesheet" data-lf-sheet hidden></div>
  </div>`;
  // The Leaflet map lives in a lazy chunk, so it's built asynchronously below. `closed` guards every
  // async continuation: if the overlay is dismissed (Esc / rail / another panel) before the chunk
  // resolves, the onClose hook flips it and we never build/operate a map on a detached container.
  let map: FireMap | null = null;
  let closed = false;
  let smokeTimer: number | null = null; // the smoke-forecast playback interval (MUST be cleared on close)
  const { root } = overlay('fires', C.overlayTitle, body, () => {
    closed = true;
    delete (window as unknown as { __fireQA?: unknown }).__fireQA; // release the QA hook + its retained DOM
    if (smokeTimer !== null) { clearInterval(smokeTimer); smokeTimer = null; } // no orphaned interval (leak guard)
    map?.dispose();
    map = null;
  });

  const headEl = root.querySelector<HTMLElement>('[data-lf-head]')!;
  const subEl = root.querySelector<HTMLElement>('[data-lf-sub]')!;
  const statsEl = root.querySelector<HTMLElement>('[data-lf-stats]')!;
  const mapEl = root.querySelector<HTMLElement>('[data-lf-map]')!;
  const sheetEl = root.querySelector<HTMLElement>('[data-lf-sheet]')!;
  const refreshBtn = root.querySelector<HTMLButtonElement>('[data-lf-refresh]')!;
  const ledgerBtn = root.querySelector<HTMLButtonElement>('[data-lf-ledger]')!;
  const countryEl = root.querySelector<HTMLSelectElement>('[data-lf-country]')!;
  const scrubEl = root.querySelector<HTMLElement>('[data-lf-scrub]')!;
  const playBtn = root.querySelector<HTMLButtonElement>('[data-lf-play]')!;
  const rangeEl = root.querySelector<HTMLInputElement>('[data-lf-range]')!;
  const scrubTimeEl = root.querySelector<HTMLElement>('[data-lf-scrub-time]')!;

  const offline: FeedMeta = { status: 'unavailable', fromCache: false, publishedAt: 0, fetchedAt: 0 };
  let hsFeed: LiveFireFeed = { hotspots: [], fireCount: 0, totalDetections: 0, meta: offline };
  let reportedFeed: ReportedFeed = { fires: [], out: [], byStage: { OC: 0, BH: 0, UC: 0, OUT: 0, UNK: 0 }, meta: offline };
  let summary: NationalSummary | null = null;
  let burnFeed: BurnFeed = { polys: [], meta: offline };
  let fwiMeta: FeedMeta = offline;
  let alertFeed: AlertFeed = { alerts: [], meta: offline };
  let banFeed: BanFeed = { bans: [], meta: offline };
  let biggest: ReportedFire | null = null; // tracked for the ?qa detail-panel hook below
  let hottest: Hotspot | null = null;
  // Smoke FORECAST layer: an hourly frame timeline built once from `now`, an index into it, and playback.
  // It's a forecast (a model prediction), labeled as such — never presented as observed smoke.
  const smokeMeta: FeedMeta = { status: isLiveFireEnabled() ? 'live' : 'disabled', fromCache: false, publishedAt: 0, fetchedAt: 0 };
  const smokeFrames = smokeForecastFrames(Date.now(), LIVEFIRE.smokeForecastHours);
  let smokeIdx = 0;
  let smokePlaying = false;
  rangeEl.max = String(Math.max(0, smokeFrames.length - 1));
  let country: CountryFilter = getCountryPref(); // defaults to Canada
  countryEl.value = country;

  const wireClose = (): void => {
    sheetEl.querySelector('[data-lf-close]')?.addEventListener('click', () => {
      sheetEl.hidden = true;
    });
  };
  let detailToken = 0; // bumped per open, so a slow history fetch can't paint into a newer selection
  const showReported = (f: ReportedFire): void => {
    sheetEl.innerHTML = reportedDetailHtml(f);
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
    // Enrich with the fire's tracked history from the ingestion backend. Best-effort + async: a no-op
    // when the backend is unconfigured/empty (fetchFireHistory → []), so the panel is unchanged offline.
    const token = ++detailToken;
    if (f.fireId) {
      void fetchFireHistory(f.fireId).then((points) => {
        if (closed || token !== detailToken) return;
        const html = fireHistoryHtml(points, f);
        const host = sheetEl.querySelector<HTMLElement>('[data-lf-hist]');
        if (html && host) host.innerHTML = html;
      });
    }
  };
  const showHotspot = (h: Hotspot): void => {
    sheetEl.innerHTML = fireDetailHtml(h);
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
  };
  const showAlert = (a: AlertItem): void => {
    sheetEl.innerHTML = alertDetailHtml(a);
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
  };
  const showBan = (b: BanArea): void => {
    sheetEl.innerHTML = banDetailHtml(b);
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
      { key: 'alerts', meta: alertFeed.meta },
      { key: 'bans', meta: banFeed.meta },
      { key: 'summary', meta: summary?.meta ?? offline },
    ];
    const rowHtml = rows
      .map(({ key, meta }) => {
        const info = LIVEFIRE_SOURCES[key];
        // Per-source freshness, honestly: smoke = a FORECAST + the frame in view (never "updated X ago");
        // alerts/bans = the count + the honest "none active" / "no ban in effect" empty state; the rest use
        // their real source publish time.
        const fresh =
          key === 'smoke' && meta.status === 'live'
            ? smokeFreshness(currentSmokeFrame())
            : key === 'alerts'
              ? alertFreshness(meta, alertFeed.alerts.length)
              : key === 'bans'
                ? banFreshness(meta, banFeed.bans.length)
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
    sheetEl.innerHTML = ledgerHtml();
    sheetEl.hidden = false;
    sheetEl.scrollTop = 0;
    wireClose();
  };

  // ── Smoke forecast playback — the firesmoke.ca-style animation, honestly labeled a FORECAST ──────────
  const currentSmokeFrame = (): string | null => smokeFrames[smokeIdx] ?? null;
  const applySmokeFrame = (): void => {
    const f = currentSmokeFrame();
    if (!f) return;
    map?.setSmokeTime(f);
    scrubTimeEl.textContent = frameTimeLabel(f);
    if (rangeEl.value !== String(smokeIdx)) rangeEl.value = String(smokeIdx);
  };
  const stopSmoke = (): void => {
    smokePlaying = false;
    if (smokeTimer !== null) { clearInterval(smokeTimer); smokeTimer = null; }
    playBtn.innerHTML = ic('play');
    playBtn.setAttribute('aria-label', 'Play smoke forecast');
  };
  const playSmoke = (): void => {
    if (smokeFrames.length < 2 || closed) return;
    if (smokeTimer !== null) clearInterval(smokeTimer); // idempotent: never stack intervals (double-tap guard)
    smokePlaying = true;
    playBtn.innerHTML = ic('pause');
    playBtn.setAttribute('aria-label', 'Pause smoke forecast');
    smokeTimer = window.setInterval(() => {
      if (closed) return stopSmoke();
      smokeIdx = (smokeIdx + 1) % smokeFrames.length;
      applySmokeFrame();
    }, LIVEFIRE.smokeFrameMs);
  };

  // Paint the CIFFC summary stat strip. The numbers are CANADA-national, so hide the strip entirely when
  // the map is filtered to the US/Mexico (showing Canadian YTD there would be a lie), and when the summary
  // is unreachable (no fake zeros). Shown for Canada + All North America (Canada is part of "all").
  const paintStats = (): void => {
    if (!summary || summary.meta.status !== 'live' || country === 'US' || country === 'MX') {
      statsEl.hidden = true;
      return;
    }
    const s = summary;
    const set = (k: string, v: string): void => {
      const el = statsEl.querySelector<HTMLElement>(`[data-lf-stat="${k}"]`);
      if (el) el.textContent = v;
    };
    set('today', s.firesToday.toLocaleString());
    set('active', s.activeFires.toLocaleString());
    set('out', s.ytdOut.toLocaleString());
    set('total', s.ytdTotal.toLocaleString());
    set('area', C.fireSize(s.areaBurnedHa));
    set('prep', C.prepLevel(s.prepLevel));
    statsEl.hidden = false;
  };

  // Paint the map for the SELECTED country: filter each layer → re-plot → refit. The headline uses the
  // AUTHORITATIVE reported active-fire count (falls back to the clustered hotspot count if CIFFC is down).
  const paint = (): void => {
    const reported = filterReportedCountry(reportedFeed.fires, country);
    const out = filterReportedCountry(reportedFeed.out, country);
    const hs = filterCountry(hsFeed.hotspots, country);
    const label = countryLabel(country);
    biggest = reported.reduce<ReportedFire | null>((a, b) => (!a || b.sizeHa > a.sizeHa ? b : a), null);
    hottest = hs.reduce<Hotspot | null>((a, b) => (!a || b.hfi > a.hfi ? b : a), null);

    const canada = country !== 'US' && country !== 'MX';
    const perimCount = canada ? burnFeed.polys.length : 0;
    // Alerts + bans are Saskatchewan (SaskAlert / SK SPSA), so they show only when Canada is in frame.
    const alerts = canada ? alertFeed.alerts : [];
    const bans = canada ? banFeed.bans : [];

    // Headline honesty: "unavailable" (both authoritative feeds down) ≠ "no fires in view" (a LIVE feed
    // with 0 results) ≠ a real count. We only show the offline copy when there's genuinely nothing live.
    if (reportedFeed.meta.status !== 'live' && hsFeed.meta.status !== 'live') {
      headEl.textContent = C.offlineTitle;
      subEl.textContent = C.offlineBody;
    } else {
      const active = reported.length || countFires(hs); // authoritative count if we have it, else clustered hotspots
      headEl.textContent = active > 0 ? C.head(active, label) : `${C.emptyTitle} · ${label}`;
      // Freshness = the SOURCE's publish time (reported sitrep, else satellite pass) — NOT our fetch time.
      const freshMs = reportedFeed.meta.publishedAt || hsFeed.meta.publishedAt;
      subEl.textContent = C.subStats(hs.length, publishedWhen(freshMs));
    }

    // Per-chip status dots — empty-in-view ('none') is a DISTINCT, calmer state from down/off (the
    // "empty ≠ down ≠ off" trust fix, computed here at the UI layer where the country filter is known).
    const setDot = (id: FireLayer, meta: FeedMeta, count?: number): void => {
      const el = root.querySelector<HTMLElement>(`[data-lf-dot="${id}"]`);
      if (!el) return;
      let cls = statusDotClass(meta); // live | cache | down | off
      if (cls !== 'down' && cls !== 'off' && count !== undefined && count === 0) cls = 'none';
      el.className = `ldotc ${cls}`;
    };
    setDot('reported', reportedFeed.meta, reported.length);
    setDot('out', reportedFeed.meta, out.length);
    setDot('hotspots', hsFeed.meta, hs.length);
    setDot('perimeters', burnFeed.meta, perimCount);
    setDot('fwi', fwiMeta);
    setDot('smoke', smokeMeta);
    setDot('alerts', alertFeed.meta, alerts.length);
    setDot('bans', banFeed.meta, bans.length);

    map?.setReportedFires(reported);
    map?.setOutFires(out);
    map?.setHotspots(hs);
    map?.setAlerts(alerts);
    map?.setBans(bans);
    // The M3 burn perimeters are Canada-only (CWFIS), so drop them when the map is scoped to US/Mexico —
    // mirrors the stat strip. Shown for Canada + All North America (where Canada is part of the frame).
    map?.setBurnPolygons(canada ? burnFeed.polys : []);
    // Frame on the authoritative fires (fall back to hotspots) for the chosen country.
    const frame = (reported.length ? reported : hs).map((p) => [p.lat, p.lon] as [number, number]);
    map?.fitTo(frame);
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
      fetchAlerts({ force }),
      fetchBans({ force }),
    ])
      .then(([sum, rep, hot, per, fwi, alr, ban]) => {
        if (closed) return; // overlay dismissed mid-flight — don't paint into a removed DOM
        if (sum.status === 'fulfilled') summary = sum.value;
        if (rep.status === 'fulfilled') reportedFeed = rep.value;
        if (hot.status === 'fulfilled') hsFeed = hot.value;
        if (per.status === 'fulfilled') burnFeed = per.value;
        if (fwi.status === 'fulfilled') fwiMeta = fwi.value;
        if (alr.status === 'fulfilled') alertFeed = alr.value;
        if (ban.status === 'fulfilled') banFeed = ban.value;
        paintStats();
        paint();
      })
      .finally(() => {
        if (!closed) refreshBtn.disabled = false;
      });
  };
  refreshBtn.addEventListener('click', () => load(true));
  ledgerBtn.addEventListener('click', () => showLedger());
  countryEl.addEventListener('change', () => {
    country = countryEl.value as CountryFilter;
    setCountryPref(country);
    sheetEl.hidden = true; // a country switch clears any open detail (it may not be in the new set)
    paintStats(); // the national summary is Canada-only — show/hide it for the chosen country
    paint();
  });

  // Layer toggles: flip the chip's state + the map layer's visibility.
  root.querySelectorAll<HTMLButtonElement>('[data-lf-layer]').forEach((chip) =>
    chip.addEventListener('click', () => {
      const id = chip.dataset.lfLayer as FireLayer;
      const on = !chip.classList.contains('on');
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
      map?.setLayer(id, on);
      // Smoke owns the forecast scrubber: reveal it + seed the current frame on enable, stop playback on disable.
      if (id === 'smoke') {
        scrubEl.hidden = !on;
        if (on) applySmokeFrame();
        else stopSmoke();
      }
    }),
  );

  // Smoke scrubber: play/pause toggles the hourly animation; dragging the timeline scrubs (and pauses).
  playBtn.addEventListener('click', () => (smokePlaying ? stopSmoke() : playSmoke()));
  rangeEl.addEventListener('input', () => {
    stopSmoke(); // dragging the timeline pauses playback
    smokeIdx = Math.min(smokeFrames.length - 1, Math.max(0, parseInt(rangeEl.value, 10) || 0));
    applySmokeFrame();
  });

  // Build the map once the overlay is painted + sized; Leaflet is a lazy chunk (loads on open only). If
  // the overlay was already dismissed before the chunk resolved, bail — never build on a detached node.
  requestAnimationFrame(() => {
    if (closed) return;
    import('../../livefire/FireMap')
      .then((m) => {
        if (closed) return;
        map = new m.FireMap(mapEl, { onSelectHotspot: showHotspot, onSelectReported: showReported, onSelectAlert: showAlert, onSelectBan: showBan });
        map.invalidate();
        load(false);
      })
      .catch(() => {
        if (closed) return;
        headEl.textContent = C.offlineTitle;
        subEl.textContent = C.offlineBody;
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
      `<p class="mtext"><b>Active fire data</b><br>CWFIS — <a href="https://cwfis.cfs.nrcan.gc.ca" target="_blank" rel="noopener">Canadian Wildland Fire Information System</a>, Natural Resources Canada</p>` +
      `<p class="mtext"><b>Basemap</b><br>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a></p>` +
      `<p class="mtext"><b>Map engine</b><br><a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a></p>` +
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
    <div class="srow"><div class="ic">${ic('motion')}</div><div class="grow"><div class="t">Reduced motion</div><div class="s">Calm the menus</div></div>
      <div class="toggle" data-rm role="switch" tabindex="0"><span class="knob"></span></div></div>
  </div>
  <div class="card" style="margin-top:12px;">
    <div class="srow"><div class="ic">${ic('user')}</div><div class="grow"><div class="t">Pilot</div><div class="s" id="callsign">${pro.name || 'Unnamed'}</div></div>
      <button class="btn ghost sm" data-edit>${ic('edit')}Edit</button></div>
    <div class="srow"><div class="ic">${ic('cloud')}</div><div class="grow" style="min-width:0;"><div class="t">Cloud save</div><div class="s" id="cloudsub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">…</div></div>
      <button class="btn ghost sm" data-cloud id="cloudbtn" style="display:none;"></button></div>
    <div class="srow"><div class="ic">${ic('pin')}</div><div class="grow"><div class="t">Region</div><div class="s">Map</div></div><span class="badge">Saskatchewan</span></div>
    <div class="srow"><div class="ic">${ic('shield')}</div><div class="grow"><div class="t">Credits &amp; data</div><div class="s">Map, fire data &amp; licences</div></div>
      <button class="btn ghost sm" data-credits aria-label="Open credits">${ic('chevron-right')}</button></div>
  </div>
  <div class="card" style="margin-top:12px;">
    <div class="srow danger"><div class="ic">${ic('trash')}</div><div class="grow"><div class="t">Reset progress</div><div class="s">Wipe ranks, stars &amp; unlocks</div></div>
      <button class="btn danger" data-reset>Reset…</button></div>
  </div>`;

  const { root } = overlay('settings', 'Settings', body);

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
