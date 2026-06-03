import * as THREE from 'three';
import { SPRAY } from '../config';

/**
 * The water-drop spray (B4 first VFX / C2 drop splash). When the bucket releases, this
 * pours a cloud of droplets from its mouth that fall under gravity and die on impact
 * with the surface below. It is ONE pooled `THREE.Points` added to the scene once: a
 * fixed-size ring buffer of `SPRAY.max` particles, recycled on emit — so there are no
 * per-frame allocations and no scene-graph churn. Each droplet is a soft procedural
 * disc drawn in the fragment shader (no texture, no binary asset), fading with its life.
 *
 * Engine-touching by nature (it owns a Points mesh), so it lives outside `sim/`; the
 * gameplay layer just calls `emit()` while dropping and `update()` every frame.
 */
export class WaterSpray {
  readonly points: THREE.Points;

  private readonly positions: Float32Array; // x,y,z per particle
  private readonly velocities: Float32Array; // vx,vy,vz per particle
  private readonly life: Float32Array; // remaining seconds (≤0 = dead)
  private readonly aLife: Float32Array; // 0..1 normalized life → shader (size + alpha)
  private readonly aSize: Float32Array; // per-particle base size jitter
  private cursor = 0; // ring-buffer write head

  private readonly posAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;

  constructor() {
    const n = SPRAY.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.aLife = new Float32Array(n);
    this.aSize = new Float32Array(n);
    // Park every particle dead and far below so it never shows until emitted.
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = -9999;

    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.aLife, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('aLife', this.lifeAttr);
    geom.setAttribute('aSize', this.sizeAttr);

    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(SPRAY.color) } },
      transparent: true,
      depthWrite: false, // droplets don't occlude each other or write depth
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSize;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Size attenuation: shrink with distance and as the droplet ages out.
          gl_PointSize = aSize * aLife * (320.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vLife;
        void main() {
          // Soft round droplet: fade from solid center to transparent edge.
          float r = length(gl_PointCoord - vec2(0.5));
          if (r > 0.5) discard;
          float soft = smoothstep(0.5, 0.12, r);
          gl_FragColor = vec4(uColor, soft * clamp(vLife, 0.0, 1.0));
        }`,
    });

    this.points = new THREE.Points(geom, material);
    this.points.name = 'WaterSpray';
    this.points.frustumCulled = false; // particles span a moving volume; skip the cull test
  }

  /**
   * Spawn a burst of droplets from world (x, y, z), inheriting some horizontal heli
   * velocity so the column smears in the direction of travel. Recycles the oldest
   * slots via the ring buffer.
   */
  emit(x: number, y: number, z: number, heliVx: number, heliVz: number): void {
    for (let k = 0; k < SPRAY.perEmit; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % SPRAY.max;
      const p = i * 3;
      this.positions[p] = x + (Math.random() - 0.5) * 1.2;
      this.positions[p + 1] = y;
      this.positions[p + 2] = z + (Math.random() - 0.5) * 1.2;
      this.velocities[p] = heliVx * SPRAY.inherit + (Math.random() - 0.5) * SPRAY.spread;
      this.velocities[p + 1] = -SPRAY.speedDown * (0.6 + Math.random() * 0.6);
      this.velocities[p + 2] = heliVz * SPRAY.inherit + (Math.random() - 0.5) * SPRAY.spread;
      this.life[i] = SPRAY.life * (0.8 + Math.random() * 0.4);
      this.aSize[i] = SPRAY.size * (0.7 + Math.random() * 0.6);
    }
  }

  /**
   * Integrate gravity, age droplets, and kill any that fall to the surface (so the
   * splash lands on the ground/water instead of sinking through). `surfaceAt` returns
   * the water level over a lake, else the ground height. `onImpact` (optional) fires
   * once per killed droplet at its landing XZ — used to ripple lake hits.
   */
  update(
    dt: number,
    surfaceAt: (x: number, z: number) => number,
    onImpact?: (x: number, z: number) => void,
  ): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let anyAlive = false;
    for (let i = 0; i < SPRAY.max; i++) {
      let rem = this.life[i];
      if (rem <= 0) {
        this.aLife[i] = 0;
        continue;
      }
      const p = i * 3;
      this.velocities[p + 1] -= SPRAY.gravity * dt;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;

      rem -= dt;
      const hitSurface = this.positions[p + 1] <= surfaceAt(this.positions[p], this.positions[p + 2]);
      if (hitSurface || rem <= 0) {
        if (onImpact && hitSurface) onImpact(this.positions[p], this.positions[p + 2]);
        this.life[i] = 0;
        this.aLife[i] = 0;
        this.positions[p + 1] = -9999; // park it out of view
        continue;
      }
      this.life[i] = rem;
      this.aLife[i] = Math.min(1, rem / SPRAY.life);
      anyAlive = true;
    }

    // Push buffers to the GPU only while particles live (and once more on the frame
    // they all die, to hide them); idle frames upload nothing.
    if (anyAlive || this.points.visible) {
      this.posAttr.needsUpdate = true;
      this.lifeAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
    this.points.visible = anyAlive;
  }
}
