import * as THREE from 'three';
import { CAMERA } from './config';
import { World } from './World';

/** Free-look orbit input fed in from a drag ANYWHERE on the flight view (the eye button was retired).
 *  While `active`, the per-frame deltas orbit the camera 1:1 with the drag (consumed directly — Input
 *  already accumulated them between frames); on release it eases back to the default trail. */
export interface LookOffset {
  active: boolean;
  yawDelta: number; // horizontal orbit increment this frame, rad (sign = direction)
  pitchDelta: number; // vertical orbit increment this frame, rad (+ = rise & look down)
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
  private aspect = 1; // viewport aspect (w/h); drives the portrait Hor+ FOV compensation
  private engage = 0; // 0..1 eased "bombing-run" look-down factor (lifts + tilts the cam over a drop)
  // Cold-start fly-in: 1 = normal trailing framing, 0 = full close-up on the parked heli. Defaults to 1
  // (no intro — the QA skip and any post-spool frame stay at flight framing); `beginIntro()` arms it to 0
  // when the engine-start ritual starts, and `update`'s `spool` pulls it back to 1 as the rotor tops out.
  // Monotonic toward 1 so a released START dial that bleeds RPM never pushes the camera back in.
  private introT = 1;

  constructor(aspect: number, private readonly world: World) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 2000);
    this.setAspect(aspect);
  }

  /**
   * Arm the cold-start fly-in: snap the camera CLOSE to the heli, to pull out to the normal trail as
   * the rotor spools (see `update`'s `spool`). Call once when the engine-start ritual begins — the QA
   * skip never calls it, so the camera stays at flight framing. `initialized = false` re-snaps so the
   * close-up is the OPENING pose (no sweep-in from wherever the cam sat during the briefing).
   */
  beginIntro(): void {
    this.introT = 0;
    this.initialized = false;
  }

  /**
   * Set the viewport aspect AND derive the vertical FOV. `fov` is VERTICAL, so a tall PORTRAIT viewport
   * crops the horizontal world away — the ground under the bucket vanishes (concern 6). Hor+ widens the
   * vertical fov in portrait to preserve a target HORIZONTAL fov, smoothstepped across a blend band so
   * there's no pop near aspect≈1. Landscape (aspect ≥ portraitFovBlendStart) stays EXACTLY CAMERA.fov.
   */
  setAspect(aspect: number): void {
    this.aspect = aspect;
    let vfov = CAMERA.fov;
    if (aspect < CAMERA.portraitFovBlendStart) {
      const targetH = (CAMERA.portraitHorizFovRef * Math.PI) / 180; // horizontal fov to preserve (rad)
      const hor = (2 * Math.atan(Math.tan(targetH / 2) / aspect) * 180) / Math.PI; // vfov that yields it (deg)
      const cap = Math.min(CAMERA.portraitVfovMax, hor); // clamp so extreme-narrow doesn't fisheye
      const u = (CAMERA.portraitFovBlendStart - aspect) / (CAMERA.portraitFovBlendStart - CAMERA.portraitFovBlendEnd);
      const s = Math.min(1, Math.max(0, u));
      const w = s * s * (3 - 2 * s); // smoothstep
      vfov = CAMERA.fov + (cap - CAMERA.fov) * w;
    }
    this.camera.fov = vfov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Re-aim behind `pos` for heading `yaw`. Call every frame after the sim. `arm` (0..1) requests the
   * gentle "bombing-run" look-down (Game arms it when low + slow + carrying water near a fire); it's
   * ignored while free-looking and — when `bombingPortraitOnly` — in landscape, and always eases in/out.
   */
  update(dt: number, pos: THREE.Vector3, yaw: number, look?: LookOffset, arm = 0, spool = 1): void {
    // Free-look: while active, add the drag DELTA directly so the camera orbits 1:1 with the finger /
    // mouse (Input accumulated the movement between frames). Yaw is unbounded (trig wraps it), so a
    // long drag can swing a full 360°. On release, fold any accumulated spins into (-π, π] so the ease
    // takes the SHORT way home, then lerp both offsets back to 0 (the default trailing pose).
    if (look?.active) {
      this.curYaw += look.yawDelta;
      this.curPitch = clampN(this.curPitch + look.pitchDelta, CAMERA.lookPitchMin, CAMERA.lookPitchMax);
    } else {
      if (this.wasLooking) this.curYaw = wrapPi(this.curYaw);
      const lookA = 1 - Math.pow(1 - CAMERA.lookReturnLerp, dt * 60);
      this.curYaw -= this.curYaw * lookA;
      this.curPitch -= this.curPitch * lookA;
    }
    this.wasLooking = !!look?.active;

    // Bombing-run assist: ease `engage` toward the armed target — but never while the player is
    // free-looking (don't fight the orbit), and only in portrait when bombingPortraitOnly is set.
    const armTarget = look?.active
      ? 0
      : !CAMERA.bombingRun
        ? 0
        : CAMERA.bombingPortraitOnly && this.aspect >= 1
          ? 0
          : arm;
    this.engage += (armTarget - this.engage) * (1 - Math.pow(1 - CAMERA.bombingEngageLerp, dt * 60));
    // The effective pitch lifts + tilts the cam down by the engage factor (on top of any free-look pitch).
    const pitch = clampN(this.curPitch + CAMERA.bombingExtraPitch * this.engage, CAMERA.lookPitchMin, CAMERA.lookPitchMax);

    // Cold-start fly-in: pull the framing OUT from the close-up toward the normal trail as the rotor
    // spools, back-loaded (introPullStart) so the close-up holds through most of the start and only
    // settles into the trail as RPM tops out — landing on flight framing exactly when the engine is up.
    // Monotonic: introT only ever rises toward 1, so a released dial bleeding RPM never re-closes the cam.
    const pull = smoothstep(CAMERA.introPullStart, 1, spool);
    if (pull > this.introT) this.introT = pull;
    const distance = lerpN(CAMERA.introDistance, CAMERA.distance, this.introT);
    const height = lerpN(CAMERA.introHeight, CAMERA.height, this.introT);
    const lookAheadBase = lerpN(CAMERA.introLookAhead, CAMERA.lookAhead, this.introT);

    // World-forward for this heading (matches the sim's convention).
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);

    // Default trail sits at angle `atan2(-fz,-fx)` behind the heli; free-look adds
    // `curYaw` around it and `pitch` lifts the cam, shrinking the horizontal reach
    // so it orbits over the top rather than just drifting outward. With every offset
    // at 0 this reproduces the plain `pos - forward*distance` trail exactly.
    const ang = Math.atan2(-fz, -fx) + this.curYaw;
    const horiz = Math.cos(pitch);
    this.desiredPos.set(
      pos.x + Math.cos(ang) * distance * horiz,
      pos.y + height + CAMERA.bombingExtraHeight * this.engage + Math.sin(pitch) * distance,
      pos.z + Math.sin(ang) * distance * horiz,
    );
    // Ground-clearance guard: never let the cam sink below the terrain at its own
    // XZ (the trail point can be over a hill higher than the heli). Lift it to a
    // minimum clearance above the ground there so we never clip through a ridge.
    const groundMin = this.world.groundHeightAt(this.desiredPos.x, this.desiredPos.z) + CAMERA.minGroundClearance;
    if (this.desiredPos.y < groundMin) this.desiredPos.y = groundMin;
    // Aim ahead of the nose normally; as the orbit swings round the side/front, fade
    // the lead to 0 so the camera keeps looking right at the heli instead of past it.
    const ahead =
      (lookAheadBase + CAMERA.bombingExtraLookAhead * this.engage) *
      Math.max(0, 1 - Math.abs(this.curYaw) / (Math.PI * 0.5));
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

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite ease from 0→1 across [edge0, edge1] (flat outside) — the back-loaded fly-in pull-out curve. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Fold an angle into (-π, π] so easing back from a multi-turn spin goes the short way. */
function wrapPi(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
}
