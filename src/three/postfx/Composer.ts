import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { QualityTier } from '../render/QualityTier';
import { POSTFX, GRADE, GODRAYS, HAZE } from '../config';
import { createGodRaysShader } from './GodRaysPass';
import { createHeatHazeShader } from './HeatHaze';

/** A fire the heat-haze pass shimmers over — a world-space point + its 0..1 heat. */
export interface HazeSource {
  x: number;
  y: number;
  z: number;
  heat: number;
}

/**
 * Post-process chain (Track B3 + cinematic lens). A thin wrapper over an EffectComposer:
 *
 *   RenderPass → [GodRaysPass] → UnrealBloomPass → OutputPass(ACES tonemap + sRGB) → [HeatHaze] → GradePass
 *
 * Bloom is the glow that makes the emissive fires and sun halo bloom; the **GradePass** is
 * the "lens" — a teal-orange color grade (cool shadows, warm highlights), a vignette, and
 * animated film grain — that fuses the fire, smoke, and water layers into one cinematic
 * image. The path is chosen ONCE at load by quality tier: high renders bloom at full res,
 * med at half-res (cheaper), low skips the composer entirely (bare renderer → no grade, the
 * cheapest fallback). `render()` dispatches to the composer or the bare renderer.
 */

// Cinematic grade + vignette + film grain. Operates on the display-referred image from
// OutputPass (a "look" grade, applied in display space on purpose). uTime animates grain.
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uWarm: { value: GRADE.warmHighlights },
    uCool: { value: GRADE.coolShadows },
    uSat: { value: GRADE.saturation },
    uContrast: { value: GRADE.contrast },
    uVignette: { value: GRADE.vignette },
    uGrain: { value: GRADE.grain },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uWarm;
    uniform float uCool;
    uniform float uSat;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));

      // Teal-orange grade: cool the shadows, warm the highlights (split-tone by luma).
      vec3 cool = vec3(-0.5, 0.05, 1.0) * uCool;   // toward teal in the shadows
      vec3 warm = vec3(1.0, 0.35, -0.6) * uWarm;   // toward orange in the highlights
      col += mix(cool, warm, smoothstep(0.15, 0.85, lum));

      // Saturation + a gentle contrast S-curve around mid grey.
      col = mix(vec3(lum), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;

      // Vignette: darken toward the corners to frame the eye on the action.
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * dot(d, d) * 2.4;
      col *= clamp(vig, 0.0, 1.0);

      // Fine animated film grain — a touch heavier in the shadows (where film grain lives).
      float g = hash(vUv * uResolution + fract(uTime) * 1000.0) - 0.5;
      col += g * uGrain * (1.2 - lum);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Composer {
  private readonly composer: EffectComposer | null;
  private readonly grade: ShaderPass | null = null;
  private readonly godrays: ShaderPass | null = null;
  private readonly haze: ShaderPass | null = null;
  private aspect = 1;
  // Reusable scratch (no per-frame allocation) for projecting the sun + fires to screen space.
  private readonly sunWorld = new THREE.Vector3();
  private readonly camFwd = new THREE.Vector3();
  private readonly hazePt = new THREE.Vector3();
  private readonly hazeToFire = new THREE.Vector3();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    tier: QualityTier,
  ) {
    const bloom = tier.current.bloom;
    if (bloom <= 0) {
      this.composer = null;
      return;
    }

    const size = renderer.getSize(new THREE.Vector2());
    // Optional MSAA (WebGL2) on the composer target. Keep HalfFloat so the bloom
    // threshold still sees HDR (>1) pixels; setSize below scales it to the framebuffer.
    const samples = tier.current.msaa;
    const target =
      samples > 0
        ? new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples })
        : undefined;
    this.composer = new EffectComposer(renderer, target);
    // Render the WHOLE chain at the renderer's DPR so the scene stays sharp. (The old
    // `getPixelRatio() * bloom` scaled the entire composited image — not just the bloom
    // blur — so med rendered the frame BELOW 1 DPR and looked soft. Render resolution is
    // now the QualityTier's adaptive lever, re-applied via `setPixelRatio` below.)
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, camera));

    // God-rays first (operating on the lit HDR scene) so the shafts then bloom + tonemap with
    // everything else. Tier-gated automatically: this whole composer only exists on med/high.
    if (GODRAYS.enabled) {
      const godrays = new ShaderPass(createGodRaysShader());
      this.composer.addPass(godrays);
      this.godrays = godrays;
    }

    this.composer.addPass(
      new UnrealBloomPass(size, POSTFX.bloomStrength, POSTFX.bloomRadius, POSTFX.bloomThreshold),
    );
    this.composer.addPass(new OutputPass()); // ACES tone-map (from renderer) + sRGB

    // Heat haze: a subtle refraction over the rising hot air above each fire. After tonemap
    // (it's a UV warp, color-space agnostic), before the grade so vignette/grain stay stable.
    this.aspect = size.y > 0 ? size.x / size.y : 1;
    if (HAZE.enabled) {
      const haze = new ShaderPass(createHeatHazeShader());
      haze.uniforms.uAspect.value = this.aspect;
      this.composer.addPass(haze);
      this.haze = haze;
    }

    // Cinematic grade/vignette/grain — the final "lens" pass, rendered to screen.
    const grade = new ShaderPass(GRADE_SHADER);
    grade.uniforms.uResolution.value.set(size.x, size.y);
    this.composer.addPass(grade);
    this.grade = grade;
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
    this.grade?.uniforms.uResolution.value.set(width, height);
    this.aspect = height > 0 ? width / height : 1;
    if (this.haze) this.haze.uniforms.uAspect.value = this.aspect;
  }

  /** Re-apply the live render DPR from the QualityTier watchdog. Resizes the whole chain
   *  (recompile-free); no-op when the composer is off (low tier renders bare). */
  setPixelRatio(dpr: number): void {
    this.composer?.setPixelRatio(dpr);
  }

  /**
   * Render the frame: through the god-rays+bloom+haze+grade composer if enabled, else straight to
   * screen. `sunDir` (a unit vector pointing TOWARD the sun, world space) drives the god-rays;
   * `fires` (active fire crowns + heat) drive the heat-haze shimmer — pass both from the game each
   * frame. Without `sunDir` the shafts stay off; without `fires` the haze pass simply does nothing.
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    sunDir?: THREE.Vector3,
    fires?: readonly HazeSource[],
  ): void {
    if (this.composer) {
      const now = performance.now() * 0.001;
      if (this.grade) this.grade.uniforms.uTime.value = now;
      if (this.godrays && sunDir) this.updateSunRays(camera, sunDir);
      if (this.haze) this.updateHaze(camera, now, fires);
      this.composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  /** Project the hottest on-screen fire crowns into the haze pass's fixed uFires slots. Fires
   *  behind the camera or well off-screen / below `minHeat` are skipped (don't consume a slot);
   *  closer fires get a bigger screen radius. No allocation — mutates the pooled Vector4s. */
  private updateHaze(camera: THREE.Camera, time: number, fires?: readonly HazeSource[]): void {
    const u = this.haze!.uniforms;
    u.uTime.value = time;
    const slots = u.uFires.value as THREE.Vector4[];
    let n = 0;
    if (fires && fires.length) {
      camera.getWorldDirection(this.camFwd);
      for (let i = 0; i < fires.length && n < slots.length; i++) {
        const f = fires[i];
        if (f.heat <= HAZE.minHeat) continue;
        this.hazePt.set(f.x, f.y + HAZE.riseHeight, f.z);
        this.hazeToFire.copy(this.hazePt).sub(camera.position);
        if (this.hazeToFire.dot(this.camFwd) <= 0) continue; // behind the camera
        const dist = this.hazeToFire.length();
        this.hazePt.project(camera);
        const sx = this.hazePt.x * 0.5 + 0.5;
        const sy = this.hazePt.y * 0.5 + 0.5;
        if (sx < -0.3 || sx > 1.3 || sy < -0.3 || sy > 1.3) continue; // well off-frame
        const radius = Math.min(HAZE.maxRadius, HAZE.radiusWorld / Math.max(dist, 1));
        const strength = Math.min(1, (f.heat - HAZE.minHeat) / (1 - HAZE.minHeat));
        slots[n++].set(sx, sy, radius, strength);
      }
    }
    for (let i = n; i < slots.length; i++) slots[i].w = 0; // disable the unused tail
  }

  /** Project the (distant) sun to screen UV and fade the shafts when it's off-screen / below the
   *  horizon / behind the camera. No allocation — reuses scratch vectors. */
  private updateSunRays(camera: THREE.Camera, sunDir: THREE.Vector3): void {
    const u = this.godrays!.uniforms;
    // A far point along the sun direction from the eye, projected to NDC → its screen position.
    this.sunWorld.copy(sunDir).multiplyScalar(5000).add(camera.position);
    camera.getWorldDirection(this.camFwd);
    const inFront = this.camFwd.dot(sunDir) > 0; // sun is in the view hemisphere
    this.sunWorld.project(camera);
    const sx = this.sunWorld.x * 0.5 + 0.5;
    const sy = this.sunWorld.y * 0.5 + 0.5;
    u.uSunPos.value.set(sx, sy);

    // Fade out when the sun sets below the horizon, drops behind the camera, or drifts well
    // outside the frame (so the shafts never pop on/off).
    const above = THREE.MathUtils.smoothstep(sunDir.y, GODRAYS.belowHorizonFade, 0.25);
    const dx = Math.max(0, -sx, sx - 1);
    const dy = Math.max(0, -sy, sy - 1);
    const off = Math.hypot(dx, dy);
    const edge = 1 - THREE.MathUtils.smoothstep(off, 0, 0.6);
    u.uIntensity.value = inFront ? above * edge : 0;
  }
}
