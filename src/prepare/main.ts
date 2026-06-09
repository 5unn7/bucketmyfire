/**
 * The Prepare page controller (`/prepare/`). Built on the SAME glass-cockpit branding as the home
 * front door (src/hub.ts): the real in-game component vocabulary (injectHomeStyles → `.card`/`.cut`,
 * `.scene`/`.embers`, `.sec`/`.tag`/`.line`, `.h-big`, `.eyebrow`) inside the shared front-door chrome
 * (frontShell → the `.bmf-app.front` scroll shell + `.fhome-bar` appbar + ambient embers). The page is
 * a thin shell in prepare/index.html; this controller builds it. Light — no Three, no game bundle.
 *
 * Content: a warm hero, the interactive 15-minute readiness checklist (mountChecklist), and Field
 * Notes — our own articles, as mission-style poster cards (mountBlogCarousel into a `.fd-mgrid`).
 */
import { injectFonts } from '../three/ui/fonts';
import { injectKitStyles } from '../three/ui/components/base';
import { injectHomeStyles } from '../three/ui/home/styles';
import { DEFS } from '../three/ui/home/icons';
import { injectShellStyles, applyMotionPref, buildFooter, tabbarMarkup } from '../site/shell';
import { injectFrontShell, frontScene, frontAppbar, spawnFrontEmbers, wireFrontAppbar } from '../site/frontShell';
import { mountChecklist } from '../site/checklist';
import { mountBlogCarousel } from '../site/blogCarousel';

applyMotionPref();
injectFonts();
injectKitStyles(); // theme.ts tokens at :root + the .btn/.badge of record
injectHomeStyles(); // the REAL component vocabulary (.card/.cut/.scene/.embers/.sec/.h-big/.eyebrow)
injectShellStyles(); // the shared footer, mobile tab bar, the .fd-mcard/.fd-mgrid notes cards + the checklist styles
injectFrontShell(); // the front-door chrome (.bmf-app.front scroll shell + .fhome-bar appbar)
injectPrepStyles(); // this page's small content layout (hero + checklist card + notes section)

const game = document.getElementById('game');
if (game) {
  const app = document.createElement('div');
  app.className = 'bmf-app front';
  app.innerHTML = DEFS + prepareMarkup();
  game.innerHTML = '';
  game.appendChild(app);
  document.getElementById('fd-boot')?.remove();

  spawnFrontEmbers(app, 13); // the ambient ember field, same as the home
  wireFrontAppbar(app); // trophy → leaderboard, gear → settings (same panels as the home)

  const checklist = app.querySelector<HTMLElement>('#fd-checklist');
  if (checklist) mountChecklist(checklist);
  const rail = app.querySelector<HTMLElement>('#fd-prep-rail');
  if (rail) void mountBlogCarousel(rail);
}

function prepareMarkup(): string {
  return `
${frontScene()}
${frontAppbar('prepare')}
<div class="pad fhome">
  <section class="card warm cut fprep-hero rise">
    <p class="fhome-eyebrow">Prepare</p>
    <h1 class="fprep-head">Get wildfire ready.</h1>
    <p class="fprep-sub">Wildfire is part of life in fire country. Here is how to be ready before it reaches you.</p>
  </section>

  <section class="card metal fprep-check" id="checklist"><div id="fd-checklist"></div></section>

  <section class="fprep-notes">
    <div class="sec"><span class="tag">Field Notes</span><span class="line"></span></div>
    <p class="fprep-lead">What we have learned about wildfire, written plainly. Our own research and time in the air.</p>
    <div class="fd-mgrid" id="fd-prep-rail"></div>
  </section>

  ${buildFooter()}
</div>
${tabbarMarkup('prepare')}`;
}

/** This page's content layout only (the components + chrome come from the injected stylesheets above). */
function injectPrepStyles(): void {
  if (document.getElementById('fd-prep-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-prep-css';
  s.textContent = `
.bmf-app.front .fprep-hero { min-height: 180px; display: flex; flex-direction: column; padding: 22px; }
.bmf-app.front .fprep-head { font-size: clamp(26px, 4vw, 42px); line-height: 1.04; color: #fff; max-width: 18ch; text-wrap: balance; }
.bmf-app.front .fprep-sub { margin-top: 13px; font-size: clamp(14px, 1.6vw, 16px); line-height: 1.5; color: var(--text-subtle); max-width: 52ch; }
.bmf-app.front .fprep-check { padding: 16px 17px; }
.bmf-app.front .fprep-notes { display: flex; flex-direction: column; }
.bmf-app.front .fprep-notes .sec { margin-top: 6px; }
.bmf-app.front .fprep-lead { margin: 0 0 13px; font-size: clamp(13px, 1.5vw, 15px); line-height: 1.5; color: var(--text-subtle); max-width: 58ch; }
`;
  document.head.appendChild(s);
}
