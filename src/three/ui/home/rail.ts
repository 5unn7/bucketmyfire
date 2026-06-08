/**
 * The Home hub's bottom RAIL — extracted so the hub (HomeScreen) AND every rail-menu overlay
 * (menus.ts) render the SAME nav and the rail stays visible the whole time you're in the menus.
 * This module is pure markup (no openers) to stay import-cycle-free; the actual routing lives in
 * `menus.ts` (`navigateRail`), which both surfaces wire their `[data-rail]` buttons to.
 */
import { ic } from './icons';

export interface RailItem {
  key: string;
  label: string;
  icon: string;
}

export const RAIL: RailItem[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'coop', label: 'Open Skies', icon: 'fire' },
  { key: 'solo', label: 'Solo', icon: 'map' },
  { key: 'hangar', label: 'Hangar', icon: 'garage' },
  { key: 'shop', label: 'Shop', icon: 'shop' },
];

/** The bottom-rail nav markup with `active` highlighted. Buttons carry `data-rail="<key>"`. */
export function railNav(active: string): string {
  return (
    `<nav class="rail" aria-label="Primary"><div class="keys">` +
    RAIL.map((t) => {
      const on = t.key === active;
      return `<button class="key${on ? ' active' : ''}" data-rail="${t.key}"${on ? ' aria-current="page"' : ''}>${
        on ? '<span class="tick"></span>' : ''
      }${ic(t.icon, 'line')}<span>${t.label}</span></button>`;
    }).join('') +
    `</div></nav>`
  );
}
