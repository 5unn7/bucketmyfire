import type { MapModule, MapCard } from '../types';
import { ALBERTA } from './region';

const card: MapCard = {
  id: 'alberta',
  name: 'Alberta',
  tagline: 'Boreal & foothills · soon',
  blurb: 'Alberta’s northern boreal and foothills — Fort McMurray, Slave Lake, the Peace country. Big seasons, fast crown runs through black spruce.',
  available: false,
  accent: '#c2702f',
  glyph: '🏕️',
  imageUrl: 'images/maps/Alberta.webp',
  stats: { area: '661,190 km²', lakes: '100,000+ lakes' },
};

/** Alberta — future map (names-only region stub; default boreal terrain; not yet available). */
export const alberta: MapModule = {
  id: 'alberta',
  country: 'canada',
  card,
  region: ALBERTA,
};
