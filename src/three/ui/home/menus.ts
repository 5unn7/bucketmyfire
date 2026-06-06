/**
 * Rail-menu overlays opened from the Home bottom rail. Board → openLeaderboard and Shop → openShop
 * reuse the existing pages; this file supplies the rest as focused, branded full-screen panels on
 * the shared `.bmf-app` stylesheet:
 *   - Maps   — region/theatre picker (Saskatchewan live + coming-soon), saves profile.mapId
 *   - Hangar — aircraft picker (3 helis, specs, unlock gates), saves profile.heliId
 *   - Co-op  — coming-soon teaser (stub)
 *   - Settings — sound + reduced-motion toggles, callsign, region, reset progress (minimal)
 * Each is a back-to-Home overlay (Home stays mounted underneath). No-scroll / single-viewport.
 */
import type { MissionDef } from '../../missions/types';
import { HELIS, MAPS, isHeliUnlocked, missionsCleared, loadProfile, saveProfile, type Profile, type CatalogItem } from '../profile';
import { isConfigured } from '../../leaderboard/client';
import { resetProgress } from '../../missions/progress';
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
let activeOverlay: { key: string; close: () => void } | null = null;

/** HomeScreen seeds the campaign catalog so the rail's Board tab can open the leaderboard. */
export function setMenuCatalog(catalog: MissionDef[]): void {
  menuCatalog = catalog;
}

/** Route a rail tap: close the current panel (if any), then open the target. `home` just falls back
 *  to the hub mounted underneath. Board/Shop are their own immersive screens (no rail of their own). */
export function navigateRail(key: string): void {
  if (activeOverlay && activeOverlay.key === key) return; // already on this panel
  const prev = activeOverlay;
  prev?.close();
  switch (key) {
    case 'home':
      return; // hub is underneath
    case 'maps':
      return openMaps();
    case 'hangar':
      return openHangar();
    case 'coop':
      return openCoop();
    case 'settings':
      return openSettings();
    case 'board':
      return openLeaderboard(menuCatalog);
    case 'shop':
      return openShop();
  }
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

// ============================ MAPS ============================
export function openMaps(): void {
  const pro = currentProfile();
  const slides = MAPS.map((m) => {
    const selected = m.id === pro.mapId && m.available;
    const cover = m.imageUrl
      ? `<img class="img" src="${m.imageUrl}" alt="">`
      : `<div class="fallback"><b>${m.name.slice(0, 2).toUpperCase()}</b></div>`;
    const badge = m.available
      ? `<span class="pill ${selected ? 'ok' : ''}">${selected ? 'Selected' : 'Live'}</span>`
      : `<span class="pill soon">Soon</span>`;
    const stats = m.stats
      ? `<div class="ctx-row" style="margin-top:11px;"><span class="ctx">${ic('map')}${m.stats.area}</span><span class="ctx">${ic('droplet')}${m.stats.lakes}</span></div>`
      : '';
    const cta = !m.available
      ? `<button class="btn ghost block is-disabled" style="margin-top:15px;">${ic('lock')}Coming soon</button>`
      : selected
        ? `<button class="btn ghost block is-disabled" style="margin-top:15px;">${ic('check')}Selected theatre</button>`
        : `<button class="btn primary block" style="margin-top:15px;" data-map="${m.id}">${ic('play')}Deploy here</button>`;
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
  const { root, close } = overlay('maps', 'Maps', 'Choose a theatre', carousel(slides, 'Theatre'));
  wireCarousel(root, initial);
  root.querySelectorAll<HTMLElement>('[data-map]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let the slide's re-centre handler swallow the pick
      saveProfile({ ...currentProfile(), mapId: b.dataset.map! });
      close();
    }),
  );
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
      <div class="heli-art"><span class="grid"></span><span class="ring"></span><span class="mark">${ic('heli')}</span></div>
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
    <div class="srow"><div class="ic">${ic('pin')}</div><div class="grow"><div class="t">Region</div><div class="s">Theatre</div></div><span class="pill">Saskatchewan</span></div>
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
