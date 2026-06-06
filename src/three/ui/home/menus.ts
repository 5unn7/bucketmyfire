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

// ============================ MAPS ============================
export function openMaps(): void {
  const pro = currentProfile();
  const cards = MAPS.map((m) => {
    const selected = m.id === pro.mapId && m.available;
    const cover = m.imageUrl
      ? `<img class="img" src="${m.imageUrl}" alt="">`
      : `<div class="fallback"><b>${m.name.slice(0, 2).toUpperCase()}</b></div>`;
    const badge = m.available
      ? `<span class="pill ${selected ? 'ok' : ''}">${selected ? 'Selected' : 'Live'}</span>`
      : `<span class="pill soon">Soon</span>`;
    const stats = m.stats
      ? `<div class="ctx-row" style="margin-top:10px;"><span class="ctx">${ic('map')}${m.stats.area}</span><span class="ctx">${ic('droplet')}${m.stats.lakes}</span></div>`
      : '';
    return `<article class="artcard" data-map="${m.available ? m.id : ''}" style="${m.available ? '' : 'filter:grayscale(.5) brightness(.7);'}">
      ${cover}<div class="scrim"></div><div class="brackets"><i></i><i></i><i></i></div>
      <div class="inner" style="min-height:190px;">
        <div class="row between"><span class="chip ghost">${m.tagline}</span>${badge}</div>
        <div class="grow"></div>
        <h2 class="h-big" style="font-size:var(--fs-display);">${m.name}</h2>
        ${stats}
      </div></article>`;
  }).join('<div style="height:12px"></div>');

  const { root, close } = overlay('maps', 'Maps', 'Choose a theatre', `<div style="margin-top:6px;">${cards}</div>`);
  root.querySelectorAll<HTMLElement>('[data-map]').forEach((el) => {
    const id = el.dataset.map;
    if (!id) return;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      saveProfile({ ...currentProfile(), mapId: id });
      close();
    });
  });
}

// ============================ HANGAR ============================
export function openHangar(): void {
  const cleared = missionsCleared();
  const body =
    `<div class="hscroll" style="margin-top:8px;" id="fleet">` +
    HELIS.map((h) => heliCard(h, cleared)).join('') +
    `</div><div class="dots" id="fleetDots">${HELIS.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>` +
    `<div class="card metal" style="margin-top:18px;"><div class="row" style="gap:12px;"><div class="glyph">${FLAME}</div>` +
    `<div class="grow"><div style="font-size:var(--fs-md);font-weight:var(--fw-semibold);">Earn your fleet</div>` +
    `<div class="muted" style="font-size:var(--fs-meta);margin-top:2px;">Bell 212 unlocks at 2 missions · UH-60 at 5. You've cleared ${cleared}.</div></div></div></div>`;

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
        foot.innerHTML = `<button class="btn primary block" data-pick="${id}">Select</button>`;
      }
    });
    root.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        saveProfile({ ...currentProfile(), heliId: b.dataset.pick! });
        refresh();
      }),
    );
  };
  refresh();

  const fleet = root.querySelector<HTMLElement>('#fleet');
  const dots = root.querySelector<HTMLElement>('#fleetDots');
  if (fleet && dots) {
    fleet.addEventListener(
      'scroll',
      () => {
        const i = Math.round(fleet.scrollLeft / (fleet.scrollWidth / HELIS.length));
        dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === Math.min(i, HELIS.length - 1)));
      },
      { passive: true },
    );
  }
}

function heliCard(h: CatalogItem, cleared: number): string {
  const unlocked = isHeliUnlocked(h, cleared);
  const specs = (h.specs ?? [])
    .map((s) => `<div class="spec"><span class="name">${s.label}</span><span class="track"><i style="width:${Math.round(s.value * 100)}%"></i></span></div>`)
    .join('');
  return `<article class="card warm cut" data-heli="${h.id}" style="width:clamp(264px,82vw,300px);${unlocked ? '' : 'filter:grayscale(.5) brightness(.74);'}">
    <div class="row between"><div><div style="font-size:var(--fs-lg);font-weight:var(--fw-heavy);">${h.name}</div>
    <div class="mono" style="font-size:var(--fs-tag);letter-spacing:.1em;color:var(--dim);margin-top:2px;text-transform:uppercase;">${h.tagline}</div></div>
    <div class="glyph">${ic('heli')}</div></div>
    <div style="margin-top:12px;">${specs}</div>
    <div class="heli-foot" style="margin-top:14px;"></div>
  </article>`;
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
