/**
 * Inline SVG icon library — zero binary assets, inherits currentColor.
 *
 * Returns a live DOM SVGElement you can appendChild directly into buttons or
 * any container. Each icon is a 24×24-viewBox stroke icon (stroke="currentColor")
 * so it inherits the parent element's text color automatically.
 *
 * Path data sourced from Lucide (MIT licence — https://lucide.dev).
 */

export type IconName =
  | 'shop'          // shopping bag — store / merch
  | 'settings'      // two sliders — settings / options
  | 'close'         // × — dismiss / back
  | 'star'          // five-point star — rating / favourite
  | 'info'          // circle-i — help / about
  | 'fire'          // flame — fire / alert
  | 'user'          // person silhouette — profile / callsign
  | 'trophy'        // cup — leaderboard / rank
  | 'map'           // folded map — region picker
  | 'chevron-right' // › — next / forward
  | 'play'          // ▶ filled triangle — start / resume
  | 'refresh'       // circular arrows — retry / restart
  | 'volume'        // speaker + wave — audio on
  | 'volume-off';   // speaker + × — audio off

// Inner SVG markup (24×24 viewBox, no fill attribute, stroke=currentColor inherited)
const ICONS: Record<IconName, string> = {
  shop:
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>' +
    '<path d="M3 6h18"/>' +
    '<path d="M16 10a4 4 0 0 1-8 0"/>',

  settings:
    '<path d="M20 7h-9"/>' +
    '<path d="M14 17H5"/>' +
    '<circle cx="17" cy="17" r="3"/>' +
    '<circle cx="7" cy="7" r="3"/>',

  close:
    '<path d="M18 6 6 18"/>' +
    '<path d="m6 6 12 12"/>',

  star:
    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',

  info:
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M12 16v-4"/>' +
    '<path d="M12 8h.01"/>',

  fire:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',

  user:
    '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>' +
    '<circle cx="12" cy="7" r="4"/>',

  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>' +
    '<path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>' +
    '<path d="M4 22h16"/>' +
    '<path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>' +
    '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>' +
    '<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',

  map:
    '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/>' +
    '<line x1="9" y1="3" x2="9" y2="18"/>' +
    '<line x1="15" y1="6" x2="15" y2="21"/>',

  'chevron-right':
    '<path d="m9 18 6-6-6-6"/>',

  play:
    '<polygon points="6 3 20 12 6 21 6 3"/>',

  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>' +
    '<path d="M21 3v5h-5"/>' +
    '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>' +
    '<path d="M8 16H3v5"/>',

  volume:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
    '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',

  'volume-off':
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
    '<line x1="23" y1="9" x2="17" y2="15"/>' +
    '<line x1="17" y1="9" x2="23" y2="15"/>',
};

const NS = 'http://www.w3.org/2000/svg';

/**
 * Build a fresh inline <svg> icon element.
 *
 * @param name  - one of the IconName string literals
 * @param size  - rendered px size (width + height); default 20
 * @returns an SVGSVGElement ready for appendChild — stroke inherits currentColor
 */
export function makeIconSvg(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display:block;flex-shrink:0;pointer-events:none';
  svg.innerHTML = ICONS[name] ?? ICONS.close;
  return svg;
}
