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
import { injectShellStyles, applyMotionPref, buildFooter, tabbarMarkup } from '../site/shell';
import { injectFrontShell, frontScene, frontAppbar, spawnFrontEmbers, wireFrontAppbar } from '../site/frontShell';
import { MAPS, HELIS, isHeliUnlocked, firstAvailable, type CatalogItem } from '../three/ui/profile';

applyMotionPref();
injectFonts();
injectKitStyles(); // theme.ts tokens at :root + the .btn/.badge of record
injectHomeStyles(); // the REAL component vocabulary (.card/.cut/.brand/.iconbtn/.sec/.tag/.line/.scene/.embers)
injectShellStyles(); // the shared footer, mobile tab bar, the corner-cut .fd-mcard/.fd-mgrid poster cards
injectFrontShell(); // the front-door chrome (.bmf-app.front scroll shell + .fhome-bar appbar)
injectCampaignStyles(); // this page's small content layout (hero + the two-step wizard chrome)

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

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
  <section class="card warm cut fcamp-hero rise">
    <p class="fhome-eyebrow">Campaign · Solo</p>
    <h1 class="fcamp-head">Fly solo.</h1>
    <p class="fcamp-sub">Pick your ground and your aircraft, then fly a private round — just you, the fire, and the towns to hold.</p>
  </section>

  <section class="fcamp-wizard" id="fd-wizard"></section>

  ${buildFooter()}
</div>
${tabbarMarkup('campaign')}`;
}

/** A poster pick card — the corner-cut in-game mission card (`.fd-mcard`), reframed for the picker as an
 *  IMAGE-FORWARD poster: the art is the hero, the copy is a tight tagline kicker + the name + a glanceable
 *  meta strip (an aircraft's spec meters, or a map's scale) — no paragraph of body text. `badge` is the
 *  status pill; `locked` dims it; a `href` flies the round, a `mapPick` advances the wizard. */
function pickCard(item: CatalogItem, badge: string, opts: { locked?: boolean; href?: string; mapPick?: string }): string {
  const art = item.imageUrl
    ? `<div class="fd-m-art"><img src="${item.imageUrl}" alt="" loading="lazy" /></div>`
    : `<div class="fd-m-art proc"></div>`;
  // Helis carry spec meters (visual, decision-relevant); maps carry a two-fact scale line. Either one
  // replaces the old blurb paragraph that buried the art.
  const meta = item.specs
    ? `<div class="fd-m-specs">${item.specs
        .map((s) => `<div class="fd-spec"><span>${esc(s.label)}</span><i class="trk"><b style="--v:${s.value}"></b></i></div>`)
        .join('')}</div>`
    : item.stats
      ? `<div class="fd-m-meta"><span>${esc(item.stats.area)}</span><span>${esc(item.stats.lakes)}</span></div>`
      : '';
  const cta = opts.locked ? '' : `<span class="fd-m-go">${opts.href ? 'Fly' : 'Choose'} →</span>`;
  const inner =
    art +
    `<span class="fd-m-scrim"></span>` +
    `<div class="fd-m-top">${badge}</div>` +
    `<div class="fd-m-body">` +
    `<p class="fd-m-kicker">${esc(item.tagline)}</p>` +
    `<div class="fd-m-name">${esc(item.name)}</div>` +
    meta +
    cta +
    `</div>`;
  if (opts.locked) return `<div class="fd-mcard fd-card locked" aria-disabled="true">${inner}</div>`;
  if (opts.href) return `<a class="fd-mcard fd-card" href="${opts.href}" aria-label="Fly ${esc(item.name)}">${inner}</a>`;
  return `<button class="fd-mcard fd-card" data-map="${esc(opts.mapPick ?? '')}" aria-label="Choose ${esc(item.name)}">${inner}</button>`;
}

function renderMaps(app: HTMLElement): void {
  const wizard = app.querySelector<HTMLElement>('#fd-wizard');
  if (!wizard) return;
  const cards = MAPS.map((m) =>
    m.available
      ? pickCard(m, `<span class="badge fire">Fly here</span>`, { mapPick: m.id })
      : pickCard(m, `<span class="badge locked">Soon</span>`, { locked: true }),
  ).join('');
  wizard.innerHTML =
    `<div class="fcamp-whead"><h2>Choose your ground</h2><span class="fcamp-step">Step 1 of 2</span></div>` +
    `<div class="fd-mgrid">${cards}</div>`;
  wizard.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) =>
    b.addEventListener('click', () => {
      mapId = b.dataset.map || mapId;
      renderHelis(app);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
  );
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
    `<h2>Choose your aircraft</h2><span class="fcamp-step">${esc(mapName)} · Step 2 of 2</span></div>` +
    `<div class="fd-mgrid">${cards}</div>` +
    `<p class="fcamp-note">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`;
  wizard.querySelector('#fd-back')?.addEventListener('click', () => {
    renderMaps(app);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/** This page's content layout only (the components + chrome come from the injected stylesheets above). */
function injectCampaignStyles(): void {
  if (document.getElementById('fd-camp-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-camp-css';
  s.textContent = `
