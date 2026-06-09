/**
 * The Campaign page controller (`/campaign/`) — SOLO flying. Solo is the campaign now (the linear
 * mission set retired): a two-step picker (choose a MAP, then an AIRCRAFT) that launches a private
 * round on the open-world province — `/?province=1&region=<map>&solo=1&heli=<heli>`, which the home
 * origin boots end-to-end. Reuses the REAL catalog data (MAPS + HELIS + the unlock gate from
 * ui/profile) and the shared poster-card vocabulary; pure data + DOM, no Three.
 */
import { injectFonts } from '../three/ui/fonts';
import { injectKitStyles } from '../three/ui/components/base';
import { injectShellStyles, hydrateChrome, applyMotionPref, buildAppbar, buildFooter, tabbarMarkup } from '../site/shell';
import { MAPS, HELIS, isHeliUnlocked, firstAvailable, type CatalogItem } from '../three/ui/profile';

applyMotionPref();
injectFonts();
injectKitStyles();
injectShellStyles();

const appbar = document.getElementById('fd-appbar');
if (appbar) appbar.outerHTML = buildAppbar('campaign');
const footer = document.getElementById('fd-footer');
if (footer) footer.outerHTML = buildFooter();
document.querySelector('.fd-app')?.insertAdjacentHTML('beforeend', tabbarMarkup('campaign'));
hydrateChrome({ active: 'campaign' });

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** A poster pick card (reuses the .fd-mcard mission-card look). `inner` carries the click target. */
function pickCard(item: CatalogItem, badge: string, opts: { locked?: boolean; href?: string; mapPick?: string }): string {
  const art = item.imageUrl
    ? `<div class="fd-m-art"><img src="${item.imageUrl}" alt="" loading="lazy" /></div>`
    : `<div class="fd-m-art proc" style="--px:60%;--py:20%"></div>`;
  const inner =
    art +
    `<span class="fd-m-scrim"></span>` +
    `<div class="fd-m-top"><span class="fd-m-no">${esc(item.tagline)}</span>${badge}</div>` +
    `<div class="fd-m-body"><div class="fd-m-name">${esc(item.name)}</div>` +
    `<div class="fd-m-tag">${esc(item.blurb)}</div></div>`;
  if (opts.locked) return `<div class="fd-mcard fd-card locked" aria-disabled="true">${inner}</div>`;
  if (opts.href) return `<a class="fd-mcard fd-card" href="${opts.href}" aria-label="Fly ${esc(item.name)}">${inner}</a>`;
  return `<button class="fd-mcard fd-card" data-map="${esc(opts.mapPick ?? '')}" aria-label="Choose ${esc(item.name)}">${inner}</button>`;
}

const wizard = document.getElementById('fd-wizard');
let mapId = firstAvailable(MAPS).id;

function renderMaps(): void {
  if (!wizard) return;
  const cards = MAPS.map((m) =>
    m.available
      ? pickCard(m, `<span class="badge fire">Fly here</span>`, { mapPick: m.id })
      : pickCard(m, `<span class="badge locked">Soon</span>`, { locked: true }),
  ).join('');
  wizard.innerHTML =
    `<div class="fd-wizard-head"><h2>Choose your ground</h2><span class="fd-step">Step 1 of 2</span></div>` +
    `<div class="fd-mgrid">${cards}</div>`;
  wizard.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) =>
    b.addEventListener('click', () => {
      mapId = b.dataset.map || mapId;
      renderHelis();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
  );
}

function renderHelis(): void {
  if (!wizard) return;
  const cleared = 0; // the linear campaign retired → unlocks come from points purchases only
  const cards = HELIS.map((h) => {
    const unlocked = isHeliUnlocked(h, cleared);
    const launch = `/?province=1&region=${encodeURIComponent(mapId)}&solo=1&heli=${encodeURIComponent(h.id)}`;
    return unlocked
      ? pickCard(h, `<span class="badge ok">Ready</span>`, { href: launch })
      : pickCard(h, `<span class="badge locked">Locked</span>`, { locked: true });
  }).join('');
  const mapName = MAPS.find((m) => m.id === mapId)?.name ?? '';
  wizard.innerHTML =
    `<div class="fd-wizard-head"><button class="fd-back" id="fd-back">← Maps</button>` +
    `<h2>Choose your aircraft</h2><span class="fd-step">${esc(mapName)} · Step 2 of 2</span></div>` +
    `<div class="fd-mgrid helis">${cards}</div>` +
    `<p class="fd-disclaimer" style="color:var(--faint);font-size:13px;margin-top:6px">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`;
  document.getElementById('fd-back')?.addEventListener('click', () => {
    renderMaps();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

renderMaps();
