import * as THREE from 'three';
import { SMOKE } from '../config';

/**
 * Per-fire smoke plumes (Track B4) — one pooled `THREE.Points` cloud shared by every
 * fire. A fixed ring buffer of `SMOKE.max` puffs is recycled on emit (no per-frame
 * allocation, no scene-graph churn), each a soft procedural disc in the fragment shader
 * (no texture, zero assets). Puffs rise from a fire's crown, EXPAND and fade over their
 * life, and BEND downwind — each frame their velocity is dragged toward the live wind
 * vector, so the whole column leans with the breeze exactly like the fire spread does.
 *
 * Engine-touching (it owns a Points mesh) so it lives outside `sim/`; the gameplay layer
 * calls `emit()` for each burning fire and `update(dt, windVx, windVz)` every frame.
 */
export class SmokePlume {
  readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array; // remaining seconds (≤0 = dead)
  private readonly maxLife: Float32Array; // this puff's own total lifetime (life scales with heat)
  private readonly aLife: Float32Array; // 1 fresh → 0 dead (size growth + alpha)
  private readonly aSeed: Float32Array; // per-puff variation
  private readonly aHeat: Float32Array; // per-puff fire heat 0..1 → bigger/darker/denser for hot fires
  private cursor = 0;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly seedAttr: THREE.BufferAttribute;
  private readonly heatAttr: THREE.BufferAttribute;

