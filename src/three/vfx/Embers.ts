import * as THREE from 'three';
import { EMBERS } from '../config';

/**
 * Fire embers / sparks (cinematic layer) — the tiny bright motes that stream up off a
 * blaze, tumble in the wind, twinkle, and die. The single highest-payoff "alive/scary"
 * detail in film fire. ONE pooled additive `THREE.Points` (fixed ring buffer of
 * `EMBERS.max`, recycled on emit → no per-frame allocation, no scene-graph churn), each a
 * soft procedural disc in the fragment shader (no texture, zero assets). Additive HDR
 * output feeds the bloom pass so the sparks glow like real embers.
 *
 * Engine-touching (owns a Points mesh) so it lives outside `sim/`; the gameplay layer calls
 * `emit()` per burning fire and `update(dt, windVx, windVz, elapsed)` every frame.
 */
export class Embers {
  readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array; // remaining seconds (≤0 = dead)
  private readonly aLife: Float32Array; // 1 fresh → 0 dead (size + color ramp)
  private readonly aSeed: Float32Array; // per-ember twinkle phase
  private cursor = 0;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly seedAttr: THREE.BufferAttribute;

  constructor() {
    const n = EMBERS.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.aLife = new Float32Array(n);
    this.aSeed = new Float32Array(n);
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = -9999; // park dead far below

    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.aLife, 1).setUsage(THREE.DynamicDrawUsage);
    this.seedAttr = new THREE.BufferAttribute(this.aSeed, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('aLife', this.lifeAttr);
    geom.setAttribute('aSeed', this.seedAttr);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: EMBERS.size },
        uHot: { value: new THREE.Color(EMBERS.colorHot) },
        uCool: { value: new THREE.Color(EMBERS.colorCool) },
        uTwinkleHz: { value: EMBERS.twinkleHz },
      },
      transparent: true,
      depthWrite: false, // sparks don't occlude; they blend over the scene
      blending: THREE.AdditiveBlending, // glow + feed the bloom pass
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSeed;
        varying float vLife;
        varying float vSeed;
        uniform float uSize;
        void main() {
          vLife = aLife;
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Bigger when fresh, shrinking as it cools; distance-attenuated.
          gl_PointSize = uSize * (0.35 + 0.65 * aLife) * (300.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uHot;
        uniform vec3 uCool;
        uniform float uTwinkleHz;
        varying float vLife;
        varying float vSeed;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5));
          if (r > 0.5) discard;
          float soft = smoothstep(0.5, 0.0, r);
          // Gentle flicker on each brand's own phase — a glowing ember breathing, not a strobing
          // spark. Lower amplitude so the field reads as drifting firebrands, not a sparkler.
          float tw = 0.72 + 0.28 * sin(uTime * uTwinkleHz + vSeed * 6.2831);
          // Cool from hot ember orange to deep red as it ages out.
          vec3 col = mix(uCool, uHot, vLife);
          gl_FragColor = vec4(col * tw, soft * clamp(vLife, 0.0, 1.0));
        }`,
    });

    this.points = new THREE.Points(geom, material);
    this.points.name = 'Embers';
    this.points.frustumCulled = false;
  }

  /**
   * Spawn one ember from the flame body at (x, y, z). `heat` 0..1 (intensity × size) scales
   * the rise speed and lateral spread so a roaring fire throws sparks higher and wider.
   */
  emit(x: number, y: number, z: number, heat: number): void {
    const h = heat < 0 ? 0 : heat > 1 ? 1 : heat;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % EMBERS.max;
    const p = i * 3;
    const spread = EMBERS.spread * (0.5 + 0.9 * h);
    this.positions[p] = x + (Math.random() - 0.5) * spread;
    this.positions[p + 1] = y + Math.random() * 2;
    this.positions[p + 2] = z + (Math.random() - 0.5) * spread;
    this.velocities[p] = (Math.random() - 0.5) * EMBERS.spread;
    this.velocities[p + 1] = EMBERS.rise * (0.5 + 0.9 * h) * (0.6 + 0.6 * Math.random());
    this.velocities[p + 2] = (Math.random() - 0.5) * EMBERS.spread;
    this.life[i] = EMBERS.life * (0.6 + 0.8 * Math.random());
    this.aLife[i] = 1;
    this.aSeed[i] = Math.random();
  }

  /**
   * Integrate every ember: buoyant rise that cools (slows) and gives way to gravity so the
   * spark arcs over, lateral drag toward the wind drift, then age + expire. `windVx/windVz`
   * are the unit wind components; `elapsed` drives the twinkle.
   */
  update(dt: number, windVx: number, windVz: number, elapsed: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    (this.points.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
    const driftX = windVx * EMBERS.windInfluence;
    const driftZ = windVz * EMBERS.windInfluence;
    const catchK = Math.min(1, EMBERS.windCatch * dt);
    const riseKeep = Math.max(0, 1 - EMBERS.riseDamp * dt);

    let anyAlive = false;
    for (let i = 0; i < EMBERS.max; i++) {
      let rem = this.life[i];
      if (rem <= 0) {
        this.aLife[i] = 0;
        continue;
      }
      const p = i * 3;
      this.velocities[p + 1] = this.velocities[p + 1] * riseKeep - EMBERS.gravity * dt; // buoyancy → fall
      this.velocities[p] += (driftX - this.velocities[p]) * catchK;
      this.velocities[p + 2] += (driftZ - this.velocities[p + 2]) * catchK;
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;

      rem -= dt;
      if (rem <= 0) {
        this.life[i] = 0;
        this.aLife[i] = 0;
        this.positions[p + 1] = -9999;
        continue;
      }
      this.life[i] = rem;
      this.aLife[i] = rem / EMBERS.life; // 1 fresh → 0 dead
      anyAlive = true;
    }

    if (anyAlive || this.points.visible) {
      this.posAttr.needsUpdate = true;
      this.lifeAttr.needsUpdate = true;
      this.seedAttr.needsUpdate = true;
    }
    this.points.visible = anyAlive;
  }
}
