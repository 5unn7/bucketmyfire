/**
 * Button — the kit's keystone. ONE button that subsumes the five rival impls that used to drift
 * across the UI (`theme.button`, `chrome.primaryButton/ghostButton/featureButton`,
 * `menuShared.utilityChip`). A real `<button>` (keyboard + focus for free), with proper hover /
 * active / :focus-visible / disabled / loading states and a ≥44px touch target by default.
 *
 *   variant  primary | secondary | ghost | pill | danger
 *   register cockpit (cyan) | fight (gold-ember)   — DESIGN.md two registers
 *   size     sm | md | lg
 */

import { UI, FS, FW, R, el, prefersReducedMotion } from '../theme';
import { tone, injectKitStyles, type Register } from './base';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'pill' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOpts {
  label?: string;
  icon?: string; // leading glyph / emoji
  variant?: ButtonVariant; // default 'primary'
  register?: Register; // default 'cockpit'
  size?: ButtonSize; // default 'md'
  block?: boolean; // full-width
  title?: string; // native tooltip + aria-label fallback
  onClick?: () => void;
}

export interface ButtonHandle {
  el: HTMLButtonElement;
  setLabel(s: string): void;
  setEnabled(on: boolean): void;
  setLoading(on: boolean): void;
}

const PAD: Record<ButtonSize, string> = { sm: '8px 14px', md: '12px 20px', lg: '15px 26px' };
const MINH: Record<ButtonSize, string> = { sm: '38px', md: '44px', lg: '52px' };
const FONT: Record<ButtonSize, string> = { sm: FS.sm, md: FS.md, lg: FS.md };

export function makeButton(opts: ButtonOpts = {}): ButtonHandle {
  injectKitStyles();
  const variant = opts.variant ?? 'primary';
  const register = opts.register ?? 'cockpit';
  const size = opts.size ?? 'md';
  const t = tone(register);
  const reduce = prefersReducedMotion();

  const b = el('button', {
    display: opts.block ? 'flex' : 'inline-flex',
    width: opts.block ? '100%' : 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    boxSizing: 'border-box',
    minHeight: MINH[size],
    padding: PAD[size],
    borderRadius: variant === 'pill' ? R.pill : R.lg,
    border: '1px solid transparent',
    fontFamily: UI.font,
    fontSize: FONT[size],
    fontWeight: FW.heavy,
    letterSpacing: '0.04em',
    lineHeight: '1',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    transition: reduce
      ? 'background 0.15s ease, box-shadow 0.2s ease, color 0.15s ease, border-color 0.15s ease'
      : 'transform 0.12s ease, background 0.15s ease, box-shadow 0.2s ease, border-color 0.15s ease, color 0.15s ease',
  });
  b.type = 'button';
  b.className = 'bmf-kit';
  b.style.setProperty('--bmf-ring', t.ring);
  if (opts.title) {
    b.title = opts.title;
    if (!opts.label) b.setAttribute('aria-label', opts.title);
  }

  // base() paints the resting look; hover() the pointer-over look. Both per variant/register.
  let base: () => void;
  let hover: () => void;
  switch (variant) {
    case 'primary':
      if (register === 'fight') {
        base = () => {
          b.style.background = UI.cta;
          b.style.color = UI.ctaInk;
          b.style.boxShadow = `0 10px 30px ${UI.ctaGlow}`;
          b.style.textTransform = 'uppercase';
        };
        hover = () => {
          b.style.background = UI.ctaHi;
          b.style.boxShadow = `0 16px 40px ${UI.ctaGlow}`;
        };
      } else {
        base = () => {
          b.style.background = UI.accent;
          b.style.color = UI.ink;
          b.style.boxShadow = UI.glow;
          b.style.textTransform = 'uppercase';
        };
        hover = () => {
          b.style.background = UI.accentHi;
          b.style.boxShadow = `0 0 16px ${UI.accentSoft}`;
        };
      }
      break;
    case 'secondary':
      base = () => {
        b.style.background = t.fill;
        b.style.color = t.fg;
        b.style.borderColor = `${t.fg}66`;
      };
      hover = () => {
        b.style.background = `${t.fg}33`;
        b.style.borderColor = t.fg;
      };
      break;
    case 'pill':
      base = () => {
        b.style.background = t.fill;
        b.style.color = t.fg;
        b.style.borderColor = `${t.fg}66`;
        b.style.fontWeight = FW.bold;
      };
      hover = () => {
        b.style.background = `${t.fg}33`;
        b.style.borderColor = t.fg;
      };
      break;
    case 'danger':
      base = () => {
        b.style.background = `${UI.warn}1f`;
        b.style.color = UI.warn;
        b.style.borderColor = `${UI.warn}66`;
      };
      hover = () => {
        b.style.background = `${UI.warn}33`;
        b.style.borderColor = UI.warn;
      };
      break;
    case 'ghost':
    default:
      base = () => {
        b.style.background = 'none';
        b.style.color = UI.dim;
        b.style.borderColor = 'transparent';
      };
      hover = () => {
        b.style.color = UI.text;
      };
      break;
  }
  base();

  let iconNode: HTMLSpanElement | null = null;
  if (opts.icon) {
    iconNode = el('span', { fontSize: '1.05em', lineHeight: '1' }, opts.icon);
    b.appendChild(iconNode);
  }
  const labelNode = el('span', {}, opts.label ?? '');
  b.appendChild(labelNode);

  let enabled = true;
  let loading = false;

  b.addEventListener('pointerenter', () => {
    if (!enabled || loading) return;
    hover();
    if (!reduce) b.style.transform = 'translateY(-2px)';
  });
  b.addEventListener('pointerleave', () => {
    base();
    b.style.transform = 'none';
  });
  b.addEventListener('click', () => {
    if (enabled && !loading) opts.onClick?.();
  });

  const setEnabled = (on: boolean): void => {
    enabled = on;
    b.disabled = !on;
    if (on) b.removeAttribute('aria-disabled');
    else b.setAttribute('aria-disabled', 'true');
  };
  const setLoading = (on: boolean): void => {
    loading = on;
    b.disabled = on || !enabled;
    labelNode.style.opacity = on ? '0.7' : '1';
    if (iconNode) iconNode.style.animation = on && !reduce ? 'bmf-kit-spin 0.9s linear infinite' : '';
  };

  return {
    el: b,
    setLabel: (s) => (labelNode.textContent = s),
    setEnabled,
    setLoading,
  };
}
