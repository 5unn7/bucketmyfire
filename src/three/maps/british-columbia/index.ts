import type { MapModule, MapCard } from '../types';
import { BRITISH_COLUMBIA } from './region';
import { BRITISH_COLUMBIA as BC_TERRAIN } from './terrain';

const card: MapCard = {
  id: 'british-columbia',
  name: 'British Columbia',
  tagline: 'Interior fire country · soon',
  blurb: 'Steep Interior valleys and deep cold lakes — the Cariboo, Thompson, and Okanagan. The wind funnels through the passes and runs fire uphill fast.',
  available: false,
  accent: '#4f86a8',
  glyph: '🏔️',
  imageUrl: 'maps/BritishColumbia.webp',
  stats: { area: '944,735 km²', lakes: '100,000+ lakes' },
};

/** British Columbia — future map (mountain terrain profile ready; names-only region stub; not yet available). */
export const britishColumbia: MapModule = {
  id: 'british-columbia',
  country: 'canada',
  card,
  region: BRITISH_COLUMBIA,
  terrain: BC_TERRAIN,
};
