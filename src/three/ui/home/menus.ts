/**
 * Rail-menu overlays opened from the Home bottom rail. Shop NAVIGATES to the standalone /shop.html
 * merch website (a real context switch, not an overlay); this file supplies the rest as focused,
 * branded full-screen panels on the shared `.bmf-app`
 * stylesheet:
 *   - Campaign — region picker (Saskatchewan live + coming-soon) that DRILLS INTO that map's
 *                missions (openMissions): pick a mission, fly it. Missions now live inside the map.
 *   - Hangar   — aircraft picker (3 helis, specs, unlock gates), saves profile.heliId
 *   - Open Skies — the endless free-for-all (openCoop): routes to ?ffa, a same-map score race
 *   - Settings — sound + reduced-motion toggles, callsign, region, reset progress (off the rail
 *                now; opened from the Home profile card). Board (leaderboard) likewise.
 * Each is a back-to-Home overlay (Home stays mounted underneath). No-scroll / single-viewport.
 */
import type { MissionDef } from '../../missions/types';
import { HELIS, MAPS, isHeliUnlocked, missionsCleared, loadProfile, saveProfile, type Profile, type CatalogItem } from '../profile';
import { isConfigured } from '../../leaderboard/client';
import { getCloudLink } from '../../leaderboard/cloudSave';
import { openCloudSave } from '../CloudSave';
import { resetProgress, getProgress, bestScore, bestStars, isUnlocked } from '../../missions/progress';
import { missionPoster } from '../missionArt';
import { openLeaderboard } from '../Leaderboard';
import { injectHomeStyles, spawnEmbers } from './styles';
import { posterCard } from './posterCard';
import { railNav } from './rail';
import { DEFS, FLAME, ic } from './icons';
import { validateCallsign, MAX_CALLSIGN } from '../callsign';

const MUTE_KEY = 'bmf.audio.muted.v1';

function currentProfile(): Profile {
  return loadProfile() ?? { name: '', mapId: 'saskatchewan', heliId: HELIS[0].id };
}

// — Rail context + router —————————————————————————————————————————————————————
// The bottom rail now rides ON every menu overlay (not just the hub), so it must stay visible the
// whole time you're "in the menus". The hub seeds the catalog (Board needs it) and tracks the one
// open overlay so tapping another rail tab swaps panels in place instead of stacking them.
let menuCatalog: MissionDef[] = [];
let flyMission: ((id: string) => void) | null = null;
let activeOverlay: { key: string; close: () => void } | null = null;
// The Campaign tab covers two views (region picker → mission list). With the back button gone, the
// rail is the only way up, so we track which view is showing: tapping Campaign while on the mission
// list drills back UP to the region picker instead of being a no-op.
let campaignView: 'region' | 'missions' = 'region';

/** HomeScreen seeds the campaign catalog (the Campaign/Board surfaces read it) and the boot hook the
 *  mission cards call to fly a mission (a page-reload campaign nav owned by main.ts). */
export function setMenuCatalog(catalog: MissionDef[], onFly?: (id: string) => void): void {
  menuCatalog = catalog;
  if (onFly) flyMission = onFly;
}

/** Route a rail tap: close the current panel (if any), then open the target. `home` just falls back
 *  to the hub mounted underneath. Shop LEAVES the game for the standalone /shop.html website. */
