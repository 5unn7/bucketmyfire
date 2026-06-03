import * as THREE from 'three';
import { FLIGHT } from '../config';

export interface FlightInput {
  /** Yaw: -1 turn the nose left … +1 turn right. The pilot steers directly. */
  turn: number;
  /** Throttle along the nose: -1 full reverse … +1 full forward (variable). */
  throttle: number;
  /** Collective: -1 descend … +1 climb. */
  lift: number;
}

/**
 * Engine-agnostic 3D flight model — the same momentum integrator that gave the
 * 2D prototype its "feels like real life" handling, lifted into a real Y-up
 * world. It owns only numbers (position, velocity, yaw/bank/pitch); the renderer
 * reads those out each frame and poses the mesh + camera. No Three.js scene
 * objects, no DOM — just the math, so the feel is independent of how we draw it.
 *
 * Conventions (the mesh + camera depend on these):
 *   - Y is up; the craft flies in the XZ plane with altitude along +Y.
 *   - The nose points local +X. With `group.rotation.y = yaw`, world-forward is
 *     (cos yaw, 0, -sin yaw). The pilot YAWS the nose directly (it does not chase
 *     velocity) and thrust is applied ALONG the nose, so the craft handles like a
 *     real helicopter: turn to point, throttle to go. This is what keeps the chase
 *     camera stable — the view only swings when the player deliberately turns.
 */
export class HelicopterSim {
  readonly position = new THREE.Vector3();
  /** Velocity: x/z horizontal, y vertical (units/s). */
  private readonly vel = new THREE.Vector3();

  yaw = 0; // heading (rad), about +Y
  bank = 0; // roll (rad), about the forward axis
  pitch = 0; // pitch (rad), about the lateral axis
  agl = FLIGHT.maxClearance; // height above the flight floor (above ground level)
  private altitude = FLIGHT.startAltitude;
  private altVel = 0; // vertical speed (units/s), eased toward the collective target
  // Last frame's horizontal velocity — differenced to get acceleration, which is
  // what the airframe pitches/banks toward (see the attitude block in update()).
  private prevVelX = 0;
  private prevVelZ = 0;
  // Eased control demands. Raw input (a key tap or stick flick) is a step; these
  // chase it with inertia so turns and throttle ramp in and roll out smoothly.
  private turnInput = 0;
  private throttleInput = 0;

  constructor(x = 0, z = 0) {
    this.position.set(x, FLIGHT.startAltitude, z);
  }

  /** Horizontal speed (units/s). */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Horizontal velocity components (units/s) — fed to the slung bucket. */
  get velX(): number {
    return this.vel.x;
  }

  get velZ(): number {
    return this.vel.z;
  }

  /**
   * Step the flight model. `floorY` is the World flight floor under the heli's XZ
   * (canopy clearance on land, scoop clearance over water); the altitude band rides
   * it so a fixed-collective descent always bottoms out the same height above
   * whatever's below. `payloadRatio` (water/capacity, 0..1) makes a full bucket fly
   * heavy: less thrust, lower top speed, weaker climb — recovers as it empties.
   */
  update(dt: number, input: FlightInput, floorY: number, payloadRatio = 0): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    const load = Number.isFinite(payloadRatio) ? THREE.MathUtils.clamp(payloadRatio, 0, 1) : 0;
    const enginePower = FLIGHT.enginePower * (1 - FLIGHT.payloadAccelPenalty * load);
    const maxSpeed = FLIGHT.maxSpeed * (1 - FLIGHT.payloadSpeedPenalty * load);
    const climbSpeed = FLIGHT.climbSpeed * (1 - FLIGHT.payloadClimbPenalty * load);

    // --- Smooth the raw inputs (a key tap or stick flick is a hard step) into eased
    // control demands, framerate-independent. This is the core of "smooth transitions":
    // turns and throttle now ramp in and ROLL OUT instead of snapping on/off. ---
    const ctlA = 1 - Math.pow(1 - FLIGHT.controlResponse, dt * 60);
    this.turnInput += (THREE.MathUtils.clamp(input.turn, -1, 1) - this.turnInput) * ctlA;
    this.throttleInput += (THREE.MathUtils.clamp(input.throttle, -1, 1) - this.throttleInput) * ctlA;

    // --- Yaw: the pilot turns the nose directly, at a rate set by the (smoothed) stick.
    // (No more chasing the velocity vector — that was what made the view swing.) ---
    const turn = this.turnInput;
    this.yaw -= turn * FLIGHT.yawRate * dt; // stick-right turns the nose toward screen-right

