/**
 * Persistent chrome for the guided pre-flight flow: the brand mark, the step-progress indicator,
 * the primary advance button, the ghost (Back / Skip) buttons, and the reduced-motion-aware screen
 * transition. All styled from the one cockpit palette (ui/theme.ts) so the wizard matches the HUD.
 */

import { UI, FS, FW, R, el, div, prefersReducedMotion } from '../theme';

let flowStylesInjected = false;
function injectFlowStyles(): void {
  if (flowStylesInjected) return;
  flowStylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
  @keyframes bmf-flow-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(tag);
}

/** A screen heading — a bold title with an optional one-line subtitle (Screens 2–4). */
export function screenHeading(title: string, sub?: string): HTMLDivElement {
  const wrap = div({ margin: '0 0 18px' });
  wrap.appendChild(el('h2', { margin: '0', fontSize: FS.hero, fontWeight: FW.heavy, letterSpacing: '0.01em', color: UI.text }, title));
  if (sub) wrap.appendChild(div({ marginTop: '6px', fontSize: FS.sm, color: UI.dim, lineHeight: '1.5' }, sub));
  return wrap;
}

/** The small "BUCKET MY FIRE" wordmark for the top strip (the big ember grid logo lives on Screen 1). */
export function brandMark(): HTMLDivElement {
  const w = div({ display: 'inline-flex', alignItems: 'baseline', fontSize: FS.body, fontWeight: FW.heavy, letterSpacing: '0.18em', userSelect: 'none' });
  w.appendChild(el('span', { color: UI.text }, 'BUCKET MY '));
  w.appendChild(el('span', { color: UI.fire }, 'FIRE'));
  return w;
}

export interface StepDots {
  el: HTMLDivElement;
  set(current: number): void;
}

/** A row of `total` progress bars; the current step widens to an accent pill, cleared steps stay accent. */
export function stepDots(total: number): StepDots {
  const row = div({ display: 'flex', alignItems: 'center', gap: '7px' });
  const dots: HTMLDivElement[] = [];
  for (let i = 0; i < total; i++) {
    const d = div({ height: '6px', width: '10px', borderRadius: R.pill, background: UI.track, transition: 'width 0.25s ease, background 0.25s ease' });
    dots.push(d);
    row.appendChild(d);
  }
  const set = (cur: number): void => {
    dots.forEach((d, i) => {
      const active = i === cur;
      d.style.width = active ? '26px' : '10px';
      d.style.background = active ? UI.accent : i < cur ? `${UI.accent}66` : UI.track;
    });
  };
  set(0);
  return { el: row, set };
}

export interface PrimaryButton {
  el: HTMLButtonElement;
  setLabel(s: string): void;
  setEnabled(on: boolean): void;
  setAction(fn: () => void): void;
  show(): void;
  hide(): void;
}

/** The flow's primary advance button — the cyan gradient action shared with onboarding. */
export function primaryButton(): PrimaryButton {
  let action: () => void = () => {};
  const b = el(
    'button',
    {
      minWidth: '210px',
      padding: '15px 26px',
      borderRadius: R.lg,
      border: 'none',
      fontFamily: UI.font,
      fontSize: FS.md,
      fontWeight: FW.heavy,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      cursor: 'pointer',
      color: '#04181d',
      background: `linear-gradient(180deg, #8df0ff, ${UI.accent})`,
      boxShadow: `0 10px 30px ${UI.accent}40`,
      transition: 'transform 0.12s ease, box-shadow 0.2s ease, opacity 0.2s ease, filter 0.2s ease',
    },
    'CONTINUE',
  );
  b.type = 'button';
  b.addEventListener('pointerenter', () => {
    if (!b.disabled) {
      b.style.transform = 'translateY(-2px)';
      b.style.boxShadow = `0 14px 38px ${UI.accent}55`;
    }
  });
  b.addEventListener('pointerleave', () => {
    b.style.transform = 'none';
    b.style.boxShadow = `0 10px 30px ${UI.accent}40`;
  });
  b.addEventListener('click', () => {
    if (!b.disabled) action();
  });
  return {
    el: b,
    setLabel: (s) => (b.textContent = s),
    setEnabled: (on) => {
      b.disabled = !on;
      b.style.opacity = on ? '1' : '0.4';
      b.style.cursor = on ? 'pointer' : 'not-allowed';
      b.style.filter = on ? 'none' : 'grayscale(0.4)';
    },
    setAction: (fn) => (action = fn),
    show: () => (b.style.display = ''),
    hide: () => (b.style.display = 'none'),
  };
}

/** A subtle text button — Back and "Skip to missions →". */
export function ghostButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = el(
    'button',
    {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: UI.dim,
      fontFamily: UI.font,
      fontSize: FS.md,
      fontWeight: FW.semibold,
      padding: '10px 6px',
      transition: 'color 0.14s ease',
    },
    label,
  );
  b.type = 'button';
  b.addEventListener('pointerenter', () => (b.style.color = UI.text));
  b.addEventListener('pointerleave', () => (b.style.color = UI.dim));
  b.addEventListener('click', onClick);
  return b;
}

/** Swap `host`'s content to `next`, with a gentle rise-in unless reduced-motion is set. */
export function fadeSwap(host: HTMLElement, next: HTMLElement): void {
  injectFlowStyles();
  if (!prefersReducedMotion()) next.style.animation = 'bmf-flow-in 0.32s ease both';
  host.replaceChildren(next);
}