  constructor() {
    const n = SMOKE.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.aLife = new Float32Array(n);
    this.aSeed = new Float32Array(n);
    this.aHeat = new Float32Array(n);
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = -9999; // park dead far below

    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.aLife, 1).setUsage(THREE.DynamicDrawUsage);
    this.seedAttr = new THREE.BufferAttribute(this.aSeed, 1).setUsage(THREE.DynamicDrawUsage);
    this.heatAttr = new THREE.BufferAttribute(this.aHeat, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('aLife', this.lifeAttr);
    geom.setAttribute('aSeed', this.seedAttr);
    geom.setAttribute('aHeat', this.heatAttr);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(SMOKE.color) },
        uWarm: { value: new THREE.Color(SMOKE.warmColor) },
        uOpacity: { value: SMOKE.opacity },
        uStartSize: { value: SMOKE.startSize },
        uEndSize: { value: SMOKE.endSize },
        uHeatSize: { value: SMOKE.heatSize },
        uHeatOpacity: { value: SMOKE.heatOpacity },
        uHeatDarken: { value: SMOKE.heatDarken },
      },
      transparent: true,
      depthWrite: false, // smoke doesn't occlude the depth buffer; blends over the scene
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSeed;
        attribute float aHeat;
        varying float vLife;
        varying float vSeed;
        varying float vHeat;
        uniform float uStartSize;
        uniform float uEndSize;
        uniform float uHeatSize;
        void main() {
          vLife = aLife;
          vSeed = aSeed;
          vHeat = aHeat;
          float age = 1.0 - aLife;
          float size = mix(uStartSize, uEndSize, age); // billows out as it ages
          size *= 1.0 + uHeatSize * aHeat;              // a hot fire's puffs are much bigger
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uWarm;
        uniform float uOpacity;
        uniform float uHeatOpacity;
        uniform float uHeatDarken;
        varying float vLife;
        varying float vSeed;
        varying float vHeat;

        // Cheap 2-octave value noise to break the perfect disc into a billowy puff.
        float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main() {
          vec2 pc = gl_PointCoord - vec2(0.5);
          // Rotate each puff by a per-puff angle so the lumps don't all line up.
          float ang = vSeed * 6.2831;
          float c = cos(ang), s = sin(ang);
          pc = mat2(c, -s, s, c) * pc;
          float r = length(pc);
          if (r > 0.5) discard;
          // Lumpy soft edge: erode the falloff radius with noise → cauliflower billow.
          float n = vnoise(pc * 5.0 + vSeed * 17.0) * 0.5 + vnoise(pc * 11.0) * 0.25;
          float soft = smoothstep(0.5, 0.06, r + (n - 0.35) * 0.22);
          float age = 1.0 - vLife;
          float fadeIn = smoothstep(0.0, 0.16, age);   // ramp up just after birth
          // Denser for a hot fire → the column reads thick and fully obscures the flames.
          float alpha = uOpacity * (1.0 + uHeatOpacity * vHeat) * soft * fadeIn * vLife;
          // Charcoal base with per-puff tone variation (kills banding). The column stays OILY
          // DARK through the lower + mid pillar, greying/dispersing only way up high (old puffs).
          vec3 col = uColor * (0.7 + 0.5 * vSeed);
          col += vec3(0.06, 0.055, 0.05) * smoothstep(0.55, 1.0, age); // disperse/lighten near the anvil
          // A roaring fire makes near-black, light-eating smoke; a smoulder stays charcoal-grey.
          col *= 1.0 - uHeatDarken * vHeat;
          // Ember KISS: an additive warm glow on only the freshest puffs at the seat of a hot
          // fire (added AFTER the darken so it survives) — a smouldering underlight, not a tint.
          float warmth = smoothstep(0.2, 0.0, age) * vHeat;
          col += uWarm * warmth * 0.6;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }`,
    });

    this.points = new THREE.Points(geom, material);
    this.points.name = 'SmokePlume';
    this.points.frustumCulled = false;
  }

  /**
   * Emit one puff from a fire crown at (x, y, z). `heat` 0..1 (intensity × size) scales
   * the rise speed, lifetime, jitter, and the per-puff `aHeat` the shader reads to make
   * a hot fire's column taller, bigger, denser, and darker — so a big blaze obscures itself.
   */
  emit(x: number, y: number, z: number, heat: number): void {
    const h = heat < 0 ? 0 : heat > 1 ? 1 : heat;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SMOKE.max;
    const p = i * 3;
    const jitter = 3 + 20 * h; // base spans the flame wall — a big blaze has a broad column foot
    this.positions[p] = x + (Math.random() - 0.5) * jitter;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z + (Math.random() - 0.5) * jitter;
    this.velocities[p] = (Math.random() - 0.5) * SMOKE.spread;
    this.velocities[p + 1] = SMOKE.rise * (0.6 + 0.9 * h); // hotter → rises faster/higher
    this.velocities[p + 2] = (Math.random() - 0.5) * SMOKE.spread;
    const life = SMOKE.life * (0.8 + 0.4 * Math.random()) * (0.7 + 0.6 * h); // hotter → lingers longer
    this.life[i] = life;
    this.maxLife[i] = life;
    this.aLife[i] = 1;
    this.aSeed[i] = Math.random();
    this.aHeat[i] = h;
  }

  /**
   * Integrate every puff: cool the rise, drag the lateral velocity toward the wind
   * drift (so the column bends downwind), age, and expire. `windVx/windVz` are the
   * unit wind components (Wind.vx/vz); SMOKE.windInfluence scales them to a drift speed.
   */
  update(dt: number, windVx: number, windVz: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const driftX = windVx * SMOKE.windInfluence;
    const driftZ = windVz * SMOKE.windInfluence;
    const catchK = Math.min(1, SMOKE.windCatch * dt);
    const riseKeep = Math.max(0, 1 - SMOKE.riseDamp * dt);

    let anyAlive = false;
    for (let i = 0; i < SMOKE.max; i++) {
      let rem = this.life[i];
      if (rem <= 0) {
        this.aLife[i] = 0;
        continue;
      }
      const p = i * 3;
      this.velocities[p + 1] *= riseKeep; // cooling slows the rise
      this.velocities[p] += (driftX - this.velocities[p]) * catchK; // bend toward wind
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
      this.aLife[i] = this.maxLife[i] > 0 ? rem / this.maxLife[i] : 0; // 1 fresh → 0 dead
      anyAlive = true;
    }

    if (anyAlive || this.points.visible) {
      this.posAttr.needsUpdate = true;
      this.lifeAttr.needsUpdate = true;
      this.seedAttr.needsUpdate = true;
      this.heatAttr.needsUpdate = true;
    }
    this.points.visible = anyAlive;
  }
}
