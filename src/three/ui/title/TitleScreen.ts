import * as THREE from 'three';
import { QualityTier } from '../../render/QualityTier';
import { Composer } from '../../postfx/Composer';
import { AttractScene } from '../../menu/AttractScene';
import type { MissionDef } from '../../missions/types';
import { createGridTitle } from '../GridTitle';
import { UI, FS, FW, R, el, div, prefersReducedMotion } from '../theme';
import { makeButton, makeBadge } from '../components';
import { loadProfile, missionsCleared } from '../profile';
import { dailyStreak, bestDailyStreak } from '../../missions/streak';
import { openLeaderboard } from '../Leaderboard';
import { signalFirstFrame } from '../../splashSignal';

/**
 * TitleScreen — the home screen. It owns a lightweight WebGL renderer + animation loop driving the
 * 3D `AttractScene` backdrop, with a DOM overlay (the ember wordmark, a tagline, a hero PLAY button,
 * and the Leaderboard chip) layered on top. Pressing PLAY tears the whole thing down — renderer,
 * scene, listeners, canvas, overlay — and calls `onPlay`, which mounts the existing pre-flight wizard
 * (`MenuFlow`). The menu→mission jump is a full page reload, so disposing here lets the gameplay
 * renderer start from a clean GPU.
 *
 * It mirrors `main.ts`'s renderer bones (ACES tone-map, tier-driven DPR + shadows, the post-fx
 * Composer for bloom/god-rays/grade, tab-blur pause, resize, context-loss recovery) but carries none
 * of the mission machinery. Replaces the bare `new MenuFlow(...)` landing in the router.
 *
 * This is the first screen of the home-screen redesign; the moving scene layers (helicopter, fire,
 * clouds, trees) and the richer overlay (returning-pilot quick-fly, settings) arrive in later phases.
 */
export class TitleScreen {
  private readonly parent: HTMLElement;
  private readonly onPlay: () => void;

  private readonly tier: QualityTier;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly attract: AttractScene;
  private readonly composer: Composer;
  private readonly root: HTMLDivElement;

  private prevTime = 0;
  private hidden = false;
  private disposed = false;

  constructor(parent: HTMLElement, catalog: MissionDef[], onPlay: () => void) {
    this.parent = parent;
    this.onPlay = onPlay;
    injectTitleStyles();

    // --- Renderer (mirrors main.ts bootMission, minus the mission machinery) ---
    this.tier = new QualityTier(); // device probe — must precede setPixelRatio + Composer construction
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.tier.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.enabled = this.tier.current.shadows;
    // The canvas covers the viewport behind the DOM overlay; updateStyle=false on setSize keeps our
    // CSS sizing (fixed inset:0) instead of the renderer stamping px width/height each resize.
    Object.assign(this.renderer.domElement.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      zIndex: '0',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.renderer.setSize(parent.clientWidth, parent.clientHeight, false);
    parent.appendChild(this.renderer.domElement);

    this.attract = new AttractScene(parent.clientWidth / parent.clientHeight, this.tier.current.shadows);
    this.composer = new Composer(this.renderer, this.attract.scene, this.attract.camera, this.tier);

    // Adaptive DPR: re-apply to renderer + composer in lockstep (recompile-free).
    this.tier.onDpr((dpr) => {
      this.renderer.setPixelRatio(dpr);
      this.composer.setPixelRatio(dpr);
    });

    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);

    this.root = this.buildOverlay(catalog);
    parent.appendChild(this.root);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.renderer.setAnimationLoop(this.loop);
  }

  /** Stop the loop, free GPU + DOM, drop listeners. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.attract.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.root.remove();
  }

  // --- Loop + lifecycle handlers (stable refs so they're removable) -----------

  private readonly loop = (time: number): void => {
    if (this.hidden) {
      this.prevTime = 0; // backgrounded — skip + reseed so resume doesn't lurch the drift
      return;
    }
    if (this.prevTime === 0) {
      this.prevTime = time;
      return;
    }
    const dt = Math.min((time - this.prevTime) / 1000, 1 / 20);
    this.prevTime = time;
    this.tier.sample(dt); // adaptive-DPR watchdog
    this.attract.update(dt);
    this.composer.render(this.renderer, this.attract.scene, this.attract.camera, this.attract.sunDir);
    signalFirstFrame(); // first attract frame is on screen — let the cold-start splash fade to it
  };

  private readonly onResize = (): void => {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.attract.resize(w / h);
  };

  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    if (!this.hidden) this.prevTime = 0;
  };

  private readonly onContextLost = (e: Event): void => {
    // The 3D backdrop is gone, but the DOM overlay still works — paint the menu gradient behind it so
    // the player keeps a usable PLAY screen instead of staring at a dead canvas.
    e.preventDefault();
    this.renderer.setAnimationLoop(null);
    this.renderer.domElement.style.display = 'none';
    this.root.style.background = MENU_GRADIENT;
  };

  private play(): void {
    if (this.disposed) return;
    this.dispose();
    this.onPlay();
  }

  /** Jump straight to today's Daily Burn (the date-seeded challenge + its own per-day board). A full
   *  reload via ?daily, so no teardown needed — the page reboots into the daily mission. */
  private playDaily(): void {
    const url = new URL(location.href);
    url.searchParams.delete('m');
    url.searchParams.set('daily', '1');
    location.assign(url.toString());
  }

