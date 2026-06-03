import * as THREE from 'three';

/**
 * Procedural forest fire for the 3D world.
 *
 * A cluster of glowing, flickering cone "tongues" plus a warm point light, all
 * built from primitive geometry — ZERO binary assets. The whole thing is driven
 * by a single intensity value in [0..1] so the game can shrink and dim it as the
 * player douses it (mirroring the old 2D `Fire.intensity`).
 *
 * Conventions: Y is up, and the flames are modeled with their BASE at local
 * y = 0 rising along +Y. The caller sets `group.position` to a point on the
 * terrain surface and the fire sits flush on the ground. `setIntensity(t)` is
 * called whenever the fire's health changes; `flicker(elapsed)` every frame for
 * a cheap living-flame wobble.
 */

export interface FireMesh {
  group: THREE.Group; // flames; modeled with the base at local y=0
  light: THREE.PointLight; // warm glow whose intensity tracks the fire
  setIntensity(t: number): void; // 0..1 — scale flame size + light + opacity; ~0 => barely visible
  flicker(elapsedSeconds: number): void; // call each frame for a cheap living-flame wobble
}

// One flame tongue: its mesh plus the deterministic per-tongue parameters that
// give the cluster variety (so they don't pulse in unison) and let us rebuild
// scale/opacity each frame from the current intensity.
interface Tongue {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseHeight: number; // full-intensity height of this cone, in units
  baseEmissive: number; // emissive strength at full intensity
  freq: number; // flicker frequency (rad/s) — varies per tongue
  phase: number; // flicker phase offset so tongues are out of step
  radius: number; // local XZ wobble radius
}

// Tallest tongue at full intensity. Spec asks ~3–5 units.
const FULL_HEIGHT = 4.4;

// Light sits a touch above the base so it pools warm light on the ground.
const LIGHT_Y = 1.5;
const LIGHT_MAX_INTENSITY = 6;
const LIGHT_MAX_DISTANCE = 40;

// Deterministic tongue layout: [heightFactor, emissive, color, offsetX, offsetZ].
// A brighter yellow inner core layered over deeper orange outer flames.
const TONGUES: ReadonlyArray<{
  heightFactor: number;
  emissive: number;
  color: number;
  ox: number;
  oz: number;
  radius: number;
}> = [
  // Outer deep-orange flames — wider, framing the core.
  { heightFactor: 0.78, emissive: 1.6, color: 0xd2431a, ox: -0.9, oz: 0.4, radius: 1.05 },
  { heightFactor: 0.9, emissive: 1.8, color: 0xe8631a, ox: 0.85, oz: -0.5, radius: 0.95 },
  { heightFactor: 0.7, emissive: 1.5, color: 0xc73a14, ox: 0.2, oz: 0.95, radius: 1.0 },
  // Inner bright yellow core — tallest and hottest, centered.
  { heightFactor: 1.0, emissive: 2.6, color: 0xffd24a, ox: 0.0, oz: 0.0, radius: 0.6 },
];

export function createFire(): FireMesh {
  const group = new THREE.Group();
  group.name = 'fire';

  const tongues: Tongue[] = [];

  TONGUES.forEach((spec, i) => {
    const height = FULL_HEIGHT * spec.heightFactor;
    // Low-poly cone: 6–7 radial segments is plenty for a mobile flame.
    const radialSegments = 7;
    const radius = 0.55 + spec.radius * 0.35;
    const geometry = new THREE.ConeGeometry(radius, height, radialSegments, 1, true);
    // ConeGeometry is centered on the origin; lift it so its base sits at y=0.
    geometry.translate(0, height / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: new THREE.Color(spec.color),
      emissiveIntensity: spec.emissive,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true, // so low intensity can fade the flames out
      opacity: 1.0,
      depthWrite: false, // overlapping translucent tongues blend cleanly
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(spec.ox, 0, spec.oz);
    mesh.castShadow = false; // emissive flames don't need to cast shadows
    mesh.receiveShadow = false;
    group.add(mesh);

    tongues.push({
      mesh,
      material,
      baseHeight: height,
      baseEmissive: spec.emissive,
      // Differing frequencies/phases per index so the cluster shimmers, not pulses.
      freq: 9 + i * 2.3,
      phase: i * 1.9,
      radius: spec.radius,
    });
  });

  // Warm orange point light, lifted off the base so it glows on the ground.
  const light = new THREE.PointLight(0xff7a18, LIGHT_MAX_INTENSITY, LIGHT_MAX_DISTANCE, 2);
  light.position.set(0, LIGHT_Y, 0);
  light.castShadow = false;
  group.add(light);

  // Current intensity, stored so flicker() can keep the wobble proportional.
  let intensity = 1;

  // Apply a static pose for the given intensity (no time term). flicker() layers
  // the per-frame wobble on top of this each frame.
  function setIntensity(t: number): void {
    intensity = THREE.MathUtils.clamp(t, 0, 1);

    for (const tongue of tongues) {
      // Height scales hardest with intensity; XZ shrinks more gently so a small
      // fire still reads as a flame, not a needle.
      tongue.mesh.scale.set(0.6 + 0.4 * intensity, intensity, 0.6 + 0.4 * intensity);
      // Fade out near zero so t≈0 is barely visible.
      tongue.material.opacity = intensity;
      tongue.material.emissiveIntensity = tongue.baseEmissive * intensity;
    }

    light.intensity = LIGHT_MAX_INTENSITY * intensity;
    light.distance = LIGHT_MAX_DISTANCE * (0.3 + 0.7 * intensity);
  }

  // Cheap living-flame wobble: modulate each tongue's vertical scale, emissive,
  // and lateral lean with a couple of sine terms at per-tongue frequencies, all
  // scaled by the stored intensity so a dying fire flickers low.
  function flicker(elapsedSeconds: number): void {
    // Wobble amplitude tracks intensity — near-dead fires barely move.
    const amp = intensity;

    for (const tongue of tongues) {
      const a = Math.sin(elapsedSeconds * tongue.freq + tongue.phase);
      const b = Math.sin(elapsedSeconds * tongue.freq * 0.43 + tongue.phase * 1.7);

      // Vertical lick: ±12% of base height, on top of the intensity-scaled height.
      const heightWobble = 1 + 0.12 * a * amp;
      tongue.mesh.scale.y = intensity * heightWobble;

      // Side-to-side sway: lean each tongue a little so the cluster looks blown
      // by its own heat. Cones pivot at their base (y=0), so a small tilt reads
      // as a flame licking sideways without lifting off the ground.
      tongue.mesh.rotation.z = b * 0.18 * tongue.radius * amp;
      tongue.mesh.rotation.x = a * 0.14 * tongue.radius * amp;

      // Heat shimmer: pulse the glow ±25% so the flames read as alive.
      const glow = 1 + 0.25 * a * amp;
      tongue.material.emissiveIntensity = tongue.baseEmissive * intensity * glow;
    }

    // Light breathes in sync with a blend of the tongue oscillations.
    const lightWobble = 1 + 0.18 * Math.sin(elapsedSeconds * 11 + 0.5) * amp;
    light.intensity = LIGHT_MAX_INTENSITY * intensity * lightWobble;
  }

  // Start at full intensity so a freshly created fire is fully lit.
  setIntensity(1);

  return { group, light, setIntensity, flicker };
}
