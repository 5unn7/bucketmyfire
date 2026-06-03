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

  private static readonly MAX_ANG_VEL = 0.08; // rad/s cap on direction drift
  private static readonly WANDER = 0.05; // rad/s of random nudge per second
  private static readonly STRENGTH_MIN = 0.25;
  private static readonly STRENGTH_MAX = 1.0;

  constructor(seedAngle?: number) {
    this._angle = seedAngle ?? Math.random() * Math.PI * 2;
  }

  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const dt = dtMs / 1000;
    this.elapsed += dt;

    // The angular velocity wanders, so the heading turns gradually, never spins.
    this.angVel += (Math.random() - 0.5) * 2 * Wind.WANDER * dt;
    this.angVel = clamp(this.angVel, -Wind.MAX_ANG_VEL, Wind.MAX_ANG_VEL);
    this._angle = wrapPi(this._angle + this.angVel * dt);

    // Two summed sines read as organic gusting rather than a single pulse.
    const gust = Math.sin(this.elapsed * 0.6) * 0.6 + Math.sin(this.elapsed * 0.17) * 0.4;
    const t = (gust + 1) / 2;
    this._strength = Wind.STRENGTH_MIN + (Wind.STRENGTH_MAX - Wind.STRENGTH_MIN) * t;
  }

  get angle(): number {
    return this._angle;
  }

  get strength(): number {
    return this._strength;
  }

  get vx(): number {
    return Math.cos(this._angle) * this._strength;
  }

  get vz(): number {
    return Math.sin(this._angle) * this._strength;
  }

  /** Nudge a base spread angle toward the wind, harder when it's blowing strong. */
  biasAngle(baseAngle: number): number {
    if (!Number.isFinite(baseAngle)) return this._angle;
    const blend = 0.3 + 0.3 * clamp(this._strength, 0, 1);
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
