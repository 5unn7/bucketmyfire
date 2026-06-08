/**
 * Living-world wind, in the XZ ground plane. One vector whose direction slowly meanders and whose
 * strength gently gusts — it keeps evolving whether the player is watching or not, so fires develop a
 * flankable downwind front. Dependency-free (plain Math, no Phaser/Three).
 *
 * DETERMINISTIC + SHAREABLE. The organic meander is a PURE FUNCTION of `(seed, clock)` — smooth value
 * noise for BOTH the heading and the gust strength (integer-hash, no `Math.sin`, no `Math.random`, no
 * dt-integrated random walk). Integer-hash noise is bit-identical on every JS engine, and both channels
 * meander SLOWLY, so for Open Skies (free-for-all): when the caller feeds a SHARED absolute clock
 * (wall-clock seconds) every peer samples the same wind from that one clock, so fire fronts drift together
 * on all screens and a peer's water lands on the blaze you both see. The one inexactness is device
 * clock-skew: peers read their own wall clocks, which differ by the OS time error (sub-second in practice).
 * The slow noise rates are chosen so a sub-second skew shifts the wind only imperceptibly (proven by
 * scripts/verify-world.ts); exact cross-peer identity would need a negotiated shared clock (a future
 * upgrade — not needed while the actual fire knock-down is synced by broadcast douse, not by wind).
 * Feed no clock (the default) and it advances on local elapsed time instead: still fully deterministic
 * from the seed (the property the verify gates rely on), just private. (This closes the "Wind needs
 * seeding before peers can share wind" gap that scripts/verify-world.ts used to document.)
 *
 * The scripted reactive SHIFT (a MissionDirector 'wind' beat) is the one stateful, dt-eased part — it
 * overrides the organic heading while it runs, then re-centres the meander on the new heading. Beats are
 * campaign-only (single-player), so their easing never needs to be cross-client identical.
 */
export class Wind {
  private _angle: number; // live radians in the XZ plane (organic OR shift-driven)
  private baseAngle: number; // meander CENTRE — the organic heading wanders around this; a shift re-centres it
  private clock = 0; // seconds driving the noise + gust phase: shared wall-clock (FFA) or local elapsed (solo)
  private _strength = 0.6; // 0..1
  private readonly noiseSeed: number; // mixes into the value-noise hash → per-seed meander, identical across peers
  private readonly n0: number; // organic offset at clock 0 → solo missions begin exactly on their base heading (no snap)

  // Reactive SHIFT state (a MissionDirector 'wind' beat — e.g. a cold front backing the wind east).
  // While a heading shift is live it OVERRIDES the organic wander so "she's turning on the town" reads as
  // a clear, decisive swing; `_dynScale` ramps the gust strength up/down independently.
  private targetAngle: number | null = null;
  private angleEase = 0; // rad/s toward targetAngle
  private _dynScale = 1; // dynamic strength multiplier (1 = no beat active)
  private dynScaleTarget = 1;
  private dynScaleEase = 0; // per-sec toward dynScaleTarget

  // Heading meander scale. With the (octave − n0) centering the heading can wander up to ≈ ±2·WANDER_AMP
  // off its base in the extreme (typically far less); a swing develops over WANDER_RATE's timescale.
  private static readonly WANDER_AMP = 0.85; // rad
  private static readonly WANDER_RATE = 0.022; // noise units/sec — heading meander timescale (~45–90s/swing)
  private static readonly GUST_RATE = 0.03; // noise units/sec — gust timescale (~30–60s); SLOW on purpose so
  //                                           sub-second cross-device clock skew can't swing the strength.
  private static readonly STRENGTH_MIN = 0.25;
  private static readonly STRENGTH_MAX = 1.0;

  // Per-mission scale on the gusting strength: <1 calm, >1 a hard wind that drives the fire front harder
  // (the campaign passes this; the sandbox leaves it at 1).
  private readonly strengthScale: number;

  /**
   * @param seed        numeric seed (use the mission seed) — drives the meander hash AND, when no
   *                    `seedAngle` is given, the base heading. SAME seed → byte-identical wind everywhere.
   * @param seedAngle   optional authored base heading (rad); else derived deterministically from `seed`.
   * @param strengthScale per-mission gust multiplier.
   */
  constructor(seed: number, seedAngle?: number, strengthScale = 1) {
    this.noiseSeed = (Number.isFinite(seed) ? seed : 0) | 0;
    this.baseAngle =
      seedAngle !== undefined && Number.isFinite(seedAngle) ? seedAngle : hashUnit(0x9a17, this.noiseSeed) * Math.PI * 2;
    this.n0 = this.octave(0); // so organic(clock=0) === baseAngle (no first-frame heading snap)
    this._angle = this.baseAngle;
    this.strengthScale = Number.isFinite(strengthScale) && strengthScale > 0 ? strengthScale : 1;
  }

