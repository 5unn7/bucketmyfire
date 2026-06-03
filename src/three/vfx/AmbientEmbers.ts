import * as THREE from 'three';
import { AMBIENT_EMBERS } from '../config';

/**
 * Ambient drifting embers (atmosphere layer) — the sparse, slow-floating amber motes that hang
 * in the air of a fire-season sky and give the scene LIFE even when you're not over a blaze. A
 * subtle cinematic touch distinct from `Embers.ts`: those are bright sparks thrown OFF a fire
 * that arc and die in ~2s; these are a persistent, gentle field that lives in a volume AROUND the
 * camera, drifts on the wind, breathes, and recycles forever — and THICKENS near active fires
 * (more motes respawn downwind of a blaze the closer you are to it).
 *
 * ONE pooled additive `THREE.Points` (fixed ring of `AMBIENT_EMBERS.max`, recycled in place → no
 * per-frame allocation, no scene-graph churn), each a soft procedural disc in the fragment shader
 * (no texture, zero assets). Additive HDR output feeds the bloom pass so the motes glow. Motes
 * fade in on birth, fade out near the volume edge (no pop), and are depth-tested so hills occlude
 * them. Engine-touching (owns a Points mesh) so it lives in `vfx/`, not `sim/`.
 */

/** Minimal fire shape this layer reads to bias spawns toward blazes (POJO — no FireSystem import). */
export interface AmbientFireLike {
  x: number;
  z: number;
  y: number;
  intensity: number; // 0..maxIntensity
  size: number; // 0..1
}

export class AmbientEmbers {
  readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array; // remaining seconds (≤0 = recycle)
  private readonly life0: Float32Array; // this mote's full lifetime (for the fade envelope)
  private readonly bright: Float32Array; // per-mote peak alpha scale (fire-fed brighter than ambient)
  private readonly aAlpha: Float32Array; // final per-frame alpha (envelope × dist-fade × bright)
  private readonly aTemp: Float32Array; // 0..1 colour temperature (1 hot amber → 0 deep ember)
  private readonly aSeed: Float32Array; // twinkle + size phase
  private seeded = false;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly tempAttr: THREE.BufferAttribute;
  private readonly seedAttr: THREE.BufferAttribute;

