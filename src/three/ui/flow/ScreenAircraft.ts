/**
 * Screen 2 — Aircraft. A horizontal snap carousel of the 3D-tilt helicopter cards (HeliCard3D),
 * plus a context panel that reflects the selected airframe's flavour blurb (there's room for it on a
 * dedicated screen). Default selection = the saved/unlocked heli; gating via `isHeliUnlocked`. The
 * choice persists to the profile through `ctx.selectHeli`. Footer advances with "Confirm aircraft".
 */

import { HELIS, isHeliUnlocked, type CatalogItem } from '../profile';
import { buildHeliCard3D } from '../HeliCard3D';
import { injectScrollStyles, section, carouselDots } from '../menuShared';
import { selectHeading } from './chrome';
import { UI, FS, FW, R, div, frosted } from '../theme';
import type { FlowCtx } from './types';

export function buildAircraftScreen(ctx: FlowCtx): HTMLElement {
  injectScrollStyles();
  const root = section({});
  root.appendChild(selectHeading('Aircraft Select', 'The forgiving trainer, a balanced twin, and the supreme handful — each flies, carries and survives differently.'));

  const scroller = div({
    display: 'flex',
    alignItems: 'stretch',
    gap: '16px',
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
    padding: '4px max(2px, calc(50% - 150px)) 10px',
  });
  scroller.className = 'bmf-hscroll';
  root.appendChild(scroller);

  // Context panel — the selected airframe's name + blurb.
  const panel = frosted({ margin: '4px auto 0', padding: '15px 18px', borderRadius: R.lg, maxWidth: '660px', textAlign: 'center' });
  const ctxName = div({ fontSize: FS.lg, fontWeight: FW.bold, marginBottom: '5px' });
  const ctxBlurb = div({ fontSize: FS.sm, lineHeight: '1.55', color: UI.dim });
  panel.append(ctxName, ctxBlurb);
  const updateContext = (heli: CatalogItem): void => {
    ctxName.textContent = heli.name;
    ctxBlurb.textContent = heli.blurb;
  };

  const cards: { id: string; setSelected: (on: boolean) => void }[] = [];
  const slots: HTMLDivElement[] = [];
  let selectedEl: HTMLDivElement | undefined;

  for (const heli of HELIS) {
    const usable = isHeliUnlocked(heli, ctx.cleared);
    const slot = div({ flex: '0 0 auto', width: 'clamp(250px, 78vw, 300px)', scrollSnapAlign: 'center' });
    const handle = buildHeliCard3D(heli, {
      usable,
      selected: usable && heli.id === ctx.currentHeli().id,
      lockText: heli.available ? `🔒 Clear ${heli.unlockAfter} missions` : '🔒 Coming soon',
      onSelect: () => {
        ctx.selectHeli(heli);
        for (const c of cards) c.setSelected(c.id === heli.id);
        updateContext(heli);
      },
    });
    slot.appendChild(handle.el);
    if (usable && heli.id === ctx.currentHeli().id) selectedEl = slot;
    cards.push({ id: heli.id, setSelected: handle.setSelected });
    slots.push(slot);
    scroller.appendChild(slot);
  }
  root.appendChild(carouselDots(scroller, slots));
  root.appendChild(panel);
  updateContext(ctx.currentHeli());

  if (selectedEl) {
    const target = selectedEl;
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, target.offsetLeft - (scroller.clientWidth - target.offsetWidth) / 2);
    });
  }

  ctx.footer.setPrimary('Confirm aircraft', () => ctx.goNext());
  ctx.footer.setPrimaryEnabled(true);
  return root;
}
