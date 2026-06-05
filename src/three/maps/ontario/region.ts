import type { Region } from '../types';

// --- ontario — NORTHERN ONTARIO (future map: Canadian Shield boreal, big cold lakes) -----------
// Real northwestern/northeastern Ontario fire country: the Shield from Thunder Bay and Kenora up to the
// James Bay lowlands. Boreal like Saskatchewan, so it shares the low-relief default until tuned.
const ONTARIO: Region = {
  id: 'ontario',
  label: 'Ontario',
  names: {
    lakes: [
      'Lake Nipigon',
      'Lake of the Woods',
      'Lac Seul',
      'Rainy Lake',
      'Wabigoon Lake',
      'Eagle Lake',
      'Lake Abitibi',
      'Lake Temagami',
      'Lake Nipissing',
      'Lake St. Joseph',
      'Trout Lake',
      'Lake Superior',
      'Lake Timiskaming',
      'Wabakimi Lake',
    ],
    communities: [
      'Thunder Bay',
      'Kenora',
      'Dryden',
      'Sioux Lookout',
      'Red Lake',
      'Atikokan',
      'Marathon',
      'Wawa',
      'Hearst',
      'Kapuskasing',
      'Cochrane',
      'Timmins',
      'Chapleau',
      'Nipigon',
      'Geraldton',
      'Ear Falls',
      'Nakina',
      'Fort Frances',
      'Ignace',
      'Manitouwadge',
      'Longlac',
      'Moosonee',
      'Terrace Bay',
      'Greenstone',
    ],
    highways: ['Hwy 11', 'Hwy 17', 'Hwy 71', 'Hwy 72', 'Hwy 105', 'Hwy 599', 'Hwy 101', 'Hwy 144', 'Hwy 129', 'Hwy 61'],
  },
};

export { ONTARIO };
