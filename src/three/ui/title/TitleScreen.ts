import type { MissionDef } from '../../missions/types';
import { UI, FS, FW, R, el, div, prefersReducedMotion } from '../theme';
import { loadProfile, missionsCleared } from '../profile';
import { signalFirstFrame } from '../../splashSignal';

/**
 * TitleScreen — the home screen. Wildfire key art (a Bell helicopter on a slung bucket dropping water
 * over a burning ridge) — full-bleed on phones, a centred rounded 16:9 card on desktop. The ember
 * wordmark sits TOP-RIGHT; a dark gradient rises from the bottom through the tagline + the single PLAY
 * button so they stay legible against the fire. (Daily Burn + Leaderboard live in the wizard.)
 *
 * Pure DOM, no WebGL (the old 3D AttractScene + GitHub-grid wordmark were removed), so the home
 * boots instantly. The background image is preloaded; the cold-start splash holds until it's ready
 * (with a timeout fallback) so the home fades in fully painted rather than flashing the fallback.
 * Pressing PLAY tears it down and calls `onPlay` (mounts MenuFlow). `main.ts` is unchanged.
 */

// Key-art background — a `public/` asset, referenced through BASE_URL so it resolves under any
// deploy base (root or the /bucketmyfire/ project-pages path).
const BG_URL = `${import.meta.env.BASE_URL}images/Website/home212-bg.webp`;

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

    // Root: a flex-centred stage on a dark backing. On phones the frame fills it; on desktop the
    // frame is a centred rounded portrait CARD and this dark backing shows in the margins. (Layout
    // lives in the injected `.bmf-home-*` classes so media queries can switch fill ↔ framed.)
    const root = div({ position: 'fixed', inset: '0', zIndex: '50', fontFamily: UI.font, color: UI.text, pointerEvents: 'none' });
    root.className = 'bmf-home-root';

    // Blurred ambient backdrop — fills the desktop margins around the card with a darkened, blurred
    // zoom of the same art so the framed look feels intentional, not letterboxed. Hidden behind the
    // full-bleed frame on phones.
    const backdrop = div({ backgroundImage: `url("${BG_URL}")` });
    backdrop.className = 'bmf-home-backdrop';
    root.appendChild(backdrop);

    // The framed key art. Its aspect-ratio matches the source image (3:4) on desktop, so `cover`
    // shows the WHOLE picture with no crop; on phones it goes full-bleed (radius 0).
    // The source art is already 16:9, so on the desktop 16:9 card it shows uncropped; on a portrait
    // phone `cover` keeps the centred helicopter in frame.
    const frame = div({ backgroundImage: `url("${BG_URL}")`, backgroundSize: 'cover', backgroundPosition: 'center' });
    frame.className = 'bmf-home-frame';

    // Legibility gradient — clean dark rising from the bottom up through where the tagline + button
    // sit; the upper art (and the top-right wordmark) stay clear of it.
    frame.appendChild(
      div({
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        background:
          'linear-gradient(180deg, rgba(4,6,10,0) 40%, rgba(4,6,10,0.55) 64%, rgba(2,4,7,0.96) 100%)',
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

    // Typographic ember wordmark (system font, ember-gradient fill + glow) — pinned TOP-RIGHT of the
    // frame as a corner mark; a dark drop-shadow under the ember glow keeps it legible over the fire.
    const word = el('h1', {
      position: 'absolute',
      top: 'max(18px, env(safe-area-inset-top))',
      right: 'max(20px, env(safe-area-inset-right))',
      margin: '0',
      textAlign: 'right',
      whiteSpace: 'nowrap',
      fontWeight: FW.black,
      letterSpacing: '0.04em',
      lineHeight: '0.92',
      fontSize: 'clamp(20px, 4.4vw, 36px)',
      background: `linear-gradient(176deg, ${UI.emberHi} 0%, ${UI.ember} 52%, ${UI.fire} 100%)`,
      backgroundClip: 'text',
      color: 'transparent',
      filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.7)) drop-shadow(0 2px 18px rgba(255,106,44,0.45))',
      pointerEvents: 'none',
    });
    word.style.setProperty('-webkit-background-clip', 'text');
    word.style.setProperty('-webkit-text-fill-color', 'transparent');
    word.setAttribute('aria-label', 'Bucket My Fire');
    word.textContent = 'BUCKET MY FIRE';
    frame.appendChild(word);

    const hook = div(
      { fontSize: FS.md, letterSpacing: '0.02em', color: UI.text, opacity: '0.92', textShadow: '0 1px 16px rgba(0,0,0,0.85)' },
      'Ready to fight the fire?',
    );

    // Returning pilot: a quiet "welcome back" line ABOVE the tagline.
    let welcome: HTMLElement | null = null;
    if (profile?.name) {
      welcome = div(
        { fontSize: FS.meta, color: UI.dim, textShadow: '0 1px 12px rgba(0,0,0,0.8)' },
        `Welcome back, ${profile.name}${cleared > 0 ? ` · ${cleared} sortie${cleared === 1 ? '' : 's'} flown` : ''}`,
      );
      hero.appendChild(welcome);
    }

    hero.append(hook);

    // The home is a single, unmistakable CTA — PLAY, raised right under the tagline.
    const play = this.buildPlayButton();
    play.style.marginTop = '6px';
    play.style.pointerEvents = 'auto';
    hero.appendChild(play);

    frame.appendChild(hero);
    root.appendChild(frame);

    if (!reduce) {
      word.style.animation = 'bmf-title-rise 0.7s ease 0.06s both';
      if (welcome) welcome.style.animation = 'bmf-title-rise 0.6s ease 0.16s both';
      hook.style.animation = 'bmf-title-rise 0.6s ease 0.24s both';
      play.style.animation = 'bmf-title-rise 0.6s cubic-bezier(0.34,1.4,0.64,1) 0.36s both';
    }

    return root;
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
  .bmf-home-root { display: flex; align-items: center; justify-content: center; background: #06080e; overflow: hidden; }
  .bmf-home-backdrop { position: absolute; inset: 0; background-size: cover; background-position: center; filter: blur(30px) brightness(0.40) saturate(1.04); transform: scale(1.14); }
  .bmf-home-frame { position: relative; overflow: hidden; width: 100%; height: 100%; border-radius: 0; }
  /* Desktop / landscape: a centred rounded 16:9 card, sized to leave a ~20px margin all round (the
     largest 16:9 box that fits inside the viewport minus 40px). Phones stay full-bleed (above). */
  @media (min-width: 768px) and (orientation: landscape) {
    .bmf-home-frame {
      width: min(calc(100vw - 40px), calc((100vh - 40px) * 16 / 9));
      height: auto; aspect-ratio: 16 / 9;
      border-radius: 22px; box-shadow: 0 30px 90px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.07);
    }
  }
  `;
  document.head.appendChild(tag);
}
