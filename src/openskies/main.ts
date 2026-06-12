/**
 * The Open Skies page controller (`/open-skies/`) — the SHARED live shift. Built on the SAME glass-cockpit
 * branding as the home front door (src/hub.ts), Campaign, and Prepare: the real in-game component
 * vocabulary (injectHomeStyles → `.card`/`.cut`, `.sec`/`.tag`/`.line`, `.badge`) inside the shared
 * front-door chrome (frontShell → the `.bmf-app.front` scroll shell + `.fhome-bar` appbar + the ambient
 * `.scene`/`.embers`), plus the SHARED pick-poster carousel (site/flyPicker → `.fly-strip` + `.fd-mcard`).
 * One visual language across all four front pages — no in-game overlay bolted under site chrome.
 *
 * Open Skies is the sibling of Campaign/Solo: where Solo picks a MAP then an aircraft and flies a PRIVATE
 * round, Open Skies is the SHARED province everyone flies — so it's a ONE-step aircraft picker that
 * launches the shared shift: `/?province=1&heli=<heli>` (no region = the canonical map, no solo flag =
 * the shared board + ghost pilots), which the home origin boots end-to-end. Pure data + DOM, no Three.
 */
import { injectFonts } from '../three/ui/fonts';
import { injectKitStyles } from '../three/ui/components/base';
import { injectHomeStyles } from '../three/ui/home/styles';
import { DEFS, ic } from '../three/ui/home/icons';
import { injectShellStyles, applyMotionPref, buildFooter } from '../site/shell';
import { injectFrontShell, frontScene, frontAppbar, spawnFrontEmbers, wireFrontAppbar } from '../site/frontShell';
import { tabbarHtml } from '../site/siteNav.mjs';
import { pickCard, wireFlyPicker, injectFlyPickerStyles } from '../site/flyPicker';
import { HELIS, isHeliUnlocked, availablePoints, buyHeli } from '../three/ui/profile';

applyMotionPref();
injectFonts();
injectKitStyles(); // theme.ts tokens at :root + the .btn/.badge of record
injectHomeStyles(); // the REAL component vocabulary (.card/.cut/.sec/.tag/.line/.badge/.scene/.embers)
injectShellStyles(); // the shared footer, mobile tab bar, the corner-cut .fd-mcard poster cards
injectFrontShell(); // the front-door chrome (.bmf-app.front scroll shell + .fhome-bar appbar)
injectFlyPickerStyles(); // the SHARED pick-poster carousel (.fly-strip/.fly-dots + image-forward .fd-m-* overrides)
injectOpenSkiesStyles(); // this page's small content layout (hero + the one-step picker chrome)

const game = document.getElementById('game');
if (game) {
  const app = document.createElement('div');
  app.className = 'bmf-app front';
  app.innerHTML = DEFS + openSkiesMarkup();
  game.innerHTML = '';
  game.appendChild(app);
  document.getElementById('fd-boot')?.remove();

  spawnFrontEmbers(app, 13); // the ambient ember field, same as the home + Campaign + Prepare
  wireFrontAppbar(app); // trophy → leaderboard, gear → settings (same panels as the home)

  renderHelis(app);
}

function openSkiesMarkup(): string {
  return `
${frontScene()}
${frontAppbar('open-skies')}
<div class="pad fhome">
  <header class="osk-hero fd-hero rise">
    <div class="fd-hero-main">
      <p class="fd-hero-eyebrow">Open Skies · Live</p>
      <h1 class="fd-hero-head">Everyone flies the same fire.</h1>
      <p class="fd-hero-sub">One live province, every pilot in it. Dispatch calls as fires break out. Get to each one before it reaches the towns.</p>
    </div>
    <div class="fd-hero-trail"><span class="badge ok">Live</span></div>
  </header>

  <section class="osk-pick" id="fd-picker"></section>

  ${buildFooter()}
</div>
${tabbarHtml('open-skies')}`;
}

function renderHelis(app: HTMLElement): void {
  const host = app.querySelector<HTMLElement>('#fd-picker');
  if (!host) return;
  // Gate on the REAL progress defaults (not a hard-coded 0) so the display agrees with buyHeli: a
  // pilot whose legacy campaign clears already earned an airframe sees it Ready, never a dead buy.
  const wallet = availablePoints(); // pre-read once for the whole grid + the balance chip
  const cards = HELIS.map((h) => {
    const unlocked = isHeliUnlocked(h);
    // Shared launch: no region (the canonical province for everyone) and no solo flag (shared board + ghosts).
    const launch = `/?province=1&heli=${encodeURIComponent(h.id)}`;
    return unlocked
      ? pickCard(h, `<span class="badge ok">Ready</span>`, { href: launch })
      : pickCard(h, `<span class="badge locked">Locked</span>`, { locked: true, wallet });
  }).join('');
  host.innerHTML =
    `<div class="sec"><span class="tag">Your aircraft</span><span class="line"></span>` +
    `<span class="pts-bal">${ic('spark')}<b>${wallet.toLocaleString()}</b><span>pts</span></span></div>` +
    `<div class="fly-strip">${cards}</div>` +
    `<div class="fly-dots" aria-hidden="true"></div>` +
    `<p class="osk-note">Locked aircraft unlock with career points earned in Open Skies and solo flights — earn enough and unlock them right here.</p>`;
  // Live unlock: spend the wallet right here (buyHeli enforces the whole gate — a blocked buy is a
  // no-op), then re-render so the card flips to Ready and the balance chip drains.
  host.querySelectorAll<HTMLButtonElement>('[data-buy-heli]').forEach((b) =>
    b.addEventListener('click', () => {
      const h = HELIS.find((x) => x.id === b.dataset.buyHeli);
      if (h && buyHeli(h).ok) renderHelis(app);
    }),
  );
  wireFlyPicker(host);
}

/** This page's content layout only — the hero + the one-step picker chrome. The poster cards + their
 *  carousel come from the SHARED injectFlyPickerStyles() (`.fly-strip`/`.fly-dots`); the components +
 *  front-door chrome come from the injected stylesheets above. */
function injectOpenSkiesStyles(): void {
  if (document.getElementById('fd-osk-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-osk-css';
  s.textContent = `
.bmf-app.front .osk-hero { padding: 2px 2px 0; }
.bmf-app.front .osk-hero .fd-hero-trail { align-self: flex-start; }
.bmf-app.front .osk-pick { display: flex; flex-direction: column; gap: 14px; }
.bmf-app.front .osk-pick .sec { margin: 0; }
.bmf-app.front .osk-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`;
  document.head.appendChild(s);
}
