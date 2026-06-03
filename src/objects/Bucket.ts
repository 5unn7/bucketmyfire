import Phaser from 'phaser';
import { HELI } from '../constants';

/**
 * Bambi bucket slung under the helicopter on a rope.
 *
 * Modeled as a spring-damped pendulum so the load LAGS behind the aircraft in
 * turns, OVERSHOOTS when you stop, and sways on the line — GTA-style payload
 * physics. This is both feel and skill: water drops emit from the *bucket's*
 * position (see `x`/`y`), not the heli's, so flying aggressively swings the
 * bucket wide and costs you bombing accuracy. Fly smooth to bomb true.
 *
 * The bucket has no real Z; like the heli, "hang" is a render trick. It draws
 * itself every frame from raw Graphics primitives (a thin rope line + a small
 * open cylinder with a rising water level) so there is zero asset coupling — no
 * texture key, no PreloadScene touch. A full bucket reads heavier: bigger
 * effective mass means more lag/overshoot and a slower settle, plus it sags a
 * little lower on the rope.
 */

const BUCKET_PHYS = {
  /** Spring constant pulling the bucket toward the heli anchor (1/s^2-ish). Higher = stiffer rope, tracks tighter. */
  stiffness: 90,
  /** Velocity damping (1/s). Higher = swings die out faster, less ringing. */
  damping: 9,
  /** Effective mass when empty. The spring/damper are divided by mass, so a heavier load lags and settles slower. */
  massEmpty: 1.0,
  /** Extra effective mass at full fill. Full bucket = massEmpty + massFull → noticeably laggier, overshoots more. */
  massFull: 1.6,
  /** Resting downward offset (px) of an empty bucket below the anchor — the slack in the rope at rest. */
  restSag: 14,
  /** Additional downward sag (px) at full fill — the weight pulls the bucket lower. */
  fullSag: 12,
  /** Turn-induced sway: fraction of heli velocity (px/s) blended into the rest target so the bucket trails travel. */
  swayFromVel: 0.06,
  /** Max integration step (s). Clamps huge frame gaps so the spring can't explode after a stall. */
  maxStep: 1 / 30,
  /** Visual bucket half-width (px) when empty. Grows slightly with fill. */
  width: 9,
  /** Visual bucket height (px). */
  height: 12,
} as const;

export class Bucket {
  private readonly gfx: Phaser.GameObjects.Graphics;

  // Bucket world position and its velocity — integrated by the spring-damper.
  private px: number;
  private py: number;
  private vx = 0;
  private vy = 0;

  // Where the rope attaches (the heli), tracked so render uses the latest anchor.
  private anchorX: number;
  private anchorY: number;

  private fill = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.px = x;
    this.py = y + BUCKET_PHYS.restSag;
    this.anchorX = x;
    this.anchorY = y;
    // Between shadow (depth 1) and heli (depth 100): the load reads as hanging below.
    this.gfx = scene.add.graphics().setDepth(50);
  }

  get x(): number {
    return this.px;
  }

  get y(): number {
    return this.py;
  }

  /**
   * Step the pendulum and redraw. `anchorX/Y` = heli position, `velX/Y` = heli
   * velocity in px/s (adds turn-induced sway so the bucket trails travel), and
   * `fillRatio` in 0..1 controls effective mass, sag and the water level.
   */
  update(
    dtMs: number,
    anchorX: number,
    anchorY: number,
    velX: number,
    velY: number,
    fillRatio: number,
  ): void {
    // Guard against NaN / zero / runaway dt — never throw, never explode.
    let dt = dtMs / 1000;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > BUCKET_PHYS.maxStep) dt = BUCKET_PHYS.maxStep;

    this.anchorX = Number.isFinite(anchorX) ? anchorX : this.anchorX;
    this.anchorY = Number.isFinite(anchorY) ? anchorY : this.anchorY;
    const vAnchorX = Number.isFinite(velX) ? velX : 0;
    const vAnchorY = Number.isFinite(velY) ? velY : 0;
    this.fill = Number.isFinite(fillRatio) ? Phaser.Math.Clamp(fillRatio, 0, 1) : 0;

    // A full bucket is heavier → larger effective mass → more lag and overshoot.
    const mass = BUCKET_PHYS.massEmpty + BUCKET_PHYS.massFull * this.fill;

    // Rest target: hangs below the anchor, sagging more when full, and trailing
    // opposite to travel so the load swings out behind the heli in turns.
    const sag = BUCKET_PHYS.restSag + BUCKET_PHYS.fullSag * this.fill;
    const targetX = this.anchorX - vAnchorX * BUCKET_PHYS.swayFromVel;
    const targetY = this.anchorY + sag - vAnchorY * BUCKET_PHYS.swayFromVel;

    // Spring pulls toward the target; damping bleeds off velocity. Both scale
    // down by mass so the heavier (fuller) load accelerates and settles slower.
    const ax = (BUCKET_PHYS.stiffness * (targetX - this.px) - BUCKET_PHYS.damping * this.vx) / mass;
    const ay = (BUCKET_PHYS.stiffness * (targetY - this.py) - BUCKET_PHYS.damping * this.vy) / mass;

    // Semi-implicit Euler: update velocity first, then position. Stable for the
    // stiffness/damping range above across the heli's 0..maxSpeed envelope.
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.px += this.vx * dt;
    this.py += this.vy * dt;

    this.draw();
  }

  setVisible(v: boolean): void {
    this.gfx.setVisible(v);
  }

  destroy(): void {
    this.gfx.destroy();
  }

  /** Redraw rope + bucket + water level from scratch each frame. */
  private draw(): void {
    const g = this.gfx;
    g.clear();

    // Rope: thin dark line from the heli anchor down to the top of the bucket.
    g.lineStyle(2, 0x2a2118, 0.85);
    g.beginPath();
    g.moveTo(this.anchorX, this.anchorY);
    g.lineTo(this.px, this.py - BUCKET_PHYS.height * 0.5);
    g.strokePath();

    // Bucket body: a small open cylinder (rounded rect), reddish-orange. Widens
    // a touch when full so a heavy load reads as bulging.
    const hw = BUCKET_PHYS.width + this.fill * 2;
    const h = BUCKET_PHYS.height;
    const left = this.px - hw;
    const top = this.py - h * 0.5;

    g.fillStyle(0xb5482a, 1); // canvas/rubber bucket
    g.fillRoundedRect(left, top, hw * 2, h, 3);

    // Water level inside, rising with fill (blue), inset from the rim.
    if (this.fill > 0.02) {
      const inset = 2;
      const innerW = hw * 2 - inset * 2;
      const innerMaxH = h - inset * 2;
      const waterH = innerMaxH * this.fill;
      const waterTop = top + inset + (innerMaxH - waterH);
      g.fillStyle(0x2f7d96, 0.95);
      g.fillRoundedRect(left + inset, waterTop, innerW, waterH, 2);
    }

    // Dark rim line so the open top reads as a mouth, not a solid block.
    g.lineStyle(1.5, 0x6e2a16, 1);
    g.strokeRoundedRect(left, top, hw * 2, h, 3);
  }
}

// HELI.maxSpeed (360 px/s) is the envelope BUCKET_PHYS is tuned against — at top
// speed the bucket trails and sways readably without jitter, and snaps overshoot
// on a hard stop. Imported so the tuning intent is explicit and self-documenting.
void HELI.maxSpeed;
