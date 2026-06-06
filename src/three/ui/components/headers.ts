/**
 * Headers — the three heading treatments the UI uses, in one module. Folds
 * `chrome.screenHeading` / `chrome.selectHeading` and `menuShared.stepHeader`.
 *   sectionHeading  left-aligned bold title + subtitle (flow screens)
 *   selectHeading   centred uppercase title over an accent rule (pickers; fight register by default)
 *   stepHeading     numbered step label ("① CALLSIGN")
 */

import { UI, FS, FW, R, el, div } from '../theme';
import { tone, type Register } from './base';

export function sectionHeading(title: string, sub?: string): HTMLDivElement {
  const wrap = div({ margin: '0 0 18px' });
  wrap.appendChild(el('h2', { margin: '0', fontSize: FS.hero, fontWeight: FW.heavy, letterSpacing: '0.01em', color: UI.text }, title));
  if (sub) wrap.appendChild(div({ marginTop: '6px', fontSize: FS.sm, color: UI.dim, lineHeight: '1.5' }, sub));
  return wrap;
}

export function selectHeading(title: string, sub?: string, register: Register = 'fight'): HTMLDivElement {
  const t = tone(register);
  const wrap = div({ textAlign: 'center', margin: '0 0 20px' });
  wrap.appendChild(
    el('h2', { margin: '0', fontSize: FS.display, fontWeight: FW.black, letterSpacing: '0.16em', textTransform: 'uppercase', color: UI.text }, title),
  );
  wrap.appendChild(div({ width: '42px', height: '3px', borderRadius: R.pill, background: t.fg, margin: '10px auto 0', boxShadow: t.glow }));
  if (sub) wrap.appendChild(div({ marginTop: '10px', fontSize: FS.sm, color: UI.dim, lineHeight: '1.5' }, sub));
  return wrap;
}

export function stepHeading(n: number | string, label: string, register: Register = 'cockpit'): HTMLDivElement {
  const t = tone(register);
  const row = div({ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 13px' });
  row.appendChild(
    div(
      {
        width: '22px',
        height: '22px',
        flex: 'none',
        borderRadius: R.round,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: FS.meta,
        fontWeight: FW.heavy,
        color: t.fg,
        background: t.fill,
        border: `1px solid ${t.fg}55`,
      },
      String(n),
    ),
  );
  row.appendChild(div({ fontSize: FS.sm, fontWeight: FW.bold, letterSpacing: '2.5px', color: UI.text }, label.toUpperCase()));
  return row;
}
