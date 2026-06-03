import * as THREE from 'three';
import { BUCKET3D } from '../config';

/**
 * The Bambi bucket as a 3D spring-damped pendulum — the payload physics from the
 * 2D prototype, now in world space. The bucket hangs roughly `ropeLength` below
 * the heli but LAGS in the XZ plane: it trails in turns, overshoots on stops, and
 * sags lower when full (a fuller bucket = heavier = laggier). Drops emit from
 * `position`, not the heli, so aggressive flying swings the bucket wide and costs
 * accuracy. Engine-agnostic: just a Vector3 the renderer reads out.
 */
export class BucketSim {
  readonly position = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  /** Eased forward scoop tilt (rad) — the renderer reads this to tip the mesh. */
  tip = 0;
  /** True while the bucket is resting on / dragging through terrain or treetops. */
  contact = false;
  /** Horizontal speed (units/s) of the bucket while in contact — drives spill/vfx/audio. */
  dragSpeed = 0;

  constructor(x: number, y: number, z: number) {
    this.position.set(x, y - BUCKET3D.ropeLength, z);
  }

  /**
   * Snap the bucket to a fixed resting spot with all motion zeroed — used to park it on the pad
   * ahead of the nose while the heli is landed (cold start). Zeroing the velocity means it doesn't
   * swing while parked AND doesn't fling outward when the pendulum (`update`) resumes on lift-off.
   */
  parkAt(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.tip = 0;
    this.contact = false;
    this.dragSpeed = 0;
  }

  /**
   * Step the pendulum. `anchor` = heli position, `velX/velZ` = heli horizontal
   * velocity (adds turn-trail sway), `fillRatio` 0..1 controls mass + sag,
   * `submerged` = the bucket is dipped in a lake (drives the physical scoop tip:
   * an eased forward tilt + a small downward dip while in the water).
   * `obstacleY` = the collision-surface height (ground or treetop) under the bucket
   * — the bucket can't sink below it and DRAGS while resting on it.
   */
  update(
    dtMs: number,
    anchor: THREE.Vector3,
    velX: number,
    velZ: number,
    fillRatio: number,
    submerged: boolean,
    obstacleY: number,
  ): void {
    let dt = dtMs / 1000;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > BUCKET3D.maxStep) dt = BUCKET3D.maxStep;

    const fill = Number.isFinite(fillRatio) ? clamp(fillRatio, 0, 1) : 0;
    const vAx = Number.isFinite(velX) ? velX : 0;
    const vAz = Number.isFinite(velZ) ? velZ : 0;

    // A full bucket is heavier → larger effective mass → more lag and overshoot.
    const mass = BUCKET3D.massEmpty + BUCKET3D.massFull * fill;

    // Rest target: hangs below the heli, sags more when full, trails opposite to
    // travel (turn-out sway), and dips a touch deeper while scooping.
    const targetX = anchor.x - vAx * BUCKET3D.swayFromVel;
    const targetZ = anchor.z - vAz * BUCKET3D.swayFromVel;
    const targetY =
      anchor.y - BUCKET3D.ropeLength - BUCKET3D.fullSag * fill - (submerged ? BUCKET3D.scoopDip : 0);

    // LATERAL (XZ): spring-damper so the bucket lags/sways/overshoots in turns.
    // Both ÷ mass so a fuller load is laggier. Semi-implicit Euler per axis.
    this.integrateAxis('x', targetX, mass, dt);
    this.integrateAxis('z', targetZ, mass, dt);

    // SOFT ROPE: the bucket may swing but the (mostly vertical) rope goes taut at
    // maxSwing — clamp the horizontal offset back and kill the outward velocity so
    // it doesn't keep pulling past the constraint.
    const dx = this.position.x - anchor.x;
    const dz = this.position.z - anchor.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz > BUCKET3D.maxSwing) {
      const k = BUCKET3D.maxSwing / horiz;
      this.position.x = anchor.x + dx * k;
      this.position.z = anchor.z + dz * k;
      // Remove the component of velocity pointing outward along the rope.
      const nx = dx / horiz;
      const nz = dz / horiz;
      const outward = this.vel.x * nx + this.vel.z * nz;
      if (outward > 0) {
        this.vel.x -= outward * nx;
        this.vel.z -= outward * nz;
      }
    }

    // VERTICAL (Y): smooth lerp follow (no spring, so no bounce) whose tightness
    // scales with load — a light bucket follows loosely so the line has give, a full
    // bucket follows tightly so the taut, weighted line reads rigid. Per design feedback.
    const followY = BUCKET3D.verticalFollowEmpty + (BUCKET3D.verticalFollowFull - BUCKET3D.verticalFollowEmpty) * fill;
    this.position.y += (targetY - this.position.y) * followY;
    this.vel.y = 0;

    // COLLISION: the bucket can't pass through the ground or the treetops. If its
    // underside has sunk below the surface under it, sit it back on top and DRAG its
    // horizontal velocity — so it scrapes along the dirt and snags in the canopy,
    // lagging behind the heli until you climb out. Deeper contact (dropped down into
    // a tall canopy) grabs harder, so trees catch more than open ground.
    const underside = this.position.y - BUCKET3D.bottomOffset;
    const penetration = obstacleY - underside;
    if (penetration > 0) {
      this.position.y = obstacleY + BUCKET3D.bottomOffset; // rest on the surface
      const grab = 1 + Math.min(1, penetration / BUCKET3D.grabDepth); // 1..2
      const keep = Math.max(0, 1 - BUCKET3D.groundDrag * grab * dt);
      this.vel.x *= keep;
      this.vel.z *= keep;
      this.contact = true;
      this.dragSpeed = Math.hypot(this.vel.x, this.vel.z);
    } else {
      this.contact = false;
      this.dragSpeed = 0;
    }

    // Physical scoop tip: ease a forward tilt in while submerged, level out clear.
    this.tip += ((submerged ? BUCKET3D.scoopTip : 0) - this.tip) * BUCKET3D.tipEase;
  }

  private integrateAxis(axis: 'x' | 'z', target: number, mass: number, dt: number): void {
    const a = (BUCKET3D.stiffness * (target - this.position[axis]) - BUCKET3D.damping * this.vel[axis]) / mass;
    this.vel[axis] += a * dt;
    this.position[axis] += this.vel[axis] * dt;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
