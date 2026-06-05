import type { TerrainProfile } from '../types';

// --- British Columbia: coast mountains. A broad, tall base (valleys you fly UP) with a sharp
// ridged MASSIF layer stacked on top so peaks tower ~100u; trees clothe the flyable valleys to
// treeline (46u), bare scree above, snow caps the top. Fewer lakes, all in the valleys → the
// scoop loop is "drop into a valley lake, climb back over the ridge to the fire". The AGL flight
// floor (World.flightFloorAt) rises with the ground automatically, so you climb passes for free. ---
export const BRITISH_COLUMBIA: TerrainProfile = {
  baseAmplitude: 22, // ~2.4× SK — valley-floor / lower-slope relief
  baseFrequency: 0.0026, // lower than SK → broader basins
  octaves: 6, // +1 octave of slope detail on the larger relief
  lacunarity: 2.0,
  gain: 0.5,
  warpStrength: 140, // long winding valleys/passes (not radial cones)
  warpFrequency: 0.0045,
  ridgeAmplitude: 26, // real ridge spurs/buttresses
  ridgeFrequency: 0.006, // long ridgelines, not pebbly
  ridgeOctaves: 4,
  ridgeThreshold: 0.42, // ridges over more of the map (a range, not specks)
  lowlandFlatten: 0.3, // less than SK — keep valley floors as real dips, not muskeg flats

  lakeMaxHeight: 14, // valley lakes only
  lakeDensityScale: 0.45, // mountains hold fewer water bodies

  mountainAmplitude: 100, // ridged crests rarely hit 1, so amplitude > target summit; gives ~95–110u peaks
  mountainFrequency: 0.0017, // broad massifs (~600u spacing across the 1500u map)
  mountainOctaves: 5,
  mountainGain: 0.5,
  mountainExponent: 1.8, // sharpen the ridged value → broad high country with distinct summits

  treeline: 46, // trees stop; above is bare scree
  snowline: 70, // snow caps the upper ~third of a full peak
  bandBlend: 7, // soft natural transition (not a hard ring)
  colorScree: 0x8a8782, // pale weathered granite/scree (lighter than SK rock)
  colorSnow: 0xf2f5fb, // bright snow, a hair blue-cool
};
