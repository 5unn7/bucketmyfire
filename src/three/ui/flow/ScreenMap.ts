/**
 * Screen 3 — Choose map. A centred snap carousel of the map cards (MapCard3D) under the premium
 * "MAP SELECT" heading, with under-card pagination dots. The live Saskatchewan map is selectable and
 * shows its province facts (area + lakes) plus mission count; the three future maps render as locked
 * "Coming soon" teasers. The choice persists via `ctx.selectMap`. Footer advances with "Confirm map".
 */

import { MAPS } from '../profile';
import { buildMapCard3D } from '../MapCard3D';
import { injectScrollStyles, section, carouselDots } from '../menuShared';
import { selectHeading } from './chrome';
import { div } from '../theme';
import type { FlowCtx } from './types';

export function buildMapScreen(ctx: FlowCtx): HTMLElement {
  injectScrollStyles();
  const root = section({});
  root.appendChild(selectHeading('Map Select', 'Choose a province to begin. More regions inbound.'));

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

  const cards: { id: string; setSelected: (on: boolean) => void }[] = [];
  const slots: HTMLDivElement[] = [];
  let selectedEl: HTMLDivElement | undefined;

  for (const map of MAPS) {
    const usable = map.available;
    const missionCount = ctx.catalog.filter((m) => (m.map ?? MAPS[0].id) === map.id).length;
    const slot = div({ flex: '0 0 auto', width: 'clamp(250px, 78vw, 300px)', scrollSnapAlign: 'center' });
    const handle = buildMapCard3D(map, {
      usable,
      selected: usable && map.id === ctx.currentMap().id,
      missionCount,
      lockText: '🔒 Coming soon',
      onSelect: () => {
        ctx.selectMap(map);
        for (const c of cards) c.setSelected(c.id === map.id);
      },
    });
    slot.appendChild(handle.el);
    if (usable && map.id === ctx.currentMap().id) selectedEl = slot;
    cards.push({ id: map.id, setSelected: handle.setSelected });
    slots.push(slot);
    scroller.appendChild(slot);
  }

  root.appendChild(carouselDots(scroller, slots));

  if (selectedEl) {
    const target = selectedEl;
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, target.offsetLeft - (scroller.clientWidth - target.offsetWidth) / 2);
    });
  }

  ctx.footer.setPrimary('Confirm map', () => ctx.goNext());
  ctx.footer.setPrimaryEnabled(true);
  return root;
}
