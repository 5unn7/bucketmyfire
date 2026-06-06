/**
 * IconButton — a round, frosted touch button (the HUD stick cluster / DROP / eye / help share this
 * shape). Folds the old `theme.button()` into the kit as a real `<button>` with focus + states.
 *   variant default | warm (the DROP hero) | accent (an active/selected toggle)
 */

import { UI, FW, R, el, setBlur, prefersReducedMotion } from '../theme';
import { injectKitStyles } from './base';

export interface IconButtonOpts {
  glyph: string;
  size?: number; // px diameter, default 56
  variant?: 'default' | 'warm' | 'accent';
  title?: string;
  onClick?: () => void;
}

export interface IconButtonHandle {
  el: HTMLButtonElement;
  setActive(on: boolean): void;
  setGlyph(s: string): void;
}

export function makeIconButton(opts: IconButtonOpts): IconButtonHandle {
  injectKitStyles();
  const size = opts.size ?? 56;
  const warm = opts.variant === 'warm';
  const accent = opts.variant === 'accent';
  const ring = warm ? UI.warmStroke : accent ? UI.accentSoft : UI.strokeStrong;
  const fill = warm ? UI.warmGlass : UI.glass;
  const hot = warm ? UI.warm : UI.accent;

  const b = el(
    'button',
    {
      width: `${size}px`,
      height: `${size}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: R.round,
      background: fill,
      border: `1px solid ${ring}`,
      color: warm ? UI.warm : UI.text,
      fontFamily: UI.font,
      fontSize: `${Math.round(size * 0.42)}px`,
      fontWeight: FW.semibold,
      boxShadow: UI.shadowBtn,
      cursor: 'pointer',
      userSelect: 'none',
      touchAction: 'none',
      transition: prefersReducedMotion()
        ? 'background 0.15s ease, border-color 0.15s ease'
        : 'transform 0.12s ease, background 0.15s ease, border-color 0.15s ease',
    },
    opts.glyph,
  );
  b.type = 'button';
  b.className = 'bmf-kit';
  b.style.setProperty('--bmf-ring', ring);
  setBlur(b);
  if (opts.title) {
    b.title = opts.title;
    b.setAttribute('aria-label', opts.title);
  }

  b.addEventListener('pointerenter', () => {
    if (!prefersReducedMotion()) b.style.transform = 'translateY(-1px)';
    b.style.borderColor = hot;
  });
  b.addEventListener('pointerleave', () => {
    b.style.transform = 'none';
    b.style.borderColor = ring;
  });
  b.addEventListener('click', () => opts.onClick?.());

  return {
    el: b,
    setActive: (on) => {
      b.style.borderColor = on ? hot : ring;
      b.style.color = on ? hot : warm ? UI.warm : UI.text;
    },
    setGlyph: (s) => (b.textContent = s),
  };
}
