/**
 * Badge / Pill / grade chip / star pips — the small status markers. Folds the SOON/NEXT/LOCKED
 * pills scattered through the menus, the grade chip (painted from the shared `GRADE` map), and
 * `menuShared.starPips`. Purely presentational, no interactivity.
 */

import { UI, FS, FW, R, GRADE, div } from '../theme';
import { injectKitStyles } from './base';

export type BadgeTone = 'accent' | 'fight' | 'warn' | 'ok' | 'neutral' | 'fire';

// Tone → canonical `.badge` modifier class. 'fight' is the default look (no modifier rule needed).
const TONE_CLASS: Record<BadgeTone, string> = {
  accent: 'accent',
  fight: 'fight',
  warn: 'warn',
  ok: 'ok',
  neutral: 'neutral',
  fire: 'fire',
};

/**
 * A small uppercase status pill ("SOON", "NEXT", "LOCKED"). Emits the canonical `.badge` class —
 * THE one status pill of record (styled once in base.ts, shared with the string-markup screens), so
 * imperative and template UI render an identical, squared, uniform-height badge.
 */
export function makeBadge(label: string, badgeTone: BadgeTone = 'accent'): HTMLDivElement {
  injectKitStyles();
  const e = document.createElement('div');
  e.className = `badge ${TONE_CLASS[badgeTone]}`;
  e.textContent = label;
  return e;
}

/** A grade chip ('S'..'D') painted from the shared GRADE map. */
export function makeGradeChip(grade: string): HTMLDivElement {
  const c = GRADE[grade] ?? UI.dim;
  return div(
    {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px',
      borderRadius: R.sm,
      fontSize: FS.title,
      fontWeight: FW.black,
      color: c,
      background: `${c}1f`,
      border: `1px solid ${c}66`,
    },
    grade,
  );
}

/** Three star pips (1..3 filled) — a cleared mission's best-run medal. */
export function makeStars(filled: number): HTMLDivElement {
  const row = div({ display: 'inline-flex', gap: '1px', fontSize: FS.sm, lineHeight: '1' });
  row.title = `${filled} / 3 stars`;
  for (let i = 1; i <= 3; i++) row.appendChild(div({ color: i <= filled ? UI.warm : UI.faint }, i <= filled ? '★' : '☆'));
  return row;
}
