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
    <div class="fd-hero">
      <div class="fd-hero-main">
        <p class="fd-hero-eyebrow">Campaign · Solo</p>
        <h1 class="fd-hero-head">Fly solo.</h1>
        <p class="fd-hero-sub">Pick your ground and your aircraft, then fly a private round — just you, the fire, and the towns to hold.</p>
      </div>
    </div>
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
    `<div class="fcamp-cards">${cards}</div>` +
    `<div class="fcamp-dots" aria-hidden="true"></div>`;
  wizard.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) =>
    b.addEventListener('click', () => {
      mapId = b.dataset.map || mapId;
      renderHelis(app);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }),
  );
  wirePicker(wizard);
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
    `<div class="fcamp-cards">${cards}</div>` +
    `<div class="fcamp-dots" aria-hidden="true"></div>` +
    `<p class="fcamp-note">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`;
  wizard.querySelector('#fd-back')?.addEventListener('click', () => {
    renderMaps(app);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  wirePicker(wizard);
}

/** Wire the mobile picker carousel: build position dots, sync the active dot as the strip scrolls, and
 *  let a dot tap centre its card. No-op past the ≥600px breakpoint (the strip relaxes into a grid + the
 *  dots hide) and a no-op with a lone card. Re-run after each wizard render — the old element + its
 *  listeners are dropped with `wizard.innerHTML`, so nothing leaks across step changes. */
function wirePicker(wizard: HTMLElement): void {
  const track = wizard.querySelector<HTMLElement>('.fcamp-cards');
  const dotsHost = wizard.querySelector<HTMLElement>('.fcamp-dots');
  if (!track || !dotsHost) return;
  const cards = Array.from(track.querySelectorAll<HTMLElement>('.fd-mcard'));
  if (cards.length < 2) return; // a single pick needs no carousel chrome
  dotsHost.innerHTML = cards.map((_, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('');
  const dots = Array.from(dotsHost.children) as HTMLElement[];
  const setActive = (i: number): void => dots.forEach((d, k) => d.classList.toggle('on', k === i));
  // Active = the card whose centre is nearest the strip's centre (works for the start-snapped layout).
  const nearest = (): number => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bd = Infinity;
    cards.forEach((c, k) => {
      const d = Math.abs(c.offsetLeft + c.clientWidth / 2 - mid);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  };
  let raf = 0;
  track.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setActive(nearest()); });
    },
    { passive: true },
  );
  dots.forEach((d, i) =>
    d.addEventListener('click', () => {
      const c = cards[i];
      track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.clientWidth) / 2, behavior: 'smooth' });
    }),
  );
}

/** This page's content layout only (the components + chrome come from the injected stylesheets above). */
function injectCampaignStyles(): void {
  if (document.getElementById('fd-camp-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-camp-css';
  s.textContent = `
.bmf-app.front .fcamp-hero { padding: 22px 22px 24px; }
.bmf-app.front .fcamp-wizard { display: flex; flex-direction: column; gap: 16px; }
.bmf-app.front .fcamp-whead { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bmf-app.front .fcamp-whead h2 { font-size: clamp(20px, 2.4vw, 25px); color: #fff; }
.bmf-app.front .fcamp-step { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin-left: auto; }
.bmf-app.front .fcamp-back { appearance: none; background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; font: inherit;
  font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .06em; text-transform: uppercase; color: var(--ember-hi); min-height: 36px; display: inline-flex; align-items: center; }
.bmf-app.front .fcamp-back:hover { color: var(--menu); }
.bmf-app.front .fcamp-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }

/* Bigger, image-forward picker posters in a swipeable carousel — ONE horizontal row at every width, no
   wrap. On a PHONE one tall poster sits in view with a peek of the next (swipe to advance). On a wider
   screen the posters fix to a comfortable width so several ride the same line and the row scrolls past
   the edge when they don't all fit (4 maps stay one strip instead of breaking to a 3+1 grid). Position
   dots track the strip the whole way. */
.bmf-app.front .fcamp-cards { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 2px; }
.bmf-app.front .fcamp-cards::-webkit-scrollbar { display: none; }
.bmf-app.front .fcamp-cards > .fd-mcard { flex: 0 0 86%; max-width: 400px; scroll-snap-align: start; }
.bmf-app.front .fcamp-dots { display: flex; justify-content: center; gap: 6px; margin-top: 14px; }
.bmf-app.front .fcamp-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--track);
  transition: width .2s, background .2s; cursor: pointer; }
.bmf-app.front .fcamp-dots i.on { width: 18px; border-radius: var(--r-pill); background: var(--ember-hi); }
/* Tablet+ : fixed-width posters so the strip stays ONE line and overflows horizontally rather than wrapping. */
@media (min-width: 600px) {
  .bmf-app.front .fcamp-cards > .fd-mcard { flex: 0 0 300px; max-width: none; }
}
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