  // --- DOM overlay ------------------------------------------------------------

  private buildOverlay(catalog: MissionDef[]): HTMLDivElement {
    const reduce = prefersReducedMotion();
    const profile = loadProfile();
    const cleared = missionsCleared();
    const streak = dailyStreak();

    // Transparent layer over the canvas (click-through; interactive children opt back in). Holds a
    // fallback gradient only if the context is lost.
    const root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '50',
      fontFamily: UI.font,
      color: UI.text,
      pointerEvents: 'none',
      overflow: 'hidden',
    });

    // Cinematic legibility scrim — darkens the lower-left where the hero sits and the very bottom,
    // letting the live 3D attract scene own the upper-right. Pure CSS, no extra draw cost.
    root.appendChild(
      div({
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        background:
          'linear-gradient(105deg, rgba(6,10,14,0.80) 0%, rgba(6,10,14,0.46) 32%, rgba(6,10,14,0) 60%),' +
          'linear-gradient(0deg, rgba(4,7,11,0.82) 0%, rgba(4,7,11,0) 38%)',
      }),
    );

    // Hero block — anchored LOWER-LEFT (game key-art composition), left-aligned, capped width.
    const hero = div({
      position: 'absolute',
      left: 'max(28px, env(safe-area-inset-left))',
      right: 'max(20px, env(safe-area-inset-right))',
      bottom: 'max(34px, env(safe-area-inset-bottom))',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: '14px',
      maxWidth: '620px',
      pointerEvents: 'none',
    });

    // Kicker (the essence) over the wordmark.
    const kicker = div(
      {
        fontSize: FS.label,
        letterSpacing: '0.34em',
        textTransform: 'uppercase',
        color: UI.ember,
        fontWeight: FW.heavy,
        textShadow: '0 1px 12px rgba(0,0,0,0.75)',
      },
      'Fight the wildfire',
    );

    // Ember wordmark — left-aligned (override the builder's auto-centering).
    const logo = createGridTitle('BUCKET MY FIRE', '440px');
    logo.style.margin = '0';

    // The descriptive hook (brand platform), under the wordmark.
    const hook = div(
      { fontSize: FS.md, letterSpacing: '0.01em', color: UI.text, opacity: '0.9', textShadow: '0 1px 12px rgba(0,0,0,0.8)' },
      'A bucket, a chopper, a wildfire.',
    );

    // Action cluster: the hero PLAY, today's Daily Burn (+ streak chip), and the leaderboard.
    const actions = div({ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '6px', pointerEvents: 'auto' });
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

    hero.append(kicker, logo, hook, actions);

    // Returning pilot: a quiet "welcome back" line under the actions.
    if (profile?.name) {
      hero.appendChild(
        div(
          { fontSize: FS.meta, color: UI.dim, marginTop: '2px', textShadow: '0 1px 10px rgba(0,0,0,0.7)' },
          `Welcome back, ${profile.name}${cleared > 0 ? ` · ${cleared} sortie${cleared === 1 ? '' : 's'} flown` : ''}`,
        ),
      );
    }

    root.appendChild(hero);

    // Staggered entrance (reduced-motion users get it static; GridTitle owns its ember sweep regardless).
    if (!reduce) {
      kicker.style.animation = 'bmf-title-rise 0.5s ease 0.02s both';
      logo.style.animation = 'bmf-title-rise 0.6s ease 0.08s both';
      hook.style.animation = 'bmf-title-rise 0.6s ease 0.22s both';
      actions.style.animation = 'bmf-title-rise 0.6s cubic-bezier(0.34,1.4,0.64,1) 0.34s both';
    }

    return root;
  }

  private buildPlayButton(): HTMLButtonElement {
    // Fight register: PLAY is the brand's hero action, so it burns ember, not cockpit cyan.
    const base = `0 14px 40px ${UI.ember}66, inset 0 2px 0 rgba(255,255,255,0.45)`;
    const hover = `0 18px 54px ${UI.ember}99, inset 0 2px 0 rgba(255,255,255,0.45)`;
    const b = el('button', {
      pointerEvents: 'auto',
      marginTop: '6px',
      minWidth: '236px',
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

/** Fallback backdrop painted only if the WebGL context is lost (mirrors MenuFlow's gradient). */
const MENU_GRADIENT = 'radial-gradient(120% 90% at 50% 0%, rgba(20,32,44,0.86), rgba(4,7,11,0.94))';

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
