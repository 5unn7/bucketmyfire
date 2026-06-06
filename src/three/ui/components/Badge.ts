/**
 * Badge / Pill / grade chip / star pips — the small status markers. Folds the SOON/NEXT/LOCKED
 * pills scattered through the menus, the grade chip (painted from the shared `GRADE` map), and
 * `menuShared.starPips`. Purely presentational, no interactivity.
 */

import { UI, FS, FW, R, GRADE, div } from '../theme';

export type BadgeTone = 'accent' | 'fight' | 'warn' | 'ok' | 'neutral' | 'fire';

const TONES: Record<BadgeTone, { fg: string; fill: string }> = {
  accent: { fg: UI.accent, fill: UI.accentFill },
  fight: { fg: UI.menu, fill: UI.menuFill },
  warn: { fg: UI.warn, fill: `${UI.warn}1f` },
  ok: { fg: UI.ok, fill: `${UI.ok}1f` },
  neutral: { fg: UI.faint, fill: UI.track },
  fire: { fg: UI.fire, fill: `${UI.fire}1f` }, // the Daily Burn streak chip
};

/** A small uppercase status pill ("SOON", "NEXT", "LOCKED"). */
export function makeBadge(label: string, badgeTone: BadgeTone = 'accent'): HTMLDivElement {
  const t = TONES[badgeTone];
  return div(
    {
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: FS.tag,
      fontWeight: FW.heavy,
      letterSpacing: '1.5px',
      textTransform: 'uppercase',
      color: t.fg,
      background: t.fill,
      border: `1px solid ${t.fg}55`,
      borderRadius: R.pill,
      padding: '2px 8px',
      lineHeight: '1.4',
    },
    label,
  );
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
