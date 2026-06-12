/**
 * The Fireline STORY page controller (`/fireline/story/?ev=<id>`). One static page tells any
 * of the ten honoured moments in full — picked by the `?ev=` query against the shared record in
 * `events.ts` (the same module the timeline reads, so the two can never drift). Same glass-cockpit
 * chrome as the roll: real theme.ts tokens + the in-game component vocabulary inside the shared
 * front-door shell. Light — no Three, no game bundle. An unknown or missing `?ev=` goes home to the
 * timeline rather than rendering an empty shrine.
 */
import { injectFonts } from '../three/ui/fonts';
import { injectKitStyles } from '../three/ui/components/base';
import { injectHomeStyles } from '../three/ui/home/styles';
import { DEFS } from '../three/ui/home/icons';
import { injectShellStyles, applyMotionPref, buildFooter, tabbarMarkup } from '../site/shell';
import { injectFrontShell, frontScene, frontAppbar, spawnFrontEmbers, wireFrontAppbar } from '../site/frontShell';
import { breadcrumbHtml, esc } from '../site/siteNav.mjs';
import { EVENTS, eventById, type HofEvent } from './events';

const ev = eventById(new URLSearchParams(location.search).get('ev'));
if (!ev) {
  location.replace('/fireline/');
} else {
  applyMotionPref();
  injectFonts();
  injectKitStyles();
  injectHomeStyles();
  injectShellStyles();
  injectFrontShell();
  injectStoryStyles();
  mount(ev);
}

function mount(e: HofEvent): void {
  const game = document.getElementById('game');
  if (!game) return;
  document.title = `${e.year} — ${e.title} · The Fireline · Bucket My Fire`;
  const app = document.createElement('div');
  app.className = 'bmf-app front';
  app.innerHTML = DEFS + storyMarkup(e);
  game.innerHTML = '';
  game.appendChild(app);
  document.getElementById('fd-boot')?.remove();

  spawnFrontEmbers(app, 13);
  wireFrontAppbar(app);
}

/** Prev/next moments along the timeline (chronological neighbours of `e`). */
function neighbours(e: HofEvent): { prev?: HofEvent; next?: HofEvent } {
  const i = EVENTS.findIndex((x) => x.id === e.id);
  return { prev: EVENTS[i - 1], next: EVENTS[i + 1] };
}

function navCardHtml(target: HofEvent, dir: 'prev' | 'next'): string {
  const arrow = dir === 'prev' ? '←' : '→';
  const word = dir === 'prev' ? 'Earlier' : 'Next';
  return `
    <a class="hst-nav ${dir}" href="/fireline/story/?ev=${target.id}">
      <span class="hst-nav-k">${word} ${arrow}</span>
      <span class="hst-nav-y">${target.year}</span>
      <span class="hst-nav-t">${esc(target.title)}</span>
    </a>`;
}

function storyMarkup(e: HofEvent): string {
  const tone = e.tone ? ` ${e.tone}` : '';
  const { prev, next } = neighbours(e);
  const mid = Math.ceil(e.story.length / 2); // the pull keyline splits the story near its middle
  const paras = (ps: string[]): string => ps.map((p) => `<p class="hst-p">${esc(p)}</p>`).join('');
  return `
${frontScene()}
${frontAppbar('halloffame')}
<div class="pad fhome">
  ${breadcrumbHtml([{ label: 'Home', href: '/' }, { label: 'Fireline', href: '/fireline/' }, { label: e.year }])}

  <section class="card cut rise fd-glass hst-hero"><span class="fd-glasstex" aria-hidden="true"></span>
    <div class="fd-hero">
      <div class="fd-hero-main">
        <p class="fd-hero-eyebrow">The Fireline · The full story</p>
        <p class="hst-year">${e.year}</p>
        <h1 class="fd-hero-head hst-head">${esc(e.title)}</h1>
        <p class="hst-dateline">${esc(e.dateline)}</p>
        <p class="fd-hero-sub hst-lede">${esc(e.lede)}</p>
        <div class="hst-badges"><span class="badge${tone}">${e.stat}</span></div>
      </div>
    </div>
  </section>

  ${e.art ? `<figure class="card cut hst-art"><img src="${e.art}" alt="${esc(e.title)}" loading="lazy" /></figure>` : ''}

  <section class="card cut hst-story">
    <div class="sec"><span class="tag">The story</span><span class="line"></span></div>
    ${paras(e.story.slice(0, mid))}
    <p class="hst-pull">${esc(e.pull)}</p>
    ${paras(e.story.slice(mid))}
  </section>

  <section class="card warm cut hst-legacy">
    <div class="sec"><span class="tag">What it left behind</span><span class="line"></span></div>
    <p class="hst-legacy-p">${esc(e.legacy)}</p>
    <div class="hst-facts">
      ${e.facts.map((f) => `<div class="hst-fact"><b>${esc(f.value)}</b><span>${esc(f.label)}</span></div>`).join('')}
    </div>
  </section>

  <nav class="hst-navrow" aria-label="More moments">
    ${prev ? navCardHtml(prev, 'prev') : '<span class="hst-nav ghost" aria-hidden="true"></span>'}
    ${next ? navCardHtml(next, 'next') : '<span class="hst-nav ghost" aria-hidden="true"></span>'}
  </nav>

  <p class="hof-sources">Drawn from the public record:
    <a href="https://natural-resources.canada.ca/" target="_blank" rel="noopener">Natural Resources Canada</a>,
    <a href="https://ciffc.ca/" target="_blank" rel="noopener">CIFFC</a>,
    <a href="https://parks.canada.ca/" target="_blank" rel="noopener">Parks Canada</a>,
    <a href="https://www2.gov.bc.ca/" target="_blank" rel="noopener">the Government of B.C.</a>,
    <a href="https://www.publicsafety.gc.ca/" target="_blank" rel="noopener">Public Safety Canada</a> and
    <a href="https://www.cbc.ca/" target="_blank" rel="noopener">CBC News</a> archives.
    Figures stay conservative where sources vary; nothing here is invented.</p>

  ${buildFooter()}
</div>
${tabbarMarkup('halloffame')}`;
}

