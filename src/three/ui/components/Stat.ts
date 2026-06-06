/**
 * Stat — a label + value pair (the pilot-record tiles, score readouts). Folds
 * `menuShared.statTile`. `value-top` reads as a big number with a caption under it; `label-top`
 * reads as a labelled readout.
 */

import { UI, FS, FW, div } from '../theme';

export interface StatOpts {
  label: string;
  value: string;
  layout?: 'value-top' | 'label-top'; // default value-top
  align?: 'left' | 'center';
}

export function makeStat(opts: StatOpts): HTMLDivElement {
  const align = opts.align ?? 'left';
  const wrap = div({ display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', textAlign: align });
  const value = div({ fontSize: FS.title, fontWeight: FW.heavy, color: UI.text, lineHeight: '1.1' }, opts.value);
  const label = div(
    { fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1.5px', textTransform: 'uppercase', color: UI.faint },
    opts.label.toUpperCase(),
  );
  if ((opts.layout ?? 'value-top') === 'label-top') {
    value.style.marginTop = '3px';
    wrap.append(label, value);
  } else {
    label.style.marginTop = '3px';
    wrap.append(value, label);
  }
  return wrap;
}
