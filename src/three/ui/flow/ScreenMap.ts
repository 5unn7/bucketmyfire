/**
 * Screen 3 — Choose map. A snap carousel of the map cards (MapCard3D). The live Saskatchewan map is
 * selectable and shows its mission count ("6 MISSIONS", counted from the campaign by `map` id); the
 * three future maps render as locked "Coming soon" teasers. The choice persists via `ctx.selectMap`.
 * Footer advances with "Confirm map".
 */

import { MAPS } from '../profile';
import { buildMapCard3D } from '../MapCard3D';
import { injectScrollStyles, section } from '../menuShared';
import { screenHeading } from './chrome';
import { div } from '../theme';
import type { FlowCtx } from './types';

export function buildMapScreen(ctx: FlowCtx): HTMLElement {
  injectScrollStyles();
  const root = section({});
  root.appendChild(screenHeading('Choose your map', 'Pick where you fly. More regions inbound.'));

  const scroller = div({ display: 'flex', gap: '14px', overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: '10px', margin: '0 -2px' });
  scroller.className = 'bmf-hscroll';
  root.appendChild(scroller);

  const cards: { id: string; setSelected: (on: boolean) => void }[] = [];
  let selectedEl: HTMLDivElement | undefined;

  for (const map of MAPS) {
    const usable = map.available;
    const missionCount = ctx.catalog.filter((m) => (m.map ?? MAPS[0].id) === map.id).length;
    const slot = div({ flex: '0 0 auto', width: '240px', scrollSnapAlign: 'start' });
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
    scroller.appendChild(slot);
  }

  if (selectedEl) {
    const target = selectedEl;
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, target.offsetLeft - 2);
    });
  }

  ctx.footer.setPrimary('Confirm map', () => ctx.goNext());
  ctx.footer.setPrimaryEnabled(true);
  return root;
}
