/**
 * Generic 3D-tilt card shell — the mouse-tilt + selection-ring behaviour shared by the helicopter
 * cards (HeliCard3D), the map cards (MapCard3D) and the mission cards (ui/flow/ScreenMission). It
 * is the platform-native port of the source React component's framer-motion tilt: a `pointermove`
 * handler writes `rotateX/rotateY` onto a `transform-style: preserve-3d` layer, with an eased
 * spring-back on leave. Tilt is mouse-only and skipped under `prefers-reduced-motion`.
 *
 * The caller appends its own cover/overlay/content to the returned `tilt` layer (each child can
 * `translateZ(...)` to parallax over the cover). `setSelected()` toggles the cyan ring; an optional
 * `onSelectedChange` lets the caller restyle its own content (e.g. a SELECT → SELECTED button).
 *
 * GOTCHA: the tilt layer is deliberately NOT `overflow:hidden` — that flattens `preserve-3d`
 * children. Rounded corners come from each layer's own `border-radius` clipping its background.
 */

import { UI, R, div, prefersReducedMotion } from './theme';

export interface TiltCardOptions {
  /** Fills its parent by default; pass a fixed width for a carousel slot. */
  width?: string;
  /** Portrait card shape by default. */
  aspectRatio?: string;
  minHeight?: string;
  /** Gated content → dimmed + not interactive. */
  usable: boolean;
  /** Start lit (cyan ring). */
  selected: boolean;
  /** Max tilt in degrees (source component used ±10.5°). */
  maxTilt?: number;
  ariaLabel?: string;
  /** Click / Enter / Space when usable. */
  onSelect?: () => void;
  /** Called after the ring repaints on setSelected — restyle caller content here. */
  onSelectedChange?: (on: boolean) => void;
}

export interface TiltCardHandle {
  /** Mount this — it owns the 3D perspective + pointer events. */
  root: HTMLDivElement;
  /** The rotating layer (preserve-3d). Append cover/overlay/content here. */
  tilt: HTMLDivElement;
  /** Light/unlight the cyan selection ring. */
  setSelected: (on: boolean) => void;
}

export function tiltCard(opts: TiltCardOptions): TiltCardHandle {
  const reduce = prefersReducedMotion();
  const MAX_TILT = opts.maxTilt ?? 10.5;
  const interactive = opts.usable && !!opts.onSelect;

  const root = div({
    position: 'relative',
    width: opts.width ?? '100%',
    aspectRatio: opts.aspectRatio ?? '5 / 6',
    minHeight: opts.minHeight ?? '300px',
    perspective: '1000px',
    cursor: interactive ? 'pointer' : 'default',
    userSelect: 'none',
    opacity: opts.usable ? '1' : '0.62',
    filter: opts.usable ? 'none' : 'saturate(0.6)',
  });
  if (interactive) root.setAttribute('role', 'button');
  if (opts.ariaLabel) root.setAttribute('aria-label', opts.ariaLabel);

  const tilt = div({
    position: 'absolute',
    inset: '0',
    borderRadius: R.xl,
    border: `1px solid ${UI.stroke}`,
    background: UI.cardGlass,
    boxShadow: UI.shadowCard,
    transformStyle: 'preserve-3d',
    transition: 'transform 0.5s cubic-bezier(0.03,0.98,0.52,0.99), border-color 0.18s ease, box-shadow 0.18s ease',
    willChange: 'transform',
  });
  tilt.style.backdropFilter = UI.blur;
  tilt.style.setProperty('-webkit-backdrop-filter', UI.blur);
  root.appendChild(tilt);

  let isSel = opts.selected;
  let hover = false;
  const paintRing = (): void => {
    tilt.style.borderColor = isSel ? UI.accent : hover && opts.usable ? `${UI.accent}66` : UI.stroke;
    tilt.style.boxShadow = isSel ? `0 0 0 2px ${UI.accent}88, ${UI.shadowCard}` : UI.shadowCard;
  };
  paintRing();

  // --- 3D tilt (mouse only; skipped under reduced-motion) ---
  let rect: DOMRect | null = null;
  if (!reduce) {
    root.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') rect = root.getBoundingClientRect();
    });
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (!rect) rect = root.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      tilt.style.transition = 'transform 0.08s ease-out, border-color 0.18s ease, box-shadow 0.18s ease';
      tilt.style.transform = `rotateX(${(-py * MAX_TILT * 2).toFixed(2)}deg) rotateY(${(px * MAX_TILT * 2).toFixed(2)}deg)`;
    });
  }
  root.addEventListener('pointerenter', () => {
    hover = true;
    paintRing();
  });
  root.addEventListener('pointerleave', () => {
    hover = false;
    rect = null;
    tilt.style.transition = 'transform 0.5s cubic-bezier(0.03,0.98,0.52,0.99), border-color 0.18s ease, box-shadow 0.18s ease';
    tilt.style.transform = 'rotateX(0deg) rotateY(0deg)';
    paintRing();
  });

  if (interactive) {
    const act = opts.onSelect as () => void;
    root.addEventListener('click', () => act());
    root.tabIndex = 0;
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        act();
      }
    });
  }

  return {
    root,
    tilt,
    setSelected: (on: boolean) => {
      isSel = on;
      paintRing();
      opts.onSelectedChange?.(on);
    },
  };
}