export function navigateRail(key: string): void {
  // Already on this panel — tapping its own tab is a no-op, EXCEPT the Campaign tab while on the
  // mission list, where it drills back up to the region picker (the back button's old job).
  if (activeOverlay && activeOverlay.key === key && !(key === 'campaign' && campaignView === 'missions')) return;
  const prev = activeOverlay;
  prev?.close();
  switch (key) {
    case 'home':
      return; // hub is underneath
    case 'campaign':
      return openCampaign();
    case 'hangar':
      return openHangar();
    case 'coop':
      return openCoop();
    case 'shop':
      window.location.href = '/shop.html'; // a real context switch to the merch website
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
function overlay(key: string, title: string, body: string): { root: HTMLDivElement; close: () => void } {
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

// ============================ CAMPAIGN (region → missions) ============================
// The Campaign rail tab. Step 1 = pick a region (map); step 2 = pick a mission INSIDE that map
// (openMissions). Selecting a live map persists it (profile.mapId) and drills in; the future maps
// stay locked "coming soon" teasers.
export function openCampaign(): void {
  const pro = currentProfile();
  const slides = MAPS.map((m) => {
    const selected = m.id === pro.mapId && m.available;
    const count = m.available ? missionsForMap(m.id).length : 0;
    const backdrop = m.imageUrl
      ? `<img class="img" src="${m.imageUrl}" alt="">`
      : `<div class="fallback"><b>${m.name.slice(0, 2).toUpperCase()}</b></div>`;
    const badge = m.available
      ? `<span class="badge ${selected ? 'ok' : ''}">${selected ? 'Selected' : 'Live'}</span>`
      : `<span class="badge">Soon</span>`;
    const body = m.available
      ? `<div class="ctx-row">${m.stats ? `<span class="ctx">${ic('map')}${m.stats.area}</span><span class="ctx">${ic('droplet')}${m.stats.lakes}</span>` : ''}<span class="ctx hot">${ic('fire')}${count} missions</span></div>`
      : '';
    const footer = !m.available
      ? `<button class="btn ghost block is-disabled">${ic('lock')}Coming soon</button>`
      : `<button class="btn primary block" data-map="${m.id}">${ic('play')}${selected ? 'Choose a mission' : 'Deploy here'}</button>`;
    return posterCard({ locked: !m.available, backdrop, tagline: m.tagline, badge, title: m.name, body, footer });
  });

  campaignView = 'region';
  const initial = Math.max(0, MAPS.findIndex((m) => m.id === pro.mapId && m.available));
  const { root, close } = overlay('campaign', 'Campaign', carousel(slides));
  wireCarousel(root, initial);
  root.querySelectorAll<HTMLElement>('[data-map]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let the slide's re-centre handler swallow the pick
      const id = b.dataset.map!;
      saveProfile({ ...currentProfile(), mapId: id });
      close();
      openMissions(id);
    }),
  );
}

/** Campaign missions set in a given map (defaults to the live map for legacy defs with no `map`). */
function missionsForMap(mapId: string): MissionDef[] {
  return menuCatalog.filter((m) => (m.map ?? MAPS[0].id) === mapId);
}

// ============================ MISSIONS (inside a map) ============================
// Step 2 of Campaign: a vertical CARD LIST of the chosen map's missions (accordion). Every card
// carries its full copy — number, name, tagline, badge, stars, best run — with the poster anchored
// RIGHT behind a left-to-right scrim so the text stays legible. The "next up" card opens EXPANDED,
// revealing its fly CTA (+ fuller brief); tapping any other card expands it in turn. Back returns to
// the region picker so the drill reads map → mission. FLY boots via the seeded campaign-nav hook.
export function openMissions(mapId: string): void {
  const all = missionsForMap(mapId);
  const map = MAPS.find((m) => m.id === mapId);
  const completed = new Set(getProgress().completed);
  const nextId = all.find((m) => isUnlocked(m, all) && !completed.has(m.id))?.id ?? null;

  const cards = all.map((m) => {
    const unlocked = isUnlocked(m, all);
    const done = completed.has(m.id);
    const isNext = m.id === nextId;
    const best = bestScore(m.id);
    const stars = bestStars(m.id);
    const num = String(m.index + 1).padStart(2, '0');
    const poster = missionPoster(m.id);
    const art = poster ? `<img class="img" src="${poster}" alt="">` : `<div class="fallback"><b>${num}</b></div>`;
    const badge = !unlocked
      ? `<span class="badge locked">${ic('lock')}Locked</span>`
      : isNext
        ? `<span class="badge">Next up</span>`
        : done
          ? `<span class="badge ok">${ic('check')}Cleared</span>`
          : `<span class="badge">Ready</span>`;
    const starRow = `<span class="stars">${star(stars >= 1)}${star(stars >= 2)}${star(stars >= 3)}</span>`;
    const scoreLine = best != null
      ? `<span class="mono" style="font-size:var(--fs-meta);color:rgba(255,255,255,0.78);">Best <b style="color:var(--menu);font-weight:var(--fw-bold)">${best.toLocaleString('en-US')}</b></span>`
      : `<span class="mono" style="font-size:var(--fs-meta);color:var(--faint);">Not flown yet</span>`;
    // The fuller brief only shows in the expanded body, and only when it adds to the always-on tagline.
    const fuller = m.tagline && m.brief && m.brief !== m.tagline ? `<p class="mbrief">${m.brief}</p>` : '';
    const cta = !unlocked
      ? `<button class="btn ghost block is-disabled">${ic('lock')}Clear earlier missions</button>`
      : `<button class="btn primary block" data-fly="${m.id}">${ic('play')}${done ? 'Replay mission' : 'Fly mission'}</button>`;
    return `<article class="mcard${isNext ? ' active' : ''}${unlocked ? '' : ' locked'}" data-mid="${m.id}" role="button" tabindex="0" aria-expanded="${isNext}">
      <div class="mart">${art}</div><div class="mfade"></div>
      <div class="mbody">
        <div class="mhead"><span class="chip ghost">Mission ${num}</span>${badge}</div>
        <h3 class="mname">${m.name}</h3>
        <p class="mtag">${m.tagline ?? m.brief}</p>
        <div class="mmeta">${starRow}${scoreLine}</div>
        <div class="mexpand"><div>${fuller}${cta}</div></div>
      </div></article>`;
  });

  campaignView = 'missions';
  const { root } = overlay('campaign', map?.name ?? 'Campaign', `<div class="mlist">${cards.join('')}</div>`);
  wireMissionList(root);
}

/** Wire the mission card list: tapping a card expands it (accordion — one open at a time); the
 *  active card's CTA flies. The "next up" card starts expanded; on open we nudge it into view. */
function wireMissionList(root: HTMLElement): void {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.mcard'));
  const expand = (card: HTMLElement): void => {
    cards.forEach((c) => {
      const on = c === card;
      c.classList.toggle('active', on);
      c.setAttribute('aria-expanded', String(on));
    });
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  cards.forEach((card) => {
    card.addEventListener('click', (e) => {
      const fly = (e.target as HTMLElement).closest<HTMLElement>('[data-fly]');
      if (fly) {
        e.stopPropagation();
        flyMission?.(fly.dataset.fly!);
        return;
      }
      if (!card.classList.contains('active')) expand(card);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (!card.classList.contains('active')) expand(card);
      else card.querySelector<HTMLElement>('[data-fly]')?.click();
    });
  });
  // Bring the initially-expanded (next up) card into view without animation.
  const active = cards.find((c) => c.classList.contains('active'));
  active?.scrollIntoView({ block: 'nearest' });
}

/** Small inline star pip (matches HomeScreen's medal styling via the shared `.stars` CSS). */
function star(on: boolean): string {
  return `<svg class="${on ? 'on' : 'off'}" viewBox="0 0 24 24"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 7.1-1.01z"/></svg>`;
}

// ============================ HANGAR ============================
export function openHangar(): void {
  const cleared = missionsCleared();
  const slides = HELIS.map((h) => heliSlide(h, cleared));
  const body = carousel(slides);

  const initial = Math.max(0, HELIS.findIndex((h) => h.id === currentProfile().heliId));
  const { root } = overlay('hangar', 'Hangar', body);

  const refresh = (): void => {
    const sel = currentProfile().heliId;
    root.querySelectorAll<HTMLElement>('[data-heli]').forEach((el) => {
      const id = el.dataset.heli!;
      const h = HELIS.find((x) => x.id === id)!;
      const unlocked = isHeliUnlocked(h, cleared);
      const foot = el.querySelector('.heli-foot')!;
      if (!unlocked) {
        foot.innerHTML = `<button class="btn ghost block is-disabled">${ic('lock')}Clear ${h.unlockAfter} missions</button>`;
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

// ===================== OPEN SKIES (free-for-all) =====================
/** Open Skies — the endless FREE-FOR-ALL (the planned co-op, reimagined as a same-map score race).
 *  Everyone flies the same daily-seeded Saskatchewan, the fires never stop, you build a personal score.
 *  Routes to `?ffa` (a reload boot owned by main.ts), mirroring the Daily Burn nav. */
export function openCoop(): void {
  // Open Skies is a sandbox, but it still respects the campaign unlock ladder — you fly the airframes
  // you've EARNED, the same gate as the Hangar. Default the pick to the pilot's saved heli (loadProfile
  // already clamps a locked save back to the trainer), falling back to the first unlocked airframe so a
  // ?heli= override or stale pick can never seed a locked selection.
  const cleared = missionsCleared();
  const unlocked = (h: CatalogItem): boolean => isHeliUnlocked(h, cleared);
  let picked = currentProfile().heliId || HELIS[0].id;
  if (!unlocked(HELIS.find((h) => h.id === picked) ?? HELIS[0])) picked = (HELIS.find(unlocked) ?? HELIS[0]).id;
  // Each airframe is a compact card-button in a 3-up horizontal grid. Locked ones render dimmed with
  // their unlock requirement + a lock corner, carry data-locked, and the click handler skips them.
  const heliCard = (h: (typeof HELIS)[number]): string => {
    const ok = unlocked(h);
    const sel = ok && h.id === picked;
    const sub = ok ? h.tagline : `Clear ${h.unlockAfter}`;
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
  // Single-viewport, NO SCROLL (CLAUDE.md): `.osky` is a flex column that fits the pad above the rail —
  // the CTA group is pinned to the base (margin-top:auto), and short phones compress via styles.ts.
  // Title lives in the overlay's top bar (the appbar shows "Open Skies") — no duplicate body headline.
  const body = `<div class="osky">
    <span class="chip">${ic('fire')}Free-for-all</span>
    <p class="muted osky-sub">Open fire. Fly with your friends, show your skills and earn points.</p>
    <div class="sec"><span class="tag">Your aircraft</span><span class="line"></span></div>
    <div class="heligrid">${HELIS.map(heliCard).join('')}</div>
    <div class="osky-cta">
      <button class="btn ember block" data-ffa>${ic('play')}Join</button>
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
  root.querySelector('[data-ffa]')?.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('m');
    url.searchParams.delete('daily');
    url.searchParams.set('ffa', '1');
    url.searchParams.set('heli', picked); // fly the chosen airframe (main.ts honours ?heli=)
    location.assign(url.toString());
  });
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
      `<p class="mtext">Wipes your ranks, best scores, stars and aircraft unlocks. You'll start the campaign from the first sortie.</p>` +
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
