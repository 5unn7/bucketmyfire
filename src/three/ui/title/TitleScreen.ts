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

    // Root carries the key art (cover) over a dark fallback so there's never a white flash.
    const root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '50',
      overflow: 'hidden',
      backgroundColor: '#0a0e16',
      backgroundImage: `url("${BG_URL}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      fontFamily: UI.font,
      color: UI.text,
      pointerEvents: 'none',
    });

    // Legibility gradient — transparent over the art up top, deepening to near-opaque at the bottom
    // where the wordmark + buttons sit. A faint top darken keeps any future top chrome readable too.
    root.appendChild(
      div({
        position: 'absolute',
        inset: '0',
        zIndex: '1',
        pointerEvents: 'none',
        background:
          'linear-gradient(180deg, rgba(4,6,10,0.34) 0%, rgba(4,6,10,0) 22%, rgba(4,6,10,0) 40%, rgba(4,6,10,0.62) 70%, rgba(3,5,8,0.94) 100%)',
      }),
    );

    // Hero plate — anchored to the BOTTOM, centred, over the gradient.
    const hero = div({
      position: 'absolute',
      left: 'max(20px, env(safe-area-inset-left))',
      right: 'max(20px, env(safe-area-inset-right))',
      bottom: 'max(30px, env(safe-area-inset-bottom))',
      zIndex: '2',
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

    root.appendChild(hero);

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
      borderRadius: R.pill,
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
  `;
  document.head.appendChild(tag);
}
