/**
 * Icon markup for the Home hub + its rail/menus, as HTML STRINGS (the screens build via innerHTML).
 * The stroke glyphs mirror `src/three/ui/svgIcons.ts` (Lucide, MIT) so the menu trains the SAME eye
 * as the in-flight HUD; a few extras (heli, wind, tree, droplet, house, clock, target, shield) are
 * drawn in the identical 24px stroke style. The brand FLAME + pilot HELMET are filled via the shared
 * gradient defs (inject `DEFS` once into the screen root).
 */

/** Shared <defs> for the flame + helmet gradients — inject once per screen root. */
export const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
  `<linearGradient id="flameGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc24a"/><stop offset="1" stop-color="#ff6a2c"/></linearGradient>` +
  `<linearGradient id="helmGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#ff8a4a"/></linearGradient>` +
  `</defs></svg>`;

/** Brand flame mark (twin flames over the bucket chevron) — fill via url(#flameGrad). */
export const FLAME = `<svg class="flame" viewBox="0 0 149.7 184.72"><polygon points="149.7 134.09 74.92 184.72 0 134.31 .57 108.82 74.83 158.71 148.67 108.67 149.7 134.09"/><path d="M73.06,58.25c-18.59,21.04-34.35,33.63-22.6,64.65-21.97-11.26-29.05-37.71-17.05-59.08C46.45,40.59,68.12,28.39,69.08,0c16.8,18.38,20.62,39.42,3.98,58.25Z"/><path d="M78.83,107.06c-5.97,5.58-8.3,13.06-8.78,21.51-10.73-8.26-13.63-23.66-5.17-35.08,13.99-18.88,30.5-27.51,32.95-51.73,22.16,26.58,26.3,62.23-2.1,82.13,1.38-11.22,2.02-20.02-3.9-28.97l-12.99,12.14Z"/></svg>`;

/** Flame, flames only (no chevron) — for the daily glyph + streak. */
export const FLAME_ONLY = `<svg class="flame" viewBox="0 0 149.7 184.72"><path d="M73.06,58.25c-18.59,21.04-34.35,33.63-22.6,64.65-21.97-11.26-29.05-37.71-17.05-59.08C46.45,40.59,68.12,28.39,69.08,0c16.8,18.38,20.62,39.42,3.98,58.25Z"/><path d="M78.83,107.06c-5.97,5.58-8.3,13.06-8.78,21.51-10.73-8.26-13.63-23.66-5.17-35.08,13.99-18.88,30.5-27.51,32.95-51.73,22.16,26.58,26.3,62.23-2.1,82.13,1.38-11.22,2.02-20.02-3.9-28.97l-12.99,12.14Z"/></svg>`;

