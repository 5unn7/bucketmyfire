import type { MissionDef } from '../../missions/types';
import { UI, FS, FW, R, el, div, prefersReducedMotion } from '../theme';
import { makeButton, makeBadge } from '../components';
import { loadProfile, missionsCleared } from '../profile';
import { dailyStreak, bestDailyStreak } from '../../missions/streak';
import { openLeaderboard } from '../Leaderboard';
import { signalFirstFrame } from '../../splashSignal';

/**
 * TitleScreen — the home screen. A PURE-DOM "Ember Horizon": a night sky over a glowing ember
 * horizon beyond a ridgeline, with embers drifting up the sky (a cheap pre-baked canvas particle
 * system), under a typographic ember wordmark + the brand hook + an action cluster (PLAY · Daily
 * Burn + streak · Leaderboard). Pressing PLAY tears it all down and calls `onPlay` (mounts MenuFlow).
 *
 * The old 3D attract backdrop + GitHub-grid wordmark were removed — no WebGL renderer / composer /
 * AttractScene here anymore, so the home boots instantly with zero GPU scene work. The only motion
 * is the ember canvas (one rAF loop, fixed-cap particles, paused while the tab is hidden, gated off
 * for reduced-motion). Zero binary assets — geometry from gradients + canvas, colours from `UI` fire
 * tokens. Replaces the bare `new MenuFlow(...)` landing in the router; `main.ts` is unchanged.
 */

// Scene backdrop hexes — the night-sky gradient. These are a procedural SCENE (like the old 3D
// backdrop), not a DOM surface token; the fire/ember colours below all come from `UI`.
const SKY = 'linear-gradient(180deg, #05070e 0%, #090e1b 34%, #160f1e 58%, #2a160f 82%, #3c1a0d 100%)';

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  age: number;
  life: number;
  sprite: number; // index into the baked sprites
}

export class TitleScreen {
  private readonly parent: HTMLElement;
  private readonly onPlay: () => void;
  private readonly root: HTMLDivElement;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly sprites: HTMLCanvasElement[] = [];
  private embers: Ember[] = [];
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private target = 0;

  private raf = 0;
  private prevTime = 0;
  private hidden = false;
  private disposed = false;
  private firstFramed = false;

  constructor(parent: HTMLElement, catalog: MissionDef[], onPlay: () => void) {
    this.parent = parent;
    this.onPlay = onPlay;
    injectTitleStyles();

    this.root = this.buildScene(catalog);
    parent.appendChild(this.root);

    if (!prefersReducedMotion()) {
      // The ember canvas is the only moving layer — set it up and run one rAF loop.
      const made = this.buildCanvas();
      this.canvas = made.canvas;
      this.ctx = made.ctx;
      this.bakeSprites();
      this.resizeCanvas();
      window.addEventListener('resize', this.onResize);
      window.addEventListener('orientationchange', this.onResize);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.raf = requestAnimationFrame(this.loop);
    }

    // No WebGL frame to wait for — clear the cold-start splash on the next paint.
    requestAnimationFrame(() => signalFirstFrame());
  }

