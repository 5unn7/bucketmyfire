/**
 * Curated Canadian place labels for the live-fire map. The CARTO basemap declutters its own labels hard at
 * country zoom (you get "CANADA" and little else until you zoom way in), so we draw our OWN names on top —
 * denser, always legible over the FWI wash, and weighted toward the wildfire-prone interior + north (the
 * places that matter for orienting a fire), not just the populous south.
 *
 * `tier` is the zoom band a name appears at: 0 = major cities + capitals, shown always (even the country
 * view); 1 = mid cities, from z≥5; 2 = smaller interior/northern towns, from z≥6. So the map stays clean
 * zoomed out and reveals more names as you zoom in. lat/lon are LABEL positions — close enough to sit on the
 * town at these scales, not survey-grade.
 */
export type Place = { name: string; lat: number; lon: number; tier: 0 | 1 | 2 };

export const PLACES: Place[] = [
  // ── tier 0 — major cities, provincial + territorial capitals, and the key wildfire hub (Fort McMurray) ──
  { name: 'Vancouver', lat: 49.28, lon: -123.12, tier: 0 },
  { name: 'Calgary', lat: 51.05, lon: -114.07, tier: 0 },
  { name: 'Edmonton', lat: 53.55, lon: -113.49, tier: 0 },
  { name: 'Saskatoon', lat: 52.13, lon: -106.67, tier: 0 },
  { name: 'Regina', lat: 50.45, lon: -104.62, tier: 0 },
  { name: 'Winnipeg', lat: 49.9, lon: -97.14, tier: 0 },
  { name: 'Thunder Bay', lat: 48.38, lon: -89.25, tier: 0 },
  { name: 'Toronto', lat: 43.65, lon: -79.38, tier: 0 },
  { name: 'Ottawa', lat: 45.42, lon: -75.7, tier: 0 },
  { name: 'Montréal', lat: 45.5, lon: -73.57, tier: 0 },
  { name: 'Québec City', lat: 46.81, lon: -71.21, tier: 0 },
  { name: 'Halifax', lat: 44.65, lon: -63.58, tier: 0 },
  { name: "St. John's", lat: 47.56, lon: -52.71, tier: 0 },
  { name: 'Fort McMurray', lat: 56.73, lon: -111.38, tier: 0 },
  { name: 'Yellowknife', lat: 62.45, lon: -114.37, tier: 0 },
  { name: 'Whitehorse', lat: 60.72, lon: -135.05, tier: 0 },

  // ── tier 1 — mid cities (z≥5) ──
  { name: 'Victoria', lat: 48.43, lon: -123.37, tier: 1 },
  { name: 'Kelowna', lat: 49.88, lon: -119.5, tier: 1 },
  { name: 'Kamloops', lat: 50.67, lon: -120.33, tier: 1 },
  { name: 'Prince George', lat: 53.92, lon: -122.75, tier: 1 },
  { name: 'Fort St. John', lat: 56.25, lon: -120.85, tier: 1 },
  { name: 'Grande Prairie', lat: 55.17, lon: -118.8, tier: 1 },
  { name: 'Red Deer', lat: 52.27, lon: -113.81, tier: 1 },
  { name: 'Lethbridge', lat: 49.69, lon: -112.84, tier: 1 },
  { name: 'Prince Albert', lat: 53.2, lon: -105.75, tier: 1 },
  { name: 'Brandon', lat: 49.85, lon: -99.95, tier: 1 },
  { name: 'Thompson', lat: 55.74, lon: -97.86, tier: 1 },
  { name: 'Sudbury', lat: 46.49, lon: -80.99, tier: 1 },
  { name: 'Timmins', lat: 48.48, lon: -81.33, tier: 1 },
  { name: 'Sault Ste. Marie', lat: 46.52, lon: -84.33, tier: 1 },
  { name: 'North Bay', lat: 46.31, lon: -79.46, tier: 1 },
  { name: 'Hamilton', lat: 43.26, lon: -79.87, tier: 1 },
  { name: 'London', lat: 42.98, lon: -81.25, tier: 1 },
  { name: 'Windsor', lat: 42.31, lon: -83.04, tier: 1 },
  { name: 'Fredericton', lat: 45.96, lon: -66.64, tier: 1 },
  { name: 'Moncton', lat: 46.09, lon: -64.78, tier: 1 },
  { name: 'Charlottetown', lat: 46.24, lon: -63.13, tier: 1 },
  { name: 'Sept-Îles', lat: 50.22, lon: -66.38, tier: 1 },
  { name: 'Iqaluit', lat: 63.75, lon: -68.52, tier: 1 },
  { name: 'Williams Lake', lat: 52.13, lon: -122.14, tier: 1 },
  { name: 'Dawson Creek', lat: 55.76, lon: -120.24, tier: 1 },

  // ── tier 2 — smaller interior + northern towns, many wildfire-prone (z≥6) ──
  { name: 'Nanaimo', lat: 49.16, lon: -123.94, tier: 2 },
  { name: 'Penticton', lat: 49.49, lon: -119.59, tier: 2 },
  { name: 'Vernon', lat: 50.27, lon: -119.27, tier: 2 },
  { name: 'Cranbrook', lat: 49.51, lon: -115.77, tier: 2 },
  { name: 'Banff', lat: 51.18, lon: -115.57, tier: 2 },
  { name: 'Jasper', lat: 52.87, lon: -118.08, tier: 2 },
  { name: 'Hinton', lat: 53.4, lon: -117.57, tier: 2 },
  { name: 'Slave Lake', lat: 55.28, lon: -114.77, tier: 2 },
  { name: 'Peace River', lat: 56.23, lon: -117.29, tier: 2 },
  { name: 'Cold Lake', lat: 54.46, lon: -110.18, tier: 2 },
  { name: 'Lloydminster', lat: 53.28, lon: -110.0, tier: 2 },
  { name: 'La Ronge', lat: 55.1, lon: -105.28, tier: 2 },
  { name: 'Flin Flon', lat: 54.77, lon: -101.86, tier: 2 },
  { name: 'The Pas', lat: 53.83, lon: -101.25, tier: 2 },
  { name: 'Churchill', lat: 58.77, lon: -94.17, tier: 2 },
  { name: 'Kenora', lat: 49.77, lon: -94.49, tier: 2 },
  { name: 'Chibougamau', lat: 49.92, lon: -74.37, tier: 2 },
  { name: 'Gander', lat: 48.95, lon: -54.61, tier: 2 },
  { name: 'Corner Brook', lat: 48.95, lon: -57.95, tier: 2 },
  { name: 'Sydney', lat: 46.14, lon: -60.19, tier: 2 },
  { name: 'Fort Nelson', lat: 58.81, lon: -122.7, tier: 2 },
  { name: 'High Level', lat: 58.52, lon: -117.14, tier: 2 },
  { name: 'Hay River', lat: 60.82, lon: -115.8, tier: 2 },
  { name: 'Fort Smith', lat: 60.0, lon: -111.89, tier: 2 },
  { name: 'Inuvik', lat: 68.36, lon: -133.72, tier: 2 },
  { name: 'Norman Wells', lat: 65.28, lon: -126.83, tier: 2 },
];
