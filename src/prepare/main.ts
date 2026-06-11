/**
 * The Prepare page controller (`/prepare/`). Built on the SAME glass-cockpit branding as the home
 * front door (src/hub.ts): the real in-game component vocabulary (injectHomeStyles → the `.card`/`.cut`/
 * `.warm` brand cards, `.scene`/`.embers`, `.sec`/`.tag`/`.line`, the `.daily` collapsible) inside the
 * shared front-door chrome (frontShell → the `.bmf-app.front` scroll shell + `.fhome-bar` appbar). No
 * bespoke layout: every surface is an existing brand cut-corner card. Light — no Three, no game bundle.
 *
 * Cards (all `.card cut`): the TOP card is the collapsible "15 mins to fire ready" readiness checklist
 * (mountChecklist, reusing the `.daily` collapsible); below it, Field Notes — our own articles, as
 * mission-style poster cards (mountBlogCarousel into a `.fd-mgrid`).
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
injectHomeStyles(); // the REAL component vocabulary (.card/.cut/.warm/.scene/.embers/.sec/.daily/.h-screen)
injectShellStyles(); // the shared footer, mobile tab bar, the .fd-mcard/.fd-mgrid notes cards + the checklist widgets
injectFrontShell(); // the front-door chrome (.bmf-app.front scroll shell + .fhome-bar appbar)

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

  const checklist = app.querySelector<HTMLElement>('#checklist');
  if (checklist) mountChecklist(checklist);
  const rail = app.querySelector<HTMLElement>('#fd-prep-rail');
  if (rail) void mountBlogCarousel(rail);
}

function prepareMarkup(): string {
  return `
${frontScene()}
${frontAppbar('prepare')}
<div class="pad fhome">
  <section class="card green cut rise" id="checklist"></section>

  <section class="card cut">
    <div class="sec"><span class="tag">Field Notes</span><span class="line"></span></div>
    <div class="mono" style="font-size:var(--fs-meta);color:var(--dim);margin:0 2px 13px">Our own research, written plainly — the home of Field Notes.</div>
    <div class="fd-mgrid" id="fd-prep-rail"></div>
    <a class="btn ghost sm" href="/blog/" style="margin-top:14px">Browse all Field Notes →</a>
  </section>

  ${buildFooter()}
</div>
${tabbarMarkup('prepare')}`;
}
