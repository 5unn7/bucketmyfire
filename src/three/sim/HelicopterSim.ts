import * as THREE from 'three';
import { FLIGHT, WASH, CRASH, resolveHeliClass, type HeliClass } from '../config';

export interface FlightInput {
  /** Yaw: -1 turn the nose left … +1 turn right. The pilot steers directly (right-stick X / pedals). */
  turn: number;
  /** Throttle along the nose: -1 full reverse … +1 full forward (variable). */
  throttle: number;
  /** Lateral cyclic: -1 strafe left … +1 strafe right — a sideways slide perpendicular to the nose
   *  (like a real helicopter rolling the disc). Optional + defaults to 0, so a zero/absent lateral
   *  leaves the model BIT-IDENTICAL (the verifiers drive turn/throttle/lift only). */
  lateral?: number;
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
  /** Downward speed (units/s) at the instant it bottomed out on the floor THIS frame, else 0.
   *  Read by Game as the hard-landing impact signal for the health/damage model. */
  landingImpact = 0;
  /** Crash state — set once the airframe flies into the canopy (a tree strike). While `crashing` the
   *  pilot has no control: Game stops calling update() and calls updateCrash() instead, which lets the
   *  dead airframe CRUMBLE and FALL to the ground. `crashLanded` latches for the single frame it hits
   *  the deck, where Game detonates the wreck. */
  crashing = false;
  crashLanded = false;
  /** Per-heli class — its capacity/feel/durability multipliers (defaults to the 205A-1 baseline). */
  private readonly cls: HeliClass;
  // Tumble rates (rad/s) of the dead airframe while it falls — seeded at the strike from the live state.
  private tumbleYaw = 0;
  private tumbleBank = 0;
  private tumblePitch = 0;
  private altitude = FLIGHT.startAltitude;
  private altVel = 0; // vertical speed (units/s), eased toward the collective target
  // Last frame's horizontal velocity — differenced to get acceleration, which is
  // what the airframe pitches/banks toward (see the attitude block in update()).
  private prevVelX = 0;
  private prevVelZ = 0;
  // Low-passed acceleration that DRIVES the airframe's nose-tilt/bank. The raw
  // per-frame difference is spiky (a throttle slam, the speed-cap clamp), and since
  // nose-down feeds MORE forward thrust (pitchThrust), driving pitch off that raw
  // signal porpoises ("see-saw"). Easing it first damps the loop — the commanded
  // dive-bomb / steer-bank bypass this, so the deliberate aerobatics are unaffected.
  private smFwdAcc = 0;
  private smRightAcc = 0;
  // Eased control demands. Raw input (a key tap or stick flick) is a step; these
  // chase it with inertia so turns, throttle AND collective ramp in and roll out
  // smoothly. Smoothing the lift demand here (not just the resulting climb rate)
  // gives the collective an S-curve onset instead of the single-lag jerk you get
  // when a full-deflection step hits the velocity ease cold.
  private turnInput = 0;
  private throttleInput = 0;
  private lateralInput = 0;
  private liftInput = 0;

  constructor(x = 0, z = 0, heliClass: HeliClass = resolveHeliClass()) {
    this.position.set(x, FLIGHT.startAltitude, z);
    this.cls = heliClass;
  }

  /**
   * Park the aircraft on the deck at (x, z): position + altitude sit on the flight floor and all
   * motion is zeroed — the cold-start pose before the pilot spools the rotors and lifts off. The
   * cold start freezes the flight step until the engine is up, so it stays put here until then.
   */
  land(x: number, z: number, floorY: number): void {
    const y = floorY + FLIGHT.minClearance;
    this.position.set(x, y, z);
    this.altitude = y;
    this.altVel = 0;
    this.vel.set(0, 0, 0);
    this.prevVelX = 0;
    this.prevVelZ = 0;
    this.smFwdAcc = 0;
    this.smRightAcc = 0;
    this.turnInput = 0;
    this.throttleInput = 0;
    this.lateralInput = 0;
    this.liftInput = 0;
    this.agl = FLIGHT.minClearance;
  }

