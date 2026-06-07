/**
 * Rail-menu overlays opened from the Home bottom rail. Shop → openShop reuses the existing page;
 * this file supplies the rest as focused, branded full-screen panels on the shared `.bmf-app`
 * stylesheet:
 *   - Campaign — region picker (Saskatchewan live + coming-soon) that DRILLS INTO that map's
 *                missions (openMissions): pick a mission, fly it. Missions now live inside the map.
 *   - Hangar   — aircraft picker (3 helis, specs, unlock gates), saves profile.heliId
 *   - Co-op    — coming-soon teaser (stub)
 *   - Settings — sound + reduced-motion toggles, callsign, region, reset progress (off the rail
 *                now; opened from the Home profile card). Board (leaderboard) likewise.
 * Each is a back-to-Home overlay (Home stays mounted underneath). No-scroll / single-viewport.
 */
import type { MissionDef } from '../../missions/types';
import { HELIS, MAPS, isHeliUnlocked, missionsCleared, loadProfile, saveProfile, type Profile, type CatalogItem } from '../profile';
import { isConfigured } from '../../leaderboard/client';
import { resetProgress, getProgress, bestScore, bestStars, isUnlocked } from '../../missions/progress';
import { missionPoster } from '../missionArt';
import { openLeaderboard } from '../Leaderboard';
import { openShop } from '../ShopScreen';
import { injectHomeStyles, spawnEmbers } from './styles';
import { railNav } from './rail';
import { DEFS, FLAME, ic } from './icons';

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

/** HomeScreen seeds the campaign catalog (the Campaign/Board surfaces read it) and the boot hook the
 *  mission cards call to fly a mission (a page-reload campaign nav owned by main.ts). */
export function setMenuCatalog(catalog: MissionDef[], onFly?: (id: string) => void): void {
  menuCatalog = catalog;
  if (onFly) flyMission = onFly;
}

/** Route a rail tap: close the current panel (if any), then open the target. `home` just falls back
 *  to the hub mounted underneath. Shop is its own immersive screen (no rail of its own). */
export function navigateRail(key: string): void {
  if (activeOverlay && activeOverlay.key === key) return; // already on this panel
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
      return openShop();
  }
}

/** Board (leaderboard) — off the rail now; opened from the Home profile card. */
export function openBoard(): void {
  activeOverlay?.close();
  openLeaderboard(menuCatalog);
}

/** Build a focused full-screen overlay WITH the persistent bottom rail (`key` = its active tab).
 *  Back / Esc / the rail's Home tab all return to the hub. Returns the root + a close() helper. */
function overlay(key: string, title: string, sub: string, body: string): { root: HTMLDivElement; close: () => void } {
  injectHomeStyles();
  const root = document.createElement('div');
  root.className = 'bmf-app';
  root.style.zIndex = '60';
  root.innerHTML =
    DEFS +
    `<div class="scene"></div><div class="embers"></div>` +
    `<div class="pad"><div class="appbar"><button class="back" data-x aria-label="Back">${ic('back')}</button>` +
    `<div><div class="ttl">${title}</div><div class="sub">${sub}</div></div></div>${body}</div>` +
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
  root.querySelector('[data-x]')?.addEventListener('click', close);
  root.querySelectorAll<HTMLElement>('.rail [data-rail]').forEach((b) =>
    b.addEventListener('click', () => navigateRail(b.dataset.rail || 'home')),
  );
  activeOverlay = { key, close };
  return { root, close };
}

// — Hero carousel (shared by Maps + Hangar) ——————————————————————————————————
// One full-bleed, center-snap, one-card-at-a-time strip with chevrons + dots + an "n / total"
// counter. Both pickers render their items as poster `.cslide`s and wire this same controller so
// the two screens read identically. Tapping an off-centre slide brings it to centre; the active
// slide's own CTA does the selecting.
function carousel(slides: string[], counterLabel: string): string {
  const n = slides.length;
  return (
    `<div class="carousel">` +
    (n > 1 ? `<button class="cnav prev hide" data-cnav="-1" aria-label="Previous">${ic('back')}</button>` : '') +
    `<div class="ctrack" data-ctrack>${slides.join('')}</div>` +
    (n > 1 ? `<button class="cnav next" data-cnav="1" aria-label="Next">${ic('chevron-right')}</button>` : '') +
    `</div>` +
    (n > 1 ? `<div class="dots" data-cdots>${slides.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` : '') +
    `<div class="cmeta"><b data-cidx>1</b> / ${n} · ${counterLabel}</div>`
  );
}

