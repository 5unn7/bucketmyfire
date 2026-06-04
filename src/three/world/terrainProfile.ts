/**
 * Per-MAP terrain profile (the "playable maps" engine seam — see docs/MAPS.md).
 *
 * `World` is fully procedural: its heightfield comes from noise parameters, not a heightmap.
 * A `TerrainProfile` bundles those parameters so ONE generator can grow radically different
 * landscapes from the same code — today the live **Saskatchewan** boreal shield (low relief,
 * many kettle lakes) and **British Columbia** (towering mountains, valleys/passes, a treeline
 * with bare scree and snow-capped peaks). A map is just a profile + its name pools + anchors.
 *
 * Keyed by REGION ID (the same ids as `world/regions.ts` + `ui/profile.ts` MAPS), resolved by
 * `getTerrainProfile()` with a graceful default → Saskatchewan, so a region with no profile yet
 * (e.g. a stubbed future map) still grows a valid world. This file is the SINGLE contract with
 * the map-data layer: add a region there + a profile here and the map is playable.
 *
 * Saskatchewan's values are the config `TERRAIN` block verbatim, so the generator is byte-identical
 * to before this seam existed (the determinism invariant; `npm run verify:campaign` proves it) and
 * a future `bmf-tune` edit to `TERRAIN` still flows into the SK map.
 */

import { TERRAIN } from '../config';

export interface TerrainProfile {
  // --- base heightfield (the 12 config TERRAIN fields) ---
  baseAmplitude: number; // vertical scale of the rolling FBM (units)
  baseFrequency: number; // world→noise scale (lower = broader landforms)
  octaves: number;
  lacunarity: number; // frequency step per octave
  gain: number; // amplitude falloff per octave
  warpStrength: number; // domain-warp displacement (units) → winding ridgelines/valleys
  warpFrequency: number;
  ridgeAmplitude: number; // rocky crests poking above the rolling base
  ridgeFrequency: number;
  ridgeOctaves: number;
  ridgeThreshold: number; // only ridge values above this rise (localizes outcrops/ranges)
  lowlandFlatten: number; // 0..1 — compress sub-waterline dips into flatter basins

  // --- lake siting (replaces the old hardcoded `>3`) ---
  lakeMaxHeight: number; // reject a lake center whose baseHeight exceeds this (valley/lowland bias)
  lakeDensityScale: number; // multiplies the area-derived lake count (1 = baseline; <1 = fewer)

  // --- MOUNTAIN layer (optional; ABSENT = off → zero cost for low-relief maps) ---
  mountainAmplitude?: number; // ridged massif relief stacked on top of the base (units)
  mountainFrequency?: number; // peak spacing (lower = broader massifs)
  mountainOctaves?: number;
  mountainGain?: number;
  mountainExponent?: number; // sharpening power on the ridged value (>1 = flatter highs, sharper summits)

  // --- ALPINE banding (optional; drives the treeline → scree → snow look + tree cutoff) ---
  treeline?: number; // elevation above which trees vanish and ground turns to bare scree
  snowline?: number; // elevation above which ground turns to snow (defaults to treeline + 28)
  bandBlend?: number; // smoothstep half-width (units) for the band transitions
  colorScree?: number; // bare alpine rock/scree (hex)
  colorSnow?: number; // snow (hex)
}

// --- Saskatchewan: the live boreal-shield map. Identical to config `TERRAIN` so the world
// generates exactly as it did before this seam (byte-identical → verify:campaign passes). ---
export const SASKATCHEWAN: TerrainProfile = {
  ...TERRAIN,
  lakeMaxHeight: 3, // the literal scatterLakes used → unchanged
  lakeDensityScale: 1, // unchanged lake count
  // no mountain layer, no treeline → all gated branches off, all alpine overlays no-op
};

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

const PROFILES: Record<string, TerrainProfile> = {
  saskatchewan: SASKATCHEWAN,
  'british-columbia': BRITISH_COLUMBIA,
};

/** Resolve a terrain profile by region id, defaulting to Saskatchewan for any unknown/missing id. */
export function getTerrainProfile(regionId?: string): TerrainProfile {
  return (regionId && PROFILES[regionId]) || SASKATCHEWAN;
}
