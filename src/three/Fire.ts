import * as THREE from 'three';
import { createFire, FireMesh } from './meshes/fire';
import { FIRE3D } from './config';

/**
 * A single forest fire: game logic (intensity that regrows when ignored and is
 * knocked down by water) wrapped around its procedural mesh. Mirrors the old 2D
 * `Fire`. At zero intensity it is extinguished and removed from the scene.
 *
 * Note: the mesh ships a per-fire point light, but we keep it DISABLED — with up
 * to a dozen-plus fires, that many dynamic lights forces shader recompiles on
 * spawn and strains mobile uniform budgets. The flames are emissive, so they
 * glow without it. A few hero lights can come back in the polish pass.
 */
export class Fire {
  private readonly mesh: FireMesh;
  private intensity = FIRE3D.maxIntensity;
  private extinguished = false;

  constructor(
    private readonly scene: THREE.Scene,
    readonly x: number,
    surfaceY: number,
    readonly z: number,
  ) {
    this.mesh = createFire();
    this.mesh.group.position.set(x, surfaceY, z);
    this.mesh.light.visible = false; // perf: avoid many dynamic lights (see class note)
    scene.add(this.mesh.group);
    this.apply();
  }

  get isExtinguished(): boolean {
    return this.extinguished;
  }

  /** Slow regrowth so fires you ignore creep back. */
  grow(dtMs: number): void {
    if (this.extinguished) return;
    this.intensity = Math.min(FIRE3D.maxIntensity, this.intensity + FIRE3D.regrowth * (dtMs / 1000));
    this.apply();
  }

  /**
   * Apply water by VOLUME (litres landing in radius this frame). Volume-based so
   * the knock-down is identical whether the water arrives as a fast one-shot dump
   * or a slow valve pour. Returns true if this extinguished the fire.
   */
  douse(litres: number): boolean {
    if (this.extinguished) return false;
    this.intensity -= FIRE3D.dousePerLitre * litres;
    if (this.intensity <= 0) {
      this.kill();
      return true;
    }
    this.apply();
    return false;
  }

  /** Per-frame living-flame wobble. */
  flicker(elapsedSeconds: number): void {
    if (!this.extinguished) this.mesh.flicker(elapsedSeconds);
  }

  private apply(): void {
    this.mesh.setIntensity(this.intensity / FIRE3D.maxIntensity);
  }

  private kill(): void {
    this.extinguished = true;
    this.scene.remove(this.mesh.group);
  }
}
