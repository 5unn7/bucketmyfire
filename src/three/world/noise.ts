/**
 * Hand-rolled seeded value-gradient noise for the generative world (Track A1).
 *
 * One dependency-free 2D **simplex** primitive (Gustavson's "simplex noise
 * demystified", with a seeded permutation table) plus the standard composites
 * built on it: **FBM** (fractal sum of octaves → natural rolling), **ridged** FBM
 * (1−|n|, squared → sharp crests for rocky bedrock outcrops), and **domain warp**
 * (perturb the sample coordinates by noise → meandering, esker-like ridgelines
 * instead of straight grid-aligned ones).
 *
 * Determinism: the whole table derives from one integer seed (mulberry32 shuffle),
 * so the same `WORLD3D.seed` always rebuilds the identical landscape — the roadmap's
 * determinism invariant. All sampling is a pure function of world (x, y); nothing
 * here knows about Three or the scene, so it sits behind `World.groundHeightAt`.
 */

export interface FbmParams {
  octaves: number;
  frequency: number; // world-units → noise space (lower = broader landforms)
  lacunarity: number; // frequency multiplier per octave
  gain: number; // amplitude multiplier per octave
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// 12 gradient directions (the classic 3D table; we use the x,y components in 2D).
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];

export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly permMod12 = new Uint8Array(512);

  constructor(seed: number) {
    // Seeded Fisher–Yates shuffle of 0..255 (mulberry32 stream).
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  /** 2D simplex noise in roughly [-1, 1]. */
  simplex(xin: number, yin: number): number {
    const perm = this.perm;
    const permMod12 = this.permMod12;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    let i1: number;
    let j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1 + perm[jj + 1]];

    let n0 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      n0 = t0 * t0 * (GRAD[gi0][0] * x0 + GRAD[gi0][1] * y0);
    }
    let n1 = 0;
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      n1 = t1 * t1 * (GRAD[gi1][0] * x1 + GRAD[gi1][1] * y1);
    }
    let n2 = 0;
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      n2 = t2 * t2 * (GRAD[gi2][0] * x2 + GRAD[gi2][1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Fractal Brownian motion: summed octaves, normalized to ~[-1, 1]. */
  fbm(x: number, y: number, p: FbmParams): number {
    let amp = 1;
    let freq = p.frequency;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < p.octaves; o++) {
      sum += amp * this.simplex(x * freq, y * freq);
      norm += amp;
      amp *= p.gain;
      freq *= p.lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /** Ridged multifractal: (1−|n|)² per octave → sharp crests. Normalized ~[0, 1]. */
  ridged(x: number, y: number, p: FbmParams): number {
    let amp = 1;
    let freq = p.frequency;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < p.octaves; o++) {
      const n = 1 - Math.abs(this.simplex(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= p.gain;
      freq *= p.lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /**
   * Domain warp: displace (x, y) by two independent low-octave FBM channels before
   * the caller samples its real height there. This is what bends ridges/valleys into
   * winding, glacial shapes instead of straight noise contours.
   */
  warp(x: number, y: number, strength: number, frequency: number): [number, number] {
    const p: FbmParams = { octaves: 3, frequency, lacunarity: 2, gain: 0.5 };
    const wx = this.fbm(x + 11.3, y + 17.7, p);
    const wy = this.fbm(x - 23.1, y + 5.2, p);
    return [x + wx * strength, y + wy * strength];
  }
}
