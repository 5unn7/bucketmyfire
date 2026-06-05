import type { Region } from '../types';

// --- alberta — NORTHERN ALBERTA (future map: boreal + foothills, big-season crown fire) --------
// Real Alberta fire country: the Fort McMurray / Slave Lake / Peace boreal and the foothills. Black
// spruce that crowns and runs; shares the low-relief default until the foothills profile is tuned.
const ALBERTA: Region = {
  id: 'alberta',
  label: 'Alberta',
  names: {
    lakes: [
      'Lesser Slave Lake',
      'Lake Athabasca',
      'Cold Lake',
      'Lac La Biche',
      'Calling Lake',
      'Utikuma Lake',
      'Wabasca Lake',
      'Peerless Lake',
      'Winefred Lake',
      'Christina Lake',
      'Touchwood Lake',
      'Gull Lake',
      'Sturgeon Lake',
      'Pigeon Lake',
    ],
    communities: [
      'Fort McMurray',
      'Slave Lake',
      'High Level',
      'Grande Prairie',
      'Peace River',
      'Fox Creek',
      'Whitecourt',
      'Hinton',
      'Edson',
      'Lac La Biche',
      'Athabasca',
      'Fort Chipewyan',
      'High Prairie',
      'Manning',
      'Valleyview',
      'Swan Hills',
      'Wabasca',
      'Conklin',
      'Rainbow Lake',
      'Zama City',
      'Red Earth Creek',
      'Cold Lake',
      'Fort Vermilion',
      'Janvier',
    ],
    highways: ['Hwy 63', 'Hwy 88', 'Hwy 35', 'Hwy 43', 'Hwy 40', 'Hwy 881', 'Hwy 686', 'Hwy 2', 'Hwy 58', 'Hwy 813'],
  },
};

export { ALBERTA };
