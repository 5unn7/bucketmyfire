import Phaser from 'phaser';

/**
 * A living-world wind system: one wind vector whose direction slowly meanders
 * and whose strength gently gusts over time. Nothing about it is tied to the
 * camera — it keeps evolving whether the player is watching or not, so fires
 * develop a flankable "front" and smoke columns lean with the weather.
 *
 * Consumed by fire-spread logic (bias which way fires creep) and by smoke
 * (bend the plume via vx/vy). Direction wanders via a slowly-wandering angular
 * velocity (smooth, no snapping); strength is a couple of summed sines for an
 * organic gust feel.
 */
export class Wind {
  private _angle: number; // radians, current wind heading
  private angVel = 0; // rad/s, itself wanders slowly so direction meanders
  private elapsed = 0; // accumulated time (s) driving the gust sines
  private _strength = 0.6; // 0..1 normalized gust strength

  // Tuning. Rotation stays on the order of a few degrees/sec so the wind turns
  // gradually rather than spinning.
  private static readonly MAX_ANG_VEL = 0.08; // rad/s cap on direction drift
  private static readonly ANG_VEL_WANDER = 0.05; // rad/s of random nudge per second
  private static readonly STRENGTH_MIN = 0.25;
  private static readonly STRENGTH_MAX = 1.0;

  constructor(seedAngle?: number) {
    this._angle = seedAngle ?? Math.random() * Math.PI * 2;
  }

  /** Drift the heading and gust the strength. Call every frame. */
  update(dtMs: number): void {
    // Guard NaN / zero / negative dt so a stalled or hiccuping frame never throws.
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = dtMs / 1000;
    this.elapsed += dt;

    // The angular velocity itself wanders, so the heading meanders smoothly.
    this.angVel += (Math.random() - 0.5) * 2 * Wind.ANG_VEL_WANDER * dt;
    this.angVel = Phaser.Math.Clamp(this.angVel, -Wind.MAX_ANG_VEL, Wind.MAX_ANG_VEL);
    this._angle = Phaser.Math.Angle.Wrap(this._angle + this.angVel * dt);

    // Two summed sines at different rates read as organic gusting rather than a
    // single mechanical pulse. Mapped from [-1,1] into [STRENGTH_MIN, STRENGTH_MAX].
    const gust = Math.sin(this.elapsed * 0.6) * 0.6 + Math.sin(this.elapsed * 0.17) * 0.4;
    const t = (gust + 1) / 2; // 0..1
    this._strength = Wind.STRENGTH_MIN + (Wind.STRENGTH_MAX - Wind.STRENGTH_MIN) * t;
  }

  /** Current wind direction, radians. */
  get angle(): number {
    return this._angle;
  }

  /** Normalized gust strength, 0..1. */
  get strength(): number {
    return this._strength;
  }

  /** Wind vector x: cos(angle) scaled by strength. */
  get vx(): number {
    return Math.cos(this._angle) * this._strength;
  }

  /** Wind vector y: sin(angle) scaled by strength. */
  get vy(): number {
    return Math.sin(this._angle) * this._strength;
  }

  /**
   * Nudge a desired spread angle toward the wind. The blend grows with strength
   * so a stiff wind biases fires harder. Uses a shortest-arc rotate so a base
   * near -π and a wind near +π don't average to a bogus 0.
   */
  biasAngle(baseAngle: number): number {
    if (!Number.isFinite(baseAngle)) return this._angle;
    // 0.3..0.6 blend, scaled by how hard it's blowing right now.
    const blend = 0.3 + 0.3 * Phaser.Math.Clamp(this._strength, 0, 1);
    return Phaser.Math.Angle.RotateTo(baseAngle, this._angle, Math.PI * blend);
  }
}
