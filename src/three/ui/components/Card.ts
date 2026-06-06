/**
 * Card — a frosted surface with an optional header (meta + title + trailing slot) and a body.
 * Folds the hand-rolled cards in `menuShared` / `ShopScreen`. `selectable` adds the hover-lift +
 * accent ring used by the map / aircraft / mission pickers (drive it with `setSelected`).
 */

import { UI, FS, FW, R, div, setBlur, prefersReducedMotion } from '../theme';
import { tone, type Register } from './base';

export interface CardOpts {
  surface?: 'glass' | 'soft'; // cardGlass (default) | cardSoft
  register?: Register;
  meta?: string; // small uppercase label above the title
  title?: string;
  trailing?: HTMLElement; // right-aligned header slot (a Badge, a value)
  selectable?: boolean; // hover-lift; pair with setSelected()
  padding?: string;
}

export interface CardHandle {
  el: HTMLDivElement;
  body: HTMLDivElement;
  setSelected(on: boolean): void;
}

export function makeCard(opts: CardOpts = {}): CardHandle {
  const t = tone(opts.register ?? 'cockpit');
  const reduce = prefersReducedMotion();
  const restFill = opts.surface === 'soft' ? UI.cardSoft : UI.cardGlass;

  const card = div({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    background: restFill,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.lg,
    boxShadow: UI.shadowCard,
    padding: opts.padding ?? '15px 16px',
    transition: reduce ? 'border-color 0.15s ease, background 0.15s ease' : 'transform 0.14s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.2s ease',
  });
  setBlur(card);

  if (opts.meta || opts.title || opts.trailing) {
    const head = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' });
    const left = div({ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '0' });
    if (opts.meta) left.appendChild(div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1.6px', textTransform: 'uppercase', color: UI.faint }, opts.meta));
    if (opts.title) left.appendChild(div({ fontSize: FS.title, fontWeight: FW.bold, color: UI.text, lineHeight: '1.15' }, opts.title));
    head.appendChild(left);
    if (opts.trailing) head.appendChild(opts.trailing);
    card.appendChild(head);
  }

  const body = div({ display: 'flex', flexDirection: 'column' });
  card.appendChild(body);

  if (opts.selectable && !reduce) {
    card.addEventListener('pointerenter', () => (card.style.transform = 'translateY(-3px)'));
    card.addEventListener('pointerleave', () => (card.style.transform = 'none'));
  }

  return {
    el: card,
    body,
    setSelected: (on) => {
      card.style.borderColor = on ? t.fg : UI.stroke;
      card.style.background = on ? t.fill : restFill;
    },
  };
}