/** Wire the carousel in `root`: scroll → active slide (scale-up + dots + counter + chevron fade),
 *  chevrons + off-centre taps re-centre. `onActive(i)` fires on each settle. Returns a `center(i)`. */
function wireCarousel(root: HTMLElement, initial: number, onActive?: (i: number) => void): (i: number) => void {
  const track = root.querySelector<HTMLElement>('[data-ctrack]');
  if (!track) return () => {};
  const slides = Array.from(track.querySelectorAll<HTMLElement>('.cslide'));
  const dots = root.querySelector<HTMLElement>('[data-cdots]');
  const idxEl = root.querySelector<HTMLElement>('[data-cidx]');
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
    if (idxEl) idxEl.textContent = String(i + 1);
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
    const cover = m.imageUrl
      ? `<img class="img" src="${m.imageUrl}" alt="">`
      : `<div class="fallback"><b>${m.name.slice(0, 2).toUpperCase()}</b></div>`;
    const badge = m.available
      ? `<span class="pill ${selected ? 'ok' : ''}">${selected ? 'Selected' : 'Live'}</span>`
      : `<span class="pill soon">Soon</span>`;
    const stats = m.available
      ? `<div class="ctx-row" style="margin-top:11px;">${m.stats ? `<span class="ctx">${ic('map')}${m.stats.area}</span><span class="ctx">${ic('droplet')}${m.stats.lakes}</span>` : ''}<span class="ctx hot">${ic('fire')}${count} missions</span></div>`
      : '';
    const cta = !m.available
      ? `<button class="btn ghost block is-disabled" style="margin-top:15px;">${ic('lock')}Coming soon</button>`
      : `<button class="btn primary block" style="margin-top:15px;" data-map="${m.id}">${ic('play')}${selected ? 'Choose a mission' : 'Deploy here'}</button>`;
    return `<article class="cslide${m.available ? '' : ' locked'}">
      <div class="artcard">
        ${cover}<div class="scrim"></div><div class="brackets"><i></i><i></i><i></i></div>
        <div class="inner">
          <div class="row between"><span class="chip ghost">${m.tagline}</span>${badge}</div>
          <div class="grow"></div>
          <h2 class="h-big" style="font-size:var(--fs-display);">${m.name}</h2>
          ${stats}
          ${cta}
        </div>
      </div></article>`;
  });

  const initial = Math.max(0, MAPS.findIndex((m) => m.id === pro.mapId && m.available));
  const { root, close } = overlay('campaign', 'Campaign', 'Choose a region', carousel(slides, 'Region'));
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
      ? `<span class="pill locked">${ic('lock')}Locked</span>`
      : isNext
        ? `<span class="pill">Next up</span>`
        : done
          ? `<span class="pill ok">${ic('check')}Cleared</span>`
          : `<span class="pill">Ready</span>`;
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

  const { root } = overlay('campaign', map?.name ?? 'Campaign', `${all.length} missions · hardest last`, `<div class="mlist">${cards.join('')}</div>`);
  // Back goes to the region picker so the drill reads map → mission (the overlay's default close()
  // — which returns to Home — still fires first, so this just re-opens Campaign on top).
  root.querySelector('[data-x]')?.addEventListener('click', () => openCampaign());
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
  const body =
    carousel(slides, 'Airframe') +
    `<div class="card metal" style="margin-top:16px;"><div class="row" style="gap:12px;"><div class="glyph">${FLAME}</div>` +
    `<div class="grow"><div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">Earn your fleet</div>` +
    `<div class="muted" style="font-size:var(--fs-meta);margin-top:2px;">Bell 212 unlocks at 2 missions · UH-60 at 5. You've cleared ${cleared}.</div></div></div></div>`;

  const initial = Math.max(0, HELIS.findIndex((h) => h.id === currentProfile().heliId));
  const { root } = overlay('hangar', 'Hangar', 'Your aircraft', body);

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
  const badge = unlocked ? `<span class="pill ok">Flyable</span>` : `<span class="pill locked">Locked</span>`;
  return `<article class="cslide${unlocked ? '' : ' locked'}">
    <div class="artcard heli" data-heli="${h.id}" style="--accent:${h.accent};">
      <div class="heli-art"><span class="grid"></span><span class="ring"></span><span class="mark">${ic('heli')}</span><span class="livery" aria-hidden="true">${FLAME}</span></div>
      <div class="scrim"></div><div class="brackets"><i></i><i></i><i></i></div>
      <div class="inner">
        <div class="row between"><span class="chip ghost">${h.tagline}</span>${badge}</div>
        <div class="grow"></div>
        <h2 class="h-big" style="font-size:var(--fs-display);">${h.name}</h2>
        <div class="specgrid">${specs}</div>
        <div class="heli-foot" style="margin-top:14px;"></div>
      </div>
    </div></article>`;
}

