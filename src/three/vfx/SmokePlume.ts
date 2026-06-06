import * as THREE from 'three';
import { SMOKE } from '../config';
import type { FrameContext } from '../render/FrameContext';

/**
 * Per-fire smoke plumes (Track B4) as a VOLUME. One pooled `THREE.Points` cloud shared by every
 * fire: a fixed ring buffer of `SMOKE.max` puffs recycled on emit (no per-frame allocation, no
 * scene-graph churn). Each puff billboards a real soft smoke-puff SPRITE (`SMOKE.tex`, a downloaded
 * asset — see CREDITS.md), rotated by a per-puff angle so the lumps never line up. Puffs rise from a
 * fire's crown, EXPAND and fade over their life, and BEND downwind (velocity dragged toward the live
 * wind vector). The emission is dense and the puffs near-opaque, so the column reads as a solid
 * cloud you can't see through — the helicopter flies AROUND it.
 *
 * COLOR IS ZONED by how far a puff has climbed above the crown it left (`vRise`, world units):
 *   - fire-lit ORANGE→RED on the lowest puffs (the smoke base catches the flame's light),
 *   - oily NEAR-BLACK billows low in the fresh, dense body,
 *   - GREY for most of the column's height,
 *   - dispersing to PALE grey at the anvil / oldest puffs.
 *
 * NEBULA-STYLE LIFE (all GPU-side off the shared `uTime`, so still one draw call, no per-frame CPU,
 * no recompiles): each puff CHURNS (its sprite rotates continuously over its life, half CW / half
 * CCW), the column BILLOWS (a travelling sideways S-wave climbs it, so it convects and rolls instead
 * of rising as a straight cone), and the fire-lit base FLICKERS like living firelight. All tunable
 * in `SMOKE` (`spin`/`swayAmp`/`swayFreq`/`swayWave`/`warmFlicker`/`flickerSpeed`/`emberColor`).
 *
 * Engine-touching (it owns a Points mesh) so it lives outside `sim/`; the gameplay layer calls
 * `emit()` for each burning fire and `update(dt, windVx, windVz)` every frame.
 */
export class SmokePlume {
  readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array; // remaining seconds (≤0 = dead)
  private readonly maxLife: Float32Array; // this puff's own total lifetime (life scales with heat)
  private readonly aLife: Float32Array; // 1 fresh → 0 dead (size growth + alpha)
  private readonly aSeed: Float32Array; // per-puff variation (sprite rotation + tone)
  private readonly aHeat: Float32Array; // per-puff fire heat 0..1 → bigger/denser/darker for hot fires
  private readonly baseY: Float32Array; // the crown Y the puff left (for height-zoned color)
  private cursor = 0;
  // Live-puff budget. The ring buffer holds SMOKE.max slots, but a hot fire emitting at full rate over
  // the long puff lifetime can want MORE live puffs than the pool holds — the cursor then recycles a
  // puff that is still rising, which reads as a mid-air "teleport pop" on busy stages. We refuse to
  // emit once the pool is full (drop the puff rather than stomp a live one), so the column tops out at
  // its true capacity and never pops. Recounted authoritatively each update(); bumped per fresh emit.
  private aliveCount = 0;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly seedAttr: THREE.BufferAttribute;
  private readonly heatAttr: THREE.BufferAttribute;
  private readonly baseAttr: THREE.BufferAttribute;

  /**
   * @param frame the shared per-frame uniform bus — the shader grabs its `uTime` reference so the
   *   churn/billow/flicker advance off the same clock as every other animated material (no separate
   *   plumbing, no drift). Constructed in `Game` after `frame`, so the reference is live.
   */
  constructor(frame: FrameContext) {
    const n = SMOKE.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.aLife = new Float32Array(n);
    this.aSeed = new Float32Array(n);
    this.aHeat = new Float32Array(n);
    this.baseY = new Float32Array(n);
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = -9999; // park dead far below

    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.aLife, 1).setUsage(THREE.DynamicDrawUsage);
    this.seedAttr = new THREE.BufferAttribute(this.aSeed, 1).setUsage(THREE.DynamicDrawUsage);
    this.heatAttr = new THREE.BufferAttribute(this.aHeat, 1).setUsage(THREE.DynamicDrawUsage);
    this.baseAttr = new THREE.BufferAttribute(this.baseY, 1).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', this.posAttr);
    geom.setAttribute('aLife', this.lifeAttr);
    geom.setAttribute('aSeed', this.seedAttr);
    geom.setAttribute('aHeat', this.heatAttr);
    geom.setAttribute('aBaseY', this.baseAttr);

