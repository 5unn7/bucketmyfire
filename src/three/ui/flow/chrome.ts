/**
 * Persistent chrome for the guided pre-flight flow: the brand mark, the step-progress indicator,
 * the primary advance button, the ghost (Back / Skip) buttons, and the reduced-motion-aware screen
 * transition. All styled from the one cockpit palette (ui/theme.ts) so the wizard matches the HUD.
 */

import { UI, FS, FW, R, el, div, prefersReducedMotion } from '../theme';
import { makeButton } from '../components';

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

/**
 * The premium CENTERED picker heading (map / aircraft / mission select) — an uppercase, wide-tracked
 * title over a short gold accent rule, with an optional subtitle. The "MAP SELECT · Choose a province
 * to begin" treatment from the comps; warm gold underline keeps it on the menu register.
 */
export function selectHeading(title: string, sub?: string): HTMLDivElement {
  const wrap = div({ textAlign: 'center', margin: '0 0 20px' });
  wrap.appendChild(
    el(
      'h2',
      { margin: '0', fontSize: FS.display, fontWeight: FW.black, letterSpacing: '0.16em', textTransform: 'uppercase', color: UI.text },
      title,
    ),
  );
  wrap.appendChild(div({ width: '42px', height: '3px', borderRadius: R.pill, background: UI.menu, margin: '10px auto 0', boxShadow: UI.emberGlow }));
  if (sub) wrap.appendChild(div({ marginTop: '10px', fontSize: FS.sm, color: UI.dim, lineHeight: '1.5' }, sub));
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
      d.style.background = active ? UI.menu : i < cur ? `${UI.menu}66` : UI.track;
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

/** The flow's primary advance button — now a kit `primary` Button on the warm "fight" register
 *  (the wizard is a brand surface, DESIGN.md → two registers). Keeps the rebindable-action +
 *  show/hide handle the controller drives; the styling/states/focus ring come from the kit. */
export function primaryButton(): PrimaryButton {
  let action: () => void = () => {};
  const h = makeButton({ label: 'CONTINUE', variant: 'primary', register: 'fight', size: 'lg', onClick: () => action() });
  h.el.style.minWidth = '210px';
  return {
    el: h.el,
    setLabel: (s) => h.setLabel(s),
    setEnabled: (on) => h.setEnabled(on),
    setAction: (fn) => (action = fn),
    show: () => (h.el.style.display = ''),
    hide: () => (h.el.style.display = 'none'),
  };
}

/** A subtle text button — Back and "Skip to missions →". Kit `ghost` Button. */
export function ghostButton(label: string, onClick: () => void): HTMLButtonElement {
  return makeButton({ label, variant: 'ghost', onClick }).el;
}

/**
 * A prominent feature pill — a bordered, tinted action in the given accent. Higher-emphasis than
 * `ghostButton` so the strategic actions (the Daily Burn retention hook, the Quick-fly instant-fun
 * escape) don't read as plain text links lost in the header (#3).
 */
export function featureButton(label: string, color: string, onClick: () => void): HTMLButtonElement {
  const b = el(
    'button',
    {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: `${color}1f`,
      border: `1px solid ${color}66`,
      color,
      fontFamily: UI.font,
      fontSize: FS.sm,
      fontWeight: FW.heavy,
      letterSpacing: '0.03em',
      borderRadius: R.pill,
      padding: '9px 15px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'background 0.14s ease, border-color 0.14s ease, transform 0.12s ease',
    },
    label,
  );
  b.type = 'button';
  b.addEventListener('pointerenter', () => {
    b.style.background = `${color}33`;
    b.style.borderColor = color;
    b.style.transform = 'translateY(-1px)';
  });
  b.addEventListener('pointerleave', () => {
    b.style.background = `${color}1f`;
    b.style.borderColor = `${color}66`;
    b.style.transform = 'none';
  });
  b.addEventListener('click', onClick);
  return b;
}

/** Swap `host`'s content to `next`, with a gentle rise-in unless reduced-motion is set. */
export function fadeSwap(host: HTMLElement, next: HTMLElement): void {
  injectFlowStyles();
  if (!prefersReducedMotion()) next.style.animation = 'bmf-flow-in 0.32s ease both';
  host.replaceChildren(next);
}