/** Pilot flight helmet — fill via url(#helmGrad). */
export const HELMET = `<svg viewBox="0 0 358.46 358.48"><path d="M141.4,339.24l-.64,12.79-34.37-.23c-21.47-.14-38.75-16.55-43.86-36.87l-5.44-21.64,13.48,1.23,3.65,14.66c3.94,15.83,15.85,29.69,33.05,29.81l34.13.25Z"/><path d="M26.44,255.79c-7.22.5-13.98-4.37-15.4-11.49L.27,190.23c-1.69-8.48,4.81-16.16,12.76-17.11,1.22,28.16,5.52,54.92,13.42,82.68Z"/><path d="M347.52,243.93c-1.51,7.61-8.12,12.15-15.54,12.04,7.74-27.11,12.19-54.35,13.44-82.84,7.96.94,14.45,8.63,12.77,17.11l-10.67,53.69Z"/><path d="M196.83,358.23l-35.73.25c-1.89.01-5.39-1.13-6.17-2.55-3.1-5.61-1.42-16.47,3.49-16.5l36.84-.22c5.16-.03,9.05,4.09,9.52,8.77.39,3.84-2.42,10.21-7.95,10.25Z"/><path d="M281.15,128.09l-204.85.05c-13.4,0-24.81,10.83-24.83,24.05l-.07,44.03c-.02,12.26,4.98,23.32,11.37,33.39,3.01,17.59,6.97,34.21,11.58,51.38-12.88,2.58-27.2-3.41-31.59-16.32-12.48-36.65-18.27-74.87-16.82-113.61C29.1,66.68,93.24,0,179.24,0c54.49,0,104.24,27.41,131.46,74.92,13.32,23.24,20.85,48.94,21.83,76.27,1.39,38.93-4.36,77.43-17.15,114.14-4.4,12.64-18.85,18.08-31.11,15.67,4.48-17.29,8.37-33.85,11.44-51.4,6.36-10.09,11.38-21.11,11.36-33.4l-.07-43.92c-.02-14.16-11.98-24.19-25.85-24.19Z"/><path d="M200.65,217.41c-4.65-8.21-12.63-12.29-20.97-12.41-8.19-.11-16.9,3.65-21.21,11.47-11.05,20.02-33.56,30.86-56.05,25.4-20.82-5.05-38.16-23.92-38.17-46.63l-.02-43.23c0-4.48,4.87-10.89,10.16-10.89h209.71c5.32,0,10.18,6.41,10.18,10.89l-.03,43.22c-.01,22.44-16.93,41.16-37.39,46.44-22.05,5.68-44.85-4.26-56.19-24.26ZM88.27,176.82l13.27-13.53c1.73-1.76.46-6.47-1.13-7.86-1.43-1.26-6.36-2.34-7.77-.94l-14.16,14c-2.46,2.43-1.66,7.1.69,9.11s6.37,1.99,9.09-.79ZM95.13,208.43l44.11-44.16c2.45-2.45,1.48-7.11-.58-9.09-1.62-1.56-6.5-2.03-8.51-.03l-44.94,44.94c-2.78,2.78-2.09,7.26.2,9.33,2.83,2.55,6.55,2.17,9.71-1Z"/></svg>`;

const STROKE: Record<string, string> = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  map: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  // Layers (Lucide) — stacked sheets; the map's "what's drawn" toggle glyph.
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  heli: '<line x1="3" y1="7" x2="14" y2="7"/><line x1="8.5" y1="7" x2="8.5" y2="4.5"/><path d="M4 13.5c0-2 1.6-3.5 3.5-3.5H11l5 2.5"/><path d="M4 13.5h8a2.5 2.5 0 0 0 2.5-2.5"/><line x1="16" y1="12.5" x2="21" y2="11"/><line x1="20" y1="9" x2="20" y2="14"/><path d="M7 16l-1.5 3"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  garage: '<path d="M22 9v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-5a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 .6-.92l8-3.56a1 1 0 0 1 .8 0l8 3.56A1 1 0 0 1 22 9Z"/><path d="M7 17h10"/><path d="M7 20h10"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
  wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  tree: '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17z"/><path d="M12 22v-3"/>',
  house: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  // Refresh (Lucide refresh-cw) — the two-arc circular arrows, the universally-read "reload data" glyph.
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  // Accessibility (Lucide) — the reduced-motion setting glyph (replaces the old hand-drawn "motion" swirl).
  accessibility: '<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>',
  cloud: '<path d="M19 15a4 4 0 0 0-1-7.9A6 6 0 0 0 6 8a5 5 0 0 0 .5 10H19z"/>',
  pin: '<path d="M12 22s7-7.6 7-13a7 7 0 1 0-14 0c0 5.4 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  // Earned-points spark — the spendable career-points currency (Hangar unlock economy).
  spark: '<path d="M12 3l1.7 5.8L19 10l-5.3 1.2L12 17l-1.7-5.8L5 10l5.3-1.2z"/>',
  // Bell (Lucide) — the "notify me when this map ships" CTA glyph.
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
};

/** Inline a stroke icon as an HTML string (24px viewBox, currentColor). */
export function ic(name: string, cls = ''): string {
  return `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STROKE[name] ?? STROKE['chevron-right']}</svg>`;
}
