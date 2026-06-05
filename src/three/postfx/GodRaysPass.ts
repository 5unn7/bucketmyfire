import * as THREE from 'three';
import { GODRAYS } from '../config';

/**
 * Screen-space god-rays / crepuscular shafts (Track B — golden-hour). A classic occlusion-free
 * radial-blur light-shaft applied as a post pass: from each pixel we march toward the sun's
 * projected screen position, accumulating the BRIGHT parts of the lit frame (the sky/sun near the
 * horizon) with per-step decay. Dark geometry — the smoke column, the ridgelines — contributes
 * nothing, so it carves the shafts. The accumulated rays are added back onto the frame.
 *
 * No extra scene render and no depth read: the lit HDR frame IS the occlusion buffer (bright sky
 * vs dark hills). It slots into the EffectComposer right after the RenderPass, so the shafts then
 * bloom + tonemap with everything else. `uSunPos` (UV space) and `uIntensity` (faded out when the
 * sun is off-screen or below the horizon) are set per frame by `Composer.render`. The sample count
 * is baked into the GLSL at module load — a fixed-length loop, never recompiled at runtime
 * (mobile-60fps invariant). Gated to med/high tiers by virtue of living in the composer chain.
 */
export function createGodRaysShader() {
  const SAMPLES = Math.max(8, Math.floor(GODRAYS.samples));
  return {
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uSunPos: { value: new THREE.Vector2(0.5, 0.8) }, // sun position in UV space (0..1)
      uIntensity: { value: 0 }, // 0 = rays off (sun off-screen / below horizon)
      uDensity: { value: GODRAYS.density },
      uDecay: { value: GODRAYS.decay },
      uWeight: { value: GODRAYS.weight },
      uExposure: { value: GODRAYS.exposure },
      uThreshold: { value: GODRAYS.threshold },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uSunPos;
      uniform float uIntensity;
      uniform float uDensity;
      uniform float uDecay;
      uniform float uWeight;
      uniform float uExposure;
      uniform float uThreshold;
      varying vec2 vUv;

      const int SAMPLES = ${SAMPLES};

      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        if (uIntensity <= 0.001) { gl_FragColor = base; return; }

        // March from this pixel toward the sun, accumulating bright (sky/sun) samples. Dark
        // geometry sampled along the way adds ~nothing, so it occludes the shaft.
        vec2 delta = (vUv - uSunPos) * (uDensity / float(SAMPLES));
        vec2 coord = vUv;
        float illum = 1.0;
        vec3 rays = vec3(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          coord -= delta;
          // Mask samples that march off-screen. The composer's render target is ClampToEdge, so
          // sampling outside [0,1] repeats the edge texel and SMEARS it into a hard radial band —
          // the "broken rays" you get when the sun sits near / just past the frame edge (flying
          // toward a low sun). Off-screen = no sky there, so it must contribute nothing. When the
          // sun is fully on-screen every sample is in-bounds → identical to before.
          vec2 inb = step(vec2(0.0), coord) * step(coord, vec2(1.0));
          float onScreen = inb.x * inb.y;
          vec3 s = texture2D(tDiffuse, coord).rgb;
          float b = max(0.0, dot(s, vec3(0.299, 0.587, 0.114)) - uThreshold);
          rays += s * b * illum * uWeight * onScreen;
          illum *= uDecay;
        }
        rays *= uExposure * uIntensity;
        gl_FragColor = vec4(base.rgb + rays, base.a);
      }`,
  };
}
