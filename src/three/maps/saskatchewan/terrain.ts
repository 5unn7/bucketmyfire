import { TERRAIN } from '../../config';
import type { TerrainProfile } from '../types';

// --- Saskatchewan: the live boreal-shield map. Identical to config `TERRAIN` so the world
// generates exactly as it did before this seam (byte-identical → verify:campaign passes). ---
export const SASKATCHEWAN: TerrainProfile = {
  ...TERRAIN,
  lakeMaxHeight: 3, // the literal scatterLakes used → unchanged
  lakeDensityScale: 1, // unchanged lake count
  // no mountain layer, no treeline → all gated branches off, all alpine overlays no-op
};