  constructor() {
    const n = AMBIENT_EMBERS.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.life0 = new Float32Array(n);
    this.bright = new Float32Array(n);
    this.aAlpha = new Float32Array(n);
    this.aTemp = new Float32Array(n);
    this.aSeed = new Float32Array(n);
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = -9999; // park until first seed

    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.tempAttr = new THREE.BufferAttribute(this.aTemp, 1).setUsage(THREE.DynamicDrawUsage);
    this.seedAttr = new THREE.BufferAttribute(this.aSeed, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('aAlpha', this.alphaAttr);
    geom.setAttribute('aTemp', this.tempAttr);
    geom.setAttribute('aSeed', this.seedAttr);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: AMBIENT_EMBERS.size },
        uHot: { value: new THREE.Color(AMBIENT_EMBERS.colorHot) },
        uCool: { value: new THREE.Color(AMBIENT_EMBERS.colorCool) },
        uTwinkleHz: { value: AMBIENT_EMBERS.twinkleHz },
      },
      transparent: true,
      depthWrite: false, // motes don't occlude; they blend over the scene
      depthTest: true, // …but hills/trees DO occlude them (a mote behind a ridge is hidden)
      blending: THREE.AdditiveBlending, // glow + feed the bloom pass
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aTemp;
        attribute float aSeed;
        varying float vAlpha;
        varying float vTemp;
        varying float vSeed;
        uniform float uSize;
        void main() {
          vAlpha = aAlpha;
          vTemp = aTemp;
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Tiny mote, mild per-mote size variation, distance-attenuated.
          gl_PointSize = uSize * (0.7 + 0.6 * aSeed) * (300.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uHot;
        uniform vec3 uCool;
        uniform float uTwinkleHz;
        varying float vAlpha;
        varying float vTemp;
        varying float vSeed;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5));
          if (r > 0.5) discard;
          float soft = smoothstep(0.5, 0.0, r);
          // Slow breathe on each mote's own phase — a glowing ember floating, never a strobe.
          float tw = 0.7 + 0.3 * sin(uTime * uTwinkleHz + vSeed * 6.2831);
          vec3 col = mix(uCool, uHot, vTemp);
          float a = vAlpha * soft * tw;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(col * tw, a);
        }`,
    });

    this.points = new THREE.Points(geom, material);
    this.points.name = 'AmbientEmbers';
    this.points.frustumCulled = false; // its AABB tracks the camera; never cull the field
  }

  /**
   * Drift + recycle the whole field around the camera. Motes that expire OR wander past the
   * volume edge respawn — biased toward active fires by `fireBias × proximity`, so the air reads
   * thicker with embers the closer you are to a blaze. `windVx/windVz` are the UNIT wind
   * components (carried at `windInfluence`); `elapsed` drives the twinkle. Fires is the live
   * cluster list (read-only) and `maxIntensity` normalizes their heat — no FireSystem import.
   */
  update(
    dt: number,
    camX: number,
    camY: number,
    camZ: number,
    windVx: number,
    windVz: number,
    elapsed: number,
    fires: readonly AmbientFireLike[],
    maxIntensity: number,
  ): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    (this.points.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
    const A = AMBIENT_EMBERS;

    // How "fiery" the camera's surroundings are (0..1) → how hard respawns are pulled to a fire.
    let nearStrength = 0;
    for (let k = 0; k < fires.length; k++) {
      const f = fires[k];
      const dh = Math.hypot(f.x - camX, f.z - camZ);
      if (dh >= A.fireSenseRadius) continue;
      const heat = Math.min(1, f.intensity / maxIntensity);
      const s = heat * (1 - dh / A.fireSenseRadius);
      if (s > nearStrength) nearStrength = s;
    }
    const bias = A.fireBias * nearStrength;

    const driftX = windVx * A.windInfluence;
    const driftZ = windVz * A.windInfluence;
    const catchK = Math.min(1, A.windCatch * dt);
    const recycle2 = (A.radius * A.recycleScale) * (A.radius * A.recycleScale);

    for (let i = 0; i < A.max; i++) {
      if (!this.seeded || this.life[i] <= 0) {
        this.respawn(i, camX, camY, camZ, windVx, windVz, fires, maxIntensity, bias);
        continue;
      }
      const p = i * 3;
      // Gentle motion: ease lateral toward the wind drift, add a slow per-mote sway, keep a soft
      // buoyant rise. No gravity/arc-over — these LINGER, they don't spark-and-fall.
      this.velocities[p] += (driftX - this.velocities[p]) * catchK;
      this.velocities[p + 2] += (driftZ - this.velocities[p + 2]) * catchK;
      const sway = Math.sin(elapsed * A.swayHz + this.aSeed[i] * 6.2831) * A.swayAmp;
      this.positions[p] += (this.velocities[p] + sway) * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += (this.velocities[p + 2] - sway) * dt;

      const rem = this.life[i] - dt;
      const dh2 = (this.positions[p] - camX) * (this.positions[p] - camX) + (this.positions[p + 2] - camZ) * (this.positions[p + 2] - camZ);
      if (rem <= 0 || dh2 > recycle2) {
        this.life[i] = 0;
        this.respawn(i, camX, camY, camZ, windVx, windVz, fires, maxIntensity, bias);
        continue;
      }
      this.life[i] = rem;

      // Envelope: fade IN over the first slice of life, hold, fade OUT at the end → no birth/death
      // pop. Plus a radial fade so motes dim as they near the volume edge (where they recycle).
      const ageFrac = 1 - rem / this.life0[i];
      const fadeIn = smooth01(ageFrac / A.fadeIn);
      const fadeOut = smooth01((1 - ageFrac) / A.fadeOut);
      const distFade = Math.max(0, 1 - Math.sqrt(dh2) / A.radius);
      this.aAlpha[i] = A.baseAlpha * this.bright[i] * fadeIn * fadeOut * distFade;
    }
    this.seeded = true;

    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.tempAttr.needsUpdate = true;
    this.seedAttr.needsUpdate = true;
  }

  /** Place a recycled mote — near a weighted-random nearby fire (downwind) when biased, else
   *  uniformly in the air around the camera. Sets pos/vel/life/colour-temp/brightness. */
  private respawn(
    i: number,
    camX: number,
    camY: number,
    camZ: number,
    windVx: number,
    windVz: number,
    fires: readonly AmbientFireLike[],
    maxIntensity: number,
    bias: number,
  ): void {
    const A = AMBIENT_EMBERS;
    const p = i * 3;
    let x: number;
    let y: number;
    let z: number;
    let vy: number;
    let temp: number;
    let bright: number;

    const f = bias > 0 && Math.random() < bias ? this.pickFire(fires, camX, camZ, maxIntensity) : null;
    if (f) {
      // Fire-fed: spawn a bit downwind + above the blaze, rising — a brighter, hotter ember.
      x = f.x + windVx * A.fireDownwind + (Math.random() - 0.5) * A.fireScatter;
      z = f.z + windVz * A.fireDownwind + (Math.random() - 0.5) * A.fireScatter;
      y = f.y + A.fireLift + Math.random() * A.fireLiftRand;
      vy = A.fireRise * (0.6 + 0.8 * Math.random());
      temp = 0.78 + 0.22 * Math.random();
      bright = A.fireBright;
    } else {
      // Ambient: anywhere in the air column around the camera (denser toward the middle).
      const ang = Math.random() * 6.2831;
      const rad = A.radius * Math.sqrt(Math.random());
      x = camX + Math.cos(ang) * rad;
      z = camZ + Math.sin(ang) * rad;
      y = camY - A.belowCam + Math.random() * (A.belowCam + A.aboveCam);
      vy = A.rise * (0.4 + Math.random());
      temp = 0.35 + 0.35 * Math.random();
      bright = A.ambientBright;
    }

    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z;
    this.velocities[p] = (Math.random() - 0.5) * A.drift;
    this.velocities[p + 1] = vy;
    this.velocities[p + 2] = (Math.random() - 0.5) * A.drift;
    const l = A.life * (0.5 + Math.random());
    this.life[i] = l;
    this.life0[i] = l;
    this.bright[i] = bright;
    this.aTemp[i] = temp;
    this.aSeed[i] = Math.random();
    this.aAlpha[i] = 0; // born invisible; the fade-in envelope brings it up next frame
  }

  /** Pick a nearby fire weighted by heat × proximity (so the hottest, closest blaze seeds most). */
  private pickFire(fires: readonly AmbientFireLike[], camX: number, camZ: number, maxIntensity: number): AmbientFireLike | null {
    const A = AMBIENT_EMBERS;
    let total = 0;
    for (let k = 0; k < fires.length; k++) {
      const f = fires[k];
      const dh = Math.hypot(f.x - camX, f.z - camZ);
      if (dh >= A.fireSenseRadius) continue;
      total += Math.min(1, f.intensity / maxIntensity) * (1 - dh / A.fireSenseRadius);
    }
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let k = 0; k < fires.length; k++) {
      const f = fires[k];
      const dh = Math.hypot(f.x - camX, f.z - camZ);
      if (dh >= A.fireSenseRadius) continue;
      r -= Math.min(1, f.intensity / maxIntensity) * (1 - dh / A.fireSenseRadius);
      if (r <= 0) return f;
    }
    return null;
  }
}

/** Clamped smoothstep on a 0..1 input (the fade-in/out easing). */
function smooth01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}
