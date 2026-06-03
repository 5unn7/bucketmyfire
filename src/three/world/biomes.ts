import { BIOMES } from '../config';
import { Noise2D } from './noise';

/**
 * Biome classification (Track A2). Blends the world's **elevation**, **slope**, and a
 * dedicated **moisture** noise channel (plus proximity to water) into the four boreal
 * biomes — shore / meadow / forest / rock — and turns that into the two outputs the
 * renderer needs: a terrain **vertex color** and a tree **density + foliage tint**.
 *
 * Pure math, engine-agnostic (returns plain `[r,g,b]` in 0..1 and scalars — no THREE,
 * no scene). It reads the height/slope/water fields from `World` via injected closures,
 * so it stays decoupled and the World keystone is still the single source of truth.
 */

export type Rgb = [number, number, number];

export interface BiomeSample {
  color: Rgb; // terrain vertex color
  treeDensity: number; // 0..1 acceptance probability for scattering a tree here
  treeTint: Rgb; // foliage color
}

export class Biomes {
  private readonly moisture: Noise2D;

  constructor(
    seed: number,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly slopeAt: (x: number, z: number) => number,
    private readonly distanceToWater: (x: number, z: number) => number,
  ) {
    this.moisture = new Noise2D(seed);
  }

  /** Moisture in 0..1: low-frequency noise, wetter in lowlands, drier on heights. */
  moistureAt(x: number, z: number, elevation: number): number {
    const n = this.moisture.fbm(x, z, {
      octaves: BIOMES.moistureOctaves,
      frequency: BIOMES.moistureFrequency,
      lacunarity: 2,
      gain: 0.5,
    });
    let m = n * 0.5 + 0.5; // → 0..1
    m += elevation < 0 ? 0.18 : 0; // muskeg lowlands hold water
    m -= elevation > BIOMES.rockHeight ? 0.2 : 0; // exposed heights dry out
    return clamp01(m);
  }

  /** Classify (x, z) into blended biome color + tree density/tint. */
  sample(x: number, z: number): BiomeSample {
    const e = this.heightAt(x, z);
    const s = this.slopeAt(x, z);
    const m = this.moistureAt(x, z, e);
    const dw = this.distanceToWater(x, z); // <0 inside water, >0 on land

    // Meadow↔forest base by moisture.
    const forestW = smoothstep(BIOMES.forestMoistLow, BIOMES.forestMoistHigh, m);
    let color = mix(COL.meadow, COL.forest, forestW);
    let density = lerp(BIOMES.densMeadow, BIOMES.densForest, forestW);
    const tint = mix(TINT.meadow, TINT.forest, forestW);

    // Rock overlay: steep ground or high outcrops show bare granite.
    const rockW = Math.max(
      smoothstep(BIOMES.rockSlope - 0.12, BIOMES.rockSlope + 0.12, s),
      smoothstep(BIOMES.rockHeight - 2, BIOMES.rockHeight + 2, e),
    );
    color = mix(color, COL.rock, rockW);
    density = lerp(density, BIOMES.densRock, rockW);

    // Shore overlay: a sandy band just outside the waterline (and the submerged bed).
    const shoreW = dw <= 0 ? 1 : 1 - smoothstep(0, BIOMES.shoreWidth, dw);
    color = mix(color, COL.shore, shoreW);
    density = lerp(density, BIOMES.densShore, shoreW);
    if (dw <= 0) density = 0; // never scatter trees on the water itself

    return { color, treeDensity: clamp01(density), treeTint: tint };
  }
}

// --- palette as 0..1 rgb (parsed once from the config hex values) ---
const COL = {
  shore: hexToRgb(BIOMES.colorShore),
  meadow: hexToRgb(BIOMES.colorMeadow),
  forest: hexToRgb(BIOMES.colorForest),
  rock: hexToRgb(BIOMES.colorRock),
};
const TINT = {
  meadow: hexToRgb(BIOMES.tintMeadow),
  forest: hexToRgb(BIOMES.tintForest),
};

function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp01((x - lo) / (hi - lo || 1e-6));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
