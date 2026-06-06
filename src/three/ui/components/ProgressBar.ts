/**
 * ProgressBar — a thin labelled fill track (campaign %, any 0..1 progress). Folds the inline track
 * built in `menuShared.pilotRecord`. `set(frac, label?)` drives it.
 */

import { UI, FS, FW, R, div } from '../theme';
import { tone, type Register } from './base';

export interface ProgressHandle {
  el: HTMLDivElement;
  set(frac: number, label?: string): void;
}

export function makeProgress(opts: { label?: string; register?: Register } = {}): ProgressHandle {
  const t = tone(opts.register ?? 'cockpit');
  const root = div({ display: 'flex', flexDirection: 'column', gap: '6px' });
  const track = div({ height: '5px', borderRadius: R.pill, background: UI.track, overflow: 'hidden' });
  const fill = div({ height: '100%', width: '0%', background: t.fg, borderRadius: R.pill, transition: 'width 0.3s ease' });
  track.appendChild(fill);
  root.appendChild(track);
  const cap = div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1.5px', textTransform: 'uppercase', color: UI.faint }, opts.label ?? '');
  if (opts.label !== undefined) root.appendChild(cap);

  return {
    el: root,
    set: (frac, label) => {
      fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      if (label !== undefined) cap.textContent = label;
    },
  };
}