.bmf-app.front .fcamp-hero { display: flex; flex-direction: column; padding: 22px 22px 24px; }
.bmf-app.front .fcamp-head { font-size: clamp(28px, 4.6vw, 46px); line-height: 1.02; color: #fff; max-width: 14ch; text-wrap: balance; }
.bmf-app.front .fcamp-sub { margin-top: 11px; font-size: clamp(14px, 1.6vw, 16.5px); line-height: 1.5; color: var(--text-subtle); max-width: 58ch; text-wrap: pretty; }
.bmf-app.front .fcamp-wizard { display: flex; flex-direction: column; gap: 16px; }
.bmf-app.front .fcamp-whead { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bmf-app.front .fcamp-whead h2 { font-size: clamp(20px, 2.4vw, 25px); color: #fff; }
.bmf-app.front .fcamp-step { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin-left: auto; }
.bmf-app.front .fcamp-back { appearance: none; background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; font: inherit;
  font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .06em; text-transform: uppercase; color: var(--ember-hi); min-height: 36px; display: inline-flex; align-items: center; }
.bmf-app.front .fcamp-back:hover { color: var(--menu); }
.bmf-app.front .fcamp-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }

/* Bigger, image-forward picker posters. Scoped override of the shared 4-up .fd-mgrid (the Prepare +
   blog cards keep it): fewer, TALLER cards so the art reads and the copy can breathe — 1-up on a phone,
   2-up on a tablet, 3-up on a desktop (the three aircraft sit one clean row across). */
.bmf-app.front .fcamp-wizard .fd-mgrid { grid-template-columns: 1fr; gap: 14px; }
@media (min-width: 600px) { .bmf-app.front .fcamp-wizard .fd-mgrid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1000px) { .bmf-app.front .fcamp-wizard .fd-mgrid { grid-template-columns: repeat(3, 1fr); } }
.bmf-app.front .fcamp-wizard .fd-mcard { min-height: 300px; }
@media (min-width: 600px) { .bmf-app.front .fcamp-wizard .fd-mcard { min-height: 326px; } }
/* The available map pick is a <button>; null its UA chrome so the copy left/bottom-aligns in the app
   font, exactly like the locked <div> maps and the <a> aircraft cards (a bare button defaults to
   text-align:center + Arial). */
.bmf-app.front .fcamp-wizard button.fd-mcard { appearance: none; -webkit-appearance: none; text-align: left; font: inherit; color: var(--text); cursor: pointer; }
.bmf-app.front .fcamp-wizard .fd-mcard .fd-m-top { justify-content: flex-end; }
.bmf-app.front .fcamp-wizard .fd-mcard .fd-m-body { padding: 16px 16px 17px; }
.bmf-app.front .fcamp-wizard .fd-m-kicker { margin: 0 0 5px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--menu); }
.bmf-app.front .fcamp-wizard .fd-m-name { font-size: clamp(20px, 2.2vw, 25px); line-height: 1.05; }
.bmf-app.front .fcamp-wizard .fd-m-meta { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 9px; }
.bmf-app.front .fcamp-wizard .fd-m-meta span { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .02em; color: var(--text-subtle); }
.bmf-app.front .fcamp-wizard .fd-m-specs { display: grid; gap: 6px; margin-top: 11px; max-width: 232px; }
.bmf-app.front .fcamp-wizard .fd-spec { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 9px; }
.bmf-app.front .fcamp-wizard .fd-spec > span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .07em; text-transform: uppercase; color: var(--dim); }
.bmf-app.front .fcamp-wizard .fd-spec .trk { height: 4px; border-radius: 99px; background: var(--recess); overflow: hidden; }
.bmf-app.front .fcamp-wizard .fd-spec .trk b { display: block; height: 100%; width: calc(var(--v, 0) * 100%); border-radius: 99px; background: linear-gradient(90deg, var(--ember), var(--ember-hi)); }
`;
  document.head.appendChild(s);
}