  /** Stop the loop, drop listeners + DOM. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
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

  // --- Ember canvas ----------------------------------------------------------

  private buildCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      pointerEvents: 'none',
      zIndex: '2', // above the ridge (z1) so embers rise in front of the hills
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(canvas);
    return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
  }

  /** Pre-bake a few radial-gradient ember sprites (white-hot core → ember tint → transparent), so the
   *  loop is just `drawImage` with additive blending — no per-particle gradient cost. */
  private bakeSprites(): void {
    const tints = [UI.emberHi, UI.fire, UI.warn];
    for (const tint of tints) {
      const s = document.createElement('canvas');
      s.width = 32;
      s.height = 32;
      const c = s.getContext('2d') as CanvasRenderingContext2D;
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,244,214,0.95)');
      g.addColorStop(0.35, tint);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
      this.sprites.push(s);
    }
  }

  private resizeCanvas(): void {
    if (!this.canvas || !this.ctx) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.vw = this.parent.clientWidth;
    this.vh = this.parent.clientHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.target = Math.min(72, Math.max(24, Math.round(this.vw / 16)));
  }

  /** Spawn one ember at the fire line (just above the ridge), rising into the sky. */
  private spawn(seed = false): Ember {
    const horizon = this.vh * 0.74;
    return {
      x: Math.random() * this.vw,
      y: seed ? horizon - Math.random() * this.vh * 0.6 : horizon + Math.random() * 14,
      vx: (Math.random() - 0.5) * 16,
      vy: -(18 + Math.random() * 46),
      size: 1.6 + Math.random() * 3.2,
      age: seed ? Math.random() * 3 : 0,
      life: 3 + Math.random() * 3.5,
      sprite: (Math.random() * this.sprites.length) | 0,
    };
  }

  private readonly loop = (time: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.hidden || !this.ctx) {
      this.prevTime = 0;
      return;
    }
    if (this.prevTime === 0) {
      this.prevTime = time;
      return;
    }
    const dt = Math.min((time - this.prevTime) / 1000, 1 / 20);
    this.prevTime = time;

    // Top up to target (a few per frame so it fills in rather than popping).
    while (this.embers.length < this.target) this.embers.push(this.spawn(this.embers.length < this.target - 6));

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.vw, this.vh);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.age += dt;
      e.x += (e.vx + Math.sin((e.age + i) * 1.3) * 8) * dt;
      e.y += e.vy * dt;
      if (e.age >= e.life || e.y < this.vh * 0.06) {
        this.embers[i] = this.spawn();
        continue;
      }
      const t = e.age / e.life;
      const alpha = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82; // quick fade-in, long fade-out
      const flick = 0.75 + Math.sin((e.age + i) * 9) * 0.25; // ember twinkle
      ctx.globalAlpha = Math.max(0, alpha) * flick;
      const d = e.size * 2;
      ctx.drawImage(this.sprites[e.sprite], e.x - e.size, e.y - e.size, d, d);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (!this.firstFramed) {
      this.firstFramed = true;
      signalFirstFrame();
    }
  };

  private readonly onResize = (): void => this.resizeCanvas();
  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    if (!this.hidden) this.prevTime = 0;
  };

  // --- DOM scene -------------------------------------------------------------

  private buildScene(catalog: MissionDef[]): HTMLDivElement {
    const reduce = prefersReducedMotion();
    const profile = loadProfile();
    const cleared = missionsCleared();
    const streak = dailyStreak();

    const root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '50',
      overflow: 'hidden',
      background: SKY,
      fontFamily: UI.font,
      color: UI.text,
      pointerEvents: 'none',
    });

    // Fire glow beyond the ridge — the wildfire is coming over the next hills.
    const glow = div({
      position: 'absolute',
      inset: '0',
      zIndex: '0',
      pointerEvents: 'none',
      background:
        `radial-gradient(120% 52% at 50% 100%, ${UI.ember}66 0%, ${UI.fire}26 34%, transparent 64%),` +
        `radial-gradient(58% 26% at 50% 100%, ${UI.emberHi}66 0%, transparent 72%)`,
    });
    if (!reduce) glow.style.animation = 'bmf-horizon-pulse 5.5s ease-in-out infinite';
    root.appendChild(glow);

    // Ridgeline silhouette (two layers for depth) anchored to the bottom.
    root.appendChild(this.ridge(0.74, '#0b0a12', 1, `1px solid ${UI.fire}`)); // far ridge, faint ember rim
    root.appendChild(this.ridge(0.82, '#040509', 1, 'none')); // near ridge, near-black

    // Hero content — centred column over the scene.
    const col = div({
      position: 'absolute',
      inset: '0',
      zIndex: '3',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      gap: '16px',
      padding:
        'max(28px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) ' +
        'max(28px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
      pointerEvents: 'none',
    });

    const kicker = div(
      { fontSize: FS.label, letterSpacing: '0.4em', textTransform: 'uppercase', color: UI.ember, fontWeight: FW.heavy, textShadow: '0 1px 14px rgba(0,0,0,0.6)' },
      'Fight the wildfire',
    );

    // Typographic ember wordmark (system font, ember-gradient fill + glow) — replaces the pixel grid.
    const word = el('h1', {
      margin: '0',
      fontWeight: FW.black,
      letterSpacing: '0.02em',
      lineHeight: '0.96',
      fontSize: 'clamp(38px, 11vw, 74px)',
      background: `linear-gradient(176deg, ${UI.emberHi} 0%, ${UI.ember} 52%, ${UI.fire} 100%)`,
      backgroundClip: 'text',
      color: 'transparent',
      filter: 'drop-shadow(0 3px 26px rgba(255,106,44,0.45))',
    });
    word.style.setProperty('-webkit-background-clip', 'text');
    word.style.setProperty('-webkit-text-fill-color', 'transparent');
    word.setAttribute('aria-label', 'Bucket My Fire');
    word.textContent = 'BUCKET MY FIRE';

    const hook = div(
      { fontSize: FS.md, letterSpacing: '0.01em', color: UI.text, opacity: '0.9', textShadow: '0 1px 14px rgba(0,0,0,0.7)' },
      'A bucket, a chopper, a wildfire.',
    );

    // Action cluster: hero PLAY · Daily Burn (+ streak) · Leaderboard.
    const actions = div({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '10px', pointerEvents: 'auto' });
    const play = this.buildPlayButton();
    actions.appendChild(play);

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

    col.append(kicker, word, hook, actions);

    if (profile?.name) {
      col.appendChild(
        div(
          { fontSize: FS.meta, color: UI.dim, marginTop: '4px', textShadow: '0 1px 10px rgba(0,0,0,0.6)' },
          `Welcome back, ${profile.name}${cleared > 0 ? ` · ${cleared} sortie${cleared === 1 ? '' : 's'} flown` : ''}`,
        ),
      );
    }

    root.appendChild(col);

    if (!reduce) {
      kicker.style.animation = 'bmf-title-rise 0.55s ease 0.02s both';
      word.style.animation = 'bmf-title-rise 0.7s ease 0.10s both';
      hook.style.animation = 'bmf-title-rise 0.6s ease 0.26s both';
      actions.style.animation = 'bmf-title-rise 0.6s cubic-bezier(0.34,1.4,0.64,1) 0.38s both';
    }

    return root;
  }

  /** A jagged ridgeline pinned to the bottom, its top edge at `topFrac` of the viewport height. */
  private ridge(topFrac: number, fill: string, opacity: number, rimBorder: string): HTMLDivElement {
    const band = div({
      position: 'absolute',
      left: '0',
      right: '0',
      top: `${Math.round(topFrac * 100)}%`,
      bottom: '0',
      zIndex: '1',
      opacity: String(opacity),
      pointerEvents: 'none',
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 30');
    svg.setAttribute('preserveAspectRatio', 'none');
    Object.assign(svg.style, { width: '100%', height: '100%', display: 'block' } as Partial<CSSStyleDeclaration>);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // A simple jagged hill/treeline profile (kept deterministic so it doesn't reshuffle on resize).
    path.setAttribute('d', 'M0,12 L8,7 L15,11 L23,4 L31,10 L39,6 L48,12 L56,5 L64,10 L72,7 L81,12 L89,8 L100,11 L100,30 L0,30 Z');
    path.setAttribute('fill', fill);
    if (rimBorder !== 'none') {
      path.setAttribute('stroke', UI.fire);
      path.setAttribute('stroke-width', '0.3');
      path.setAttribute('stroke-opacity', '0.5');
    }
    svg.appendChild(path);
    band.appendChild(svg);
    return band;
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
  @keyframes bmf-horizon-pulse { 0%, 100% { opacity: 0.82; } 50% { opacity: 1; } }
  `;
  document.head.appendChild(tag);
}
