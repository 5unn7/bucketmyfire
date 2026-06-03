import * as THREE from 'three';
import { HAZE, HAZE_SLOTS } from '../config';

/**
 * Heat-haze refraction post pass (Track B4) — the "this is HOT" shimmer that real-time-VFX
 * artists call out as the single biggest cheap realism win for fire. A LATE pass (after
 * tonemap): it warps the image UVs by a panning value-noise field, masked to a soft,
 * UPWARD-biased lobe over the hottest on-screen fires. Hot air rises, so each lobe sits a
 * little above the flame crown and tapers up the column; below the seat it's cut off fast.
 *
 * No extra scene render — it just re-samples the already-composited frame (`tDiffuse`) at a
 * nudged UV. The fire positions arrive each frame as a FIXED-length array (`uFires[HAZE_SLOTS]`,
 * xy = screen-UV center, z = screen radius, w = strength 0..1) projected by `Composer.render`;
 * the array length is baked into the GLSL at module load, so the loop never recompiles at
 * runtime (mobile-60fps invariant). Gated to med/high tiers by virtue of living in the
 * composer chain — the low tier skips post entirely, so heat haze just isn't there.
 */
export function createHeatHazeShader() {
  const SLOTS = Math.max(1, Math.floor(HAZE_SLOTS));
  // Reused Vector4 pool — Composer mutates these in place each frame (no per-frame alloc).
  const fires: THREE.Vector4[] = [];
  for (let i = 0; i < SLOTS; i++) fires.push(new THREE.Vector4(0, 0, 0, 0));

  return {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uTime: { value: 0 },
      uAspect: { value: 1 }, // width/height — keeps the noise + mask circular in pixels
      uStrength: { value: HAZE.strength },
      uNoiseScale: { value: HAZE.noiseScale },
      uNoiseSpeed: { value: HAZE.noiseSpeed },
      uFires: { value: fires }, // xy = screen UV center, z = screen radius, w = strength 0..1
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
      uniform float uAspect;
      uniform float uStrength;
      uniform float uNoiseScale;
      uniform float uNoiseSpeed;
      uniform vec4 uFires[ ${SLOTS} ];
      varying vec2 vUv;

      const int SLOTS = ${SLOTS};

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        // Accumulate a refraction offset from every active fire lobe, then take ONE warped
        // sample (cheap — the per-fire work is just a mask, not a texture tap).
        float mask = 0.0;
        for (int i = 0; i < SLOTS; i++) {
          vec4 f = uFires[i];
          if (f.w <= 0.0) continue;
          // Aspect-correct vector from the lobe center; make the lobe TALLER than wide and push
          // most of it ABOVE the seat (upward v reaches ~1.7× the radius, downward only ~0.55×).
          vec2 d = vUv - f.xy;
          d.x *= uAspect;
          float v = vUv.y - f.xy.y;
          d.y = v * (v > 0.0 ? 0.6 : 1.8);
          float radial = length(d) / max(f.z, 1e-4);
          mask += f.w * (1.0 - smoothstep(0.35, 1.0, radial));
        }
        mask = clamp(mask, 0.0, 1.0);

        vec2 off = vec2(0.0);
        if (mask > 0.001) {
          // Panning value-noise: the field scrolls UP (so the shimmer rises), warping mostly
          // sideways with a touch of vertical churn.
          vec2 q = vec2(vUv.x * uAspect, vUv.y) * uNoiseScale;
          float t = uTime * uNoiseSpeed;
          float nx = vnoise(q + vec2(0.0, -t)) - 0.5;
          float ny = vnoise(q.yx * 1.3 + vec2(5.2, -t * 1.27)) - 0.5;
          off = vec2(nx, ny * 0.5) * mask * uStrength;
        }
        gl_FragColor = texture2D(tDiffuse, vUv + off);
      }`,
  };
}
