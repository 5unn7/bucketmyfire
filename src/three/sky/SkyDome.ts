import * as THREE from 'three';
import { FrameContext } from '../render/FrameContext';
import { SkyPreset } from './TimeOfDay';

/**
 * Gradient sky dome (Track B2) — a big inverted sphere shaded from a horizon haze up
 * to a deeper zenith blue, with a soft halo bloomed around the sun. It replaces the
 * flat background color so the sky reads with depth, and its horizon band matches the
 * fog color so distant hills dissolve seamlessly into it (aerial perspective).
 *
 * The sun direction comes from the shared `FrameContext.uSunDir` (the same uniform the
 * water reads), so the glow tracks the actual light with zero extra plumbing. The dome
 * is meant to follow the camera each frame (the caller copies camera position onto it)
 * so the horizon always sits at eye level and it never clips the far plane.
 */
export function createSkyDome(frame: FrameContext, preset: SkyPreset): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1500, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, // seen from the inside
    depthWrite: false, // never occludes scene geometry
    fog: false, // the sky is the thing fog fades toward — don't fog it
    uniforms: {
      uZenith: { value: new THREE.Color(preset.zenith) },
      uHorizon: { value: new THREE.Color(preset.horizon) },
      uSunHalo: { value: new THREE.Color(preset.sunHalo) },
      uSunDir: frame.uSunDir, // shared live uniform (direction toward the sun)
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position); // dome is camera-centered → local dir = view dir
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uZenith, uHorizon, uSunHalo, uSunDir;
      void main() {
        // Vertical gradient: horizon haze → zenith, biased so most of the dome is sky.
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        // Aerial-perspective haze band: a thick, slightly brighter+warmer layer hugging the
        // horizon that thins with altitude, so distant ridges read as STACKED into layered
        // haze (depth) instead of meeting a hard fog wall. Pure gradient — load-once, no cost.
        float haze = pow(1.0 - h, 5.0);
        col = mix(col, uHorizon * 1.05 + vec3(0.015, 0.01, 0.0), haze * 0.3);
        // Sun halo: a broad warm glow plus a tight core where you look at the sun. The broad
        // term is widened a touch so the low golden sun washes warmth along the horizon.
        float d = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        float halo = pow(d, 5.0) * 0.5 + pow(d, 220.0) * 0.7;
        col += uSunHalo * halo;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'skyDome';
  mesh.renderOrder = -1000; // draw first, behind everything
  mesh.frustumCulled = false;
  return mesh;
}
