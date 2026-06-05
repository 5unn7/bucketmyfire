import * as THREE from 'three';
import { createSkyDome } from '../sky/SkyDome';
import { applyAtmosphere, SKY_PRESETS, SUN_DISTANCE } from '../sky/TimeOfDay';
import { FrameContext } from '../render/FrameContext';
import { TITLE } from '../config';
import { prefersReducedMotion } from '../ui/theme';

/**
 * AttractScene — the lightweight 3D backdrop that renders BEHIND the home-screen menu. It owns the
 * scene graph + camera (mirroring `Game`'s shape: `.scene`, `.camera`, `.sunDir`, `.update(dt)`,
 * `.resize()`, `.dispose()`), but NO renderer and NO DOM — `TitleScreen` drives it. The menu→mission
 * jump is a full page reload, so this scene is simply disposed when the player hits PLAY and the
 * gameplay renderer boots clean (no double-renderer cost).
 *
 * Phase 1 (skeleton): the shared gradient sky dome, a gently rolling boreal floor, sun + hemisphere
 * lighting and aerial-perspective fog (all from the `TimeOfDay` preset), and a slow cinematic camera
 * drift. The moving layers — a helicopter flyby, fire + smoke, drifting clouds, swaying trees — layer
 * onto this in later phases, all tuned from the `TITLE` block in `config.ts`.
 *
 * Mobile-60: built once at construction, O(1) per frame, no shader recompiles. Reduced-motion freezes
 * the camera to a static beauty frame (matching `GridTitle`'s reduced-motion treatment).
 */
export class AttractScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private readonly frame = new FrameContext();
  private readonly sun = new THREE.DirectionalLight();
  private readonly hemi = new THREE.HemisphereLight();
  private readonly skyDome: THREE.Mesh;

  private readonly sunPos = new THREE.Vector3(); // fixed sun position (origin is its target)
  private readonly origin = new THREE.Vector3(); // light/uSunDir target → uSunDir == preset.sunDir
  private readonly camBase = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly reduce = prefersReducedMotion();
  private t = 0;

  constructor(aspect: number, shadows: boolean) {
    const preset = SKY_PRESETS[TITLE.timeOfDay];

    // Camera — composed elevated frame looking out over the floor toward the low sun.
    this.camera = new THREE.PerspectiveCamera(TITLE.camera.fov, aspect, 1, 4000);
    this.camBase.set(TITLE.camera.pos.x, TITLE.camera.pos.y, TITLE.camera.pos.z);
    this.camTarget.set(TITLE.camera.target.x, TITLE.camera.target.y, TITLE.camera.target.z);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camTarget);

    // Sky dome reads the shared uSunDir; atmosphere wires sun/hemi colour + fog + background.
    this.skyDome = createSkyDome(this.frame, preset);
    this.scene.add(this.skyDome, this.sun, this.sun.target, this.hemi);
    applyAtmosphere(this.scene, this.sun, this.hemi, preset);

    // Fixed sun along the preset direction; target at the origin so uSunDir == preset.sunDir exactly.
    this.sunPos.copy(preset.sunDir).multiplyScalar(SUN_DISTANCE);
    this.sun.position.copy(this.sunPos);
    this.sun.target.position.copy(this.origin);
    if (shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const cam = this.sun.shadow.camera;
      cam.near = 1;
      cam.far = SUN_DISTANCE * 2.2;
      cam.left = cam.bottom = -180;
      cam.right = cam.top = 180;
      cam.updateProjectionMatrix();
    }

    this.scene.add(this.buildFloor(shadows));

    // Seed the shared uniforms once so the sky halo points at the sun on the very first frame.
    this.frame.update(0, TITLE.wind.x, TITLE.wind.z, this.sunPos, this.origin);
  }

  /** Normalized direction TOWARD the sun (for the post-fx god-rays). */
  get sunDir(): THREE.Vector3 {
    return this.frame.uSunDir.value;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.t += dt;
    // Advance the shared clock + ambient wind (sun is fixed). Drives foliage/smoke in later phases.
    this.frame.update(dt, TITLE.wind.x, TITLE.wind.z, this.sunPos, this.origin);

    // Slow cinematic camera drift — frozen for reduced-motion users (static beauty frame).
    if (!this.reduce) {
      const TWO_PI = Math.PI * 2;
      const sway = Math.sin(this.t * TITLE.camera.swayHz * TWO_PI) * TITLE.camera.driftX;
      const bob = Math.sin(this.t * TITLE.camera.bobHz * TWO_PI) * TITLE.camera.driftY;
      this.camera.position.set(this.camBase.x + sway, this.camBase.y + bob, this.camBase.z);
      this.camera.lookAt(this.camTarget);
    }

    // The dome rides with the camera so the horizon never slides or clips the far plane.
    this.skyDome.position.copy(this.camera.position);
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.scene.clear();
  }

  /** A single procedural plane rolled into low boreal hills, vertex-coloured by height and faded into
   *  the horizon by the preset fog. Built once — pure geometry + a MeshStandardMaterial. */
  private buildFloor(shadows: boolean): THREE.Mesh {
    const { size, segments, amplitude, frequency, colorLow, colorHigh } = TITLE.ground;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2); // lie flat in XZ, +Y up

    const pos = geo.attributes.position as THREE.BufferAttribute;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h =
        amplitude *
        (0.6 * Math.sin(x * frequency) * Math.cos(z * frequency * 0.8) +
          0.4 * Math.sin((x + z) * frequency * 1.7 + 1.3));
      pos.setY(i, h);
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }

    const lo = new THREE.Color(colorLow);
    const hi = new THREE.Color(colorHigh);
    const tint = new THREE.Color();
    const colors = new Float32Array(pos.count * 3);
    const span = Math.max(1e-3, maxY - minY);
    for (let i = 0; i < pos.count; i++) {
      tint.copy(lo).lerp(hi, (pos.getY(i) - minY) / span);
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = shadows;
    mesh.name = 'attractFloor';
    return mesh;
  }
}
