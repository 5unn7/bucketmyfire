import type { Region } from '../types';

// --- british-columbia — INTERIOR BC (future map: steep valleys, deep lakes, wind through the passes) ---
// Real Interior-BC fire country: the Cariboo, Thompson, and Okanagan. Mountainous relief lands when the
// terrain profile is tuned (docs/MAPS.md Phase 3); for now it's a future region with real place names.
const BRITISH_COLUMBIA: Region = {
  id: 'british-columbia',
  label: 'British Columbia',
  names: {
    lakes: [
      'Okanagan Lake',
      'Shuswap Lake',
      'Kootenay Lake',
      'Quesnel Lake',
      'Babine Lake',
      'Stuart Lake',
      'François Lake',
      'Adams Lake',
      'Nicola Lake',
      'Bowron Lake',
      'Arrow Lakes',
      'Chilko Lake',
      'Williston Lake',
      'Cariboo Lake',
    ],
    communities: [
      'Kamloops',
      'Kelowna',
      'Williams Lake',
      'Prince George',
      'Vernon',
      'Penticton',
      'Merritt',
      'Lytton',
      'Lillooet',
      'Quesnel',
      '100 Mile House',
      'Cache Creek',
      'Ashcroft',
      'Clearwater',
      'Vanderhoof',
      'Burns Lake',
      'Fort St. James',
      'Salmon Arm',
      'Revelstoke',
      'Princeton',
      'Logan Lake',
      'Barriere',
      'Chetwynd',
      'Mackenzie',
    ],
    highways: ['Hwy 1', 'Hwy 5', 'Hwy 97', 'Hwy 3', 'Hwy 16', 'Hwy 99', 'Hwy 24', 'Hwy 6', 'Hwy 33', 'Hwy 95', 'Hwy 20'],
  },
};

export { BRITISH_COLUMBIA };
