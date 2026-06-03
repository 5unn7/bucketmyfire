import Phaser from 'phaser';
import { HELI } from '../constants';

export interface FlightInput {
  /** Desired travel direction in world space, magnitude 0..1 (throttle). */
  move: Phaser.Math.Vector2;
  /** Hold to descend toward scoop altitude (dip the bucket). */
  descend: boolean;
}

/**
 * Momentum-based helicopter. We integrate velocity ourselves rather than
 * letting Arcade apply the input directly, so the aircraft carries inertia,
 * drifts on release, and swings its nose toward travel — the "feels like real
 * life" handling. Altitude is faked (shadow gap + sprite scale) for a top-down
 * view that still reads as airborne.
 */
export class Helicopter {
  readonly sprite: Phaser.Physics.Arcade.Image;
  private readonly rotor: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private altitude = HELI.cruiseAltitude;
  private rotorAngle = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.shadow = scene.add.image(x, y, 'shadow').setDepth(1);
    this.sprite = scene.physics.add.image(x, y, 'heli').setDepth(100);
    this.rotor = scene.add.image(x, y, 'rotor').setDepth(101);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setCircle(20, 22, 8); // tight collision circle around the fuselage
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  /** True when low enough to dip the Bambi bucket into a lake. */
  get canScoop(): boolean {
    return this.altitude <= HELI.scoopAltitude + 6;
  }

  /** Current heading in radians (nose points +x). */
  get rotation(): number {
    return this.sprite.rotation;
  }

  /** Velocity components (px/s) — fed to the slung bucket and the rotor audio. */
  get velocityX(): number {
    return (this.sprite.body as Phaser.Physics.Arcade.Body).velocity.x;
  }

  get velocityY(): number {
    return (this.sprite.body as Phaser.Physics.Arcade.Body).velocity.y;
  }

  /** Current speed (px/s). */
  get speed(): number {
    return (this.sprite.body as Phaser.Physics.Arcade.Body).velocity.length();
  }

  update(dtMs: number, input: FlightInput): void {
    const dt = dtMs / 1000;
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    const v = body.velocity;

    // Thrust → velocity, with air drag and a hard speed cap.
    v.x += input.move.x * HELI.enginePower * dt;
    v.y += input.move.y * HELI.enginePower * dt;
    const drag = Math.max(0, 1 - HELI.linearDrag * dt);
    v.x *= drag;
    v.y *= drag;
    const speed = v.length();
    if (speed > HELI.maxSpeed) v.scale(HELI.maxSpeed / speed);

    // Nose swings toward the direction of travel.
    if (speed > 12) {
      const heading = Math.atan2(v.y, v.x);
      this.sprite.rotation = Phaser.Math.Angle.RotateTo(
        this.sprite.rotation,
        heading,
        HELI.yawLerp,
      );
    }

    // Altitude lerp + faked-height visuals.
    const targetAlt = input.descend ? HELI.scoopAltitude : HELI.cruiseAltitude;
    this.altitude = Phaser.Math.Linear(this.altitude, targetAlt, HELI.altitudeLerp);
    const scale = 1 + this.altitude * HELI.scalePerAltitude;
    this.sprite.setScale(scale);

    const gap = this.altitude * HELI.shadowSpread;
    this.shadow.setPosition(this.sprite.x + gap, this.sprite.y + gap);
    this.shadow.setScale(scale * 0.9);
    this.shadow.setAlpha(Phaser.Math.Clamp(0.45 - this.altitude * 0.002, 0.12, 0.45));

    // Rotor blur spins independent of heading.
    this.rotorAngle += HELI.rotorSpinSpeed * dt;
    this.rotor.setPosition(this.sprite.x, this.sprite.y);
    this.rotor.setRotation(this.rotorAngle);
    this.rotor.setScale(scale);
  }
}
