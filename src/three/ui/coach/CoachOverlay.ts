/**
 * CoachOverlay — the visible face of the interactive first-flight tutorial. A compact frosted card
 * pinned top-centre (below the instrument spine) that shows the current step's one-line instruction,
 * a step counter, an optional fill gauge, and a "Skip" button. It renders what `CoachDirector` decides
 * — no logic of its own beyond a tiny id-diff so it only rebuilds text when the step changes (O(1)/frame).
 *
 * Cockpit register: cyan-dominant, token-only colour/blur (no raw literals — it lives under
 * `src/three/ui/**`, which the `verify:ui` ratchet guards). Lifecycle mirrors `hud/engineStart.ts`:
 * the HUD owns one, `show({onSkip})`s it when the coach goes live, `set(prompt)`s it each frame,
 * `complete()`s it for the sign-off, and `hide()`/`dispose()`s it on the in-place mission switch.
 * The card is click-through except the Skip button, so it never steals flight input.
 */

import { UI, FS, FW, R, el, setBlur, clamp01, prefersReducedMotion } from '../theme';
import { COACH_COMPLETE, type CoachPrompt } from './CoachDirector';

function toneColor(tone: CoachPrompt['tone']): string {
  return tone === 'water' ? UI.water : tone === 'fire' ? UI.fire : UI.accent;
}

export class CoachOverlay {
  private readonly root: HTMLElement;
  private lastId = '';
  private hideTimer = 0;
  private elt?: {
    wrap: HTMLDivElement;
    card: HTMLDivElement;
    dot: HTMLDivElement;
    title: HTMLDivElement;
    counter: HTMLDivElement;
    body: HTMLDivElement;
    bar: HTMLDivElement;
    fill: HTMLDivElement;
    skip: HTMLButtonElement;
  };

  constructor(root: HTMLElement) {
    this.root = root;
  }

  get isShown(): boolean {
    return !!this.elt;
  }

  /** Build + mount the coach card. `onSkip` fires when the pilot taps "Skip" (host marks the tutorial
   *  done and hides). Idempotent — a second call while shown is a no-op. */
  show(opts: { onSkip: () => void }): void {
    if (this.elt) return;
    const reduce = prefersReducedMotion();

    // Click-through wrapper top-centre, lowered clear of the instrument spine. Only the Skip button
    // opts back into pointer events, so the card never intercepts the flight controls beneath it.
    const wrap = el('div', {
      position: 'fixed',
      top: 'calc(var(--bmf-safe-t) + var(--bmf-edge) + 64px)',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(360px, calc(100vw - 32px))',
      zIndex: '25',
      pointerEvents: 'none',
      transition: reduce ? 'opacity 0.2s ease' : 'opacity 0.28s ease, transform 0.28s ease',
    });

    const card = el('div', {
      display: 'flex',
      flexDirection: 'column',
      gap: '7px',
      padding: '11px 14px 12px',
      borderRadius: R.lg,
      background: UI.cardGlass,
      border: `1px solid ${UI.stroke}`,
      boxShadow: UI.shadowCard,
    });
    setBlur(card);

    // Header: tone dot + step title (left), step counter (right).
    const head = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    const dot = el('div', { width: '9px', height: '9px', borderRadius: R.round, background: UI.accent, flex: 'none', boxShadow: UI.glow });
    const title = el('div', { fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '0.16em', textTransform: 'uppercase', color: UI.accent }, '');
    const counter = el('div', { marginLeft: 'auto', fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '0.08em', color: UI.dim }, '');
    head.append(dot, title, counter);

    const body = el('div', { fontSize: FS.md, fontWeight: FW.medium, lineHeight: '1.35', color: UI.text }, '');

    // Optional fill gauge (only the "fill" step sets a progress value).
    const bar = el('div', { display: 'none', height: '4px', borderRadius: R.pill, background: UI.track, overflow: 'hidden' });
    const fill = el('div', { width: '0%', height: '100%', borderRadius: R.pill, background: UI.accent, transition: reduce ? 'none' : 'width 0.18s ease' });
    bar.append(fill);

    const skip = el(
      'button',
      {
        alignSelf: 'flex-end',
        marginTop: '1px',
        padding: '4px 6px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: UI.font,
        fontSize: FS.meta,
        fontWeight: FW.semibold,
        letterSpacing: '0.04em',
        color: UI.dim,
        pointerEvents: 'auto',
        transition: 'color 0.15s ease',
      },
      'Skip tutorial ›',
    );
    skip.type = 'button';
    skip.addEventListener('pointerenter', () => (skip.style.color = UI.text));
    skip.addEventListener('pointerleave', () => (skip.style.color = UI.dim));
    skip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      opts.onSkip();
    });

    card.append(head, body, bar, skip);
    wrap.append(card);

    if (!reduce) {
      wrap.style.opacity = '0';
      wrap.style.transform = 'translateX(-50%) translateY(-8px)';
    }
    this.root.appendChild(wrap);
    // Next frame: settle into place (entrance).
    requestAnimationFrame(() => {
      wrap.style.opacity = '1';
      wrap.style.transform = 'translateX(-50%)';
    });

    this.lastId = '';
    this.elt = { wrap, card, dot, title, counter, body, bar, fill, skip };
  }

  /** Render the live step. Rebuilds the text only when the step id changes; the gauge + done-tick
   *  update every frame (both cheap). */
  set(prompt: CoachPrompt): void {
    const e = this.elt;
    if (!e) return;
    const col = toneColor(prompt.tone);

    if (prompt.id !== this.lastId) {
      this.lastId = prompt.id;
      e.title.textContent = prompt.title;
      e.title.style.color = col;
      e.body.textContent = prompt.body;
      e.counter.textContent = `${prompt.index} / ${prompt.count}`;
      e.fill.style.background = col;
    }

    if (prompt.progress === null) {
      e.bar.style.display = 'none';
    } else {
      e.bar.style.display = 'block';
      e.fill.style.width = `${Math.round(clamp01(prompt.progress) * 100)}%`;
    }

    // The dot goes green the instant the step's move is satisfied (the "you did it" tick).
    e.dot.style.background = prompt.done ? UI.ok : col;
    e.dot.style.boxShadow = prompt.done ? `0 0 10px ${UI.ok}` : UI.glow;
  }

  /** Swap to the completion sign-off, then fade out. Game calls this once when the director completes. */
  complete(): void {
    const e = this.elt;
    if (!e) {
      return;
    }
    e.dot.style.background = UI.ok;
    e.dot.style.boxShadow = `0 0 10px ${UI.ok}`;
    e.title.textContent = 'Cleared';
    e.title.style.color = UI.ok;
    e.counter.textContent = '';
    e.body.textContent = COACH_COMPLETE;
    e.bar.style.display = 'none';
    e.skip.style.display = 'none';
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), 2600);
  }

  /** Fade out + remove. Idempotent; doubles as the dispose path for an in-place mission switch. */
  hide(): void {
    const e = this.elt;
    if (!e) return;
    window.clearTimeout(this.hideTimer);
    this.elt = undefined;
    e.wrap.style.opacity = '0';
    e.wrap.style.transform = 'translateX(-50%) translateY(-8px)';
    window.setTimeout(() => e.wrap.remove(), 300);
  }

  dispose(): void {
    this.hide();
  }
}
