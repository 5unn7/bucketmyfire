/**
 * A compact Saskatchewan community list (name + real lat/lon) used ONLY to label a fire by its nearest
 * town ("near La Ronge"). It deliberately mirrors the canonical anchors in
 * `maps/saskatchewan/region.ts`, kept here as a tiny, dependency-free copy so the pure normalize layer
 * — and its Node verify bundle — need not import the whole map module (which pulls config/heightmaps).
 * These are real-world coordinates (facts), not authored map placements, so the duplication is stable.
 */
export interface Place {
  name: string;
  lat: number;
  lon: number;
}

/** The fire bases + protected communities + southern cities, north→south. Enough coverage that any
 *  in-province fire has a sensible nearest label. */
export const SK_PLACES: readonly Place[] = [
  { name: 'Buffalo Narrows', lat: 56.9406, lon: -108.4697 },
  { name: 'Southend', lat: 57.0703, lon: -103.4381 },
  { name: 'Île-à-la-Crosse', lat: 56.2819, lon: -107.5236 },
  { name: 'Missinipe', lat: 56.3156, lon: -105.1285 },
  { name: 'Stanley Mission', lat: 55.8538, lon: -105.1051 },
  { name: 'Denare Beach', lat: 55.476, lon: -102.0801 },
  { name: 'La Ronge', lat: 55.3076, lon: -105.605 },
  { name: 'Beauval', lat: 55.287, lon: -107.4685 },
  { name: 'Dorintosh', lat: 54.9551, lon: -109.1496 },
  { name: 'Weyakwin', lat: 54.4414, lon: -105.7082 },
  { name: 'Prince Albert', lat: 53.1266, lon: -105.7296 },
  { name: 'North Battleford', lat: 52.8446, lon: -108.2075 },
  { name: 'Saskatoon', lat: 52.133, lon: -106.67 },
  { name: 'Regina', lat: 50.445, lon: -104.619 },
  { name: 'Cypress Hills', lat: 49.7464, lon: -107.8708 },
];
