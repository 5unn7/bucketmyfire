import type { MapModule, MapCard } from '../types';
import { ONTARIO } from './region';

const card: MapCard = {
  id: 'ontario',
  name: 'Ontario',
  tagline: 'Shield & boreal · soon',
  blurb: 'Northern Ontario’s Canadian Shield: endless boreal forest and big cold lakes from Thunder Bay to the James Bay lowlands.',
  available: false,
  accent: '#2f8f7a',
  glyph: '🛶',
  imageUrl: 'maps/Ontario.webp',
};

/** Ontario — future map (names-only region stub; default boreal terrain; not yet available). */
export const ontario: MapModule = {
  id: 'ontario',
  country: 'canada',
  card,
  region: ONTARIO,
};
