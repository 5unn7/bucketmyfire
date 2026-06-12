/**
 * The Shop page controller (`/shop/`) — the COMING-SOON front for "Wear the fight." merch, living on
 * the main domain until the standalone storefront's own domain (shop.bucketmyfire.com) is live. Built
 * on the SAME glass-cockpit branding as the other front pages (src/hub.ts, /campaign/): the real
 * in-game component vocabulary (injectKitStyles → `.btn`, injectHomeStyles → `.card`/`.cut`/`.scene`/
 * `.embers`) inside the shared front-door chrome (frontShell → the `.bmf-app.front` scroll shell +
 * `.fhome-bar` appbar), with the shared footer + mobile tab bar (shell). Pure DOM, no Three.
 *
 * One job: hold the brand moment (the merch key art + "Wear the fight.") and capture intent — the
 * **Notify me** CTA opens the shared front-door lead modal (shell `openShopNotify`, tagged
 * `notify:shop`). When the storefront goes live, this page hands over: flip `STORE_URL` in
 * ui/storeLink.ts + the NAV href in site/siteNav.mjs back to the external domain.
 */
import { injectFonts } from '../three/ui/fonts';
import { injectKitStyles } from '../three/ui/components/base';
import { injectHomeStyles } from '../three/ui/home/styles';
import { DEFS, ic } from '../three/ui/home/icons';
import { injectShellStyles, applyMotionPref, buildFooter, tabbarMarkup, openShopNotify } from '../site/shell';
import { injectFrontShell, frontScene, frontAppbar, spawnFrontEmbers, wireFrontAppbar } from '../site/frontShell';

applyMotionPref();
injectFonts();
injectKitStyles(); // theme.ts tokens at :root + the .btn/.badge of record
injectHomeStyles(); // the REAL component vocabulary (.card/.cut/.brand/.scene/.embers)
injectShellStyles(); // the shared footer + mobile tab bar + .fd-hero/.fd-cform chrome
injectFrontShell(); // the front-door chrome (.bmf-app.front scroll shell + .fhome-bar appbar)
injectShopStyles(); // this page's small content layout (hero + the key-art poster)

const game = document.getElementById('game');
if (game) {
  const app = document.createElement('div');
  app.className = 'bmf-app front';
  app.innerHTML = DEFS + shopMarkup();
  game.innerHTML = '';
  game.appendChild(app);
  document.getElementById('fd-boot')?.remove();

  spawnFrontEmbers(app, 13); // the ambient ember field, same as the other front pages
  wireFrontAppbar(app); // trophy → leaderboard, gear → settings, footer Contact/legal

  // The one job: every Notify-me CTA opens the shared waitlist capture (tagged notify:shop).
  app.querySelectorAll<HTMLButtonElement>('[data-notify-shop]').forEach((b) =>
    b.addEventListener('click', () => openShopNotify()),
  );
}

function shopMarkup(): string {
  return `
${frontScene()}
${frontAppbar('shop')}
<div class="pad fhome">
  <header class="fshop-hero fd-hero rise">
    <div class="fd-hero-main">
      <p class="fd-hero-eyebrow">BMF Gear · Coming soon</p>
      <h1 class="fd-hero-head">Wear the fight.</h1>
      <p class="fd-hero-sub">Gear built around the fight — for the pilots, the crews, and everyone
        watching the line hold. The first collection is in final prep.</p>
    </div>
  </header>

  <section class="card warm cut fshop-poster rise" aria-label="Wear the fight — the first BMF gear collection, coming soon">
    <div class="fshop-art"><img src="/images/cardsbg/wearthefightbg.webp" alt="Wear the fight — the black BMF hoodie, its back print a helicopter bucket-drop over a burning ridge, floating in a misty boreal forest" /></div>
    <div class="fshop-scrim"></div>
    <div class="fshop-body">
      <span class="fshop-ey">${ic('shop')}First collection</span>
      <h2 class="fshop-h">The doors open soon.</h2>
      <p class="fshop-sub">Leave your email and you'll be the first one through — one message when the
        gear drops, nothing else.</p>
      <button class="btn primary fshop-go" type="button" data-notify-shop>Notify me</button>
    </div>
  </section>

  ${buildFooter()}
</div>
${tabbarMarkup('shop')}`;
}

/** This page's content layout only — the hero spacing + the key-art poster card (art / scrim / copy
 *  stack). Components + chrome come from the injected stylesheets above; every value is a token or a
 *  layout number (same convention as the campaign page's local CSS). */
function injectShopStyles(): void {
  if (document.getElementById('fd-shop-css')) return;
  const s = document.createElement('style');
  s.id = 'fd-shop-css';
  s.textContent = `
.bmf-app.front .fshop-hero { padding: 2px 2px 0; }
/* The key-art poster: a tall landscape stage on desktop, portrait-leaning on phones, copy + CTA
   bottom-left over a directional fade (mirrors the home's merch feature card treatment). */
.bmf-app.front .fshop-poster { position: relative; overflow: hidden; display: flex; flex-direction: column;
  justify-content: flex-end; min-height: min(62dvh, 560px); padding: 0; }
.bmf-app.front .fshop-art { position: absolute; inset: 0; z-index: 0; }
.bmf-app.front .fshop-art img { width: 100%; height: 100%; object-fit: cover; object-position: 64% 38%; display: block; }
.bmf-app.front .fshop-scrim { position: absolute; inset: 0; z-index: 1; background:
  linear-gradient(180deg, rgba(6,9,11,0.04) 0%, rgba(6,9,11,0.35) 48%, rgba(6,9,11,0.9) 100%),
  linear-gradient(100deg, rgba(6,9,11,0.72) 0%, transparent 58%); }
.bmf-app.front .fshop-body { position: relative; z-index: 2; padding: 18px 18px 20px; max-width: 460px; }
.bmf-app.front .fshop-ey { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono);
  font-size: var(--fs-label); letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fshop-ey svg { width: 15px; height: 15px; }
.bmf-app.front .fshop-h { margin: 9px 0 0; font-size: clamp(26px, 4vw, 38px); font-weight: var(--fw-black);
  line-height: 1.06; letter-spacing: .01em; color: #fff; text-wrap: balance; }
.bmf-app.front .fshop-sub { margin: 9px 0 0; font-size: var(--fs-md); line-height: 1.5; color: var(--text-subtle); text-wrap: pretty; }
.bmf-app.front .fshop-go { margin-top: 15px; min-width: 180px; justify-content: center; }
`;
  document.head.appendChild(s);
}
