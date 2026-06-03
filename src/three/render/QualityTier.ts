import { QUALITY } from '../config';

/**
 * Quality tiers (B0). Picks an initial preset from a coarse device probe, then runs
 * an adaptive watchdog: if the smoothed frame time sits over budget for a sustained
 * window, it steps DOWN one tier (never up — avoids oscillation). Only the CHEAP,
 * recompile-free knobs change at runtime (DPR + shadow on/off); load-time fields
 * (shadow-map size, water tessellation) are read once at construction. The renderer
 * layer subscribes via `onChange` to re-apply DPR/shadows; everything else reads
 * `current` at build time.
 */

export type TierName = 'low' | 'med' | 'high';

export interface QualitySettings {
  readonly name: TierName;
  readonly dprCap: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly waterSegments: number;
  readonly terrainSegments: number;
  readonly bloom: number; // post-process glow render scale: 0 off, 0.5 half-res, 1 full
}

const ORDER: TierName[] = ['high', 'med', 'low'];

export class QualityTier {
  current: QualitySettings;
  private emaMs = 16.7; // smoothed frame time
  private overBudgetSec = 0;
  private listener?: (s: QualitySettings) => void;

  constructor(forced?: TierName) {
    const name = forced ?? detectTier();
    this.current = QUALITY.presets[name];
  }

  /** Subscribe the renderer to tier changes (re-apply DPR / shadows). */
  onChange(cb: (s: QualitySettings) => void): void {
    this.listener = cb;
  }

  /** Feed each frame's dt (seconds). Steps the tier down if sustained over budget. */
  sample(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const ms = dt * 1000;
    this.emaMs += (ms - this.emaMs) * QUALITY.emaAlpha;

    if (this.emaMs > QUALITY.downgradeMs) {
      this.overBudgetSec += dt;
      if (this.overBudgetSec >= QUALITY.downgradeWindowSec) {
        this.downgrade();
        this.overBudgetSec = 0;
        this.emaMs = 16.7; // reset so we re-measure at the new tier before stepping again
      }
    } else {
      this.overBudgetSec = Math.max(0, this.overBudgetSec - dt);
    }
  }

  private downgrade(): void {
    const i = ORDER.indexOf(this.current.name);
    if (i < 0 || i >= ORDER.length - 1) return; // already at 'low'
    this.current = QUALITY.presets[ORDER[i + 1]];
    this.listener?.(this.current);
  }
}

/** Coarse one-shot device probe → starting tier. Errs toward safe (lower) on mobile. */
function detectTier(): TierName {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const cores = nav?.hardwareConcurrency ?? 4;
  const ua = nav?.userAgent ?? '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (mobile) return cores >= 8 ? 'med' : 'low';
  return cores >= 8 ? 'high' : 'med';
}
