import type { MissionDef } from '../../missions/types';
import { UI, HOME, FS, FW, R, el, div, prefersReducedMotion } from '../theme';
import { makeButton } from '../components';
import { makeBrandIcon, makeBrandWordmark, brandIconUrl } from '../brandLogo';
import { loadProfile, missionsCleared } from '../profile';
import { openStore } from '../storeLink';
import { signalFirstFrame } from '../../splashSignal';

/**
 * TitleScreen — the home screen. Full-bleed 16:9 wildfire key art (a Bell helicopter on a slung
 * bucket dropping water over a burning ridge), covering every viewport. The brand lockup is CENTRED
 * along the top with the icon BURNING (a masked fire gradient + flickering ember glow); a dark
 * gradient rises from the bottom through the tagline + PLAY/Shop so they stay legible against the
 * fire. (Daily Burn + Leaderboard live in the wizard.)
 *
 * Pure DOM, no WebGL (the old 3D AttractScene + GitHub-grid wordmark were removed), so the home
 * boots instantly. The background image is preloaded; the cold-start splash holds until it's ready
 * (with a timeout fallback) so the home fades in fully painted rather than flashing the fallback.
 * Pressing PLAY tears it down and calls `onPlay` (routes to the HomeScreen hub / NewPilot gate).
 */

// Key-art background — a `public/` asset, referenced through BASE_URL so it resolves under any
// deploy base (root or the /bucketmyfire/ project-pages path).
const BG_URL = `${import.meta.env.BASE_URL}images/ui/home212-bg.webp`;

export class TitleScreen {
  private readonly onPlay: () => void;
  private readonly root: HTMLDivElement;
  private splashTimer = 0;
  private disposed = false;

  constructor(parent: HTMLElement, _catalog: MissionDef[], onPlay: () => void) {
    this.onPlay = onPlay;
    injectTitleStyles();

    this.root = this.buildScene();
    parent.appendChild(this.root);

    // Hold the cold-start splash until the key art is decoded, so the home fades in fully painted.
    // Fallback after 1.6s in case the image is slow/blocked — we never want the splash to hang.
    const reveal = (): void => {
      if (this.splashTimer) {
        window.clearTimeout(this.splashTimer);
        this.splashTimer = 0;
      }
      signalFirstFrame();
    };
    const img = new Image();
    img.onload = reveal;
    img.onerror = reveal;
    img.src = BG_URL;
    this.splashTimer = window.setTimeout(reveal, 1600);
  }

