import * as THREE from 'three';

/**
 * The shared per-frame uniform bus (B0). One instance holds the handful of values
 * that every animated material needs — elapsed time, wind, sun direction — as
 * THREE.Uniform-style `{ value }` objects. Materials grab the SAME references in
 * their onBeforeCompile, so a single `update()` here propagates to all of them with
 * zero per-material plumbing (and no risk of one shader drifting out of sync).
 *
 * It owns no scene objects; `Game.ts` feeds it the live wind + sun each frame. Fog
 * is intentionally NOT here — Three injects scene.fog into every material for free.
 */
export class FrameContext {
  /** Seconds since start — drives wave scroll, foam shimmer, flicker. */
  readonly uTime = { value: 0 };
  /** Wind in the XZ plane (vx, vz) — bends waves, particles, foliage later. */
  readonly uWind = { value: new THREE.Vector2(0, 0) };
  /** Normalized direction TOWARD the sun — for sky/foliage shading later. */
  readonly uSunDir = { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() };
  /**
   * Rotor downwash disc (C4): (centerX, centerZ, radius, strength). Materials that
   * react to the wash (foliage bend) read this same reference; `Game` refreshes it
   * each frame from the `RotorWash` signal + the heli's XZ via `setWash`.
   */
  readonly uWash = { value: new THREE.Vector4(0, 0, 1, 0) };

  /**
   * Advance the shared clock and refresh wind/sun. `windVx/windVz` come from
   * `Wind`; `sunPos`/`targetPos` from the heli-follow directional light.
   */
  update(dt: number, windVx: number, windVz: number, sunPos: THREE.Vector3, targetPos: THREE.Vector3): void {
    if (Number.isFinite(dt) && dt > 0) this.uTime.value += dt;
    this.uWind.value.set(windVx, windVz);
    this.uSunDir.value.copy(sunPos).sub(targetPos).normalize();
  }

  /** Refresh the rotor-downwash disc (world center XZ, radius, 0..1 strength). */
  setWash(x: number, z: number, radius: number, strength: number): void {
    this.uWash.value.set(x, z, radius, strength);
  }
}