// ============================ CO-OP (stub) ============================
export function openCoop(): void {
  const body = `<div style="margin-top:10px;">
    <span class="pill soon">Coming soon</span>
    <h1 class="h-big" style="margin-top:14px;">Fly it together.</h1>
    <p class="muted" style="margin-top:10px;font-size:var(--fs-body);line-height:1.5;max-width:34ch;">Host or join by code. One fire, one team.</p>
    <div class="card metal" style="margin-top:18px;">
      <div class="row between"><div class="row" style="gap:12px;"><div class="glyph">${ic('users')}</div>
      <div><div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">Get notified</div>
      <div class="muted" style="font-size:var(--fs-meta);margin-top:2px;">One email when co-op goes live.</div></div></div></div>
      <button class="btn ember block" style="margin-top:14px;border-radius:var(--r-sm);" data-soon>${ic('check')}Notify me</button>
    </div>
  </div>`;
  const { root } = overlay('coop', 'Co-op', 'Multiplayer', body);
  root.querySelector('[data-soon]')?.addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.textContent = "You're on the list";
    b.classList.add('is-disabled');
  });
}

// ============================ SETTINGS (minimal) ============================
export function openSettings(): void {
  const pro = currentProfile();
  const muted = localStorage.getItem(MUTE_KEY) === '1';
  const online = isConfigured();
  const body = `<div class="card" style="margin-top:8px;">
    <div class="srow"><div class="ic">${ic('volume')}</div><div class="grow"><div class="t">Sound</div><div class="s">Rotor loop &amp; SFX</div></div>
      <div class="toggle ${muted ? '' : 'on'}" data-sound role="switch" tabindex="0"><span class="knob"></span></div></div>
    <div class="srow"><div class="ic">${ic('motion')}</div><div class="grow"><div class="t">Reduced motion</div><div class="s">Calm the menus</div></div>
      <div class="toggle" data-rm role="switch" tabindex="0"><span class="knob"></span></div></div>
  </div>
  <div class="card" style="margin-top:12px;">
    <div class="srow"><div class="ic">${ic('user')}</div><div class="grow"><div class="t">Pilot</div><div class="s" id="callsign">${pro.name || 'Unnamed'}</div></div>
      <button class="btn ghost sm" data-edit>${ic('edit')}Edit</button></div>
    <div class="srow"><div class="ic">${ic('cloud')}</div><div class="grow"><div class="t">Cloud &amp; board</div><div class="s ${online ? 'ok' : ''}">${online ? 'Online ✓' : 'Offline'}</div></div></div>
    <div class="srow"><div class="ic">${ic('pin')}</div><div class="grow"><div class="t">Region</div><div class="s">Map</div></div><span class="pill">Saskatchewan</span></div>
  </div>
  <div class="card" style="margin-top:12px;">
    <div class="srow danger"><div class="ic">${ic('trash')}</div><div class="grow"><div class="t">Reset progress</div><div class="s">Wipe ranks, stars &amp; unlocks</div></div>
      <button class="btn danger" data-reset>Reset…</button></div>
  </div>
  <div style="margin-top:16px;text-align:center;font-family:var(--mono);font-size:var(--fs-micro);letter-spacing:.16em;text-transform:uppercase;color:var(--faint);">bucketmyfire v1.0 · Marakana</div>`;

  const { root } = overlay('settings', 'Settings', 'Field settings', body);

  root.querySelector('[data-sound]')?.addEventListener('click', (e) => {
    const t = e.currentTarget as HTMLElement;
    const on = t.classList.toggle('on');
    localStorage.setItem(MUTE_KEY, on ? '0' : '1'); // toggle ON = sound on = not muted
  });
  root.querySelector('[data-rm]')?.addEventListener('click', (e) => {
    (e.currentTarget as HTMLElement).classList.toggle('on');
  });
  root.querySelector('[data-edit]')?.addEventListener('click', () => {
    const v = window.prompt('Callsign', currentProfile().name || '');
    if (v && v.trim()) {
      saveProfile({ ...currentProfile(), name: v.trim() });
      const el = root.querySelector('#callsign');
      if (el) el.textContent = v.trim();
    }
  });
  root.querySelector('[data-reset]')?.addEventListener('click', () => {
    if (window.confirm('Reset all progress? This wipes your ranks, scores and unlocks.')) {
      resetProgress();
      location.reload();
    }
  });
}
