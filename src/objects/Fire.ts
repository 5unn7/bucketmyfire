import Phaser from 'phaser';
import { FIRE } from '../constants';

/**
 * A single fire cell. Intensity drives its visual size and smoke output; it
 * regrows when left alone and is knocked down by water drops. At zero intensity
 * it is extinguished and removed from play.
 */
export class Fire {
  readonly sprite: Phaser.GameObjects.Image;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private intensity = FIRE.maxIntensity;
  private extinguished = false;

  constructor(
    private readonly scene: Phaser.Scene,
    public readonly x: number,
    public readonly y: number,
  ) {
    this.sprite = scene.add.image(x, y, 'fire').setDepth(20);
    this.smoke = scene.add.particles(x, y, 'smoke', {
      speed: { min: 8, max: 26 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.4, end: 1.4 },
      alpha: { start: 0.5, end: 0 },
      lifespan: 1800,
      frequency: 120,
      tint: 0x6b6b6b,
    });
    this.smoke.setDepth(40);
  }

  get isExtinguished(): boolean {
    return this.extinguished;
  }

  /** Slow regrowth so fires you ignore creep back. */
  grow(dtMs: number): void {
    if (this.extinguished) return;
    this.intensity = Math.min(FIRE.maxIntensity, this.intensity + FIRE.regrowth * (dtMs / 1000));
    this.applyVisual();
  }

  /** Apply water. Returns true if this drop extinguished the fire. */
  douse(dtMs: number): boolean {
    if (this.extinguished) return false;
    this.intensity -= FIRE.douseRate * (dtMs / 1000);
    if (this.intensity <= 0) {
      this.kill();
      return true;
    }
    this.applyVisual();
    return false;
  }

  private applyVisual(): void {
    const t = this.intensity / FIRE.maxIntensity;
    this.sprite.setScale(0.5 + t);
    this.smoke.frequency = 60 + (1 - t) * 200; // dying fires smoulder/smoke more
  }

  private kill(): void {
    this.extinguished = true;
    this.smoke.stop();
    this.scene.time.delayedCall(1800, () => this.smoke.destroy());
    this.sprite.destroy();
  }
}
