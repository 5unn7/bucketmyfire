import * as THREE from 'three';
import { CAMERA } from './config';
import { World } from './World';

/** Free-look orbit input fed in from Input's "eye" button. When `active`, the
 *  rates spin the camera around the heli (held = continuous, so a full 360°);
 *  on release it eases back to the default trail. */
export interface LookOffset {
  active: boolean;
  yawRate: number; // horizontal orbit speed, rad/sec (sign = direction)
  pitchRate: number; // vertical orbit speed, rad/sec (+ = rise & look down)
}

/**
 * Forza/GTA-style follow camera. It trails a fixed distance behind the
 * helicopter's heading, lifted above it, and aims at a point slightly ahead of
 * the nose. Position and aim are both eased (framerate-independent lerp) so the
 * camera flows through turns instead of snapping — that smoothing is a big part
 * of why a chase cam reads as "cinematic" rather than rigid.
 *
 * The "eye" button feeds in a {@link LookOffset}: while it's active the camera
 * orbits freely around the heli by the dragged angles; on release the offsets
 * ease back to zero so the view settles into the default trailing pose.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly lookTarget = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private initialized = false;
  // Accumulated orbit offsets — integrated from the drag rate while looking, then
  // eased back to 0 on release. `wasLooking` catches the release edge.
  private curYaw = 0;
  private curPitch = 0;
  private wasLooking = false;

  constructor(aspect: number, private readonly world: World) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 2000);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Re-aim behind `pos` for heading `yaw`. Call every frame after the sim. */
  update(dt: number, pos: THREE.Vector3, yaw: number, look?: LookOffset): void {
    // Free-look: while active, INTEGRATE the drag rate so a held stick spins the
    // camera continuously (a full 360° and beyond — yaw is unbounded, trig wraps it).
    // On release, fold any accumulated spins into (-π, π] so the ease takes the SHORT
    // way home, then lerp both offsets back to 0 (the default trailing pose).
    if (look?.active) {
      this.curYaw += look.yawRate * dt;
      this.curPitch = clampN(this.curPitch + look.pitchRate * dt, CAMERA.lookPitchMin, CAMERA.lookPitchMax);
    } else {
      if (this.wasLooking) this.curYaw = wrapPi(this.curYaw);
      const lookA = 1 - Math.pow(1 - CAMERA.lookReturnLerp, dt * 60);
      this.curYaw -= this.curYaw * lookA;
      this.curPitch -= this.curPitch * lookA;
    }
    this.wasLooking = !!look?.active;

    // World-forward for this heading (matches the sim's convention).
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);

    // Default trail sits at angle `atan2(-fz,-fx)` behind the heli; free-look adds
    // `curYaw` around it and `curPitch` lifts the cam, shrinking the horizontal reach
    // so it orbits over the top rather than just drifting outward. With both offsets
    // at 0 this reproduces the plain `pos - forward*distance` trail exactly.
    const ang = Math.atan2(-fz, -fx) + this.curYaw;
    const horiz = Math.cos(this.curPitch);
    this.desiredPos.set(
      pos.x + Math.cos(ang) * CAMERA.distance * horiz,
      pos.y + CAMERA.height + Math.sin(this.curPitch) * CAMERA.distance,
      pos.z + Math.sin(ang) * CAMERA.distance * horiz,
    );
    // Ground-clearance guard: never let the cam sink below the terrain at its own
    // XZ (the trail point can be over a hill higher than the heli). Lift it to a
    // minimum clearance above the ground there so we never clip through a ridge.
    const groundMin = this.world.groundHeightAt(this.desiredPos.x, this.desiredPos.z) + CAMERA.minGroundClearance;
    if (this.desiredPos.y < groundMin) this.desiredPos.y = groundMin;
    // Aim ahead of the nose normally; as the orbit swings round the side/front, fade
    // the lead to 0 so the camera keeps looking right at the heli instead of past it.
    const ahead = CAMERA.lookAhead * Math.max(0, 1 - Math.abs(this.curYaw) / (Math.PI * 0.5));
    this.desiredLook.set(pos.x + fx * ahead, pos.y, pos.z + fz * ahead);

    if (!this.initialized) {
      // Snap on the first frame so we don't sweep in from the origin.
      this.camera.position.copy(this.desiredPos);
      this.lookTarget.copy(this.desiredLook);
      this.initialized = true;
    } else {
      // Framerate-independent easing: convert a per-60fps-frame factor to dt.
      const posA = 1 - Math.pow(1 - CAMERA.posLerp, dt * 60);
      const lookA = 1 - Math.pow(1 - CAMERA.lookLerp, dt * 60);
      this.camera.position.lerp(this.desiredPos, posA);
      this.lookTarget.lerp(this.desiredLook, lookA);
    }

    this.camera.lookAt(this.lookTarget);
  }
}

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fold an angle into (-π, π] so easing back from a multi-turn spin goes the short way. */
function wrapPi(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
}
