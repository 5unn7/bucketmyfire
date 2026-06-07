/**
 * Button — the kit's keystone and THE one button of record. A real `<button>` that emits the canonical
 * `.btn` classes (styled once, globally, in `components/base.ts` injectKitStyles — the SAME classes the
 * string-markup screens use), so imperative AND template-authored UI share a single button source.
 * Keyboard + focus for free; proper hover / active / :focus-visible / disabled / loading / locked states;
 * a ≥44px touch target by default.
 *
 *   variant  primary | secondary | ghost | danger     (no round "pill" — rugged technical radius)
 *   register cockpit (cyan instrument) | fight (gold-ember brand)   — DESIGN.md two registers
 *   size     sm | md | lg
 */

import { tone, injectKitStyles, type Register } from './base';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonOpts {
  label?: string;
  icon?: string; // leading glyph / emoji
  variant?: ButtonVariant; // default 'primary'
  register?: Register; // default 'cockpit'
  size?: ButtonSize; // default 'md'
  block?: boolean; // full-width
  locked?: boolean; // render a non-interactive "locked" affordance (gated content)
  title?: string; // native tooltip + aria-label fallback
  onClick?: () => void;
}

export interface ButtonHandle {
  el: HTMLButtonElement;
  setLabel(s: string): void;
  setEnabled(on: boolean): void;
  setLoading(on: boolean): void;
  setLocked(on: boolean): void;
}

export function makeButton(opts: ButtonOpts = {}): ButtonHandle {
  injectKitStyles();
  const variant = opts.variant ?? 'primary';
  const register = opts.register ?? 'cockpit';
  const size = opts.size ?? 'md';

  const b = document.createElement('button');
  b.type = 'button';
  // The canonical classes — all styling lives in base.ts. `cockpit` is the cyan modifier (fight is the
  // warm default); `md` is the base size (no class). `bmf-kit` carries the shared focus-ring/keyframes.
  const cls = ['bmf-kit', 'btn', variant];
  if (register === 'cockpit') cls.push('cockpit');
  if (size !== 'md') cls.push(size);
  if (opts.block) cls.push('block');
  if (opts.locked) cls.push('locked');
  b.className = cls.join(' ');
  b.style.setProperty('--bmf-ring', tone(register).ring);

  if (opts.title) {
    b.title = opts.title;
    if (!opts.label) b.setAttribute('aria-label', opts.title);
  }

  let iconNode: HTMLSpanElement | null = null;
  if (opts.icon) {
    iconNode = document.createElement('span');
    iconNode.textContent = opts.icon;
    iconNode.style.lineHeight = '1';
    b.appendChild(iconNode);
  }
  const labelNode = document.createElement('span');
  labelNode.textContent = opts.label ?? '';
  b.appendChild(labelNode);

  let enabled = !opts.locked;
  let loading = false;
  if (opts.locked) b.disabled = true;

  b.addEventListener('click', () => {
    if (enabled && !loading && !b.classList.contains('locked')) opts.onClick?.();
  });

  const setEnabled = (on: boolean): void => {
    enabled = on;
    b.disabled = !on || loading;
    if (on) b.removeAttribute('aria-disabled');
    else b.setAttribute('aria-disabled', 'true');
  };
  const setLoading = (on: boolean): void => {
    loading = on;
    b.classList.toggle('is-loading', on);
    b.disabled = on || !enabled;
    labelNode.style.opacity = on ? '0.7' : '1';
    if (iconNode) iconNode.style.animation = on ? 'bmf-kit-spin 0.9s linear infinite' : '';
  };
  const setLocked = (on: boolean): void => {
    b.classList.toggle('locked', on);
    b.disabled = on || !enabled;
  };

  return {
    el: b,
    setLabel: (s) => (labelNode.textContent = s),
    setEnabled,
    setLoading,
    setLocked,
  };
}
