import { QUALITY } from '../config';

/**
 * Quality tiers (B0). Picks an initial preset from a coarse device probe — that preset
 * fixes SCENE COMPLEXITY at load (shadows, tessellation, post-fx) and never changes
 * afterward (those knobs would recompile shaders / rebuild geometry).
 *
 * Render RESOLUTION is a separate, recompile-free lever. A frame-time watchdog scales
 * the live `dpr` within `[dprMin .. dprMax]`: it steps DOWN when the smoothed frame
 * time sits over budget, and — unlike the old one-way tier ratchet — steps back UP when
 * there's sustained headroom. So a transient stall (asset load, GC pause, tab switch)
 * can't strand the device at a permanently blurry resolution. `main.ts` subscribes via
 * `onDpr` and re-applies `dpr` to the renderer + composer; everything else reads
 * `current.*` (the load-time scene fields) once at construction.
 */

export type TierName = 'low' | 'med' | 'high';

export interface QualitySettings {
  readonly name: TierName;
  readonly dprCap: number; // per-tier render-resolution ceiling (clamped by the device DPR)
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly waterSegments: number;
  readonly terrainSegments: number;
  readonly bloom: number; // > 0 enables the post-fx composer; 0 = bare renderer (cheapest)
  readonly msaa: number; // composer multisample count (0 = none)
}

export class QualityTier {
  /** Load-time scene-complexity preset (shadows, tessellation, post-fx). Fixed after construction. */
  current: QualitySettings;
  /** Live render DPR — the one runtime-adaptive lever. Read by the renderer + composer. */
  dpr: number;

  private readonly dprMax: number;
  private readonly dprMin: number;
  private emaMs = 16.7; // smoothed frame time
  private overSec = 0; // accumulated time spent over budget
  private underSec = 0; // accumulated time spent with headroom
  private listener?: (dpr: number) => void;

  constructor(forced?: TierName) {
    const name = forced ?? detectTier();
    this.current = QUALITY.presets[name];
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dprMax = Math.min(deviceDpr, this.current.dprCap);
    this.dprMin = Math.min(this.dprMax, QUALITY.dpr.floor);
    this.dpr = this.dprMax; // start sharp; the watchdog only lowers DPR if the device can't hold it
  }

  /** Subscribe to live DPR changes (re-apply to the renderer + composer). */
  onDpr(cb: (dpr: number) => void): void {
    this.listener = cb;
  }

  /** Feed each frame's dt (seconds). Scales DPR down under sustained load, up under headroom. */
  sample(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const ms = dt * 1000;
    this.emaMs += (ms - this.emaMs) * QUALITY.emaAlpha;

    if (this.dprMax <= this.dprMin) return; // no resolution headroom to adapt (e.g. a DPR-1 display)

    if (this.emaMs > QUALITY.downgradeMs) {
      this.underSec = 0;
      this.overSec += dt;
      if (this.overSec >= QUALITY.downgradeWindowSec) this.step(-QUALITY.dpr.step);
    } else if (this.emaMs < QUALITY.upgradeMs) {
      this.overSec = 0;
      this.underSec += dt;
      if (this.underSec >= QUALITY.dpr.upWindowSec) this.step(QUALITY.dpr.step);
    } else {
      // Dead zone between the up/down thresholds — bleed both accumulators so we don't oscillate.
      this.overSec = Math.max(0, this.overSec - dt);
      this.underSec = Math.max(0, this.underSec - dt);
    }
  }

  /** Nudge DPR by `delta`, clamped to the device range, and notify if it actually moved. */
  private step(delta: number): void {
    this.overSec = 0;
    this.underSec = 0;
    const next = Math.min(this.dprMax, Math.max(this.dprMin, this.dpr + delta));
    if (next === this.dpr) return; // already pinned at a bound
    this.dpr = next;
    this.emaMs = 16.7; // reset so we re-measure at the new resolution before stepping again
    this.listener?.(next);
  }
}

/** Coarse one-shot device probe → starting tier. Errs toward safe (lower) on mobile. Exported so
 *  load-time consumers (e.g. Fauna's heavy-GLB gate) can make the same low/med/high decision without
 *  threading a QualityTier instance through every constructor. */
export function detectTier(): TierName {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const cores = nav?.hardwareConcurrency ?? 4;
  const ua = nav?.userAgent ?? '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  if (mobile) return cores >= 8 ? 'med' : 'low';
  return cores >= 8 ? 'high' : 'med';
}