  /**
   * Start airborne and stationary, hovering at cruise clearance over (x, z). This is the QA /
   * autostart pose: those URLs skip the hold-to-start ritual, but we still want to spawn OVER HOME
   * rather than the world origin (an origin spawn reads as "mid air in the middle of nowhere", with
   * the pad and the crew LZs far off in some random direction). Syncs altitude + agl to the flight
   * floor so the first integrated frame doesn't jump.
   */
  hoverAt(x: number, z: number, floorY: number): void {
    const y = floorY + FLIGHT.startClearance;
    this.position.set(x, y, z);
    this.altitude = y;
    this.altVel = 0;
    this.vel.set(0, 0, 0);
    this.prevVelX = 0;
    this.prevVelZ = 0;
    this.smFwdAcc = 0;
    this.smRightAcc = 0;
    this.turnInput = 0;
    this.throttleInput = 0;
    this.lateralInput = 0;
    this.liftInput = 0;
    this.agl = FLIGHT.startClearance;
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

  /** Vertical speed (units/s): + climbing, − descending. For the HUD's VSI. */
  get vertSpeed(): number {
    return this.altVel;
  }

  /**
   * Step the flight model. `floorY` is the World flight floor under the heli's XZ
   * (canopy clearance on land, scoop clearance over water); the altitude band rides
   * it so a fixed-collective descent always bottoms out the same height above
   * whatever's below. `payloadRatio` (water/capacity, 0..1) makes a full bucket fly
   * heavy: less thrust, lower top speed, weaker climb — recovers as it empties.
   * `windX/windZ` (world units/s) are the air mass moving over the ground: the
   * craft's GROUND velocity is its airspeed plus the wind, so a headwind eats your
   * ground speed and a tailwind adds to it (the displayed airspeed is unaffected).
   */
  update(
    dt: number,
    input: FlightInput,
    floorY: number,
    payloadRatio = 0,
    windX = 0,
    windZ = 0,
    groundEffect = 0,
  ): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    // Per-heli class scales the airframe's power/feel; the payload penalties then stack on top.
    const cls = this.cls;
    const load = Number.isFinite(payloadRatio) ? THREE.MathUtils.clamp(payloadRatio, 0, 1) : 0;
    const enginePower = FLIGHT.enginePower * cls.powerMul * (1 - FLIGHT.payloadAccelPenalty * load);
    const maxSpeed = FLIGHT.maxSpeed * cls.speedMul * (1 - FLIGHT.payloadSpeedPenalty * load);
    const climbSpeed = FLIGHT.climbSpeed * cls.climbMul * (1 - FLIGHT.payloadClimbPenalty * load);

    // --- Smooth the raw inputs (a key tap or stick flick is a hard step) into eased
    // control demands, framerate-independent. This is the core of "smooth transitions":
    // turns and throttle now ramp in and ROLL OUT instead of snapping on/off. ---
    const ctlA = 1 - Math.pow(1 - FLIGHT.controlResponse * cls.controlMul, dt * 60);
    this.turnInput += (THREE.MathUtils.clamp(input.turn, -1, 1) - this.turnInput) * ctlA;
    this.throttleInput += (THREE.MathUtils.clamp(input.throttle, -1, 1) - this.throttleInput) * ctlA;
    this.lateralInput += (THREE.MathUtils.clamp(input.lateral ?? 0, -1, 1) - this.lateralInput) * ctlA;
    this.liftInput += (THREE.MathUtils.clamp(input.lift, -1, 1) - this.liftInput) * ctlA;

    // --- Yaw: the pilot turns the nose directly, at a rate set by the (smoothed) stick.
    // (No more chasing the velocity vector — that was what made the view swing.) ---
    const turn = this.turnInput;
    this.yaw -= turn * FLIGHT.yawRate * cls.yawMul * dt; // stick-right turns the nose toward screen-right

    // Nose-forward unit vector for the current heading, and the matching body-RIGHT vector (for strafe).
    const fx = Math.cos(this.yaw);
    const fz = -Math.sin(this.yaw);
    const rx = Math.sin(this.yaw); // body-right in world XZ (+ = the craft's right side)
    const rz = Math.cos(this.yaw);

    // --- Horizontal: thrust ALONG THE NOSE (variable with smoothed throttle), drag, cap ---
    let throttle = this.throttleInput;
    if (throttle < 0) throttle *= FLIGHT.reversePower; // tail-first flight is slower
    this.vel.x += fx * throttle * enginePower * dt;
    this.vel.z += fz * throttle * enginePower * dt;
    // Lateral cyclic strafe: thrust along body-RIGHT, weaker than forward (FLIGHT.lateralPower). It joins
    // the same vel → drag → speed-cap path below, and its acceleration flows into the attitude block's
    // `rightAcc`, so the airframe BANKS into the slide automatically — like a real helicopter.
    const lateral = this.lateralInput;
    this.vel.x += rx * lateral * enginePower * FLIGHT.lateralPower * dt;
    this.vel.z += rz * lateral * enginePower * FLIGHT.lateralPower * dt;
    // Cyclic-forward: a nose-down disc tilts the thrust vector forward, so committing
    // to a dive adds REAL speed on top of throttle (the helicopter trades height for
    // velocity). Uses last frame's pitch — the one-frame lag is imperceptible. Pitch is
    // negative nose-down, so `dive` is how far the nose is tucked below level.
    const dive = Math.max(0, -this.pitch);
    this.vel.x += fx * dive * FLIGHT.pitchThrust * dt;
    this.vel.z += fz * dive * FLIGHT.pitchThrust * dt;
    // Flare braking: a pitched-up disc tilts thrust backward, decelerating you — mirror of the dive surge.
    const noseUp = Math.max(0, this.pitch);
    this.vel.x -= fx * noseUp * FLIGHT.flareBrake * dt;
    this.vel.z -= fz * noseUp * FLIGHT.flareBrake * dt;
    const drag = Math.max(0, 1 - FLIGHT.linearDrag * cls.dragMul * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    // Speed cap — RAISED while diving so a committed nose-down run outpaces level
    // cruise (a dive should feel like it gets away from you, then bleed off on the flare).
    const diveFrac = THREE.MathUtils.clamp(dive / FLIGHT.maxPitch, 0, 1);
    const speedCap = maxSpeed * (1 + FLIGHT.diveSpeedBoost * diveFrac);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > speedCap) {
      const k = speedCap / sp;
      this.vel.x *= k;
      this.vel.z *= k;
    }
    // Forward speed + cruise trim (reused by the dive coupling below AND the attitude
    // block). `cruise` is the steady nose-down a fast heli holds to fight drag.
    const fwdSpeed = this.vel.x * fx + this.vel.z * fz;
    const cruise = -(fwdSpeed / FLIGHT.maxSpeed) * FLIGHT.cruisePitch;

    // --- Vertical: collective with WEIGHT, AGL. The commanded climb/descent rate
    // EASES in (rotor inertia, framerate-independent) rather than snapping. A loaded
    // bucket cuts climb power (climbSpeed above), drags the craft down with a constant
    // sink the rotor must fight, and makes the collective laggier — so a full heli
    // wallows and you must hold UP just to hold height. All of it fades as it drains. ---
    const lift = this.liftInput; // smoothed collective demand (eased above, like turn/throttle)
    const upRate = climbSpeed; // already payload-penalized above
    const downRate = FLIGHT.descendSpeed; // weight assists descent → no payload cut
    let targetAltVel = lift >= 0 ? lift * upRate : lift * downRate;
    targetAltVel -= FLIGHT.payloadSink * load; // a full bucket pulls the aircraft down
    // Cyclic-forward DIVE: nosing over BEYOND the cruise trim trades height for speed —
    // you sink as you surge. Steady cruise (pitch ≈ trim) does NOT drift down; only the
    // active tuck opens a dive, and pulling UP collective arrests it. This is the vertical
    // half of the pitch coupling whose horizontal half is the thrust boost above.
    const diveExcess = Math.max(0, -(this.pitch - cruise));
    targetAltVel -= FLIGHT.pitchDive * diveExcess;
    // Ground effect (C4): close to the surface the rotor rides its own downwash cushion — a buoyant
    // assist that makes a low climb leap off the deck and helps haul a heavy bucket up. It's gated by
    // the COMMANDED collective (Math.max(0, lift)): it only adds when you're actually pulling UP, so a
    // landed or neutral-collective aircraft sits put instead of floating up on its own downwash, and a
    // full-DOWN descent to scoop still bottoms out on the floor.
    const ge = Number.isFinite(groundEffect) ? THREE.MathUtils.clamp(groundEffect, 0, 1) : 0;
    targetAltVel += WASH.groundLift * ge * Math.max(0, lift);
    const resp = FLIGHT.collectiveResponse * cls.collectiveMul * (1 - FLIGHT.payloadResponsePenalty * load);
    const altA = 1 - Math.pow(1 - resp, dt * 60); // per-60fps factor → framerate-independent ease
    this.altVel += (targetAltVel - this.altVel) * altA;
    this.altitude += this.altVel * dt;
    const minAlt = floorY + FLIGHT.minClearance;
    const maxAlt = floorY + FLIGHT.maxClearance;
    // Hard-landing signal: capture the DOWNWARD speed at the instant the heli bottoms out on the
    // floor (descending into it), then arrest it. Game reads this as the impact for the damage model;
    // cleared to 0 on any frame that doesn't bottom out, so it's a one-shot per touchdown.
    this.landingImpact = 0;
    if (this.altitude < minAlt) {
      if (this.altVel < 0) {
        this.landingImpact = -this.altVel;
        this.altVel = 0;
      }
      this.altitude = minAlt;
    } else if (this.altitude > maxAlt) {
      this.altitude = maxAlt;
      if (this.altVel > 0) this.altVel = 0;
    }
    this.agl = this.altitude - floorY;

    // --- Integrate position: GROUND velocity = airspeed + wind (so a headwind
    // drags you back over the ground, a tailwind pushes you along). Wind only takes
    // hold once you're actually flying — at/near a hover it fades out so the pilot
    // holds station and releasing the stick doesn't let the wind carry you away. ---
    const windGain = THREE.MathUtils.clamp(sp / FLIGHT.windHoldSpeed, 0, 1);
    this.position.x += (this.vel.x + windX * windGain) * dt;
    this.position.z += (this.vel.z + windZ * windGain) * dt;
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
    const fwdAcc = accX * fx + accZ * fz; // + = speeding up along the nose (rx/rz hoisted above)
    const rightAcc = accX * rx + accZ * rz; // + = pulled to the right (e.g. a right turn)
    const aRef = FLIGHT.enginePower; // normalize accel → roughly ±1 at full thrust
    // Low-pass the raw per-frame acceleration before it tilts the airframe. The raw
    // signal spikes on a throttle slam and at the speed cap, and because nose-down
    // feeds MORE thrust (pitchThrust below), driving pitch off the raw value porpoises
    // ("see-saw"). Easing it (framerate-independent) damps that loop into a smooth lean.
    const accA = 1 - Math.pow(1 - FLIGHT.attitudeAccelSmoothing, dt * 60);
    this.smFwdAcc += (fwdAcc - this.smFwdAcc) * accA;
    this.smRightAcc += (rightAcc - this.smRightAcc) * accA;

    // A fast-cruising heli sits persistently nose-down (disc tilted forward to hold
    // speed against drag — `cruise`, computed above); the acceleration term then adds
    // the dive/flare on top.
    let targetPitch = cruise - THREE.MathUtils.clamp(this.smFwdAcc / aRef, -1, 1) * FLIGHT.maxPitch;
    // NOTE: sign is MIRRORED (no leading minus) so a LEFT turn banks LEFT — left side drops,
    // right side rides high. The steer term below uses the matching sign so both reinforce.
    let targetBank = THREE.MathUtils.clamp(this.smRightAcc / aRef, -1, 1) * FLIGHT.maxBank;

    // --- Direct pilot attitude authority (AEROBATICS) — lean on the STICK, on TOP of the
    // acceleration-driven tilt above. This is the "throw it into a hard banked turn and
    // dive-bomb on command" layer; without it bank/pitch are only ever side effects. ---
    // Steering rolls the airframe directly. The centripetal bank alone is weak at this
    // game's slow cruise, so a turn barely dropped a wing — now the stick commands the
    // roll, scaled up with speed (a hover pedal-turn still banks a little: steerBankIdle).
    const moveFrac = THREE.MathUtils.clamp(this.speed / FLIGHT.maxSpeed, 0, 1);
    const steerGain = FLIGHT.steerBankIdle + (1 - FLIGHT.steerBankIdle) * moveFrac;
    targetBank += this.turnInput * FLIGHT.steerBank * steerGain;
    // Dive-bomb: shoving the nose DOWN (down collective) while carrying forward speed tucks the
    // airframe into a committed dive. The pitch→motion coupling above (which read last frame's pitch)
    // then turns this deeper nose-down into a real surging, sinking swoop next frame; haul UP collective
    // to kill the dive and flare out. Scaled by forward speed, so easing straight down onto a lake to
    // scoop barely noses over — only a fast forward descent opens a dive. `lift` is the smoothed
    // collective demand (−1 down … +1 up).
    const diveFwd = THREE.MathUtils.clamp(fwdSpeed / FLIGHT.maxSpeed, 0, 1);
    const diveCmd = Math.max(0, -lift) * diveFwd;
    targetPitch -= diveCmd * FLIGHT.diveCommand;
    // Flare: UP collective at forward speed pitches the nose back — mirror of the dive-bomb coupling.
    const flareCmd = Math.max(0, lift) * diveFwd;
    targetPitch += flareCmd * FLIGHT.flareCommand;

    // Hard envelope: accel + stick combined can't tumble the airframe past a sane lean.
    targetBank = THREE.MathUtils.clamp(targetBank, -FLIGHT.maxBankHard, FLIGHT.maxBankHard);
    targetPitch = THREE.MathUtils.clamp(targetPitch, -FLIGHT.maxPitchHard, FLIGHT.maxPitchHard);

    this.bank = THREE.MathUtils.lerp(this.bank, targetBank, FLIGHT.bodyEase);
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, FLIGHT.bodyEase);
  }

  /**
   * Begin a CRASH: the airframe has flown into the forest canopy (a rotor/fuselage strike). Flight is
   * over — the craft now CRUMBLES and FALLS under gravity (see `updateCrash`), tumbling, until it hits
   * the ground. It keeps its horizontal momentum (so it carries on into the trees) plus an immediate
   * downward kick, so a heli that was climbing at the strike still drops instead of floating up on the
   * last frame of lift. Tumble direction is seeded off the live state (no RNG → the pure sim stays
   * deterministic for the verifier, which never crashes). No-op if already crashing.
   */
  beginCrash(): void {
    if (this.crashing) return;
    this.crashing = true;
    this.crashLanded = false;
    this.altVel = Math.min(this.altVel, -CRASH.initialDrop); // ensure it starts falling, never floats up
    const s = Math.sign(this.bank + this.turnInput) || 1; // roll the way it was already leaning
    this.tumbleYaw = CRASH.tumbleYaw * s;
    this.tumbleBank = CRASH.tumbleRoll * s;
    this.tumblePitch = -CRASH.tumblePitch; // nose drops as it falls
  }

  /**
   * Step the airframe while it's CRASHING: no pilot input, no thrust. Gravity pulls it down (capped at
   * a terminal sink), its horizontal momentum bleeds via drag, and the body tumbles — the visible
   * crumble. When it bottoms out on the flight floor it settles and latches `crashLanded` for one frame
   * (Game detonates the wreck there). `floorY` is the World floor under the heli's XZ, same as update().
   */
  updateCrash(dt: number, floorY: number): void {
    this.crashLanded = false; // one-shot — true only on the touchdown frame
    this.landingImpact = 0; // the crash path detonates directly; never feed the hard-landing model
    if (!this.crashing || !Number.isFinite(dt) || dt <= 0) return;

    // Gravity → terminal fall.
    this.altVel = Math.max(-CRASH.maxFall, this.altVel - CRASH.gravity * dt);
    this.altitude += this.altVel * dt;

    // Horizontal momentum carries the wreck on, bleeding to a stop (the engine is dead — no thrust).
    const drag = Math.max(0, 1 - CRASH.fallDrag * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    this.position.x += this.vel.x * dt;
    this.position.z += this.vel.z * dt;

    // Tumble the airframe as it drops — the crumble.
    this.yaw += this.tumbleYaw * dt;
    this.bank += this.tumbleBank * dt;
    this.pitch += this.tumblePitch * dt;

    // Ground contact: settle on the floor and signal the detonation (once).
    const minAlt = floorY + FLIGHT.minClearance;
    if (this.altitude <= minAlt) {
      this.altitude = minAlt;
      this.altVel = 0;
      this.crashLanded = true;
    }
    this.position.y = this.altitude;
    this.agl = this.altitude - floorY;
  }
}
