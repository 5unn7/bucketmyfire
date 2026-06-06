/**
 * ListRow — a leading / primary+secondary / trailing row (leaderboard entries, lists). `mine`
 * tints it as "this one is you". Folds the hand-built leaderboard rows. The single sanctioned
 * place a list row's layout lives, so screens stop re-rolling it.
 */

import { UI, FS, FW, R, div } from '../theme';

export interface ListRowOpts {
  leading?: HTMLElement | string; // rank number / avatar / icon
  primary: string;
  secondary?: string;
  trailing?: HTMLElement | string; // value / medal
  mine?: boolean; // accent-tinted "this is you"
}

export function makeListRow(opts: ListRowOpts): HTMLDivElement {
  const row = div({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: R.md,
    background: opts.mine ? UI.rowMine : 'transparent',
    borderBottom: `1px solid ${UI.hair}`,
  });

  if (opts.leading !== undefined) {
    const lead =
      typeof opts.leading === 'string'
        ? div({ fontSize: FS.lg, fontWeight: FW.heavy, color: UI.dim, minWidth: '24px', textAlign: 'center' }, opts.leading)
        : opts.leading;
    row.appendChild(lead);
  }

  const mid = div({ display: 'flex', flexDirection: 'column', gap: '2px', flex: '1', minWidth: '0' });
  mid.appendChild(
    div({ fontSize: FS.lg, fontWeight: FW.bold, color: UI.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, opts.primary),
  );
  if (opts.secondary) mid.appendChild(div({ fontSize: FS.meta, color: UI.dim }, opts.secondary));
  row.appendChild(mid);

  if (opts.trailing !== undefined) {
    const tr =
      typeof opts.trailing === 'string' ? div({ fontSize: FS.title, fontWeight: FW.heavy, color: UI.text }, opts.trailing) : opts.trailing;
    row.appendChild(tr);
  }

  return row;
}