  /**
   * Advance the wind. `absSeconds`, when supplied, is a SHARED absolute clock (wall-clock seconds) — pass
   * it in free-for-all so every peer samples the identical wind; omit it for a private local-elapsed clock.
   * The organic heading + gust are recomputed as pure functions of that clock (dt-independent); only the
   * scripted shift / dynamic-strength easings consume `dt`.
   */
  update(dtMs: number, absSeconds?: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = dtMs / 1000;
    this.clock = absSeconds !== undefined && Number.isFinite(absSeconds) ? absSeconds : this.clock + dt;

    if (this.targetAngle !== null) {
      // A scripted shift is live: drive the heading decisively toward the target, overriding wander. On
      // arrival, re-centre the organic meander on the new heading so wander resumes there with no snap-back.
      const d = wrapPi(this.targetAngle - this._angle);
      const step = this.angleEase * dt;
      if (Math.abs(d) <= step) {
        this._angle = this.targetAngle;
        this.baseAngle = this.targetAngle;
        this.targetAngle = null;
        this.angleEase = 0;
      } else {
        this._angle = wrapPi(this._angle + Math.sign(d) * step);
      }
    } else {
      // Organic meander: PURE function of (seed, clock) — identical on every peer, no dt integration.
      this._angle = wrapPi(this.baseAngle + Wind.WANDER_AMP * (this.octave(this.clock * Wind.WANDER_RATE) - this.n0));
    }

    // Ease the dynamic gust-strength multiplier toward its scripted target (1 when no beat active).
    if (this._dynScale !== this.dynScaleTarget) {
      const ds = this.dynScaleEase * dt;
      if (Math.abs(this.dynScaleTarget - this._dynScale) <= ds) this._dynScale = this.dynScaleTarget;
      else this._dynScale += Math.sign(this.dynScaleTarget - this._dynScale) * ds;
    }

    // Gust strength on the SAME integer-hash value noise as the heading (NOT Math.sin) → bit-identical on
    // every JS engine, and slow (GUST_RATE) so a sub-second device-clock skew barely moves it. Two octaves
    // read as organic "the wind picks up and dies down" rather than a single pulse.
    const g =
      valueNoise(this.clock * Wind.GUST_RATE, this.noiseSeed ^ 0x1b873593) * 0.6 +
      valueNoise(this.clock * Wind.GUST_RATE * 3.1 + 5.0, this.noiseSeed ^ 0x2c1b3c6d) * 0.4;
    const t = clamp((g + 1) / 2, 0, 1);
    this._strength = Wind.STRENGTH_MIN + (Wind.STRENGTH_MAX - Wind.STRENGTH_MIN) * t;
  }

  /** Two-octave smooth value noise in ≈(-1,1) — the organic heading's meander shape. Pure, seed-keyed. */
  private octave(t: number): number {
    return valueNoise(t, this.noiseSeed) * 0.72 + valueNoise(t * 2.31 + 17.0, this.noiseSeed ^ 0x5bd1e995) * 0.28;
  }

  /**
   * Reactive wind BEAT (the MissionDirector calls this): ease the heading toward `angle` and/or the gust
   * strength toward `strengthScale×` over `seconds`. While a heading shift runs it overrides the organic
   * wander so the swing reads clearly. Either parameter is optional. (Campaign-only — see the class note.)
   */
  shiftTo(angle?: number, strengthScale?: number, seconds = 8): void {
    const s = Math.max(0.5, seconds);
    if (angle !== undefined && Number.isFinite(angle)) {
      this.targetAngle = wrapPi(angle);
      const d = Math.abs(wrapPi(this.targetAngle - this._angle));
      this.angleEase = Math.max(d / s, 0.01); // rad/s so we cover the shortest arc in ~seconds
    }
    if (strengthScale !== undefined && Number.isFinite(strengthScale) && strengthScale > 0) {
      this.dynScaleTarget = strengthScale;
      this.dynScaleEase = Math.max(Math.abs(strengthScale - this._dynScale) / s, 0.01);
    }
  }

  get angle(): number {
    return this._angle;
  }

  get strength(): number {
    return this._strength * this.strengthScale * this._dynScale;
  }

  // The wind direction the gust is easing TOWARD (the live angle when no shift is pending). A reactive
  // 'wind' beat sets the target via shiftTo; a same-frame ignite reads these so a wind-oriented fire (a
  // `line` front) is laid along the NEW wind, not the pre-shift vector.
  get intendedVx(): number {
    return Math.cos(this.targetAngle ?? this._angle) * this.strength;
  }

  get intendedVz(): number {
    return Math.sin(this.targetAngle ?? this._angle) * this.strength;
  }

  get vx(): number {
    return Math.cos(this._angle) * this.strength;
  }

  get vz(): number {
    return Math.sin(this._angle) * this.strength;
  }

  /** Nudge a base spread angle toward the wind, harder when it's blowing strong. */
  biasAngle(baseAngle: number): number {
    if (!Number.isFinite(baseAngle)) return this._angle;
    const blend = 0.3 + 0.3 * clamp(this.strength, 0, 1);
    // Shortest-arc rotate from base toward the wind by up to `blend * π`.
    let d = wrapPi(this._angle - baseAngle);
    d = clamp(d, -Math.PI * blend, Math.PI * blend);
    return wrapPi(baseAngle + d);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle to (-π, π]. */
function wrapPi(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

/** Deterministic 32-bit integer hash → [0,1). Mixes a lattice index with the wind's seed so distinct
 *  seeds meander independently while the SAME seed is byte-identical everywhere (the shareable property). */
function hashUnit(i: number, seed: number): number {
  let x = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1D value noise in (-1,1): smoothstep-interpolate between hashed integer-lattice points. */
function valueNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  const a = hashUnit(i, seed);
  const b = hashUnit(i + 1, seed);
  return (a + (b - a) * u) * 2 - 1;
}
