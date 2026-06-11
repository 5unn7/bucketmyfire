/**
 * The Campaign page controller (`/campaign/`) — SOLO flying. Built on the SAME glass-cockpit branding
 * as the home front door (src/hub.ts) and the Prepare page: the real in-game component vocabulary
 * (injectHomeStyles → `.card`/`.cut`, `.brand`/`.iconbtn`, `.sec`/`.tag`/`.line`, `.eyebrow`) inside the
 * shared front-door chrome (frontShell → the `.bmf-app.front` scroll shell + `.fhome-bar` appbar + the
 * ambient `.scene`/`.embers`), plus the shared poster-card vocabulary (shell → `.fd-mcard`/`.fd-mgrid`,
 * corner-cut to match the in-game mission cards). One visual language across all three front pages.
 *
 * Solo IS the campaign now (the linear mission set retired): a two-step picker (choose a MAP, then an
 * AIRCRAFT) that launches a private round on the open-world province —
 * `/?province=1&region=<map>&solo=1&heli=<heli>`, which the home origin boots end-to-end. Reuses the
 * REAL catalog data (MAPS + HELIS + the unlock gate from ui/profile). Pure data + DOM, no Three.
 */
import { injectFonts } from '../three/ui/fonts';
import { injectKitStyles } from '../three/ui/components/base';
import { injectHomeStyles } from '../three/ui/home/styles';
import { DEFS } from '../three/ui/home/icons';
import { injectShellStyles, applyMotionPref, buildFooter, tabbarMarkup, openNotify } from '../site/shell';
import { esc } from '../site/siteNav.mjs';
import { injectFrontShell, frontScene, frontAppbar, spawnFrontEmbers, wireFrontAppbar } from '../site/frontShell';
import { pickCard, wireFlyPicker, injectFlyPickerStyles } from '../site/flyPicker';
import { MAPS, HELIS, isHeliUnlocked, firstAvailable } from '../three/ui/profile';

applyMotionPref();
injectFonts();
injectKitStyles(); // theme.ts tokens at :root + the .btn/.badge of record
injectHomeStyles(); // the REAL component vocabulary (.card/.cut/.brand/.iconbtn/.sec/.tag/.line/.scene/.embers)
injectShellStyles(); // the shared footer, mobile tab bar, the corner-cut .fd-mcard/.fd-mgrid poster cards
injectFrontShell(); // the front-door chrome (.bmf-app.front scroll shell + .fhome-bar appbar)
injectFlyPickerStyles(); // the SHARED pick-poster carousel (.fly-strip/.fly-dots + image-forward .fd-m-* overrides)
injectCampaignStyles(); // this page's small content layout (hero + the two-step wizard chrome)

let mapId = firstAvailable(MAPS).id;

const game = document.getElementById('game');
if (game) {
  const app = document.createElement('div');
  app.className = 'bmf-app front';
  app.innerHTML = DEFS + campaignMarkup();
  game.innerHTML = '';
  game.appendChild(app);
  document.getElementById('fd-boot')?.remove();

  spawnFrontEmbers(app, 13); // the ambient ember field, same as the home + Prepare
  wireFrontAppbar(app); // trophy → leaderboard, gear → settings (same panels as the home)

  renderMaps(app);
}

function campaignMarkup(): string {
  return `
${frontScene()}
${frontAppbar('campaign')}
<div class="pad fhome">
  <header class="fcamp-hero fd-hero rise">
    <div class="fd-hero-main">
      <p class="fd-hero-eyebrow">Campaign · Solo</p>
      <h1 class="fd-hero-head">Fly solo.</h1>
      <p class="fd-hero-sub">Pick your ground and your aircraft, then fly a private round — just you, the fire, and the towns to hold.</p>
    </div>
  </header>

  <section class="fcamp-wizard" id="fd-wizard"></section>

  ${buildFooter()}
</div>
${tabbarMarkup('campaign')}`;
}

function renderMaps(app: HTMLElement): void {
  const wizard = app.querySelector<HTMLElement>('#fd-wizard');
  if (!wizard) return;
  const cards = MAPS.map((m) =>
    m.available
      ? pickCard(m, `<span class="badge fire">Fly here</span>`, { pick: m.id })
      : pickCard(m, `<span class="badge locked">Soon</span>`, { locked: true }),
  ).join('');
  wizard.innerHTML =
    `<div class="fcamp-whead"><h2>Choose your ground</h2></div>` +
    `<div class="fly-strip">${cards}</div>` +
    `<div class="fly-dots" aria-hidden="true"></div>`;
  wizard.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      mapId = b.dataset.pick || mapId;
      renderHelis(app);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
  );
  // Upcoming (locked) maps carry a "Notify me" CTA → the front-door capture modal (same shell as Contact).
  wizard.querySelectorAll<HTMLElement>('[data-notify-map]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openNotify(b.dataset.notifyMap!);
    }),
  );
  wireFlyPicker(wizard);
}

function renderHelis(app: HTMLElement): void {
  const wizard = app.querySelector<HTMLElement>('#fd-wizard');
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
    `<div class="fcamp-whead"><button class="fcamp-back" id="fd-back">← Maps</button>` +
    `<h2>Choose your aircraft</h2><span class="fcamp-step">${esc(mapName)}</span></div>` +
    `<div class="fly-strip">${cards}</div>` +
    `<div class="fly-dots" aria-hidden="true"></div>` +
    `<p class="fcamp-note">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`;
  wizard.querySelector('#fd-back')?.addEventListener('click', () => {
    renderMaps(app);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  wireFlyPicker(wizard);
}

/** This page's content layout only — the hero + the two-step wizard chrome (whead / step / back / note).
 *  The poster cards + their carousel come from the SHARED injectFlyPickerStyles() (`.fly-strip`/`.fly-dots`);
 *  the components + front-door chrome come from the injected stylesheets above. */
function injectCampaignStyles(): void {
  if (document.getElementById('fd-camp-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-camp-css';
  s.textContent = `
.bmf-app.front .fcamp-hero { padding: 2px 2px 0; }
.bmf-app.front .fcamp-wizard { display: flex; flex-direction: column; gap: 16px; }
.bmf-app.front .fcamp-whead { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; }
/* Caption-style step header (mirrors .fd-sec-tag): a compact mono kicker, not a display heading — so
   the pick cards ride higher up the screen and their full detail clears the fold without scrolling. */
.bmf-app.front .fcamp-whead h2 { font-family: var(--mono); font-size: var(--fs-sm); font-weight: var(--fw-bold);
  letter-spacing: .2em; text-transform: uppercase; color: var(--menu); }
.bmf-app.front .fcamp-step { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin-left: auto; }
.bmf-app.front .fcamp-back { appearance: none; background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; font: inherit;
  font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .06em; text-transform: uppercase; color: var(--ember-hi); min-height: 36px; display: inline-flex; align-items: center; }
.bmf-app.front .fcamp-back:hover { color: var(--menu); }
.bmf-app.front .fcamp-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`;
  document.head.appendChild(s);
}
