/**
 * Field — a labelled text input with an optional leading icon, a hint/error message line, and a
 * register-aware focus ring. Folds `ScreenIdentity`'s hand-rolled `field()` + `flowLabel()` +
 * inline validation node so any future form gets the same treatment.
 */

import { UI, FS, FW, R, el, div, setBlur } from '../theme';
import type { Register } from './base';

export interface FieldOpts {
  label?: string;
  optional?: boolean; // appends "— optional" to the label
  icon?: string; // leading glyph / emoji
  type?: string; // input type, default 'text'
  placeholder?: string;
  value?: string;
  maxLength?: number;
  hint?: string; // resting helper text under the field
  register?: Register; // focus-ring accent family, default cockpit
}

export interface FieldHandle {
  el: HTMLDivElement;
  input: HTMLInputElement;
  value(): string;
  setError(msg: string): void;
  setHint(msg: string): void;
  clearMsg(): void;
  focus(): void;
}

export function makeField(opts: FieldOpts = {}): FieldHandle {
  const accent = (opts.register ?? 'cockpit') === 'fight' ? UI.menu : UI.accent;
  const root = div({ display: 'flex', flexDirection: 'column' });

  if (opts.label) {
    const lab = div(
      { fontSize: FS.label, letterSpacing: '0.18em', textTransform: 'uppercase', color: accent, opacity: '0.9', fontWeight: FW.semibold, margin: '0 2px 10px' },
      opts.label,
    );
    if (opts.optional) lab.appendChild(el('span', { color: UI.dim, fontWeight: FW.medium, textTransform: 'none', letterSpacing: '0' }, ' — optional'));
    root.appendChild(lab);
  }

  const wrap = div({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: UI.field,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.lg,
    padding: opts.icon ? '4px 14px 4px 16px' : '4px 14px',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  });
  setBlur(wrap);
  if (opts.icon) wrap.appendChild(el('span', { fontSize: FS.title, opacity: '0.8' }, opts.icon));

  const input = document.createElement('input');
  input.type = opts.type ?? 'text';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.value) input.value = opts.value;
  if (opts.maxLength) input.maxLength = opts.maxLength;
  input.autocomplete = 'off';
  input.spellcheck = false;
  Object.assign(input.style, {
    flex: '1',
    minWidth: '0',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#fff',
    fontSize: FS.xl,
    fontWeight: FW.semibold,
    padding: '12px 0',
    fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);
  input.addEventListener('focus', () => {
    wrap.style.borderColor = `${accent}88`;
    wrap.style.boxShadow = `0 0 0 3px ${accent}1f`;
  });
  input.addEventListener('blur', () => {
    wrap.style.borderColor = UI.stroke;
    wrap.style.boxShadow = 'none';
  });
  wrap.appendChild(input);
  root.appendChild(wrap);

  const msg = div({ fontSize: FS.meta, fontWeight: FW.semibold, minHeight: '16px', margin: '8px 2px 0', color: UI.dim }, opts.hint ?? '');
  root.appendChild(msg);

  return {
    el: root,
    input,
    value: () => input.value,
    setError: (m) => {
      msg.textContent = m;
      msg.style.color = UI.warm;
    },
    setHint: (m) => {
      msg.textContent = m;
      msg.style.color = UI.dim;
    },
    clearMsg: () => {
      msg.textContent = '';
    },
    focus: () => input.focus(),
  };
}