// ── Page-ONLY story LAYOUT (chrome comes from injectFrontShell; components from injectHomeStyles).
//    Reading page: a measured prose column, an ember pull-line, instrument fact chips, prev/next. ──

function injectStoryStyles(): void {
  if (document.getElementById('fd-hofstory-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-hofstory-css';
  s.textContent = `
/* Hero — year as a big cockpit numeral over the title; dateline in instrument mono. */
.bmf-app.front .hst-hero { margin-top: 6px; }
.bmf-app.front .hst-year { margin: 6px 0 0; font-family: var(--mono); font-weight: var(--fw-black);
  font-size: var(--fs-hero); line-height: 1; color: var(--ember-hi); letter-spacing: .02em; }
.bmf-app.front .hst-head { margin-top: 6px; }
.bmf-app.front .hst-dateline { margin: 8px 0 0; font-family: var(--mono); font-size: var(--fs-micro);
  letter-spacing: .14em; text-transform: uppercase; color: var(--menu); }
.bmf-app.front .hst-lede { margin-top: 10px; }
.bmf-app.front .hst-badges { margin-top: 12px; }

/* Optional hero art — an ultrawide strip in its own card frame (kept short on every viewport). */
.bmf-app.front .hst-art { padding: 0; overflow: hidden; margin: 0; }
.bmf-app.front .hst-art img { display: block; width: 100%; aspect-ratio: 21 / 9; object-fit: cover; }

/* The story — a real reading column. The pull keyline sits on an ember spine mid-story. */
.bmf-app.front .hst-story .hst-p { margin: 12px 0 0; font-size: var(--fs-md); line-height: 1.72;
  color: var(--text-subtle); max-width: 66ch; }
.bmf-app.front .hst-story .hst-p:first-of-type { color: var(--text); }
.bmf-app.front .hst-pull { margin: 18px 0 6px; padding: 4px 0 4px 16px; border-left: 2px solid var(--ember-hi);
  font-size: var(--fs-lg); font-weight: var(--fw-bold); line-height: 1.4; color: #fff; max-width: 30ch;
  text-wrap: balance; }

/* Legacy — warm register close + three instrument chips. */
.bmf-app.front .hst-legacy-p { margin: 2px 0 0; font-size: var(--fs-md); line-height: 1.6; color: var(--text); max-width: 60ch; }
.bmf-app.front .hst-facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
.bmf-app.front .hst-fact { background: var(--bezel); border: 1px solid var(--hair); border-radius: var(--r-sm);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.bmf-app.front .hst-fact b { font-family: var(--mono); font-weight: var(--fw-black); font-size: var(--fs-title);
  color: var(--ember-hi); line-height: 1.05; }
.bmf-app.front .hst-fact span { font-size: var(--fs-micro); line-height: 1.35; color: var(--dim); }

/* Prev / next — two quiet instrument cards continuing the journey. */
.bmf-app.front .hst-navrow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bmf-app.front .hst-nav { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; text-decoration: none;
  background: var(--bezel); border: 1px solid var(--hair); border-radius: var(--r-md); transition: border-color .2s ease; }
.bmf-app.front .hst-nav:hover { border-color: var(--warm-stroke); }
.bmf-app.front .hst-nav.next { text-align: right; align-items: flex-end; }
.bmf-app.front .hst-nav.ghost { visibility: hidden; }
.bmf-app.front .hst-nav-k { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .12em;
  text-transform: uppercase; color: var(--menu); }
.bmf-app.front .hst-nav-y { font-family: var(--mono); font-weight: var(--fw-black); font-size: var(--fs-lg); color: var(--ember-hi); }
.bmf-app.front .hst-nav-t { font-size: var(--fs-sm); color: var(--text-subtle); line-height: 1.3; }

/* Sources small print (same voice as the roll). */
.bmf-app.front .hof-sources { margin: 2px 0 0; font-family: var(--mono); font-size: var(--fs-micro);
  letter-spacing: .03em; line-height: 1.7; color: var(--faint); max-width: 72ch; }
.bmf-app.front .hof-sources a { color: var(--dim); text-decoration: none; }
.bmf-app.front .hof-sources a:hover { color: var(--ember-hi); }

/* Desktop — wider prose measure, roomier cards (END of sheet: media queries add no specificity). */
@media (min-width: 880px) {
  .bmf-app.front .hst-art img { aspect-ratio: 3.4 / 1; }
  .bmf-app.front .hst-story { padding: 26px 30px 28px; }
  .bmf-app.front .hst-story .hst-p { font-size: var(--fs-lg); }
  .bmf-app.front .hst-pull { font-size: var(--fs-xl); }
  .bmf-app.front .hst-legacy { padding: 24px 26px; }
}
@media (max-width: 560px) {
  .bmf-app.front .hst-facts { grid-template-columns: 1fr; }
}
`;
  document.head.appendChild(s);
}