    // Nose-forward unit vector for the current heading.
    const fx = Math.cos(this.yaw);
    const fz = -Math.sin(this.yaw);

    // --- Horizontal: thrust ALONG THE NOSE (variable with smoothed throttle), drag, cap ---
    let throttle = this.throttleInput;
    if (throttle < 0) throttle *= FLIGHT.reversePower; // tail-first flight is slower
    this.vel.x += fx * throttle * enginePower * dt;
    this.vel.z += fz * throttle * enginePower * dt;
    const drag = Math.max(0, 1 - FLIGHT.linearDrag * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > maxSpeed) {
      const k = maxSpeed / sp;
      this.vel.x *= k;
      this.vel.z *= k;
    }

    // --- Vertical: collective with WEIGHT, AGL. The commanded climb/descent rate
    // EASES in (rotor inertia, framerate-independent) rather than snapping. A loaded
    // bucket cuts climb power (climbSpeed above), drags the craft down with a constant
    // sink the rotor must fight, and makes the collective laggier — so a full heli
    // wallows and you must hold UP just to hold height. All of it fades as it drains. ---
    const lift = THREE.MathUtils.clamp(input.lift, -1, 1);
    const upRate = climbSpeed; // already payload-penalized above
    const downRate = FLIGHT.descendSpeed; // weight assists descent → no payload cut
    let targetAltVel = lift >= 0 ? lift * upRate : lift * downRate;
    targetAltVel -= FLIGHT.payloadSink * load; // a full bucket pulls the aircraft down
    const resp = FLIGHT.collectiveResponse * (1 - FLIGHT.payloadResponsePenalty * load);
    const altA = 1 - Math.pow(1 - resp, dt * 60); // per-60fps factor → framerate-independent ease
    this.altVel += (targetAltVel - this.altVel) * altA;
    this.altitude += this.altVel * dt;
    const minAlt = floorY + FLIGHT.minClearance;
    const maxAlt = floorY + FLIGHT.maxClearance;
    if (this.altitude < minAlt) {
      this.altitude = minAlt;
      if (this.altVel < 0) this.altVel = 0;
    } else if (this.altitude > maxAlt) {
      this.altitude = maxAlt;
      if (this.altVel > 0) this.altVel = 0;
    }
    this.agl = this.altitude - floorY;

    // --- Integrate position ---
    this.position.x += this.vel.x * dt;
    this.position.z += this.vel.z * dt;
    this.position.y = this.altitude;

    // --- Body attitude from REAL acceleration (the physics polish) ---
    // A helicopter tilts its rotor disc — and so its whole fuselage — in the
    // direction it's accelerating: nose-down to gain speed, nose-up flare to brake,
    // and banked into a turn (the centripetal pull as the velocity vector swings
    // around). We difference this frame's velocity to get acceleration, project it
    // onto the nose (forward) and right axes, and tilt toward it. The upshot is the
    // behaviour you'd expect from real footage: "throttle forward + turn right"
    // dives the nose forward AND rolls a bit to the right, all at once.
    const accX = (this.vel.x - this.prevVelX) / dt;
    const accZ = (this.vel.z - this.prevVelZ) / dt;
    this.prevVelX = this.vel.x;
    this.prevVelZ = this.vel.z;
    const rx = Math.sin(this.yaw); // right vector for this heading
    const rz = Math.cos(this.yaw);
    const fwdAcc = accX * fx + accZ * fz; // + = speeding up along the nose
    const rightAcc = accX * rx + accZ * rz; // + = pulled to the right (e.g. a right turn)
    const aRef = FLIGHT.enginePower; // normalize accel → roughly ±1 at full thrust

    // A fast-cruising heli sits persistently nose-down (disc tilted forward to hold
    // speed against drag); the acceleration term then adds the dive/flare on top.
    const fwdSpeed = this.vel.x * fx + this.vel.z * fz;
    const cruise = -(fwdSpeed / FLIGHT.maxSpeed) * FLIGHT.cruisePitch;
    const targetPitch = cruise - THREE.MathUtils.clamp(fwdAcc / aRef, -1, 1) * FLIGHT.maxPitch;
    const targetBank = -THREE.MathUtils.clamp(rightAcc / aRef, -1, 1) * FLIGHT.maxBank;
    this.bank = THREE.MathUtils.lerp(this.bank, targetBank, FLIGHT.bodyEase);
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, FLIGHT.bodyEase);
  }
}
