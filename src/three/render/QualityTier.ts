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
  readonly treeViewDist: number; // forest chunk cull radius (med/high reach toward the fog; low stays tight)
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
    // Desktop starts SHARP and the watchdog only steps down if the machine can't hold it.
    // MOBILE starts at the FLOOR and climbs. Boot is the heaviest moment in the whole session (world
    // gen, terrain build, texture upload) and it is exactly when a phone can least afford to also be
    // rendering at 2x: starting at dprMax meant seconds of visible stutter before the watchdog's 2.5s
    // over-budget window could react, on top of the memory spike that can cost the GL context. The
    // watchdog raises DPR after `dpr.upWindowSec` of headroom, so a phone that CAN hold it still gets
    // there a few seconds in, having stayed smooth throughout.
    const mobile = typeof navigator !== 'undefined'
      && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? '');
    this.dpr = mobile ? this.dprMin : this.dprMax;
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

/** The GPU's own name, via WEBGL_debug_renderer_info (`UNMASKED_RENDERER_WEBGL`). Far better evidence
 *  than core count for what a device can actually draw. Returns '' when unavailable (the extension is
 *  hidden in some privacy modes) — callers must treat '' as "no information", never as "weak". The probe
 *  context is released immediately so it can't count against the browser's live-context budget. */
function gpuName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** Mobile GPUs strong enough for the `med` preset (shadows + the full post-fx composer at DPR 2).
 *  Deliberately an ALLOWLIST of current flagship silicon, not a blocklist of weak parts: new budget
 *  chips ship constantly and must default to safe, whereas the flagship families are a short, stable
 *  list. Adreno 7xx/8xx (Snapdragon 8 Gen 1+), Mali-G7xx / Immortalis (Dimensity 9000+, Exynos 2200+),
 *  and Apple's desktop-class GPUs. */
const STRONG_MOBILE_GPU = /Adreno \(TM\) (7\d\d|8\d\d)|Adreno (7\d\d|8\d\d)|Mali-G7\d\d|Immortalis|Apple (A1[5-9]|A[2-9]\d|M\d)/i;

/**
 * Coarse one-shot device probe → starting tier. Errs toward safe (lower) on mobile. Exported so
 * load-time consumers (e.g. Fauna's heavy-GLB gate) can make the same low/med/high decision without
 * threading a QualityTier instance through every constructor.
 *
 * MOBILE RULE CHANGED (Android jitter / black-screen fix). This used to be
 * `mobile ? (cores >= 8 ? 'med' : 'low')`, which is close to useless on Android: essentially EVERY
 * Android SoC is octa-core big.LITTLE, from a $150 handset to a flagship, so `hardwareConcurrency >= 8`
 * promoted nearly every Android phone to `med`. That is a huge jump — `low` runs at DPR 1 with no
 * shadows and NO post-fx composer at all, while `med` adds shadow maps, heavier tessellation and a
 * full EffectComposer (HDR half-float targets) at DPR 2. On a budget Adreno that means fill-rate
 * collapse (the jitter) and enough GPU memory pressure to lose the WebGL context (the black screen).
 * The irony: iOS Safari CAPS `hardwareConcurrency` low, so iPhones — the stronger devices — were
 * correctly landing on `low` while weak Androids were not.
 *
 * Now the GPU name decides, and mobile defaults to `low` unless the part is demonstrably flagship.
 * A device with no GPU string available stays `low`: on mobile, absence of evidence is not evidence
 * of capability. Desktop keeps the core-count heuristic, where it is a reasonable proxy and where a
 * misjudgement is not fatal.
 */
export function detectTier(): TierName {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const cores = nav?.hardwareConcurrency ?? 4;
  const ua = nav?.userAgent ?? '';
  // iPadOS reports a desktop UA, so also treat a touch-capable "Mac" as mobile.
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    || (/Macintosh/i.test(ua) && (nav?.maxTouchPoints ?? 0) > 1);
  if (mobile) {
    // deviceMemory is Chromium-only (undefined elsewhere); when present, <4 GB is a hard 'low'.
    const mem = (nav as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory;
    if (typeof mem === 'number' && mem < 4) return 'low';
    return STRONG_MOBILE_GPU.test(gpuName()) ? 'med' : 'low';
  }
  return cores >= 8 ? 'high' : 'med';
}
