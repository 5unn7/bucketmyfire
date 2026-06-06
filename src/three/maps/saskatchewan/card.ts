import type { MapCard } from '../types';

/** Saskatchewan picker card. imageUrl is BASE_URL-relative — ui/profile.ts prefixes it. */
export const card: MapCard = {
  id: 'saskatchewan',
  name: 'Saskatchewan',
  tagline: 'Boreal north · 8 missions',
  blurb: 'Northern Saskatchewan: glacier-scoured granite, the Churchill River chain, and cold kettle lakes from La Ronge to the Athabasca. The full campaign flies here.',
  available: true,
  accent: '#3f7d4a',
  glyph: '🌲',
  imageUrl: 'maps/Saskatchewan.webp',
  stats: { area: '661,900 km²', lakes: '100,000+ lakes' },
};