  /** Drop the DOM + any pending splash timer. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.splashTimer) window.clearTimeout(this.splashTimer);
    this.root.remove();
  }

  private play(): void {
    if (this.disposed) return;
    this.dispose();
    this.onPlay();
  }

  // --- DOM scene -------------------------------------------------------------

  private buildScene(): HTMLDivElement {
    const reduce = prefersReducedMotion();
    const profile = loadProfile();
    const cleared = missionsCleared();

    // Root: the stage, dark fallback behind the art (no white flash before the image decodes).
    const root = div({ position: 'fixed', inset: '0', zIndex: '50', fontFamily: UI.font, color: UI.text, pointerEvents: 'none' });
    root.className = 'bmf-home-root';

    // Key art — full-bleed cover on every viewport, anchored to the TOP (so the framing sits lower:
    // more sky + heli, the forest cropped under the gradient). Sizing in .bmf-home-frame.
    const frame = div({ backgroundImage: `url("${BG_URL}")` });
    frame.className = 'bmf-home-frame';

    // Legibility gradient — sits OVER the image, darkening the lower ~half of the screen so the
    // tagline + PLAY/Shop clearly read against the fire (upper art + top-right wordmark stay clear).
    frame.appendChild(
      div({
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        background:
          'linear-gradient(180deg, rgba(4,6,10,0) 48%, rgba(6,9,14,0.58) 72%, rgba(4,7,11,0.88) 88%, rgba(2,4,7,0.98) 100%)',
      }),
    );

    // Hero plate — anchored to the BOTTOM of the FRAME, centred, over the gradient.
    const hero = div({
      position: 'absolute',
      left: 'max(20px, env(safe-area-inset-left))',
      right: 'max(20px, env(safe-area-inset-right))',
      bottom: 'max(26px, env(safe-area-inset-bottom))',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: '14px',
      pointerEvents: 'none',
    });

    // Brand logo lockup — the official bucket-drop flame ICON beside the "BUCKET MY FIRE" WORDMARK
    // (inline vector, brandLogo.ts), CENTRED along the top of the frame. The icon BURNS (see addBurn:
    // a fire gradient masked to the mark's shape, drifting up, under a flickering ember glow). The
    // wordmark stays clean white with a dark + ember drop-shadow so it reads against the flames.
    // The centring transform lives on `wordWrap` so the inner `word`'s rise animation can't clobber it.
    const wordWrap = div({
      position: 'absolute',
      top: 'max(20px, env(safe-area-inset-top))',
      left: '50%',
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
    });
    const word = div({
      display: 'flex',
      alignItems: 'center',
      gap: 'clamp(9px, 1.8vw, 15px)',
      filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.7)) drop-shadow(0 2px 18px rgba(255,106,44,0.45))',
    });
    word.setAttribute('role', 'img');
    word.setAttribute('aria-label', 'Bucket My Fire');

    // Icon mark — white base (also the no-mask fallback) with the BURN layer laid over it.
    const markBox = div({ position: 'relative', height: 'clamp(40px, 8vw, 64px)', aspectRatio: '149.7 / 184.72', flex: 'none' });
    markBox.appendChild(makeBrandIcon('white'));
    this.addBurn(markBox, reduce);
    const wordmarkBox = div({ height: 'clamp(26px, 5vw, 42px)', aspectRatio: '302 / 161.26', flex: 'none' });
    wordmarkBox.appendChild(makeBrandWordmark('white'));
    word.append(markBox, wordmarkBox);
    wordWrap.appendChild(word);
    frame.appendChild(wordWrap);

    const hook = div(
      { fontSize: FS.md, letterSpacing: '0.02em', color: UI.text, opacity: '0.92', textShadow: '0 1px 16px rgba(0,0,0,0.85)' },
      'Experience the thrill of helicopter firefighting.',
    );

    // Returning pilot: a quiet "welcome back" line ABOVE the tagline.
    let welcome: HTMLElement | null = null;
    if (profile?.name) {
      welcome = div(
        { fontSize: FS.meta, color: UI.dim, textShadow: '0 1px 12px rgba(0,0,0,0.8)' },
        `Welcome back, ${profile.name}${cleared > 0 ? ` · ${cleared} mission${cleared === 1 ? '' : 's'} flown` : ''}`,
      );
      hero.appendChild(welcome);
    }

    hero.append(hook);

    // The primary CTA — PLAY, raised right under the tagline.
    const play = this.buildPlayButton();
    play.style.marginTop = '6px';
    play.style.pointerEvents = 'auto';
    hero.appendChild(play);

    // Secondary — Shop opens the standalone bucketmyfire storefront in a new tab (keeps the game up).
    const shop = makeButton({ label: 'Shop', icon: '🛍', variant: 'secondary', register: 'fight', onClick: () => openStore('title') });
    shop.el.style.pointerEvents = 'auto';
    hero.appendChild(shop.el);

    frame.appendChild(hero);
    root.appendChild(frame);

    if (!reduce) {
      word.style.animation = 'bmf-title-rise 0.7s ease 0.06s both';
      if (welcome) welcome.style.animation = 'bmf-title-rise 0.6s ease 0.16s both';
      hook.style.animation = 'bmf-title-rise 0.6s ease 0.24s both';
      play.style.animation = 'bmf-title-rise 0.6s cubic-bezier(0.34,1.4,0.64,1) 0.36s both';
      shop.el.style.animation = 'bmf-title-rise 0.6s ease 0.46s both';
    }

    return root;
  }

  /**
   * The brand "burn": lay a masked, drifting fire gradient over the icon mark and give the mark a
   * flickering ember glow (firelight on the brand). The white icon underneath stays as the fallback
   * where CSS masks aren't supported — there we keep the plain mark and just add the static glow.
   * Motion is gated on reduce-motion: reduced players still get the burning fill + glow, just no drift.
   */
  private addBurn(markBox: HTMLDivElement, reduce: boolean): void {
    // Flickering ember glow on the mark itself. Static (no flicker) under reduce-motion.
    if (reduce) markBox.style.filter = `drop-shadow(0 0 8px ${UI.ember}) drop-shadow(0 3px 18px ${HOME.glow80})`;
    else markBox.style.animation = 'bmf-burn-glow 2.6s ease-in-out infinite';

    const maskOK =
      typeof CSS !== 'undefined' &&
      (CSS.supports?.('mask-image', 'url(x)') || CSS.supports?.('-webkit-mask-image', 'url(x)'));
    if (!maskOK) return; // no CSS mask → keep the plain white icon (+ glow above)

    // Fill the mark's SHAPE with a vertical fire gradient (deep ember → fire → hot gold), taller than
    // the box so it can drift upward like a flame. The mask is the icon SVG, matching the white base.
    const mask = `url("${brandIconUrl('white')}") center / contain no-repeat`;
    const burn = div({
      position: 'absolute',
      inset: '0',
      background: `linear-gradient(0deg, ${UI.ember} 0%, ${UI.fire} 30%, ${UI.emberHi} 55%, ${UI.fire} 80%, ${UI.ember} 100%)`,
      backgroundSize: '100% 220%',
      backgroundPosition: '50% 0%',
      mask,
      pointerEvents: 'none',
    });
    burn.style.setProperty('-webkit-mask', mask);
    if (!reduce) burn.style.animation = 'bmf-burn-shimmer 3.2s ease-in-out infinite';
    markBox.appendChild(burn);
  }

