import type { MissionDef } from '../../missions/types';
import { UI, FS, FW, R, el, div, prefersReducedMotion } from '../theme';
import { makeButton, makeBadge } from '../components';
import { loadProfile, missionsCleared } from '../profile';
import { dailyStreak, bestDailyStreak } from '../../missions/streak';
import { openLeaderboard } from '../Leaderboard';
import { signalFirstFrame } from '../../splashSignal';

/**
 * TitleScreen — the home screen. Full-bleed wildfire key art (a Huey on a slung bucket dropping
 * water over a burning ridge) with a dark gradient rising from the bottom, and the hero plate —
 * typographic ember wordmark + the brand hook + the action cluster (PLAY · Daily Burn + 🔥 streak ·
 * Leaderboard) — anchored over that gradient so text and buttons stay legible against the busy fire.
 *
 * Pure DOM, no WebGL (the old 3D AttractScene + GitHub-grid wordmark were removed), so the home
 * boots instantly. The background image is preloaded; the cold-start splash holds until it's ready
 * (with a timeout fallback) so the home fades in fully painted rather than flashing the fallback.
 * Pressing PLAY tears it down and calls `onPlay` (mounts MenuFlow). `main.ts` is unchanged.
 */

// Key-art background — a `public/` asset, referenced through BASE_URL so it resolves under any
// deploy base (root or the /bucketmyfire/ project-pages path).
const BG_URL = `${import.meta.env.BASE_URL}images/Website/homescreen-bg.webp`;

export class TitleScreen {
  private readonly onPlay: () => void;
  private readonly root: HTMLDivElement;
  private splashTimer = 0;
  private disposed = false;

  constructor(parent: HTMLElement, catalog: MissionDef[], onPlay: () => void) {
    this.onPlay = onPlay;
    injectTitleStyles();

    this.root = this.buildScene(catalog);
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

  /** Jump straight to today's Daily Burn (?daily → full reload, so no teardown needed). */
  private playDaily(): void {
    const url = new URL(location.href);
    url.searchParams.delete('m');
    url.searchParams.set('daily', '1');
    location.assign(url.toString());
  }

  // --- DOM scene -------------------------------------------------------------

  private buildScene(catalog: MissionDef[]): HTMLDivElement {
    const reduce = prefersReducedMotion();
    const profile = loadProfile();
    const cleared = missionsCleared();
    const streak = dailyStreak();

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
    // Bias the crop UPWARD (28% from top) so the 16:9 landscape crop keeps the helicopter + bucket in
    // frame (the source is portrait; a centred crop would cut the heli off the top).
    const frame = div({ backgroundImage: `url("${BG_URL}")`, backgroundSize: 'cover', backgroundPosition: 'center 28%' });
    frame.className = 'bmf-home-frame';

    // Legibility gradient — transparent over the art up top, deepening to near-opaque at the bottom
    // (inside the frame) where the wordmark + buttons sit.
    frame.appendChild(
      div({
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        background:
          'linear-gradient(180deg, rgba(4,6,10,0.30) 0%, rgba(4,6,10,0) 24%, rgba(4,6,10,0) 42%, rgba(4,6,10,0.60) 70%, rgba(3,5,8,0.95) 100%)',
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

    // Typographic ember wordmark (system font, ember-gradient fill + glow) — not a pixel grid.
    const word = el('h1', {
      margin: '0',
      fontWeight: FW.black,
      letterSpacing: '0.02em',
      lineHeight: '0.96',
      fontSize: 'clamp(34px, 9vw, 60px)',
      background: `linear-gradient(176deg, ${UI.emberHi} 0%, ${UI.ember} 52%, ${UI.fire} 100%)`,
      backgroundClip: 'text',
      color: 'transparent',
      filter: 'drop-shadow(0 3px 22px rgba(255,106,44,0.5))',
    });
    word.style.setProperty('-webkit-background-clip', 'text');
    word.style.setProperty('-webkit-text-fill-color', 'transparent');
    word.setAttribute('aria-label', 'Bucket My Fire');
    word.textContent = 'BUCKET MY FIRE';

    const hook = div(
      { fontSize: FS.md, letterSpacing: '0.02em', color: UI.text, opacity: '0.92', textShadow: '0 1px 16px rgba(0,0,0,0.85)' },
      'A bucket, a chopper, a wildfire.',
    );

    // Action cluster: hero PLAY · Daily Burn (+ streak) · Leaderboard.
    const actions = div({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '8px', pointerEvents: 'auto' });
    actions.appendChild(this.buildPlayButton());

    const dailyWrap = div({ display: 'flex', alignItems: 'center', gap: '8px' });
    if (streak >= 1) {
      const best = bestDailyStreak();
      const chip = makeBadge(`🔥 ${streak}`, 'fire');
      chip.style.fontSize = FS.sm;
      chip.title = best > streak ? `${streak}-day Daily Burn streak · best ${best}` : `${streak}-day Daily Burn streak`;
      dailyWrap.appendChild(chip);
    }
    dailyWrap.appendChild(makeButton({ label: 'Daily Burn', icon: '🔥', variant: 'secondary', register: 'fight', onClick: () => this.playDaily() }).el);
    actions.appendChild(dailyWrap);
    actions.appendChild(makeButton({ label: 'Leaderboard', icon: '🏆', variant: 'ghost', onClick: () => openLeaderboard(catalog) }).el);

    hero.append(word, hook, actions);

    if (profile?.name) {
      hero.appendChild(
        div(
          { fontSize: FS.meta, color: UI.dim, marginTop: '2px', textShadow: '0 1px 12px rgba(0,0,0,0.8)' },
          `Welcome back, ${profile.name}${cleared > 0 ? ` · ${cleared} sortie${cleared === 1 ? '' : 's'} flown` : ''}`,
        ),
      );
    }

    frame.appendChild(hero);
    root.appendChild(frame);

    if (!reduce) {
      word.style.animation = 'bmf-title-rise 0.7s ease 0.06s both';
      hook.style.animation = 'bmf-title-rise 0.6s ease 0.20s both';
      actions.style.animation = 'bmf-title-rise 0.6s cubic-bezier(0.34,1.4,0.64,1) 0.32s both';
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
