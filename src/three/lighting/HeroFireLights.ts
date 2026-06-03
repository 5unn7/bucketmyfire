import * as THREE from 'three';
import { FIRELIGHT } from '../config';

/**
 * Hero fire lights (Track B3) — a FIXED pool of warm point-lights that throw real
 * light on the terrain around the nearest, hottest fires. The pool is added to the
 * scene ONCE and never grown or removed: each frame the lights are repositioned onto
 * the best few fires and their intensity is set (zeroed when there's no fire to light).
 * Adding/removing lights would change the light count and force shader recompiles —
 * exactly the mobile-60fps hazard that keeps per-fire lights disabled — so a constant
 * pool is the whole point.
 */
export interface FireLightTarget {
  x: number;
  y: number;
  z: number;
  intensity: number; // 0..1 relative burn strength
}

export class HeroFireLights {
  private readonly lights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < FIRELIGHT.count; i++) {
      const light = new THREE.PointLight(FIRELIGHT.color, 0, FIRELIGHT.distance, FIRELIGHT.decay);
      light.castShadow = false; // pooled fill light only — shadows would be far too costly
      light.visible = true; // never toggled; intensity 0 hides it without a recompile
      scene.add(light);
      this.lights.push(light);
    }
  }

  /**
   * Point the pool at the best fires for the current view: score each fire by heat and
   * nearness to the heli, take the top `count`, and drive each light's position +
   * flickering intensity. Unused lights drop to 0. `elapsed` drives the flicker phase.
   */
  update(fires: readonly FireLightTarget[], heli: THREE.Vector3, elapsed: number): void {
    // Score = heat weighted by proximity, so the lights favor the big fire you're near.
    const ranked = fires
      .map((f) => {
        const d2 = (f.x - heli.x) * (f.x - heli.x) + (f.z - heli.z) * (f.z - heli.z);
        return { f, score: f.intensity / (1 + d2 / 6000) };
      })
      .sort((a, b) => b.score - a.score);

    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const hit = ranked[i];
      if (!hit) {
        light.intensity = 0;
        continue;
      }
      const f = hit.f;
      light.position.set(f.x, f.y + FIRELIGHT.heightOffset, f.z);
      // Flicker each light on its OWN non-repeating noise stream (not a shared sine), so
      // the glow doesn't visibly pulse on a loop. `f.intensity` is the fire's heat
      // (intensity × size) → a bigger blaze throws more, reachier light.
      const flick = 1 + FIRELIGHT.flicker * fnoise(elapsed * 2.2 + i * 17.3);
      light.intensity = FIRELIGHT.intensity * f.intensity * flick;
      light.distance = FIRELIGHT.distance * (0.7 + 0.5 * f.intensity); // hotter → reaches farther
    }
  }
}

// --- Non-repeating 1-D value noise (cheap, no texture; matches meshes/fire.ts) -------
function hash1(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
/** Two-octave value noise centered on 0, range ~[-0.75, 0.75]. */
function fnoise(x: number): number {
  return (vnoise(x) - 0.5) + (vnoise(x * 2.3 + 11.7) - 0.5) * 0.5;
}
