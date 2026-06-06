/**
 * Tabs — a pill segmented control (the leaderboard career / mission switch). Real `<button>`s with
 * focus rings; calls back with the selected index. Register-aware accent.
 */

import { UI, FS, FW, R, el, div, prefersReducedMotion } from '../theme';
import { tone, injectKitStyles, type Register } from './base';

export interface TabsHandle {
  el: HTMLDivElement;
  select(index: number): void;
}

export function makeTabs(labels: string[], onChange: (index: number) => void, register: Register = 'cockpit'): TabsHandle {
  injectKitStyles();
  const t = tone(register);
  const reduce = prefersReducedMotion();
  const row = div({ display: 'inline-flex', gap: '4px', padding: '4px', background: UI.field, borderRadius: R.pill });
  const btns: HTMLButtonElement[] = [];
  let cur = 0;

  const paint = (): void => {
    btns.forEach((b, i) => {
      const on = i === cur;
      b.style.background = on ? t.fill : 'transparent';
      b.style.color = on ? t.fg : UI.dim;
      b.style.fontWeight = on ? FW.heavy : FW.semibold;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  };

  labels.forEach((label, i) => {
    const b = el(
      'button',
      {
        border: 'none',
        borderRadius: R.pill,
        padding: '7px 16px',
        cursor: 'pointer',
        fontFamily: UI.font,
        fontSize: FS.sm,
        background: 'transparent',
        color: UI.dim,
        transition: reduce ? 'none' : 'background 0.15s ease, color 0.15s ease',
      },
      label,
    );
    b.type = 'button';
    b.className = 'bmf-kit';
    b.setAttribute('role', 'tab');
    b.style.setProperty('--bmf-ring', t.ring);
    b.addEventListener('click', () => {
      if (cur === i) return;
      cur = i;
      paint();
      onChange(i);
    });
    btns.push(b);
    row.appendChild(b);
  });
  row.setAttribute('role', 'tablist');
  paint();

  return {
    el: row,
    select: (i) => {
      cur = i;
      paint();
    },
  };
}