    // Real soft smoke-puff sprite (downloaded asset). It's a mask, not colour, so keep it linear;
    // mipmaps keep distant puffs from sparkling. The shader supplies all the colour (zoning).
    const tex = new THREE.TextureLoader().load(import.meta.env.BASE_URL + SMOKE.tex);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: tex },
        uTime: frame.uTime, // SHARED reference — churn/billow/flicker ride the global clock
        uBody: { value: new THREE.Color(SMOKE.bodyColor) },
        uDark: { value: new THREE.Color(SMOKE.darkColor) },
        uPale: { value: new THREE.Color(SMOKE.paleColor) },
        uWarm: { value: new THREE.Color(SMOKE.warmColor) },
        uEmber: { value: new THREE.Color(SMOKE.emberColor) },
        uOpacity: { value: SMOKE.opacity },
        uHeatOpacity: { value: SMOKE.heatOpacity },
        uStartSize: { value: SMOKE.startSize },
        uEndSize: { value: SMOKE.endSize },
        uHeatSize: { value: SMOKE.heatSize },
        uWarmRise: { value: SMOKE.warmRise },
        uWarmStrength: { value: SMOKE.warmStrength },
        uWarmFlicker: { value: SMOKE.warmFlicker },
        uFlickerSpeed: { value: SMOKE.flickerSpeed },
        uDarkLo: { value: SMOKE.darkLo },
        uDarkHi: { value: SMOKE.darkHi },
        uDarkStrength: { value: SMOKE.darkStrength },
        uPaleRise: { value: SMOKE.paleRise },
        uSpin: { value: SMOKE.spin },
        uSway: { value: SMOKE.swayAmp },
        uSwayFreq: { value: SMOKE.swayFreq },
        uSwayWave: { value: SMOKE.swayWave },
        uMaxScreenSize: { value: SMOKE.maxScreenSize },
        uNearFadeLo: { value: SMOKE.nearFadeLo },
        uNearFadeHi: { value: SMOKE.nearFadeHi },
      },
      transparent: true,
      depthWrite: false, // smoke doesn't occlude the depth buffer; blends (darkens) over the scene
      blending: THREE.NormalBlending, // OVER, not additive — it must DARKEN/hide what's behind
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSeed;
        attribute float aHeat;
        attribute float aBaseY;
        varying float vLife;
        varying float vSeed;
        varying float vHeat;
        varying float vRise;   // world units this puff has climbed above its crown
        varying float vViewZ;  // distance in FRONT of the camera (for the near-camera fade)
        varying float vAngle;  // continuously-churning sprite rotation (nebula-style roil)
        uniform float uTime;
        uniform float uStartSize;
        uniform float uEndSize;
        uniform float uHeatSize;
        uniform float uMaxScreenSize;
        uniform float uSpin;
        uniform float uSway;
        uniform float uSwayFreq;
        uniform float uSwayWave;
        void main() {
          vLife = aLife;
          vSeed = aSeed;
          vHeat = aHeat;
          vRise = position.y - aBaseY;
          float age = 1.0 - aLife;

          // CONVECTIVE BILLOW: a travelling sideways S-wave climbs the column, so the plume meanders
          // and rolls like real convection instead of rising as a straight cone. Anchored at the seat
          // (× age) and phased per-puff + by rise so neighbours wander out of step. World-space, before
          // model-view, so it bends the actual column (and reads from every camera angle).
          vec3 wp = position;
          float phase = aSeed * 6.2831 + vRise * uSwayWave;
          float swing = uSway * age * (0.5 + 0.5 * aHeat);
          wp.x += swing * sin(uTime * uSwayFreq + phase);
          wp.z += swing * cos(uTime * uSwayFreq * 1.13 + phase); // detuned → an orbital roll, not a flat sway

          // CHURN: each puff's sprite rotates continuously over its life, half CW / half CCW at a
          // seed-varied rate — the nebula "rotation.z" move that keeps the lumps roiling, not frozen.
          vAngle = aSeed * 6.2831 + uTime * uSpin * (aSeed - 0.5) * 2.0;

          float size = mix(uStartSize, uEndSize, age); // billows out as it ages
          size *= 1.0 + uHeatSize * aHeat;              // a hot fire's puffs are much bigger
          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          vViewZ = -mv.z;
          // Cap the on-screen size so no single puff can fill the whole frame (which would slam it
          // to a solid near-black) — many overlapping puffs build the volume, the fragment near-fade
          // dissolves the one you fly into.
          gl_PointSize = clamp(size * (300.0 / max(-mv.z, 1.0)), 1.0, uMaxScreenSize);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uTex;
        uniform float uTime;
        uniform vec3 uBody;
        uniform vec3 uDark;
        uniform vec3 uPale;
        uniform vec3 uWarm;
        uniform vec3 uEmber;
        uniform float uOpacity;
        uniform float uHeatOpacity;
        uniform float uWarmRise;
        uniform float uWarmStrength;
        uniform float uWarmFlicker;
        uniform float uFlickerSpeed;
        uniform float uDarkLo;
        uniform float uDarkHi;
        uniform float uDarkStrength;
        uniform float uPaleRise;
        uniform float uNearFadeLo;
        uniform float uNearFadeHi;
        varying float vLife;
        varying float vSeed;
        varying float vHeat;
        varying float vRise;
        varying float vViewZ;
        varying float vAngle;

        void main() {
          // Rotate each puff's UV by its continuously-churning angle so the lumps roil over their
          // life (and never read as a frozen tiled grid).
          vec2 pc = gl_PointCoord - vec2(0.5);
          float c = cos(vAngle), s = sin(vAngle);
          pc = mat2(c, -s, s, c) * pc;
          vec4 tex = texture2D(uTex, pc + vec2(0.5));
          float cover = tex.a;        // soft puff coverage (the sprite's alpha)
          if (cover < 0.01) discard;
          float dens = tex.r;         // internal luminance → density variation (denser core = darker)

          float age = 1.0 - vLife;
          float fadeIn = smoothstep(0.0, 0.16, age); // ramp up just after birth (no hard pop at the seat)
          float rise = vRise;

          // --- Height-zoned colour ------------------------------------------------------------
          // Grey body for most of the column, with a per-puff tone wobble to kill banding.
          vec3 col = uBody * (0.82 + 0.36 * vSeed);
          // Oily near-black band low in the fresh, dense body (denser texel → blacker).
          float dark = smoothstep(uDarkLo, uDarkLo + 10.0, rise) * (1.0 - smoothstep(uDarkHi, uDarkHi + 45.0, rise));
          dark *= uDarkStrength * (0.45 + 0.55 * vHeat) * (0.55 + 0.45 * dens);
          col = mix(col, uDark, clamp(dark, 0.0, 0.95));
          // Disperse/lighten toward the anvil (high rise) and as the puff ages out.
          float pale = smoothstep(uPaleRise, uPaleRise + 80.0, rise) + smoothstep(0.6, 1.0, age) * 0.4;
          col = mix(col, uPale, clamp(pale, 0.0, 0.7));
          // FIRE-LIT base: the lowest, freshest puffs catch the flame light. Like the nebula's coloured
          // point lights, the glow has TONE (orange soft rim → deep-red dense core) and FLICKERS like
          // living firelight (a cheap two-octave wobble off the shared clock, per-puff de-phased).
          float warm = smoothstep(uWarmRise, 0.0, rise) * vHeat * smoothstep(0.45, 0.0, age);
          float ph = vSeed * 40.0;
          float flick = 1.0 + uWarmFlicker * (0.6 * sin(uTime * uFlickerSpeed + ph)
                                            + 0.4 * sin(uTime * uFlickerSpeed * 1.7 + ph * 1.3));
          vec3 fireTone = mix(uWarm, uEmber, dens); // soft edges glow orange, the dense core glows red-hot
          col += fireTone * warm * uWarmStrength * flick;

          // Soft-particle NEAR fade: a puff you fly into dissolves as it nears the eye instead of
          // slamming the frame to solid near-black (the source of the into-smoke black flicker).
          float nearFade = smoothstep(uNearFadeLo, uNearFadeHi, vViewZ);
          float alpha = cover * uOpacity * (1.0 + uHeatOpacity * vHeat) * fadeIn * vLife * nearFade;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }`,
    });

    this.points = new THREE.Points(geom, material);
    this.points.name = 'SmokePlume';
    this.points.frustumCulled = false;
  }

  /**
   * Emit one puff from a fire crown at (x, y, z). `heat` 0..1 (intensity × size) scales the rise
   * speed, lifetime, jitter, and the per-puff `aHeat` the shader reads to make a hot fire's column
   * bigger and denser. The crown Y is stored so the shader can colour-zone the puff by how far it
   * later rises above it.
   */
  emit(x: number, y: number, z: number, heat: number): void {
    if (this.aliveCount >= SMOKE.max) return; // pool full — drop the puff, never recycle a live one
    const h = heat < 0 ? 0 : heat > 1 ? 1 : heat;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SMOKE.max;
    const wasAlive = this.life[i] > 0; // stomping the (rare) oldest live puff leaves the count flat
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
    this.baseY[i] = y; // the crown this puff left — height-zoned colour measures rise above it
    if (!wasAlive) this.aliveCount++; // filled a dead slot → one more live puff (a stomp keeps it flat)
  }

  /**
   * Integrate every puff: cool the rise, drag the lateral velocity toward the wind drift (so the
   * column bends downwind), age, and expire. `windVx/windVz` are the unit wind components
   * (Wind.vx/vz); SMOKE.windInfluence scales them to a drift speed.
   */
  update(dt: number, windVx: number, windVz: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const driftX = windVx * SMOKE.windInfluence;
    const driftZ = windVz * SMOKE.windInfluence;
    const catchK = Math.min(1, SMOKE.windCatch * dt);
    const riseKeep = Math.max(0, 1 - SMOKE.riseDamp * dt);

    let alive = 0;
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
      alive++;
    }
    this.aliveCount = alive; // authoritative live count — emit() budgets against it to fit the pool
    const anyAlive = alive > 0;

    if (anyAlive || this.points.visible) {
      this.posAttr.needsUpdate = true;
      this.lifeAttr.needsUpdate = true;
      this.seedAttr.needsUpdate = true;
      this.heatAttr.needsUpdate = true;
      this.baseAttr.needsUpdate = true;
    }
    this.points.visible = anyAlive;
  }
}
