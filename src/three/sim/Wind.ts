/**
 * Living-world wind, in the XZ ground plane. One vector whose direction slowly
 * meanders and whose strength gently gusts — it keeps evolving whether the
 * player is watching or not, so fires develop a flankable downwind front. A
 * dependency-free port of the 2D Wind (no Phaser), using plain Math.
 */
export class Wind {
  private _angle: number; // radians in the XZ plane
  private angVel = 0; // rad/s, itself wanders so the heading meanders smoothly
  private elapsed = 0; // accumulated seconds driving the gust sines
  private _strength = 0.6; // 0..1

  // Reactive SHIFT state (a MissionDirector 'wind' beat — e.g. a cold front backing the wind east).
  // While a heading shift is live it OVERRIDES the organic wander so "she's turning on the town"
  // reads as a clear, decisive swing; `_dynScale` ramps the gust strength up/down independently.
  private targetAngle: number | null = null;
  private angleEase = 0; // rad/s toward targetAngle
  private _dynScale = 1; // dynamic strength multiplier (1 = no beat active)
  private dynScaleTarget = 1;
  private dynScaleEase = 0; // per-sec toward dynScaleTarget

  private static readonly MAX_ANG_VEL = 0.08; // rad/s cap on direction drift
  private static readonly WANDER = 0.05; // rad/s of random nudge per second
  private static readonly STRENGTH_MIN = 0.25;
  private static readonly STRENGTH_MAX = 1.0;

  // Per-mission scale on the gusting strength: <1 calm, >1 a hard wind that drives the
  // fire front harder (the campaign passes this; the sandbox leaves it at 1).
  private readonly strengthScale: number;

  constructor(seedAngle?: number, strengthScale = 1) {
    this._angle = seedAngle ?? Math.random() * Math.PI * 2;
    this.strengthScale = Number.isFinite(strengthScale) && strengthScale > 0 ? strengthScale : 1;
  }

  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = dtMs / 1000;
    this.elapsed += dt;

    if (this.targetAngle !== null) {
      // A scripted shift is live: drive the heading decisively toward the target, overriding wander.
      const d = wrapPi(this.targetAngle - this._angle);
      const step = this.angleEase * dt;
      if (Math.abs(d) <= step) {
        this._angle = this.targetAngle;
        this.targetAngle = null;
        this.angVel = 0;
      } else {
        this._angle = wrapPi(this._angle + Math.sign(d) * step);
      }
    } else {
      // The angular velocity wanders, so the heading turns gradually, never spins.
      this.angVel += (Math.random() - 0.5) * 2 * Wind.WANDER * dt;
      this.angVel = clamp(this.angVel, -Wind.MAX_ANG_VEL, Wind.MAX_ANG_VEL);
      this._angle = wrapPi(this._angle + this.angVel * dt);
    }

    // Ease the dynamic gust-strength multiplier toward its scripted target (1 when no beat active).
    if (this._dynScale !== this.dynScaleTarget) {
      const ds = this.dynScaleEase * dt;
      if (Math.abs(this.dynScaleTarget - this._dynScale) <= ds) this._dynScale = this.dynScaleTarget;
      else this._dynScale += Math.sign(this.dynScaleTarget - this._dynScale) * ds;
    }

    // Two summed sines read as organic gusting rather than a single pulse.
    const gust = Math.sin(this.elapsed * 0.6) * 0.6 + Math.sin(this.elapsed * 0.17) * 0.4;
    const t = (gust + 1) / 2;
    this._strength = Wind.STRENGTH_MIN + (Wind.STRENGTH_MAX - Wind.STRENGTH_MIN) * t;
  }

  /**
   * Reactive wind BEAT (the MissionDirector calls this): ease the heading toward `angle` and/or the
   * gust strength toward `strengthScale×` over `seconds`. While a heading shift runs it overrides the
   * organic wander so the swing reads clearly. Either parameter is optional.
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

  // The wind direction the gust is easing TOWARD (the live angle when no shift is pending). A
  // reactive 'wind' beat sets the target via shiftTo; a same-frame ignite reads these so a
  // wind-oriented fire (a `line` front) is laid along the NEW wind, not the pre-shift vector.
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