  private buildPlayButton(): HTMLButtonElement {
    // Fight register: PLAY is the brand's hero action, so it burns ember, not cockpit cyan.
    const base = `0 14px 40px ${UI.ember}66, inset 0 2px 0 rgba(255,255,255,0.45)`;
    const hover = `0 18px 54px ${UI.ember}99, inset 0 2px 0 rgba(255,255,255,0.45)`;
    const b = el('button', {
      pointerEvents: 'auto',
      minWidth: '230px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      padding: '17px 44px',
      borderRadius: R.lg,
      border: 'none',
      fontFamily: UI.font,
      fontSize: FS.title,
      fontWeight: FW.heavy,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: UI.ink,
      background: `linear-gradient(180deg, ${UI.emberHi}, ${UI.ember})`,
      boxShadow: base,
      cursor: 'pointer',
      transition: 'transform 0.14s ease, box-shadow 0.22s ease',
    });
    b.type = 'button';
    b.setAttribute('aria-label', 'Play — start pre-flight');
    b.append(el('span', { fontSize: '0.78em', transform: 'translateY(1px)' }, '▶'), el('span', {}, 'PLAY'));
    b.addEventListener('pointerenter', () => {
      b.style.transform = 'translateY(-2px) scale(1.02)';
      b.style.boxShadow = hover;
    });
    b.addEventListener('pointerleave', () => {
      b.style.transform = 'none';
      b.style.boxShadow = base;
    });
    b.addEventListener('pointerdown', () => (b.style.transform = 'translateY(1px) scale(0.99)'));
    b.addEventListener('click', () => this.play());
    return b;
  }
}

// --- module-level ----------------------------------------------------------

let stylesInjected = false;
function injectTitleStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
  @keyframes bmf-title-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  /* Burn — the fire gradient drifts up through the icon mask (flame movement), with a faint flicker. */
  @keyframes bmf-burn-shimmer {
    0%   { background-position: 50% 0%;   opacity: 0.9; }
    50%  { background-position: 50% 100%; opacity: 1; }
    100% { background-position: 50% 0%;   opacity: 0.9; }
  }
  /* Firelight — the mark's ember glow breathes and flickers warm. */
  @keyframes bmf-burn-glow {
    0%, 100% { filter: drop-shadow(0 0 6px ${UI.ember}) drop-shadow(0 2px 14px ${HOME.glow50}); }
    40%      { filter: drop-shadow(0 0 13px ${UI.emberHi}) drop-shadow(0 3px 22px ${HOME.glow90}); }
    68%      { filter: drop-shadow(0 0 8px ${UI.fire}) drop-shadow(0 2px 18px ${HOME.glow80}); }
  }
  .bmf-home-root { background: #06080e; overflow: hidden; }
  .bmf-home-frame { position: absolute; inset: 0; overflow: hidden; background-position: center top; background-repeat: no-repeat; background-size: cover; }
  `;
  document.head.appendChild(tag);
}
